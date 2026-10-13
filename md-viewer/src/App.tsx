import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { api, isDesktop, type MenuCommand, type Note, type Settings, type TagColors } from './api';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { FormatPanel } from './FormatPanel';
import { displayColor, stripFormatting } from './richtext';
import { formatState, setTextColor, toggleHeadingBold } from './richtextEditor';
import { SettingsDialog } from './SettingsDialog';
import { TagChip, TagInput } from './TagInput';
import { TAG_COLORS, fontStack, tagColor } from './theme';
import { FileTree, buildTree, pruneTree, visibleFiles, type LocalNote } from './FileTree';
import { IconEye, IconFolder, IconFolderOpen, IconFolderPlus, IconNotes, IconPencil, IconPlus, IconSearch, IconSettings, IconSidebar, IconTextColor, IconTrash } from './Icons';

type TreeTarget = { kind: 'dir' | 'file'; id: string; key?: string };

const SAVE_DELAY = 400;
let keySeq = 0;
const newKey = () => `n${++keySeq}`;

function formatLong(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function folderName(dir: string | null): string {
  if (!dir) return 'No folder';
  return dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir;
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: the preference just won't be remembered
  }
}

const allTagsOf = (n: Note) => [...new Set([...n.tags, ...n.inlineTags])];

export default function App() {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [dirs, setDirs] = useState<string[]>([]);
  const [colors, setColors] = useState<TagColors>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  // The format panel on the right; whether it's open is remembered per device.
  const [formatOpen, setFormatOpen] = useState(() => readStorage('mdviewer:formatPanel') === 'open');
  // It formats the note title or the note text, whichever had the cursor last.
  const [formatTarget, setFormatTarget] = useState<'title' | 'body'>('body');
  const [, setFormatTick] = useState(0);
  const formatOpenRef = useRef(formatOpen);
  formatOpenRef.current = formatOpen;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [tagMenu, setTagMenu] = useState<{ tag: string; x: number; y: number } | null>(null);
  const [treeMenu, setTreeMenu] = useState<(TreeTarget & { x: number; y: number }) | null>(null);
  // Collapsed folders are remembered per opened folder; everything else starts open.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [newFolderIn, setNewFolderIn] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');

  const notesRef = useRef<LocalNote[]>([]);
  const versions = useRef(new Map<string, number>());
  const saved = useRef(new Map<string, number>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const timers = useRef(new Map<string, number>());
  // Notes created here with ⌘N: these are discarded again if left empty.
  const created = useRef(new Set<string>());
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const commit = useCallback((fn: (prev: LocalNote[]) => LocalNote[]) => {
    notesRef.current = fn(notesRef.current);
    setNotes(notesRef.current);
  }, []);

  const isDirty = (key: string) => (versions.current.get(key) ?? 0) !== (saved.current.get(key) ?? 0) || inflight.current.has(key);

  // ---- Saving -------------------------------------------------------------

  const flush = useCallback(
    async (key: string) => {
      window.clearTimeout(timers.current.get(key));
      timers.current.delete(key);
      while (inflight.current.has(key)) await inflight.current.get(key);
      const note = notesRef.current.find((n) => n.key === key);
      const version = versions.current.get(key) ?? 0;
      if (!note || version === (saved.current.get(key) ?? 0)) return;

      const promise = api
        .saveNote({ id: note.id, title: note.title, body: note.body, tags: note.tags, titleColor: note.titleColor ?? null, titleBold: note.titleBold !== false })
        .then((res) => {
          saved.current.set(key, version);
          commit((prev) =>
            prev.map((n) =>
              n.key === key ? { ...n, id: res.id, dir: res.dir, name: res.name, inlineTags: res.inlineTags, hasFrontmatter: res.hasFrontmatter, updated: res.updated, created: res.created } : n,
            ),
          );
        })
        .catch((err) => {
          console.error('Failed to save note', err);
        });
      inflight.current.set(key, promise);
      try {
        await promise;
      } finally {
        inflight.current.delete(key);
      }
    },
    [commit],
  );

  const scheduleSave = useCallback(
    (key: string) => {
      window.clearTimeout(timers.current.get(key));
      timers.current.set(key, window.setTimeout(() => void flush(key), SAVE_DELAY));
    },
    [flush],
  );

  const updateNote = useCallback(
    (key: string, patch: Partial<Pick<Note, 'title' | 'body' | 'tags' | 'titleColor' | 'titleBold'>>) => {
      commit((prev) => prev.map((n) => (n.key === key ? { ...n, ...patch, updated: new Date().toISOString() } : n)));
      versions.current.set(key, (versions.current.get(key) ?? 0) + 1);
      scheduleSave(key);
    },
    [commit, scheduleSave],
  );

  const flushAll = useCallback(() => Promise.all(notesRef.current.map((n) => flush(n.key))), [flush]);

  // ---- Loading ------------------------------------------------------------

  const reload = useCallback(async () => {
    const [listing, tagColors] = await Promise.all([api.listFiles(), api.getTagColors()]);
    const byId = new Map(notesRef.current.map((n) => [n.id, n]));
    const next: LocalNote[] = listing.files.map((n) => {
      const local = byId.get(n.id);
      if (local && isDirty(local.key)) return local;
      return { ...n, key: local?.key ?? newKey() };
    });
    // Keep notes with unsaved edits even if their file is missing on disk.
    for (const local of notesRef.current) {
      if (!next.some((n) => n.key === local.key) && isDirty(local.key)) next.push(local);
    }
    commit(() => next);
    setDirs(listing.dirs);
    setColors(tagColors);
    setLoaded(true);
    return next;
  }, [commit]);

  const loadCollapsed = (folder: string | null) => {
    try {
      const raw = readStorage(`mdviewer:collapsed:${folder ?? ''}`);
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set<string>();
    }
  };

  // Loads (or re-loads) the settings and the open folder from scratch.
  const loadFolder = useCallback(async () => {
    const next = await api.getSettings();
    setSettings(next);
    setCollapsed(loadCollapsed(next.folder));
    setQuery('');
    setActiveTag(null);
    commit(() => []);
    const list = await reload();
    setSelectedKey(list[0]?.key ?? null);
  }, [commit, reload]);

  useEffect(() => {
    void loadFolder();
    const off = api.onFilesChanged(() => void reload());
    const flushOnExit = () => void flushAll();
    window.addEventListener('beforeunload', flushOnExit);
    return () => {
      off();
      window.removeEventListener('beforeunload', flushOnExit);
    };
  }, [loadFolder, reload, flushAll]);

  // ---- Derived state ------------------------------------------------------

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of allTagsOf(n)) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [notes]);
  const tagNames = useMemo(() => allTags.map(([t]) => t), [allTags]);

  const filtering = Boolean(query.trim()) || activeTag !== null;
  const tree = useMemo(() => {
    const full = buildTree(notes, dirs);
    if (!filtering) return full;
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const tagTerms = words.filter((w) => w.startsWith('#') && w.length > 1).map((w) => w.slice(1));
    const textTerms = words.filter((w) => !w.startsWith('#'));
    const keep = new Set<string>();
    for (const n of notes) {
      const tags = allTagsOf(n);
      if (activeTag && !tags.includes(activeTag)) continue;
      if (!tagTerms.every((t) => tags.some((tag) => tag.startsWith(t)))) continue;
      const hay = `${n.title}\n${n.id}\n${stripFormatting(n.body)}`.toLowerCase();
      if (!textTerms.every((w) => hay.includes(w))) continue;
      keep.add(n.key);
    }
    return pruneTree(full, keep);
  }, [notes, dirs, query, activeTag, filtering]);

  // While filtering, every folder with a match is shown open.
  const isOpen = useCallback((id: string) => filtering || !collapsed.has(id), [filtering, collapsed]);
  const visible = useMemo(() => visibleFiles(tree, isOpen), [tree, isOpen]);
  const selected = notes.find((n) => n.key === selectedKey) ?? null;
  const folder = settings?.folder ?? null;

  // ---- Actions ------------------------------------------------------------

  const toggleDir = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeStorage(`mdviewer:collapsed:${folder ?? ''}`, JSON.stringify([...next]));
      return next;
    });
  };

  // Opens the folders leading to a note so it is visible in the tree.
  const revealInTree = useCallback(
    (note: LocalNote) => {
      if (!note.dir) return;
      setCollapsed((prev) => {
        const next = new Set(prev);
        const parts = note.dir.split('/');
        for (let i = 1; i <= parts.length; i++) next.delete(parts.slice(0, i).join('/'));
        if (next.size !== prev.size) writeStorage(`mdviewer:collapsed:${folder ?? ''}`, JSON.stringify([...next]));
        return next;
      });
    },
    [folder],
  );

  const select = useCallback(
    (key: string | null) => {
      const prev = notesRef.current.find((n) => n.key === selectedKey);
      if (prev && prev.key !== key) {
        void flush(prev.key).then(async () => {
          // Discard notes created here that were never written in.
          const current = notesRef.current.find((n) => n.key === prev.key);
          if (current && created.current.has(prev.key) && !current.body.trim() && current.title === 'Untitled') {
            await api.trashNote(current.id).catch(() => {});
            created.current.delete(prev.key);
            commit((list) => list.filter((n) => n.key !== prev.key));
          }
        });
      }
      setSelectedKey(key);
      const next = key ? notesRef.current.find((n) => n.key === key) : null;
      if (next) revealInTree(next);
    },
    [selectedKey, flush, commit, revealInTree],
  );

  // The folder new notes go into: the selected note's folder, or the top level.
  const currentDir = selected?.dir ?? '';

  const createNote = useCallback(
    async (dir: string = currentDir) => {
      if (!folder) return;
      const note = await api.createNote({ dir, title: 'Untitled' });
      const local: LocalNote = { ...note, key: newKey() };
      created.current.add(local.key);
      commit((prev) => [...prev, local]);
      setQuery('');
      setActiveTag(null);
      setPreview(false);
      select(local.key);
      requestAnimationFrame(() => {
        titleRef.current?.focus();
        titleRef.current?.select();
      });
    },
    [folder, currentDir, commit, select],
  );

  const startNewFolder = useCallback(
    (parent: string = currentDir) => {
      if (!folder) return;
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const part of parent.split('/').map((_p, i, arr) => arr.slice(0, i + 1).join('/'))) next.delete(part);
        return next;
      });
      setNewFolderName('');
      setNewFolderIn(parent);
    },
    [folder, currentDir],
  );

  const submitNewFolder = async () => {
    const parent = newFolderIn;
    const name = newFolderName.trim();
    setNewFolderIn(null);
    if (parent === null || !name) return;
    await api.createFolder(parent, name);
    await reload();
  };

  const trashNote = useCallback(
    async (key: string) => {
      const note = notesRef.current.find((n) => n.key === key);
      if (!note) return;
      if (note.body.trim() && !window.confirm(`Move "${note.title || note.name}" to the Trash?`)) return;
      const index = visible.findIndex((n) => n.key === key);
      const next = key === selectedKey ? (visible[index + 1] ?? visible[index - 1] ?? null) : null;
      window.clearTimeout(timers.current.get(key));
      while (inflight.current.has(key)) await inflight.current.get(key);
      const current = notesRef.current.find((n) => n.key === key);
      if (current) await api.trashNote(current.id).catch((err) => console.error('Failed to trash note', err));
      versions.current.delete(key);
      saved.current.delete(key);
      created.current.delete(key);
      commit((prev) => prev.filter((n) => n.key !== key));
      if (key === selectedKey) setSelectedKey(next?.key ?? null);
    },
    [visible, selectedKey, commit],
  );

  const trashSelected = useCallback(() => {
    if (selected) void trashNote(selected.key);
  }, [selected, trashNote]);

  const showFormatPanel = useCallback((open: boolean) => {
    setFormatOpen(open);
    writeStorage('mdviewer:formatPanel', open ? 'open' : 'closed');
  }, []);

  const toggleFormat = useCallback(() => {
    if (!formatOpen && document.activeElement === titleRef.current) setFormatTarget('title');
    showFormatPanel(!formatOpen);
  }, [formatOpen, showFormatPanel]);

  // Keeps the panel in step with the editor's selection and focus.
  const onEditorActivity = useCallback((editor: EditorView) => {
    if (editor.hasFocus) setFormatTarget('body');
    if (formatOpenRef.current) setFormatTick((t) => t + 1);
  }, []);

  const changeSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSettings(await api.setSettings(patch));
  }, []);

  const chooseFolder = useCallback(async () => {
    await flushAll();
    const before = settings?.folder ?? null;
    const next = await api.chooseFolder();
    if (next.folder !== before) await loadFolder();
  }, [flushAll, settings?.folder, loadFolder]);

  const openRecent = useCallback(
    async (dir: string) => {
      await flushAll();
      try {
        await api.openFolder(dir);
      } catch {
        window.alert(`The folder "${dir}" can't be opened. It may have been moved or deleted.`);
        return;
      }
      await loadFolder();
    },
    [flushAll, loadFolder],
  );

  const setTagColorFor = useCallback(async (tag: string, color: string) => {
    setColors((c) => ({ ...c, [tag]: color }));
    setColors(await api.setTagColor(tag, color));
  }, []);

  const showTag = (tag: string) => {
    setActiveTag((t) => (t === tag ? null : tag));
  };

  const moveSelection = (delta: number) => {
    if (!visible.length) return;
    const index = visible.findIndex((n) => n.key === selectedKey);
    const next = visible[index === -1 ? (delta > 0 ? 0 : visible.length - 1) : Math.max(0, Math.min(visible.length - 1, index + delta))];
    if (next) select(next.key);
  };

  // ---- Commands & shortcuts ----------------------------------------------

  const runCommand = useCallback(
    (command: MenuCommand) => {
      switch (command) {
        case 'new':
          void createNote();
          break;
        case 'new-folder':
          startNewFolder();
          break;
        case 'search':
          setSidebarOpen(true);
          requestAnimationFrame(() => {
            searchRef.current?.focus();
            searchRef.current?.select();
          });
          break;
        case 'format':
          toggleFormat();
          break;
        case 'preview':
          setPreview((p) => !p);
          break;
        case 'settings':
          setShowSettings(true);
          break;
        case 'trash':
          trashSelected();
          break;
        case 'sidebar':
          setSidebarOpen((o) => !o);
          break;
        case 'reveal':
          if (selected) void api.revealFile(selected.id);
          break;
        case 'folder-changed':
          void flushAll().then(loadFolder);
          break;
      }
    },
    [createNote, startNewFolder, toggleFormat, trashSelected, selected, flushAll, loadFolder],
  );

  const commandRef = useRef(runCommand);
  commandRef.current = runCommand;

  useEffect(() => api.onMenuCommand((c) => commandRef.current(c)), []);

  // In the browser build there is no native menu, so handle shortcuts here.
  useEffect(() => {
    if (isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const map: Record<string, MenuCommand> = { e: 'preview', ',': 'settings', k: 'search', '\\': 'sidebar', j: 'new' };
      const command = map[e.key.toLowerCase()];
      if (command) {
        e.preventDefault();
        commandRef.current(command);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Appearance ---------------------------------------------------------

  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
    root.style.setProperty('--note-font', fontStack(settings.font));
    root.style.setProperty('--note-size', `${settings.fontSize}px`);
    root.style.setProperty('--line-width', `${settings.lineWidth}px`);
  }, [settings]);

  // Grow the title field to fit long titles.
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, [selected?.title, selectedKey, settings?.font, settings?.fontSize]);

  // Keep the selected file in view in the tree.
  useEffect(() => {
    if (!selectedKey) return;
    const el = treeRef.current?.querySelector<HTMLElement>(`[data-key="${selectedKey}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, tree]);

  useEffect(() => {
    if (!tagMenu && !treeMenu) return;
    const close = () => {
      setTagMenu(null);
      setTreeMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [tagMenu, treeMenu]);

  // ---- Render -------------------------------------------------------------

  // The format panel targets the title while it has the cursor (or in
  // preview, where the text can't be edited), and the note text otherwise.
  const renderFormatPanel = (note: LocalNote) => {
    const editor = editorRef.current;
    if (preview || formatTarget === 'title' || !editor) {
      return (
        <FormatPanel
          target="the note title"
          color={note.titleColor ?? null}
          onColor={(color) => updateNote(note.key, { titleColor: color })}
          boldLabel="Title"
          bold={{ on: note.titleBold !== false, onToggle: () => updateNote(note.key, { titleBold: note.titleBold === false }) }}
          boldHint=""
          onClose={() => showFormatPanel(false)}
        />
      );
    }
    const state = formatState(editor.state);
    const refresh = () => setFormatTick((t) => t + 1);
    return (
      <FormatPanel
        target={editor.state.selection.main.empty ? 'the whole line' : 'the selected text'}
        color={state.color}
        onColor={(color) => {
          setTextColor(editor, color);
          refresh();
          editor.focus();
        }}
        boldLabel="Heading"
        bold={state.heading ? { on: state.headingBold, onToggle: () => (toggleHeadingBold(editor), refresh()) } : null}
        boldHint="Put the cursor on a heading, or in the title, to turn its bold on or off."
        onClose={() => showFormatPanel(false)}
      />
    );
  };

  const words = selected ? (stripFormatting(selected.body).match(/\S+/g) ?? []).length : 0;
  const crumbs = selected ? [folderName(folder), ...selected.dir.split('/').filter(Boolean)] : [];
  const onTreeKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && selected) {
      e.preventDefault();
      editorRef.current?.focus();
    }
  };

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-collapsed'}${isDesktop ? ' desktop' : ''}`}>
      {sidebarOpen && (
        <aside className="sidebar">
          <div className="sidebar-top drag">
            <span className="brand">MD Viewer</span>
          </div>
          <button className="folder-button no-drag" onClick={() => void chooseFolder()} title={folder ? `${folder}\nClick to open another folder` : 'Open a folder'}>
            <IconFolderOpen size={18} />
            <span className="folder-name">{folder ? folderName(folder) : 'Open folder…'}</span>
            <span className="folder-change">Change</span>
          </button>
          <button className="new-note no-drag" onClick={() => void createNote()} disabled={!folder}>
            <IconPlus /> New note
            <kbd>{isDesktop ? '⌘N' : ''}</kbd>
          </button>
          <div className="search">
            <IconSearch size={14} />
            <input
              ref={searchRef}
              value={query}
              placeholder="Search notes or #tag"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQuery('');
                  e.currentTarget.blur();
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  moveSelection(e.key === 'ArrowDown' ? 1 : -1);
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  editorRef.current?.focus();
                }
              }}
            />
            {query && (
              <button className="search-clear" onClick={() => setQuery('')} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
          <div className="sidebar-scroll">
            <div className="section-label with-action">
              {activeTag ? (
                <span className="section-filter">
                  Files <TagChip tag={activeTag} colors={colors} small onRemove={() => setActiveTag(null)} />
                </span>
              ) : (
                'Files'
              )}
              <button className="section-action" title="New folder (⇧⌘N)" aria-label="New folder" onClick={() => startNewFolder()} disabled={!folder}>
                <IconFolderPlus size={14} />
              </button>
            </div>
            <div className="tree" ref={treeRef} role="tree" onKeyDown={onTreeKey}>
              {!folder && loaded && (
                <p className="empty-hint">
                  Open a folder to see the Markdown files in it.
                </p>
              )}
              {folder && loaded && tree.length === 0 && newFolderIn === null && (
                <p className="empty-hint">{filtering ? 'No notes match.' : 'No Markdown files here yet. Create one with New note.'}</p>
              )}
              <FileTree
                nodes={tree}
                selectedKey={selectedKey}
                isOpen={isOpen}
                onToggle={toggleDir}
                onSelect={select}
                onContextMenu={(target, e) => {
                  e.preventDefault();
                  setTreeMenu({ ...target, x: e.clientX, y: e.clientY });
                }}
                newFolderIn={newFolderIn}
                newFolderName={newFolderName}
                onNewFolderName={setNewFolderName}
                onNewFolderSubmit={() => void submitNewFolder()}
                onNewFolderCancel={() => setNewFolderIn(null)}
              />
            </div>

            <div className="section-label">Tags</div>
            <nav className="nav tags-nav">
              {allTags.length === 0 && folder && loaded && <p className="empty-hint">Tags in a note's frontmatter, or written as #tag in the text, show up here.</p>}
              {allTags.map(([tag, count]) => (
                <button
                  key={tag}
                  className={`nav-item${activeTag === tag ? ' active' : ''}`}
                  onClick={() => showTag(tag)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTagMenu({ tag, x: e.clientX, y: e.clientY });
                  }}
                >
                  <span className={`tag-dot tag-${tagColor(tag, colors)}`} />
                  <span className="nav-text">{tag}</span>
                  <span className="count">{count}</span>
                </button>
              ))}
            </nav>
          </div>

          <div className="sidebar-bottom">
            <button className="nav-item" onClick={() => setShowSettings(true)}>
              <IconSettings /> Settings
            </button>
          </div>
        </aside>
      )}

      <main className="editor-pane">
        <div className="editor-toolbar drag">
          {!sidebarOpen && (
            <button className="icon-button no-drag" onClick={() => setSidebarOpen(true)} title="Show sidebar (⌘\)" aria-label="Show sidebar">
              <IconSidebar />
            </button>
          )}
          <div className="crumbs">
            {selected && (
              <>
                {crumbs.map((c, i) => (
                  <span key={i} className="crumb">
                    <span>{c}</span>
                    <span className="crumb-sep">/</span>
                  </span>
                ))}
                <span className="crumb-current">{selected.title || 'Untitled'}</span>
              </>
            )}
          </div>
          {selected && (
            <div className="toolbar-actions no-drag">
              <button
                className={`icon-button${formatOpen ? ' on' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={toggleFormat}
                title={formatOpen ? 'Hide format panel (⇧⌘C)' : 'Show format panel: text color and bold (⇧⌘C)'}
                aria-label="Text formatting"
                aria-pressed={formatOpen}
              >
                <IconTextColor />
              </button>
              <button className={`icon-button${preview ? ' on' : ''}`} onClick={() => setPreview((p) => !p)} title="Toggle preview (⌘E)" aria-label="Toggle preview">
                {preview ? <IconPencil /> : <IconEye />}
              </button>
              <button className="icon-button danger" onClick={trashSelected} title="Move to trash (⌘⌫)" aria-label="Move to trash">
                <IconTrash />
              </button>
            </div>
          )}
        </div>

        <div className="editor-body">
          <div className="editor-main">
            {selected ? (
              <div className="document-scroll">
                <article className="document">
                  <textarea
                    ref={titleRef}
                    className="title-input"
                    style={{
                      color: selected.titleColor ? displayColor(selected.titleColor) : undefined,
                      fontWeight: selected.titleBold === false ? 400 : undefined,
                    }}
                    rows={1}
                    value={selected.title}
                    placeholder="Untitled"
                    spellCheck
                    onFocus={() => setFormatTarget('title')}
                    onChange={(e) => updateNote(selected.key, { title: e.target.value.replace(/\n/g, ' ') })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || (e.key === 'ArrowDown' && !preview)) {
                        e.preventDefault();
                        editorRef.current?.focus();
                      }
                    }}
                  />
                  <div className="properties">
                    <div className="property">
                      <span className="property-label">Tags</span>
                      <div className="property-tags">
                        {selected.inlineTags.filter((t) => !selected.tags.includes(t)).length > 0 && (
                          <span className="inline-tags" title="Tags written in the text">
                            {selected.inlineTags
                              .filter((t) => !selected.tags.includes(t))
                              .map((t) => (
                                <TagChip key={t} tag={t} colors={colors} onClick={() => setActiveTag(t)} />
                              ))}
                          </span>
                        )}
                        <TagInput tags={selected.tags} allTags={tagNames} colors={colors} onChange={(tags) => updateNote(selected.key, { tags })} onSelectTag={(tag) => setActiveTag(tag)} />
                      </div>
                    </div>
                    <div className="property">
                      <span className="property-label">File</span>
                      <button className="property-value property-link" onClick={() => void api.revealFile(selected.id)} title={isDesktop ? 'Show in Finder' : undefined} disabled={!isDesktop}>
                        {selected.id}
                      </button>
                    </div>
                    <div className="property">
                      <span className="property-label">Edited</span>
                      <span className="property-value">{formatLong(selected.updated)}</span>
                    </div>
                  </div>
                  <div className={preview ? 'hidden' : ''}>
                    <Editor docKey={selected.key} value={selected.body} onChange={(body) => updateNote(selected.key, { body })} editorRef={editorRef} onActivity={onEditorActivity} />
                  </div>
                  {preview && <Preview body={selected.body} onChange={(body) => updateNote(selected.key, { body })} />}
                </article>
              </div>
            ) : (
              <div className="no-selection">
                {folder ? (
                  <>
                    <IconNotes size={36} />
                    <p>{notes.length ? 'Select a note in the sidebar.' : 'This folder has no Markdown files yet.'}</p>
                    <button className="button primary" onClick={() => void createNote()}>
                      <IconPlus size={14} /> New note
                    </button>
                  </>
                ) : (
                  <>
                    <IconFolder size={36} />
                    <p>Open a folder to browse and edit the Markdown notes in it.</p>
                    <button className="button primary" onClick={() => void chooseFolder()}>
                      <IconFolderOpen size={14} /> Open folder…
                    </button>
                    {settings && settings.recentFolders.length > 0 && (
                      <div className="recent-folders">
                        <div className="recent-label">Recent</div>
                        {settings.recentFolders.map((dir) => (
                          <button key={dir} className="recent-folder" onClick={() => void openRecent(dir)} title={dir}>
                            <IconFolder size={14} /> {folderName(dir)}
                            <span className="recent-path">{dir}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {selected && (
              <div className="status-bar">
                {words} {words === 1 ? 'word' : 'words'} · {selected.body.length} characters
              </div>
            )}
          </div>
          {formatOpen && selected && renderFormatPanel(selected)}
        </div>
      </main>

      {tagMenu && (
        <div className="context-menu" style={{ left: tagMenu.x, top: tagMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="context-title">#{tagMenu.tag}</div>
          <div className="swatches">
            {TAG_COLORS.map((c) => (
              <button
                key={c.name}
                className={`swatch tag-${c.name}${tagColor(tagMenu.tag, colors) === c.name ? ' selected' : ''}`}
                title={c.label}
                aria-label={c.label}
                onClick={() => void setTagColorFor(tagMenu.tag, c.name)}
              />
            ))}
          </div>
        </div>
      )}

      {treeMenu && (
        <div className="context-menu" style={{ left: treeMenu.x, top: treeMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="context-title">{treeMenu.id.split('/').pop()}</div>
          {treeMenu.kind === 'dir' && (
            <>
              <button
                className="context-item"
                onClick={() => {
                  const id = treeMenu.id;
                  setTreeMenu(null);
                  void createNote(id);
                }}
              >
                New note here
              </button>
              <button
                className="context-item"
                onClick={() => {
                  const id = treeMenu.id;
                  setTreeMenu(null);
                  startNewFolder(id);
                }}
              >
                New folder here
              </button>
            </>
          )}
          {isDesktop && (
            <button
              className="context-item"
              onClick={() => {
                const id = treeMenu.id;
                setTreeMenu(null);
                void api.revealFile(id);
              }}
            >
              Show in Finder
            </button>
          )}
          {treeMenu.kind === 'file' && (
            <>
              <div className="context-sep" />
              <button
                className="context-item danger"
                onClick={() => {
                  const key = treeMenu.key!;
                  setTreeMenu(null);
                  void trashNote(key);
                }}
              >
                Move to Trash
              </button>
            </>
          )}
        </div>
      )}

      {showSettings && settings && (
        <SettingsDialog
          settings={settings}
          isDesktop={isDesktop}
          onChange={(patch) => void changeSettings(patch)}
          onChooseFolder={() => void chooseFolder()}
          onOpenFolder={(dir) => void openRecent(dir)}
          onRevealFolder={() => void api.revealFolder()}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
