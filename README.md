# MD Notes

A local-first Markdown notes and tasks app for macOS. It has a clean, Capacities-style interface, Simplenote-fast note taking, colored tags, and bundled fonts such as IBM Plex Sans and Roboto.

![MD Notes](docs/screenshot.png)

## Features

- **Plain Markdown files on your Mac.** Each note is a `.md` file with YAML frontmatter in `~/Documents/MD Notes` by default. You can change the folder in Settings. Edits made in other editors show up live.
- **Fast capture.** `⌘N` creates a note and autosave runs as you type. Empty notes are discarded when you leave them. Search is instant and supports `#tag` filters.
- **Live Markdown editor.** Built on CodeMirror. Headings, bold, italics, links and code are styled as you type, and lists and checklists continue when you press Enter. `⌘E` switches to a rendered preview where you can tick checkboxes.
- **Tasks.** Google Tasks-style lists with subtasks, details, due dates and a Today view of everything overdue or due today. Each list is a plain Markdown file (see [Tasks](#tasks)).
- **Colored tags, shared by notes and tasks.** Add tags under a note's title or in a task's details (with autocomplete). Click a tag in the sidebar to see its open tasks and notes together. Right-click a tag to pick one of 10 colors, rename it, or delete it everywhere.
- **Fonts.** IBM Plex Sans, Roboto, Inter, IBM Plex Serif, Lora, IBM Plex Mono, JetBrains Mono and the system font are all bundled, so they work offline. You can also adjust text size and line width.
- **Light and dark themes**, pinned notes, sorting (last edited, created, title), and a word count.

| Preview | Dark mode |
| --- | --- |
| ![Preview with checkboxes](docs/preview.png) | ![Dark mode](docs/dark.png) |

![Settings](docs/settings.png)

## Tasks

![Tasks](docs/tasks.png)

| Today | A tag shows its tasks and notes |
| --- | --- |
| ![Today view](docs/today.png) | ![Tag page](docs/tag-page.png) |

Task lists live in the `Tasks` folder inside your notes folder, one Markdown file per list (the filename is the list name). They use the same syntax as the [Obsidian Tasks](https://publish.obsidian.md/tasks/) plugin, so you can also read and edit them in Obsidian or any text editor:

```markdown
- [ ] Buy milk #errands 📅 2026-10-01
    Get the big carton if it's on sale
    - [ ] Oat milk
    - [x] Regular milk ✅ 2026-09-27
- [ ] Book dentist appointment #health
- [x] Return library books #errands ✅ 2026-09-26
```

- Tags are written inline (`#errands`), 📅 marks the due date and ✅ the completion date.
- Indented lines under a task are its details; indented checkboxes are its subtasks (one level).
- Completed tasks stay where they are in the file; the app shows them in a collapsible Completed section.
- Headings and other text you add to a list file by hand are kept. Edits made in other apps show up live.
- Deleted lists are moved to `.trash/Tasks` in the notes folder.

In a list: **Enter** adds the next task, **Tab** / **⇧Tab** turns a task into a subtask and back, **Backspace** on an empty task deletes it, and **↑** / **↓** move between tasks. Drag tasks to reorder them, or drop one on another list in the sidebar to move it. Leaving a new task empty discards it.

## Backing up to Google Drive

Install [Google Drive for desktop](https://www.google.com/drive/download/). It adds **Google Drive › My Drive** to Finder (at `~/Library/CloudStorage/GoogleDrive-<your account>/My Drive`). In MD Notes, open **Settings → Notes folder → Change…** and choose (or create) a folder there, such as `My Drive/MD Notes`. Your notes are then synced to Google Drive and still work offline. An iCloud Drive folder works the same way.

Changing the folder doesn't move existing notes. To bring them along, copy the `.md` files (and the hidden `.mdnotes` folder, which holds tag colors) into the new folder first.

## Note format

```markdown
---
title: Project kickoff
tags: [work, urgent-items]
pinned: true
created: 2026-09-26T07:05:00.000Z
updated: 2026-09-26T07:12:00.000Z
---

## Agenda
- [ ] Assign owners
```

The filename follows the title. Frontmatter keys the app doesn't know about are preserved. Deleted notes go to `.trash/` inside the notes folder. Tag colors are stored in `.mdnotes/tags.json`.

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev      # run the app with hot reload
npm run dist     # build a .dmg into release/
```

`npm run dev:web` runs the UI in a browser with a localStorage-backed store, which is handy for UI work. `npm test` runs the storage tests.

The built app is unsigned, so the first time you open it, right-click **MD Notes.app → Open**.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘N` | New note (or new task in Tasks) |
| `⌘1` | Notes |
| `⌘2` | Today |
| `⌘F` | Search notes |
| `⌘E` | Toggle preview |
| `⇧⌘P` | Pin / unpin |
| `⌘⌫` | Move to trash |
| `⌘\` | Toggle sidebar |
| `⌘,` | Settings |

In search, `↑`/`↓` moves through notes and `Enter` jumps into the editor. In the title, `Enter` jumps to the body.

## Project layout

- `electron/main.cjs`: app window, native menu, IPC, folder watcher
- `electron/store.cjs`: reads and writes note files (unit tested in `test/`)
- `electron/tasks.cjs`: reads and writes task list files
- `shared/tasks.mjs`: parses and writes the task Markdown format and implements every task operation; used by both the main process and the UI
- `electron/preload.cjs`: the narrow `window.notesApi` bridge
- `src/`: React UI (`App.tsx`, `tasks/` for the task views, CodeMirror `Editor.tsx`, `Preview.tsx`, `TagInput.tsx`, `SettingsDialog.tsx`, fonts and tag palette in `theme.ts`)
