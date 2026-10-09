import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { api, isDesktop, type MenuCommand, type Note, type Settings, type TagColors } from './api';
import { Editor } from './Editor';
import { Preview } from './Preview';
import { FormatBar } from './FormatBar';
import { FormatPanel } from './FormatPanel';
import { displayColor, stripFormatting } from './richtext';
import { formatState, setTextColor, toggleHeadingBold } from './richtextEditor';
import { SettingsDialog } from './SettingsDialog';
import { TagChip, TagInput } from './TagInput';
import { TAG_COLORS, fontStack, tagColor } from './theme';
import { collectOpen, openCount } from '../shared/tasks.mjs';
import { useTasks } from './tasks/useTasks';
import { ListPage, TaskMatches, TodayPage, TASK_DRAG_TYPE } from './tasks/TasksView';
import { longDate, todayKey } from './tasks/dates';
import { DailyCalendar } from './DailyCalendar';
import {
  IconCalendar,
  IconEye,
  IconList,
  IconNotes,
  IconPencil,
  IconPin,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
  IconSort,
  IconSun,
  IconTrash,
  IconUntagged,
} from './Icons';

// `key` is a stable client-side identity; `id` is the filename and changes when
// a note's title changes.
type LocalNote = Note & { key: string };
type Filter = { kind: 'all' } | { kind: 'daily' } | { kind: 'pinned' } | { kind: 'untagged' } | { kind: 'tag'; tag: string };
type View = { kind: 'notes' } | { kind: 'list'; id: string; reveal: string | null } | { kind: 'today' };

const SAVE_DELAY = 400;
let keySeq = 0;
const newKey = () => `n${++keySeq}`;

function snippet(body: string): string {
  return stripFormatting(body)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, '')
    .replace(/[*_~`]+/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, 160);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

function formatLong(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function App() {
  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [colors, setColors] = useState<TagColors>({});
  const [settings, setSettings] = useState<Settings | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(false);
  // The format panel on the right; whether it's open is remembered per device.
  const [formatOpen, setFormatOpen] = useState(() => {
    try {
      return localStorage.getItem('mdnotes:formatPanel') === 'open';
    } catch {
      return false;
    }
  });
  // It formats the note title or the note text, whichever had the cursor last.
  const [formatTarget, setFormatTarget] = useState<'title' | 'body'>('body');
  const [formatTick, setFormatTick] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [tagMenu, setTagMenu] = useState<{ tag: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: 'notes' });
  const [newTaskSignal, setNewTaskSignal] = useState(0);
  const [listMenu, setListMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [newListName, setNewListName] = useState<string | null>(null);
  const [dropListId, setDropListId] = useState<string | null>(null);
  const tasks = useTasks();

  const notesRef = useRef<LocalNote[]>([]);
  const versions = useRef(new Map<string, number>());
  const saved = useRef(new Map<string, number>());
  const inflight = useRef(new Map<string, Promise<void>>());
  const timers = useRef(new Map<string, number>());
  const searchRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<EditorView | null>(null);

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
        .saveNote({ id: note.id, title: note.title, body: note.body, tags: note.tags, pinned: note.pinned, titleColor: note.titleColor ?? null, titleBold: note.titleBold !== false })
        .then((res) => {
          saved.current.set(key, version);
          commit((prev) => prev.map((n) => (n.key === key ? { ...n, id: res.id, updated: res.updated, created: res.created } : n)));
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
    (key: string, patch: Partial<Pick<Note, 'title' | 'body' | 'tags' | 'pinned' | 'titleColor' | 'titleBold'>>) => {
      commit((prev) => prev.map((n) => (n.key === key ? { ...n, ...patch, updated: new Date().toISOString() } : n)));
      versions.current.set(key, (versions.current.get(key) ?? 0) + 1);
      scheduleSave(key);
    },
    [commit, scheduleSave],
  );

  const flushAll = useCallback(() => Promise.all(notesRef.current.map((n) => flush(n.key))), [flush]);

  // ---- Loading ------------------------------------------------------------

  const reload = useCallback(async () => {
    const [disk, tagColors] = await Promise.all([api.listNotes(), api.getTagColors()]);
    const byId = new Map(notesRef.current.map((n) => [n.id, n]));
    const next: LocalNote[] = disk.map((n) => {
      const local = byId.get(n.id);
      if (local && isDirty(local.key)) return local;
      return { ...n, key: local?.key ?? newKey() };
    });
    // Keep notes with unsaved edits even if their file is missing on disk.
    for (const local of notesRef.current) {
      if (!next.some((n) => n.key === local.key) && isDirty(local.key)) next.push(local);
    }
    commit(() => next);
    setColors(tagColors);
    return next;
  }, [commit]);

  useEffect(() => {
    api.getSettings().then(setSettings);
    reload().then((list) => {
      const first = [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated.localeCompare(a.updated))[0];
      if (first) setSelectedKey(first.key);
    });
    const off = api.onNotesChanged(() => void reload());
    const flushOnExit = () => void flushAll();
    window.addEventListener('beforeunload', flushOnExit);
    return () => {
      off();
      window.removeEventListener('beforeunload', flushOnExit);
    };
  }, [reload, flushAll]);

  // ---- Derived state ------------------------------------------------------

  // Tags are shared: counts include notes and open tasks.
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of notes) for (const t of n.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const { task } of collectOpen(tasks.lists, () => true)) for (const t of task.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [notes, tasks.lists]);
  const tagNames = useMemo(() => allTags.map(([t]) => t), [allTags]);

  // Open tasks shown above the notes on tag pages and when searching.
  const taskMatches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const tagTerms = words.filter((w) => w.startsWith('#') && w.length > 1).map((w) => w.slice(1));
    const textTerms = words.filter((w) => !w.startsWith('#'));
    if (filter.kind === 'pinned' || filter.kind === 'untagged' || filter.kind === 'daily') return [];
    if (filter.kind === 'all' && !words.length) return [];
    return collectOpen(tasks.lists, (t) => {
      if (filter.kind === 'tag' && !t.tags.includes(filter.tag)) return false;
      if (!tagTerms.every((term) => t.tags.some((tag) => tag.startsWith(term)))) return false;
      const hay = `${t.title}\n${t.details}`.toLowerCase();
      return textTerms.every((w) => hay.includes(w));
    });
  }, [tasks.lists, filter, query]);

  const todayCount = useMemo(() => {
    const today = todayKey();
    return collectOpen(tasks.lists, (t) => Boolean(t.due && t.due <= today)).length;
  }, [tasks.lists]);
  const activeList = view.kind === 'list' ? (tasks.lists.find((l) => l.id === view.id) ?? null) : null;

  const visible = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const tagTerms = words.filter((w) => w.startsWith('#') && w.length > 1).map((w) => w.slice(1));
    const textTerms = words.filter((w) => !w.startsWith('#'));
    const sort = settings?.sort ?? 'updated';
    return notes
      .filter((n) => {
        if (filter.kind === 'daily' && !n.daily) return false;
        if (filter.kind === 'pinned' && !n.pinned) return false;
        if (filter.kind === 'untagged' && n.tags.length) return false;
        if (filter.kind === 'tag' && !n.tags.includes(filter.tag)) return false;
        if (!tagTerms.every((t) => n.tags.some((tag) => tag.startsWith(t)))) return false;
        const hay = `${n.title}\n${stripFormatting(n.body)}`.toLowerCase();
        return textTerms.every((w) => hay.includes(w));
      })
      .sort((a, b) => {
        // Daily notes are listed by date, newest first.
        if (filter.kind === 'daily') return (b.daily ?? '').localeCompare(a.daily ?? '');
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        if (sort === 'title') return (a.title || 'Untitled').localeCompare(b.title || 'Untitled');
        if (sort === 'created') return b.created.localeCompare(a.created);
        return b.updated.localeCompare(a.updated);
      });
  }, [notes, filter, query, settings?.sort]);

  const selected = notes.find((n) => n.key === selectedKey) ?? null;
  const dailyDates = useMemo(() => new Set(notes.flatMap((n) => (n.daily ? [n.daily] : []))), [notes]);

  // ---- Actions ------------------------------------------------------------

  const select = useCallback(
    (key: string | null) => {
      const prev = notesRef.current.find((n) => n.key === selectedKey);
      if (prev && prev.key !== key) {
        void flush(prev.key).then(async () => {
          // Discard notes that were created but never written in (for daily
          // notes, which start with a date title, an empty body is enough).
          const current = notesRef.current.find((n) => n.key === prev.key);
          if (current && !current.body.trim() && (!current.title.trim() || current.daily)) {
            await api.trashNote(current.id).catch(() => {});
            commit((list) => list.filter((n) => n.key !== prev.key));
          }
        });
      }
      setSelectedKey(key);
    },
    [selectedKey, flush, commit],
  );

  // Opens the daily note for `date` (today by default), creating it if
  // needed, with the cursor in the text.
  const openDaily = useCallback(async (date: string = todayKey()) => {
    setFilter({ kind: 'daily' });
    setView({ kind: 'notes' });
    setQuery('');
    setPreview(false);
    let local = notesRef.current.find((n) => n.daily === date);
    if (!local) {
      const note = await api.createNote({ daily: date, title: longDate(date) });
      local = notesRef.current.find((n) => n.id === note.id) ?? { ...note, key: newKey() };
      const added = local;
      commit((prev) => (prev.some((n) => n.key === added.key) ? prev : [added, ...prev]));
    }
    select(local.key);
    requestAnimationFrame(() => editorRef.current?.focus());
  }, [commit, select]);

  const createNote = useCallback(async () => {
    if (filter.kind === 'daily') return openDaily();
    const tags = filter.kind === 'tag' ? [filter.tag] : [];
    const note = await api.createNote({ tags });
    const local: LocalNote = { ...note, key: newKey() };
    commit((prev) => [local, ...prev]);
    if (filter.kind === 'pinned') setFilter({ kind: 'all' });
    setQuery('');
    setPreview(false);
    select(local.key);
    requestAnimationFrame(() => titleRef.current?.focus());
  }, [filter, commit, select, openDaily]);

  const trashSelected = useCallback(async () => {
    if (!selected) return;
    const index = visible.findIndex((n) => n.key === selected.key);
    const next = visible[index + 1] ?? visible[index - 1] ?? null;
    window.clearTimeout(timers.current.get(selected.key));
    while (inflight.current.has(selected.key)) await inflight.current.get(selected.key);
    const current = notesRef.current.find((n) => n.key === selected.key);
    if (current) await api.trashNote(current.id).catch(() => {});
    versions.current.delete(selected.key);
    saved.current.delete(selected.key);
    commit((prev) => prev.filter((n) => n.key !== selected.key));
    setSelectedKey(next?.key ?? null);
  }, [selected, visible, commit]);

  const showFormatPanel = useCallback((open: boolean) => {
    setFormatOpen(open);
    try {
      localStorage.setItem('mdnotes:formatPanel', open ? 'open' : 'closed');
    } catch {
      // storage unavailable: the panel just won't be remembered
    }
  }, []);

  const toggleFormat = useCallback(() => {
    if (!formatOpen && document.activeElement === titleRef.current) setFormatTarget('title');
    showFormatPanel(!formatOpen);
  }, [formatOpen, showFormatPanel]);

  // Keeps the panel in step with the editor's selection and focus.
  const onEditorActivity = useCallback((editor: EditorView) => {
    if (editor.hasFocus) setFormatTarget('body');
    setFormatTick((t) => t + 1);
  }, []);

  const togglePin = useCallback(() => {
    if (selected) updateNote(selected.key, { pinned: !selected.pinned });
  }, [selected, updateNote]);

  const changeSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...patch } : s));
    setSettings(await api.setSettings(patch));
  }, []);

  const chooseFolder = useCallback(async () => {
    await flushAll();
    const next = await api.chooseFolder();
    setSettings(next);
    commit(() => []);
    const list = await reload();
    setSelectedKey(list[0]?.key ?? null);
    await tasks.reload();
    setView({ kind: 'notes' });
  }, [flushAll, reload, commit, tasks]);

  const setTagColorFor = useCallback(async (tag: string, color: string) => {
    setColors((c) => ({ ...c, [tag]: color }));
    setColors(await api.setTagColor(tag, color));
  }, []);

  const renameTag = useCallback(
    async (from: string, to: string) => {
      await flushAll();
      await api.renameTag(from, to);
      await Promise.all([reload(), tasks.reload()]);
      if (filter.kind === 'tag' && filter.tag === from) {
        setFilter(to ? { kind: 'tag', tag: to.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase() } : { kind: 'all' });
      }
    },
    [flushAll, reload, filter, tasks],
  );

  const showTag = useCallback((tag: string) => {
    setView({ kind: 'notes' });
    setFilter({ kind: 'tag', tag });
  }, []);

  const showNotes = (next: Filter) => {
    setView({ kind: 'notes' });
    setFilter(next);
  };

  const openTask = (listId: string, taskId: string) => setView({ kind: 'list', id: listId, reveal: taskId });

  const createList = (name: string) => {
    const id = tasks.createList(name.trim() || 'Untitled list');
    setView({ kind: 'list', id, reveal: null });
    return id;
  };

  const deleteList = (id: string) => {
    const list = tasks.lists.find((l) => l.id === id);
    if (!list) return;
    const count = openCount(list);
    if (count && !window.confirm(`Delete "${list.name}" and its ${count} open ${count === 1 ? 'task' : 'tasks'}? The file is moved to the notes folder's .trash.`)) return;
    void tasks.deleteList(id);
    if (view.kind === 'list' && view.id === id) setView({ kind: 'today' });
  };

  const moveSelection = (delta: number) => {
    if (!visible.length) return;
    const index = visible.findIndex((n) => n.key === selectedKey);
    const next = visible[Math.max(0, Math.min(visible.length - 1, index + delta))];
    if (next) select(next.key);
  };

  // ---- Commands & shortcuts ----------------------------------------------

  const runCommand = useCallback(
    (command: MenuCommand) => {
      switch (command) {
        case 'new':
          if (view.kind === 'notes') void createNote();
          else setNewTaskSignal((n) => n + 1);
          break;
        case 'search':
          setView({ kind: 'notes' });
          requestAnimationFrame(() => {
            searchRef.current?.focus();
            searchRef.current?.select();
          });
          break;
        case 'show-notes':
          setView({ kind: 'notes' });
          break;
        case 'show-today':
          setView({ kind: 'today' });
          break;
        case 'format':
          if (view.kind === 'notes') toggleFormat();
          break;
        case 'preview':
          if (view.kind === 'notes') setPreview((p) => !p);
          break;
        case 'settings':
          setShowSettings(true);
          break;
        case 'pin':
          if (view.kind === 'notes') togglePin();
          break;
        case 'trash':
          if (view.kind === 'notes') void trashSelected();
          break;
        case 'sidebar':
          setSidebarOpen((o) => !o);
          break;
      }
    },
    [createNote, togglePin, trashSelected, toggleFormat, view.kind, preview],
  );

  const commandRef = useRef(runCommand);
  commandRef.current = runCommand;

  useEffect(() => api.onMenuCommand((c) => commandRef.current(c)), []);

  // In the browser build there is no native menu, so handle shortcuts here.
  useEffect(() => {
    if (isDesktop) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const map: Record<string, MenuCommand> = { e: 'preview', ',': 'settings', k: 'search', '\\': 'sidebar', j: 'new', '1': 'show-notes', '2': 'show-today' };
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

  useEffect(() => {
    if (!tagMenu) return;
    const close = () => {
      setTagMenu(null);
      setRenaming(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [tagMenu]);

  useEffect(() => {
    if (!listMenu) return;
    const close = () => setListMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [listMenu]);

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

  const filterLabel =
    filter.kind === 'all'
      ? 'All notes'
      : filter.kind === 'daily'
        ? 'Daily Notes'
        : filter.kind === 'pinned'
          ? 'Pinned'
          : filter.kind === 'untagged'
            ? 'Untagged'
            : `#${filter.tag}`;
  const counts = {
    all: notes.length,
    pinned: notes.filter((n) => n.pinned).length,
    untagged: notes.filter((n) => !n.tags.length).length,
    daily: notes.filter((n) => n.daily).length,
  };
  const words = selected ? (stripFormatting(selected.body).match(/\S+/g) ?? []).length : 0;
  const nextSort = { updated: 'created', created: 'title', title: 'updated' } as const;
  const sortLabel = { updated: 'Last edited', created: 'Date created', title: 'Title' };

  return (
    <div className={`app${sidebarOpen ? '' : ' sidebar-collapsed'}${isDesktop ? ' desktop' : ''}${view.kind === 'notes' ? '' : ' tasks-view'}`}>
      {sidebarOpen && (
        <aside className="sidebar">
          <div className="sidebar-top drag">
            <span className="brand">MD Notes</span>
          </div>
          <button className="new-note no-drag" onClick={() => runCommand('new')}>
            <IconPlus /> {view.kind === 'notes' ? 'New note' : 'New task'}
            <kbd>{isDesktop ? '⌘N' : ''}</kbd>
          </button>
          <div className="sidebar-scroll">
            <nav className="nav">
              <button className={`nav-item${view.kind === 'notes' && filter.kind === 'all' ? ' active' : ''}`} onClick={() => showNotes({ kind: 'all' })}>
                <IconNotes /> All notes <span className="count">{counts.all}</span>
              </button>
              <button
                className={`nav-item${view.kind === 'notes' && filter.kind === 'daily' ? ' active' : ''}`}
                onClick={() => void openDaily()}
                title="Open today's daily note"
              >
                <IconCalendar /> Daily Notes <span className="count">{counts.daily}</span>
              </button>
              <button className={`nav-item${view.kind === 'notes' && filter.kind === 'pinned' ? ' active' : ''}`} onClick={() => showNotes({ kind: 'pinned' })}>
                <IconPin /> Pinned <span className="count">{counts.pinned}</span>
              </button>
              <button className={`nav-item${view.kind === 'notes' && filter.kind === 'untagged' ? ' active' : ''}`} onClick={() => showNotes({ kind: 'untagged' })}>
                <IconUntagged /> Untagged <span className="count">{counts.untagged}</span>
              </button>
            </nav>

            <div className="section-label with-action">
              Tasks
              <button className="section-action" title="New list" aria-label="New list" onClick={() => setNewListName('')}>
                <IconPlus size={13} />
              </button>
            </div>
            <nav className="nav lists-nav">
              <button className={`nav-item${view.kind === 'today' ? ' active' : ''}`} onClick={() => setView({ kind: 'today' })}>
                <IconSun /> Today {todayCount > 0 && <span className="count badge">{todayCount}</span>}
              </button>
              {tasks.lists.map((list) => (
                <button
                  key={list.id}
                  className={`nav-item${view.kind === 'list' && view.id === list.id ? ' active' : ''}${dropListId === list.id ? ' drop-target' : ''}`}
                  onClick={() => setView({ kind: 'list', id: list.id, reveal: null })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setListMenu({ id: list.id, x: e.clientX, y: e.clientY });
                  }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
                    e.preventDefault();
                    setDropListId(list.id);
                  }}
                  onDragLeave={() => setDropListId(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropListId(null);
                    try {
                      const { listId, taskId } = JSON.parse(e.dataTransfer.getData(TASK_DRAG_TYPE));
                      tasks.moveToList(listId, list.id, taskId);
                    } catch {
                      // not a task
                    }
                  }}
                >
                  <IconList />
                  <span className="nav-text">{list.name}</span>
                  <span className="count">{openCount(list) || ''}</span>
                </button>
              ))}
              {newListName !== null && (
                <form
                  className="new-list-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newListName.trim()) createList(newListName);
                    setNewListName(null);
                  }}
                >
                  <IconList />
                  <input
                    autoFocus
                    value={newListName}
                    placeholder="List name"
                    aria-label="New list name"
                    onChange={(e) => setNewListName(e.target.value)}
                    onBlur={() => {
                      if (newListName.trim()) createList(newListName);
                      setNewListName(null);
                    }}
                    onKeyDown={(e) => e.key === 'Escape' && setNewListName(null)}
                  />
                </form>
              )}
            </nav>

            <div className="section-label">Tags</div>
            <nav className="nav tags-nav">
              {allTags.length === 0 && <p className="empty-hint">Tags you add to notes and tasks show up here.</p>}
              {allTags.map(([tag, count]) => (
                <button
                  key={tag}
                  className={`nav-item${view.kind === 'notes' && filter.kind === 'tag' && filter.tag === tag ? ' active' : ''}`}
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

      {view.kind === 'list' && activeList && (
        <ListPage
          key={activeList.id}
          list={activeList}
          revealTaskId={view.reveal}
          tasks={tasks}
          colors={colors}
          allTags={tagNames}
          newTaskSignal={newTaskSignal}
          sidebarOpen={sidebarOpen}
          onShowSidebar={() => setSidebarOpen(true)}
          onSelectTag={showTag}
          onDeleteList={(list) => deleteList(list.id)}
        />
      )}
      {(view.kind === 'today' || (view.kind === 'list' && !activeList)) && (
        <TodayPage
          tasks={tasks}
          colors={colors}
          allTags={tagNames}
          newTaskSignal={newTaskSignal}
          sidebarOpen={sidebarOpen}
          onShowSidebar={() => setSidebarOpen(true)}
          onSelectTag={showTag}
          onOpenList={openTask}
          onCreateList={createList}
        />
      )}

      {view.kind === 'notes' && (
        <>
          <section className="list-pane">
            <div className="list-header drag">
              {!sidebarOpen && (
                <button className="icon-button no-drag" onClick={() => setSidebarOpen(true)} title="Show sidebar" aria-label="Show sidebar">
                  <IconSidebar />
                </button>
              )}
              <div className="list-title">
                <h1>{filterLabel}</h1>
                <span>{visible.length} {visible.length === 1 ? 'note' : 'notes'}</span>
              </div>
              <button
                className="icon-button no-drag"
                title={`Sort: ${sortLabel[settings?.sort ?? 'updated']}`}
                aria-label="Change sort order"
                onClick={() => settings && void changeSettings({ sort: nextSort[settings.sort] })}
              >
                <IconSort />
              </button>
              <button className="icon-button no-drag" title="New note" aria-label="New note" onClick={() => void createNote()}>
                <IconPencil />
              </button>
            </div>
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
            <div className="note-list">
              {filter.kind === 'daily' && <DailyCalendar noteDates={dailyDates} selected={selected?.daily ?? null} onPick={(date) => void openDaily(date)} />}
              <TaskMatches rows={taskMatches} tasks={tasks} onOpen={openTask} />
              {taskMatches.length > 0 && visible.length > 0 && <div className="task-matches-label notes-label">Notes</div>}
              {visible.length === 0 && (
                <div className="list-empty">
                  <p>{query ? 'No notes match your search.' : taskMatches.length ? 'No notes with this tag yet.' : 'No notes here yet.'}</p>
                  {!query && (
                    <button className="button" onClick={() => void createNote()}>
                      <IconPlus size={14} /> New note
                    </button>
                  )}
                </div>
              )}
              {visible.map((n) => (
                <button key={n.key} className={`note-item${n.key === selectedKey ? ' selected' : ''}`} onClick={() => select(n.key)}>
                  <div className="note-item-top">
                    <span className={`note-item-title${n.title ? '' : ' untitled'}`}>{n.title || 'Untitled'}</span>
                    {n.pinned && <span className="pin-mark"><IconPin size={12} /></span>}
                  </div>
                  <div className="note-item-snippet">{snippet(n.body) || 'No additional text'}</div>
                  <div className="note-item-meta">
                    <span className="note-item-date">{formatDate(n.updated)}</span>
                    {n.tags.slice(0, 3).map((t) => (
                      <TagChip key={t} tag={t} colors={colors} small />
                    ))}
                    {n.tags.length > 3 && <span className="more-tags">+{n.tags.length - 3}</span>}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <main className="editor-pane">
            <div className="editor-toolbar drag">
              <div className="crumbs">
                {selected && (
                  <>
                    <span>{filterLabel}</span>
                    <span className="crumb-sep">/</span>
                    <span className="crumb-current">{selected.title || 'Untitled'}</span>
                  </>
                )}
              </div>
              {selected && (
                <div className="toolbar-actions no-drag">
                  <button className={`icon-button${selected.pinned ? ' on' : ''}`} onClick={togglePin} title="Pin note (⇧⌘P)" aria-label="Pin note">
                    <IconPin />
                  </button>
                  <button className={`icon-button${preview ? ' on' : ''}`} onClick={() => setPreview((p) => !p)} title="Toggle preview (⌘E)" aria-label="Toggle preview">
                    {preview ? <IconPencil /> : <IconEye />}
                  </button>
                  <button className="icon-button danger" onClick={() => void trashSelected()} title="Move to trash (⌘⌫)" aria-label="Move to trash">
                    <IconTrash />
                  </button>
                </div>
              )}
            </div>

            <div className="editor-body">
              <div className="editor-main">
                {selected && (
                  <FormatBar editor={editorRef.current} tick={formatTick} readOnly={preview} colorOpen={formatOpen} onToggleColor={toggleFormat} />
                )}
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
                          <TagInput
                            tags={selected.tags}
                            allTags={tagNames}
                            colors={colors}
                            onChange={(tags) => updateNote(selected.key, { tags })}
                            onSelectTag={(tag) => setFilter({ kind: 'tag', tag })}
                          />
                        </div>
                        <div className="property">
                          <span className="property-label">Edited</span>
                          <span className="property-value">{formatLong(selected.updated)}</span>
                        </div>
                      </div>
                      <div className={preview ? 'hidden' : ''}>
                        <Editor
                          docKey={selected.key}
                          value={selected.body}
                          onChange={(body) => updateNote(selected.key, { body })}
                          editorRef={editorRef}
                          onActivity={onEditorActivity}
                        />
                      </div>
                      {preview && <Preview body={selected.body} onChange={(body) => updateNote(selected.key, { body })} />}
                    </article>
                  </div>
                ) : (
                  <div className="no-selection">
                    <IconNotes size={36} />
                    <p>Select a note or create a new one.</p>
                    <button className="button primary" onClick={() => void createNote()}>
                      <IconPlus size={14} /> New note
                    </button>
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
        </>
      )}

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
          <div className="context-sep" />
          {renaming !== null ? (
            <form
              className="rename-form"
              onSubmit={(e) => {
                e.preventDefault();
                const to = renaming.trim();
                if (to && to !== tagMenu.tag) void renameTag(tagMenu.tag, to);
                setTagMenu(null);
                setRenaming(null);
              }}
            >
              <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} aria-label="New tag name" />
            </form>
          ) : (
            <button className="context-item" onClick={() => setRenaming(tagMenu.tag)}>
              Rename tag…
            </button>
          )}
          <button
            className="context-item danger"
            onClick={() => {
              const tag = tagMenu.tag;
              setTagMenu(null);
              if (window.confirm(`Remove #${tag} from all notes? The notes themselves are kept.`)) void renameTag(tag, '');
            }}
          >
            Delete tag
          </button>
        </div>
      )}

      {listMenu && (
        <div className="context-menu" style={{ left: listMenu.x, top: listMenu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <button
            className="context-item"
            onClick={() => {
              const id = listMenu.id;
              setListMenu(null);
              setView({ kind: 'list', id, reveal: null });
              requestAnimationFrame(() => {
                const input = document.querySelector<HTMLInputElement>('.list-name-input');
                input?.focus();
                input?.select();
              });
            }}
          >
            Rename list
          </button>
          <button
            className="context-item danger"
            onClick={() => {
              const id = listMenu.id;
              setListMenu(null);
              deleteList(id);
            }}
          >
            Delete list
          </button>
        </div>
      )}

      {showSettings && settings && (
        <SettingsDialog
          settings={settings}
          isDesktop={isDesktop}
          onChange={(patch) => void changeSettings(patch)}
          onChooseFolder={() => void chooseFolder()}
          onRevealFolder={() => void api.revealFolder()}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
