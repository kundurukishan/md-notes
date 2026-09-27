#!/usr/bin/env python3
"""Back up new Capacities notes by appending them to a Google Doc.

Each run:
  1. lists the objects in your Capacities space (API 2.0),
  2. skips any object id already recorded in the state file,
  3. fetches each new object as Markdown and appends it to the Google Doc,
  4. records the id so it is never appended twice.

Configuration comes from environment variables (see README.md).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

CAPACITIES_API = os.environ.get("CAPACITIES_API_URL", "https://api.capacities.io")

# Built-in structures that are not "notes" and are skipped unless listed
# explicitly in CAPACITIES_STRUCTURE_IDS.
SKIPPED_STRUCTURES = {
    "RootSpace", "User", "UserPersonal", "RootDatabase", "RootQuery",
    "RootStructure", "RootEntity", "RootBlocksTemplate", "RootAIChat",
    "RootSimpleTable", "RootTag", "UtilDate",
    "MediaImage", "MediaPDF", "MediaAudio", "MediaVideo", "MediaFile",
}

# Capacities allows 30 requests / 60 s on the object endpoints.
MIN_REQUEST_INTERVAL = 2.1


class CapacitiesClient:
    def __init__(self, token: str, base_url: str = CAPACITIES_API):
        self.token = token
        self.base_url = base_url.rstrip("/")
        self._last_request = 0.0

    def _get(self, path: str, params: dict | None = None) -> dict:
        url = f"{self.base_url}{path}"
        if params:
            url += "?" + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
        for attempt in range(5):
            wait = self._last_request + MIN_REQUEST_INTERVAL - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last_request = time.monotonic()
            req = urllib.request.Request(url, headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/json",
            })
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    return json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code == 429 or e.code >= 500:
                    retry_after = e.headers.get("Retry-After")
                    delay = int(retry_after) if retry_after and retry_after.isdigit() else 2 ** (attempt + 2)
                    print(f"  {e.code} from {path}; retrying in {delay}s", file=sys.stderr)
                    time.sleep(delay)
                    continue
                body = e.read().decode(errors="replace")[:500]
                raise RuntimeError(f"GET {path} failed: {e.code} {body}") from None
        raise RuntimeError(f"GET {path} failed after retries")

    def structures(self) -> list[dict]:
        return self._get("/space/structures")["structures"]

    def list_objects(self, structure_id: str) -> list[dict]:
        """All objects of one structure, following pagination cursors."""
        objects: list[dict] = []
        cursor = None
        seen_cursors = set()
        while True:
            page = self._get("/objects/structure", {"structureId": structure_id, "cursor": cursor})
            objects.extend(_page_items(page))
            cursor = _next_cursor(page)
            if not cursor or cursor in seen_cursors:
                return objects
            seen_cursors.add(cursor)

    def get_object(self, object_id: str) -> dict:
        return self._get("/object", {"id": object_id})

    def get_markdown(self, object_id: str) -> str:
        return self._get("/object/markdown", {"id": object_id})["markdown"]


def _page_items(page: dict) -> list[dict]:
    for key in ("objects", "results", "items", "data"):
        if isinstance(page.get(key), list):
            return page[key]
    return []


def _next_cursor(page: dict) -> str | None:
    for key in ("nextCursor", "next_cursor", "cursor"):
        if page.get(key):
            return page[key]
    pagination = page.get("pagination") or {}
    return pagination.get("nextCursor") or pagination.get("cursor")


def object_title(obj: dict) -> str:
    if obj.get("title"):
        return obj["title"]
    prop = (obj.get("properties") or {}).get("title") or {}
    return (prop.get("title") or {}).get("value") or "Untitled"


def object_timestamp(obj: dict, kind: str) -> datetime | None:
    """Return the createdAt / lastUpdatedAt timestamp from an object, if present."""
    raw = obj.get(kind)
    if raw is None:
        for prop in (obj.get("properties") or {}).values():
            if isinstance(prop, dict) and prop.get("type") == kind:
                raw = (prop.get(kind) or {}).get("value")
                break
    if not raw:
        return None
    return datetime.fromisoformat(raw.replace("Z", "+00:00"))


# --- Google Docs -----------------------------------------------------------

def utf16_len(text: str) -> int:
    """Google Docs indexes are measured in UTF-16 code units."""
    return len(text.encode("utf-16-le")) // 2


def build_append_requests(end_index: int, title: str, meta: str, markdown: str) -> list[dict]:
    """Requests that append one note at the end of the document body.

    `end_index` is the endIndex of the document's last structural element; the
    final newline of the body cannot be written past, so text goes before it.
    """
    heading = f"{title}\n"
    body = f"{meta}\n\n{markdown.strip()}\n\n"
    text = "\n" + heading + body
    start = end_index - 1
    heading_start = start + 1
    heading_end = heading_start + utf16_len(heading)
    body_end = heading_end + utf16_len(body)
    return [
        {"insertText": {"location": {"index": start}, "text": text}},
        {"updateParagraphStyle": {
            "range": {"startIndex": heading_start, "endIndex": heading_end},
            "paragraphStyle": {"namedStyleType": "HEADING_2"},
            "fields": "namedStyleType",
        }},
        {"updateParagraphStyle": {
            "range": {"startIndex": heading_end, "endIndex": body_end},
            "paragraphStyle": {"namedStyleType": "NORMAL_TEXT"},
            "fields": "namedStyleType",
        }},
    ]


class GoogleDoc:
    def __init__(self, doc_id: str, credentials_json: str):
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        info = json.loads(credentials_json)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/documents"])
        self.doc_id = doc_id
        self.service = build("docs", "v1", credentials=creds, cache_discovery=False)

    def end_index(self) -> int:
        doc = self.service.documents().get(documentId=self.doc_id, fields="body/content/endIndex").execute()
        return doc["body"]["content"][-1]["endIndex"]

    def append_note(self, title: str, meta: str, markdown: str) -> None:
        requests = build_append_requests(self.end_index(), title, meta, markdown)
        self.service.documents().batchUpdate(documentId=self.doc_id, body={"requests": requests}).execute()


# --- State -----------------------------------------------------------------

def load_state(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {"initialized": False, "backed_up": {}}


def save_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n")
    tmp.replace(path)


# --- Main ------------------------------------------------------------------

def pick_structures(client: CapacitiesClient, configured: str | None) -> list[str]:
    if configured:
        return [s.strip() for s in configured.split(",") if s.strip()]
    return [s["id"] for s in client.structures()
            if s["id"] not in SKIPPED_STRUCTURES and not s["id"].startswith("Media")]


def run(args: argparse.Namespace) -> int:
    token = os.environ.get("CAPACITIES_API_TOKEN")
    if not token:
        print("CAPACITIES_API_TOKEN is not set", file=sys.stderr)
        return 2
    client = CapacitiesClient(token)
    state_path = Path(args.state_file)
    state = load_state(state_path)
    backed_up: dict = state["backed_up"]

    structure_ids = pick_structures(client, os.environ.get("CAPACITIES_STRUCTURE_IDS"))
    print(f"Checking structures: {', '.join(structure_ids)}")
    candidates = []
    for sid in structure_ids:
        for obj in client.list_objects(sid):
            if obj.get("id") and obj["id"] not in backed_up:
                obj.setdefault("structureId", sid)
                candidates.append(obj)
    print(f"{len(candidates)} object(s) not yet backed up")

    first_run = not state.get("initialized")
    if first_run and not args.include_existing:
        now = datetime.now(timezone.utc).isoformat()
        for obj in candidates:
            backed_up[obj["id"]] = {"title": object_title(obj), "baseline": now}
        state["initialized"] = True
        if not args.dry_run:
            save_state(state_path, state)
        print(f"First run: recorded {len(candidates)} existing object(s) as the baseline. "
              "Notes created from now on will be backed up. "
              "(Use --include-existing to back up everything instead.)")
        return 0

    doc = None
    if not args.dry_run:
        doc_id = os.environ.get("GOOGLE_DOC_ID")
        creds = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
        if not doc_id or not creds:
            print("GOOGLE_DOC_ID and GOOGLE_SERVICE_ACCOUNT_JSON must be set", file=sys.stderr)
            return 2
        doc = GoogleDoc(doc_id, creds)

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=args.min_age_minutes)
    notes = []
    for obj in candidates:
        full = client.get_object(obj["id"])
        created = object_timestamp(full, "createdAt") or object_timestamp(obj, "createdAt")
        updated = object_timestamp(full, "lastUpdatedAt") or created
        # Leave notes that are still being written for a later run.
        if updated and updated > cutoff:
            print(f"  skip (edited in the last {args.min_age_minutes} min): {object_title(full)}")
            continue
        notes.append((created or datetime.min.replace(tzinfo=timezone.utc), obj, full))

    appended = 0
    for created, obj, full in sorted(notes, key=lambda n: n[0]):
        title = object_title(full) if object_title(full) != "Untitled" else object_title(obj)
        if args.limit and appended >= args.limit:
            break
        markdown = client.get_markdown(obj["id"])
        created_str = created.strftime("%Y-%m-%d %H:%M UTC") if created.year > 1 else "unknown"
        meta = f"Created: {created_str} · Type: {full.get('structureId', obj['structureId'])} · ID: {obj['id']}"
        if args.dry_run:
            print(f"  [dry run] would append: {title} ({created_str})")
        else:
            doc.append_note(title, meta, markdown)
            backed_up[obj["id"]] = {"title": title, "appended": datetime.now(timezone.utc).isoformat()}
            state["initialized"] = True
            save_state(state_path, state)  # save after each note so a crash never duplicates
            print(f"  appended: {title}")
        appended += 1

    state["initialized"] = True
    if not args.dry_run:
        save_state(state_path, state)
    print(f"Done: {appended} note(s) {'would be ' if args.dry_run else ''}appended")
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--state-file", default=os.environ.get("STATE_FILE", "state/backed_up.json"),
                   help="JSON file recording which objects were already backed up")
    p.add_argument("--include-existing", action="store_true",
                   help="on the first run, back up all existing notes instead of recording them as a baseline")
    p.add_argument("--min-age-minutes", type=int, default=int(os.environ.get("MIN_AGE_MINUTES", "30")),
                   help="only back up notes not edited for this many minutes (default 30)")
    p.add_argument("--limit", type=int, default=0, help="append at most this many notes this run")
    p.add_argument("--dry-run", action="store_true", help="show what would be appended; change nothing")
    return run(p.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
