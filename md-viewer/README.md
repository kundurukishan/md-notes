# MD Viewer

A desktop app for macOS that opens a folder of Markdown files and lets you browse and edit them. It is a fork of [MD Notes](../README.md) with the same look and feel: the same fonts, colors, tag palette, live Markdown editor, preview and text-color panel. What changed is the layout: there is no middle list pane. The left pane shows the folder itself, as a tree of folders and files with the tags underneath, and the right pane is the MD Notes editor with more room.

## Features

- **Any folder.** Open a folder (`⌘O`) and every `.md` file in it and its subfolders shows up in a tree in the sidebar. Folders from MD Notes, Obsidian or any other Markdown app work, and hidden folders, `node_modules` and `.trash` are skipped. Edits made in other editors show up live.
- **Files are edited in place, as they are.** A file without frontmatter stays that way: editing the text never adds anything. Frontmatter from MD Notes (title, tags, title color) is read and written back, and keys the app doesn't know are preserved untouched.
- **Tags.** The Tags section lists tags from each file's frontmatter together with `#tags` written in the text. Click a tag to show only the files that have it. Tags in the frontmatter can be edited under the title; right-click a tag to pick one of 10 colors. Colors saved by MD Notes in the folder's `.mdnotes/tags.json` are picked up; colors chosen in MD Viewer are kept in its own settings, so nothing is written into your folder.
- **The MD Notes editor.** Live Markdown styling built on CodeMirror, `⌘E` for a rendered preview with tickable checkboxes, and the `⇧⌘C` Format panel for text color and heading weight.
- **Title and filename.** The title is the file's `title` from its frontmatter if it has one, otherwise the filename. Editing the title renames the file (and updates the frontmatter title when there is one).
- **New notes and folders.** `⌘N` creates a note in the selected note's folder; right-click a folder for *New note here* and *New folder here*. Notes are moved to the macOS Trash with `⌘⌫`.
- **Fonts, themes, line width** from MD Notes, with the same light and dark themes.

## Development

Requires Node.js 20+.

```bash
cd md-viewer
npm install
npm run dev      # run the app with hot reload
npm run dist     # build a .dmg into release/
```

`npm run dev:web` runs the UI in a browser against an in-memory sample folder, which is handy for UI work. `npm test` runs the store and editor tests. The Vite dev server uses port 5174 so it can run next to MD Notes.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘O` | Open folder |
| `⌘N` | New note |
| `⇧⌘N` | New folder |
| `⌘F` | Search notes |
| `⌘E` | Toggle preview |
| `⇧⌘C` | Text color and bold (title, headings, text) |
| `⌘⌫` | Move to trash |
| `⌘\` | Toggle sidebar |
| `⌘,` | Settings |

In search, `↑`/`↓` moves through the files and `Enter` jumps into the editor.

## Project layout

- `electron/main.cjs`: app window, native menu, IPC, folder watcher, recent folders
- `electron/store.cjs`: lists the folder and reads and writes files (unit tested in `test/`)
- `electron/preload.cjs`: the narrow `window.viewerApi` bridge
- `src/`: React UI (`App.tsx`, the folder tree in `FileTree.tsx`, CodeMirror `Editor.tsx`, `Preview.tsx`, `FormatPanel.tsx`, `TagInput.tsx`, `SettingsDialog.tsx`, fonts and tag palette in `theme.ts`)

The editor files (`Editor.tsx`, `Preview.tsx`, `FormatPanel.tsx`, `richtext.ts`, `richtextEditor.ts`, `markdown.ts`, `TagInput.tsx`, `theme.ts`) are copies of the MD Notes ones.

## Installing

The build and install steps are the same as for MD Notes, see [INSTALL.md](../INSTALL.md): download `MD-Viewer-<version>-mac.dmg` from the **Build MD Viewer installer** workflow run (or a release), drag it to Applications, and confirm the first launch. Settings live in `~/Library/Application Support/MD Viewer/settings.json`.
