# MD Notes

A local-first Markdown notes app for macOS. It has a clean, Capacities-style interface, Simplenote-fast note taking, colored tags, and bundled fonts such as IBM Plex Sans and Roboto.

![MD Notes](docs/screenshot.png)

## Features

- **Plain Markdown files on your Mac.** Each note is a `.md` file with YAML frontmatter in `~/Documents/MD Notes` by default. You can change the folder in Settings (an iCloud Drive folder gives you sync across Macs). Edits made in other editors show up live.
- **Fast capture.** `⌘N` creates a note and autosave runs as you type. Empty notes are discarded when you leave them. Search is instant and supports `#tag` filters.
- **Live Markdown editor.** Built on CodeMirror. Headings, bold, italics, links and code are styled as you type, and lists and checklists continue when you press Enter. `⌘E` switches to a rendered preview where you can tick checkboxes.
- **Colored tags.** Add tags under the title (with autocomplete). Click a tag in the sidebar to filter. Right-click a tag to pick one of 10 colors, rename it, or delete it across all notes.
- **Fonts.** IBM Plex Sans, Roboto, Inter, IBM Plex Serif, Lora, IBM Plex Mono, JetBrains Mono and the system font are all bundled, so they work offline. You can also adjust text size and line width.
- **Light and dark themes**, pinned notes, sorting (last edited, created, title), and a word count.

![Settings](docs/settings.png)

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
| `⌘N` | New note |
| `⌘F` | Search notes |
| `⌘E` | Toggle preview |
| `⇧⌘P` | Pin / unpin |
| `⌘⌫` | Move to trash |
| `⌘\` | Toggle sidebar |
| `⌘,` | Settings |

In search, `↑`/`↓` moves through notes and `Enter` jumps into the editor. In the title, `Enter` jumps to the body.

## Project layout

- `electron/main.cjs`: app window, native menu, IPC, folder watcher
- `electron/store.cjs`: reads and writes Markdown files (unit tested in `test/`)
- `electron/preload.cjs`: the narrow `window.notesApi` bridge
- `src/`: React UI (`App.tsx`, CodeMirror `Editor.tsx`, `Preview.tsx`, `TagInput.tsx`, `SettingsDialog.tsx`, fonts and tag palette in `theme.ts`)
