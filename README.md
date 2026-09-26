# md-notes

Backs up new [Capacities](https://capacities.io) notes by appending them to a Google Doc.

`capacities_backup.py` runs hourly via GitHub Actions. Each run lists the objects in your
Capacities space, finds the ones it hasn't backed up yet, fetches each one as Markdown, and
appends it to the end of your Google Doc. Each note gets a heading (the title), a line with
the creation date, type, and ID, and then the note body. The IDs of backed-up notes are kept
in `state/backed_up.json`, which the workflow commits back to the repo, so no note is appended
twice.

## Setup

1. **Capacities API token.** In Capacities, go to *Settings → Capacities API* and create a
   token for the space you want to back up. You need a Capacities Pro plan for this.
2. **Google service account.**
   1. In [Google Cloud Console](https://console.cloud.google.com/), create a project (or use an
      existing one) and enable the **Google Docs API**.
   2. Go to *IAM & Admin → Service Accounts*, create a service account, and download a JSON key
      for it (*Keys → Add key → JSON*).
3. **Google Doc.** Create the doc and share it with the service account's email address
   (`…@….iam.gserviceaccount.com`) with **Editor** access. The doc ID is the long string in the
   URL: `docs.google.com/document/d/<DOC_ID>/edit`.
4. **Repository secrets.** Under *Settings → Secrets and variables → Actions*, add:

   | Secret | Value |
   | --- | --- |
   | `CAPACITIES_API_TOKEN` | the token from step 1 |
   | `GOOGLE_SERVICE_ACCOUNT_JSON` | the full contents of the JSON key file |
   | `GOOGLE_DOC_ID` | the doc ID from step 3 |

   Optionally, add a repository **variable** named `CAPACITIES_STRUCTURE_IDS` with a
   comma-separated list of object types to back up, such as `RootPage,RootDailyNote,<custom-type-uuid>`.
   If you don't set it, every type is backed up except system and media types (tags,
   queries, collections, images, PDFs, and so on).
5. **First run.** Under *Actions → Capacities → Google Doc backup*, click *Run workflow*.
   - By default, the first run records every note you already have as the baseline without
     appending anything. After that, only notes created later are appended.
   - To start with a full backup instead, tick **include_existing**. Capacities limits the API
     to about 30 requests per minute, so a large space can take a while to back up.

## Behaviour

- A note is appended only after it hasn't been edited for `MIN_AGE_MINUTES` (default 30). This
  keeps half-written notes out of the doc. They're picked up on a later run.
- A note is appended **once**, when it is new. Later edits to it are not re-synced.
- New notes are appended oldest first. The state file is saved after each note, so if a run
  fails partway through, the next run doesn't duplicate what was already appended.
- A Google Doc holds about 1.02 million characters at most. If your backup gets close to that,
  create a new doc and update `GOOGLE_DOC_ID`.

## Running locally

```bash
pip install -r requirements.txt
export CAPACITIES_API_TOKEN=...
export GOOGLE_DOC_ID=...
export GOOGLE_SERVICE_ACCOUNT_JSON="$(cat key.json)"
python capacities_backup.py --dry-run   # show what would be appended
python capacities_backup.py             # do it
```

Options: `--include-existing`, `--min-age-minutes N`, `--limit N`, `--dry-run`,
`--state-file PATH`.

Tests: `pip install pytest && python -m pytest tests`.
