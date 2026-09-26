export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  pinned: boolean;
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
export type MenuCommand = 'new' | 'search' | 'preview' | 'settings' | 'pin' | 'trash' | 'sidebar';

export interface NotesApi {
  platform: string;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  chooseFolder(): Promise<Settings>;
  revealFolder(): Promise<void>;
  listNotes(): Promise<Note[]>;
  createNote(input?: Partial<Pick<Note, 'title' | 'body' | 'tags'>>): Promise<Note>;
  saveNote(note: Pick<Note, 'id' | 'title' | 'body' | 'tags' | 'pinned'>): Promise<Note>;
  trashNote(id: string): Promise<void>;
  getTagColors(): Promise<TagColors>;
  setTagColor(tag: string, color: string): Promise<TagColors>;
  renameTag(from: string, to: string): Promise<Note[]>;
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
  type State = { notes: Note[]; colors: TagColors; settings: Settings };
  const now = () => new Date().toISOString();
  const load = (): State => {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '');
      if (parsed?.notes) return parsed;
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
      persist();
      return clone(state.notes);
    },
    onNotesChanged: () => () => {},
    onMenuCommand: () => () => {},
  };
}

export const api: NotesApi = window.notesApi ?? createBrowserApi();
