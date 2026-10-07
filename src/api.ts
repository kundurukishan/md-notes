import * as tasksModel from '../shared/tasks.mjs';
import type { ListOpArgs, ListOpName, TaskList } from '../shared/tasks.mjs';

export type { Task, TaskList, TaskRef, TaskPatch, ListOpName, ListOpArgs } from '../shared/tasks.mjs';

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
  // Title formatting, saved in the note's frontmatter.
  titleColor?: string | null;
  titleBold?: boolean;
  created: string;
  updated: string;
}

export type Theme = 'system' | 'light' | 'dark';
export type SortKey = 'updated' | 'created' | 'title';

export interface Settings {
  notesDir: string;
  font: string;
  fontSize: number;
  lineWidth: number;
  theme: Theme;
  sort: SortKey;
}

export type TagColors = Record<string, string>;
export type MenuCommand = 'new' | 'search' | 'preview' | 'settings' | 'pin' | 'trash' | 'sidebar' | 'show-notes' | 'show-today' | 'format';

export interface NotesApi {
  platform: string;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  chooseFolder(): Promise<Settings>;
  revealFolder(): Promise<void>;
  listNotes(): Promise<Note[]>;
  createNote(input?: Partial<Pick<Note, 'title' | 'body' | 'tags'>>): Promise<Note>;
  saveNote(note: Pick<Note, 'id' | 'title' | 'body' | 'tags' | 'pinned' | 'titleColor' | 'titleBold'>): Promise<Note>;
  trashNote(id: string): Promise<void>;
  getTagColors(): Promise<TagColors>;
  setTagColor(tag: string, color: string): Promise<TagColors>;
  renameTag(from: string, to: string): Promise<Note[]>;
  listTaskLists(): Promise<TaskList[]>;
  createTaskList(name: string, id?: string): Promise<TaskList>;
  renameTaskList(id: string, name: string): Promise<TaskList>;
  deleteTaskList(id: string): Promise<void>;
  applyTaskOp<K extends ListOpName>(id: string, op: K, args: ListOpArgs<K>): Promise<TaskList>;
  moveTaskToList(fromId: string, toId: string, taskId: string): Promise<[TaskList, TaskList]>;
  onTasksChanged(callback: () => void): () => void;
  onNotesChanged(callback: () => void): () => void;
  onMenuCommand(callback: (command: MenuCommand) => void): () => void;
}

declare global {
  interface Window {
    notesApi?: NotesApi;
  }
}

export const isDesktop = Boolean(window.notesApi);

// In a plain browser (`npm run dev:web`) there is no Electron backend, so fall
// back to a localStorage store with the same behavior for UI development.
function createBrowserApi(): NotesApi {
  const KEY = 'mdnotes:web';
  // Task lists are kept as Markdown text, like the files on disk.
  type State = { notes: Note[]; colors: TagColors; settings: Settings; taskFiles: { name: string; raw: string }[] };
  const now = () => new Date().toISOString();
  const load = (): State => {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '');
      if (parsed?.notes) return { taskFiles: [], ...parsed };
    } catch {
      // fall through to the seed state
    }
    const t = now();
    return {
      notes: [
        {
          id: 'Welcome to MD Notes.md',
          title: 'Welcome to MD Notes',
          body: '# Hello\n\nThis is the **browser preview** of MD Notes. In the Mac app every note is a Markdown file on disk.\n\n- [x] Try the editor\n- [ ] Pick a font in Settings\n',
          tags: ['getting-started'],
          pinned: true,
          created: t,
          updated: t,
        },
      ],
      colors: { 'getting-started': 'purple' },
      taskFiles: [{ name: 'My Tasks', raw: '- [ ] Click a task to add details, tags and a due date #getting-started\n- [ ] Press Enter to add the next task, Tab to make it a subtask\n' }],
      settings: { notesDir: '~/Documents/MD Notes', font: 'IBM Plex Sans', fontSize: 16, lineWidth: 720, theme: 'system', sort: 'updated' },
    };
  };
  let state = load();
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // storage unavailable: keep the in-memory state
    }
  };
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  const norm = (tags: string[]) => [...new Set(tags.map((t) => t.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase()).filter(Boolean))];
  const uniqueId = (title: string, current?: string) => {
    const base = (title.replace(/[\\/:*?"<>|#^[\]]/g, '').trim().slice(0, 80) || 'Untitled');
    for (let i = 0; ; i++) {
      const id = i === 0 ? `${base}.md` : `${base} ${i + 1}.md`;
      if (id === current || !state.notes.some((n) => n.id === id)) return id;
    }
  };

  // Parsed lists stay in memory so task ids are stable, like in the main process.
  let lists: TaskList[] | null = null;
  const getLists = () => (lists ??= state.taskFiles.map((f) => tasksModel.parseList(f.raw, { name: f.name })));
  const saveLists = () => {
    state.taskFiles = getLists()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((l) => ({ name: l.name, raw: tasksModel.serializeList(l) }));
    persist();
  };
  const uniqueListName = (name: string, id?: string) => {
    const base = name.replace(/[\\/:*?"<>|#^[\]]/g, '').trim() || 'Untitled list';
    for (let i = 0; ; i++) {
      const candidate = i === 0 ? base : `${base} ${i + 1}`;
      if (!getLists().some((l) => l.id !== id && l.name.toLowerCase() === candidate.toLowerCase())) return candidate;
    }
  };

  return {
    platform: 'web',
    getSettings: async () => clone(state.settings),
    setSettings: async (patch) => {
      state.settings = { ...state.settings, ...patch };
      persist();
      return clone(state.settings);
    },
    chooseFolder: async () => clone(state.settings),
    revealFolder: async () => {},
    listNotes: async () => clone(state.notes),
    createNote: async (input = {}) => {
      const t = now();
      const note: Note = { id: uniqueId(input.title || 'Untitled'), title: input.title || '', body: input.body || '', tags: norm(input.tags || []), pinned: false, created: t, updated: t };
      state.notes.push(note);
      persist();
      return clone(note);
    },
    saveNote: async (input) => {
      const existing = state.notes.find((n) => n.id === input.id);
      const note: Note = {
        ...(existing || { created: now() }),
        ...input,
        tags: norm(input.tags),
        id: uniqueId(input.title || 'Untitled', existing ? input.id : undefined),
        updated: now(),
      } as Note;
      state.notes = state.notes.filter((n) => n.id !== input.id).concat(note);
      persist();
      return clone(note);
    },
    trashNote: async (id) => {
      state.notes = state.notes.filter((n) => n.id !== id);
      persist();
    },
    getTagColors: async () => clone(state.colors),
    setTagColor: async (tag, color) => {
      state.colors[tag] = color;
      persist();
      return clone(state.colors);
    },
    renameTag: async (from, to) => {
      const dst = to ? norm([to])[0] : '';
      state.notes = state.notes.map((n) => (n.tags.includes(from) ? { ...n, tags: norm(n.tags.map((t) => (t === from ? dst : t)).filter(Boolean)) } : n));
      if (dst && state.colors[from] && !state.colors[dst]) state.colors[dst] = state.colors[from];
      delete state.colors[from];
      lists = getLists().map((l) => tasksModel.renameTag(l, from, to));
      saveLists();
      return clone(state.notes);
    },
    listTaskLists: async () => clone(getLists()),
    createTaskList: async (name, id) => {
      const list = tasksModel.parseList('', { id, name: uniqueListName(name || 'Untitled list') });
      getLists().push(list);
      saveLists();
      return clone(list);
    },
    renameTaskList: async (id, name) => {
      const list = getLists().find((l) => l.id === id)!;
      list.name = uniqueListName(name || 'Untitled list', id);
      saveLists();
      return clone(list);
    },
    deleteTaskList: async (id) => {
      lists = getLists().filter((l) => l.id !== id);
      saveLists();
    },
    applyTaskOp: async (id, op, args) => {
      const fn = tasksModel.LIST_OPS[op] as (list: TaskList, ...a: unknown[]) => TaskList;
      lists = getLists().map((l) => (l.id === id ? fn(l, ...(args as unknown[])) : l));
      saveLists();
      return clone(lists.find((l) => l.id === id)!);
    },
    moveTaskToList: async (fromId, toId, taskId) => {
      const all = getLists();
      const res = tasksModel.moveToList(all.find((l) => l.id === fromId)!, all.find((l) => l.id === toId)!, taskId);
      lists = all.map((l) => (l.id === fromId ? res.from : l.id === toId ? res.to : l));
      saveLists();
      return [clone(res.from), clone(res.to)];
    },
    onTasksChanged: () => () => {},
    onNotesChanged: () => () => {},
    onMenuCommand: () => () => {},
  };
}

export const api: NotesApi = window.notesApi ?? createBrowserApi();
