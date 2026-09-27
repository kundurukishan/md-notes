import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import capacities_backup as cb


def test_utf16_len_counts_surrogate_pairs():
    assert cb.utf16_len("abc") == 3
    assert cb.utf16_len("😀") == 2
    assert cb.utf16_len("é") == 1


def test_build_append_requests_indices():
    reqs = cb.build_append_requests(10, "Title😀", "meta", "# Body\n")
    insert = reqs[0]["insertText"]
    assert insert["location"]["index"] == 9
    assert insert["text"] == "\nTitle😀\nmeta\n\n# Body\n\n"
    heading = reqs[1]["updateParagraphStyle"]["range"]
    assert heading == {"startIndex": 10, "endIndex": 10 + 8}  # "Title" + 2 + "\n"
    body = reqs[2]["updateParagraphStyle"]["range"]
    assert body["startIndex"] == 18
    assert body["endIndex"] == 9 + cb.utf16_len(insert["text"])


def test_page_parsing_variants():
    assert cb._page_items({"objects": [{"id": 1}]}) == [{"id": 1}]
    assert cb._page_items({"results": [{"id": 2}]}) == [{"id": 2}]
    assert cb._page_items({}) == []
    assert cb._next_cursor({"nextCursor": "x"}) == "x"
    assert cb._next_cursor({"pagination": {"nextCursor": "y"}}) == "y"
    assert cb._next_cursor({"nextCursor": None}) is None


def test_list_objects_follows_cursor_and_stops_on_repeat():
    client = cb.CapacitiesClient("t")
    pages = [
        {"objects": [{"id": "a"}], "nextCursor": "c1"},
        {"objects": [{"id": "b"}], "nextCursor": "c1"},
    ]
    with mock.patch.object(client, "_get", side_effect=pages) as get:
        assert [o["id"] for o in client.list_objects("RootPage")] == ["a", "b"]
    assert get.call_count == 2


def test_object_title_and_timestamps():
    obj = {"properties": {
        "title": {"type": "title", "title": {"value": "Hello"}},
        "createdAt": {"type": "createdAt", "createdAt": {"value": "2026-09-01T10:00:00Z"}},
    }}
    assert cb.object_title(obj) == "Hello"
    assert cb.object_title({"title": "Direct"}) == "Direct"
    assert cb.object_title({}) == "Untitled"
    assert cb.object_timestamp(obj, "createdAt") == datetime(2026, 9, 1, 10, tzinfo=timezone.utc)
    assert cb.object_timestamp(obj, "lastUpdatedAt") is None


class FakeClient:
    def __init__(self, objects):
        self.objects = objects

    def structures(self):
        return [{"id": "RootPage"}, {"id": "RootTag"}, {"id": "MediaImage"}]

    def list_objects(self, sid):
        return [{"id": o["id"], "title": o["title"]} for o in self.objects] if sid == "RootPage" else []

    def get_object(self, oid):
        o = next(o for o in self.objects if o["id"] == oid)
        return {"id": oid, "structureId": "RootPage", "properties": {
            "title": {"type": "title", "title": {"value": o["title"]}},
            "createdAt": {"type": "createdAt", "createdAt": {"value": o["created"]}},
            "lastUpdatedAt": {"type": "lastUpdatedAt", "lastUpdatedAt": {"value": o["created"]}},
        }}

    def get_markdown(self, oid):
        return f"body of {oid}"


def _run(tmp_path, objects, *argv):
    fake_client = FakeClient(objects)
    fake_doc = mock.Mock()
    env = {"CAPACITIES_API_TOKEN": "t", "GOOGLE_DOC_ID": "d", "GOOGLE_SERVICE_ACCOUNT_JSON": "{}"}
    with mock.patch.dict("os.environ", env, clear=True), \
            mock.patch.object(cb, "CapacitiesClient", return_value=fake_client), \
            mock.patch.object(cb, "GoogleDoc", return_value=fake_doc):
        rc = cb.main(["--state-file", str(tmp_path / "state.json"), *argv])
    assert rc == 0
    return fake_doc, json.loads((tmp_path / "state.json").read_text())


def test_first_run_records_baseline_then_appends_only_new(tmp_path):
    old = {"id": "old", "title": "Old", "created": "2026-01-01T00:00:00Z"}
    doc, state = _run(tmp_path, [old])
    doc.append_note.assert_not_called()
    assert "old" in state["backed_up"]

    new2 = {"id": "n2", "title": "Second", "created": "2026-03-02T00:00:00Z"}
    new1 = {"id": "n1", "title": "First", "created": "2026-03-01T00:00:00Z"}
    fresh = {"id": "fresh", "title": "Draft",
             "created": datetime.now(timezone.utc).isoformat()}
    doc, state = _run(tmp_path, [old, new2, new1, fresh])
    titles = [c.args[0] for c in doc.append_note.call_args_list]
    assert titles == ["First", "Second"]  # oldest first; recently edited skipped
    assert {"n1", "n2"} <= state["backed_up"].keys()
    assert "fresh" not in state["backed_up"]

    doc, _ = _run(tmp_path, [old, new2, new1])
    doc.append_note.assert_not_called()


def test_include_existing_backs_up_everything(tmp_path):
    old = {"id": "old", "title": "Old", "created": "2026-01-01T00:00:00Z"}
    doc, state = _run(tmp_path, [old], "--include-existing")
    assert [c.args[0] for c in doc.append_note.call_args_list] == ["Old"]
    assert state["initialized"] is True
