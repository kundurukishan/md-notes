export interface Note {
  // Path relative to the open folder, with "/" separators: "Work/Plan.md".
  id: string;
  // The folder part of the id ('' for the top level) and the filename stem.
  dir: string;
  name: string;
  title: string;
  body: string;
  // Tags from the frontmatter (editable) and #tags written in the text.
  tags: string[];
  inlineTags: string[];
  titleColor?: string | null;
  titleBold?: boolean;
  hasFrontmatter: boolean;
  created: string;
  updated: string;
}

export interface Listing {
  files: Note[];
  // Every folder, including empty ones, as relative paths.
  dirs: string[];
}

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  folder: string | null;
  recentFolders: string[];
  font: string;
  fontSize: number;
  lineWidth: number;
  theme: Theme;
}

export type TagColors = Record<string, string>;
export type MenuCommand = 'new' | 'new-folder' | 'search' | 'preview' | 'settings' | 'trash' | 'sidebar' | 'format' | 'reveal' | 'folder-changed';

export interface ViewerApi {
  platform: string;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  chooseFolder(): Promise<Settings>;
  openFolder(dir: string | null): Promise<Settings>;
  revealFolder(): Promise<void>;
  revealFile(id: string): Promise<void>;
  listFiles(): Promise<Listing>;
  createNote(input?: { dir?: string; title?: string; body?: string }): Promise<Note>;
  createFolder(parent: string, name: string): Promise<string>;
  saveNote(note: Pick<Note, 'id' | 'title' | 'body' | 'tags' | 'titleColor' | 'titleBold'>): Promise<Note>;
  trashNote(id: string): Promise<void>;
  getTagColors(): Promise<TagColors>;
  setTagColor(tag: string, color: string): Promise<TagColors>;
  onFilesChanged(callback: () => void): () => void;
  onMenuCommand(callback: (command: MenuCommand) => void): () => void;
}

declare global {
  interface Window {
    viewerApi?: ViewerApi;
  }
}

export const isDesktop = Boolean(window.viewerApi);

// In a plain browser (`npm run dev:web`) there is no Electron backend, so fall
// back to an in-memory folder with the same behavior for UI development.
function createBrowserApi(): ViewerApi {
  const now = () => new Date().toISOString();
  const t = now();
  type Raw = { id: string; raw: string; created: string; updated: string };
  const seed: [string, string][] = [
    ['README.md', '# My notes\n\nThis is the **browser preview** of MD Viewer. In the Mac app every file here is a Markdown file in the folder you opened.\n\n- [x] Browse the folder on the left\n- [ ] Pick a font in Settings\n\nTagged inline with #getting-started.\n'],
    ['Work/Weekly planning.md', '---\ntitle: Weekly planning\ntags: [work, planning]\ncreated: 2026-09-28T08:18:00.000Z\nupdated: 2026-09-28T08:18:00.000Z\n---\n\n## Focus this week\n\nShip the **onboarding redesign** and close out Q3 reviews.\n\n- [x] Draft review notes for the team\n- [ ] Finalize copy for the welcome screens\n\n## Notes\n\n> Keep scope small. We can iterate after launch.\n'],
    ['Work/1-1 with Priya.md', '---\ntitle: 1:1 with Priya\ntags: [work]\n---\n\nTalked about growth goals and the mentoring program.\n'],
    ['Work/Projects/Launch checklist.md', '- [ ] Press release\n- [ ] Update the website #work\n'],
    ['Personal/Trip to Kyoto.md', '---\ntags: [travel, ideas]\n---\n\nMust see Fushimi Inari at sunrise. Arashiyama bamboo grove. Nishiki Market.\n'],
    ['Personal/Recipes/Miso soup.md', '## Ingredients\n\n- 4 cups dashi\n- 3 tbsp white miso\n- Silken tofu, cubed\n\n#cooking\n'],
    ['Reading list.md', '---\ntags: [books]\n---\n\n- The Design of Everyday Things\n- Deep Work\n'],
  ];
  const files = new Map<string, Raw>(seed.map(([id, raw]) => [id, { id, raw, created: t, updated: t }]));
  const dirs = new Set(['Work', 'Work/Projects', 'Personal', 'Personal/Recipes', 'Archive']);
  let colors: TagColors = { 'getting-started': 'purple', work: 'blue', planning: 'purple' };
  let settings: Settings = { folder: '~/Documents/Notes', recentFolders: [], font: 'IBM Plex Sans', fontSize: 16, lineWidth: 720, theme: 'system' };

  const FM = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/;
  const norm = (tags: string[]) => [...new Set(tags.map((x) => x.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase()).filter(Boolean))];
  const parseFm = (raw: string): { data: Record<string, unknown>; header: string; body: string } => {
    const m = raw.match(FM);
    if (!m) return { data: {}, header: '', body: raw };
    const data: Record<string, unknown> = {};
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^([\w-]+):\s*(.*)$/);
      if (!kv) continue;
      const [, k, v] = kv;
      if (v.startsWith('[')) data[k] = v.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      else if (v === 'false' || v === 'true') data[k] = v === 'true';
      else data[k] = v.replace(/^"|"$/g, '');
    }
    return { data, header: m[0], body: raw.slice(m[0].length) };
  };
  const serializeFm = (data: Record<string, unknown>) =>
    `---\n${Object.entries(data)
      .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(', ')}]` : typeof v === 'string' && v.startsWith('#') ? `"${v}"` : String(v)}`)
      .join('\n')}\n---\n\n`;
  const inline = (body: string) => {
    const out = new Set<string>();
    for (const m of body.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ').matchAll(/(^|[\s(\[{,;])#([a-z][\w/-]*)/gi)) out.add(m[2].toLowerCase());
    return [...out];
  };
  const toNote = (f: Raw): Note => {
    const { data, header, body } = parseFm(f.raw);
    const name = f.id.split('/').pop()!.replace(/\.md$/i, '');
    const dir = f.id.includes('/') ? f.id.slice(0, f.id.lastIndexOf('/')) : '';
    return {
      id: f.id,
      dir,
      name,
      title: typeof data.title === 'string' && data.title.trim() ? data.title : name,
      body,
      tags: Array.isArray(data.tags) ? norm(data.tags as string[]) : [],
      inlineTags: inline(body),
      titleColor: typeof data.titleColor === 'string' ? data.titleColor : null,
      titleBold: data.titleBold !== false,
      hasFrontmatter: Boolean(header),
      created: typeof data.created === 'string' ? data.created : f.created,
      updated: typeof data.updated === 'string' ? data.updated : f.updated,
    };
  };
  const slug = (title: string) => title.replace(/[\\/:*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled';
  const uniqueId = (dir: string, title: string, current?: string) => {
    const base = slug(title);
    for (let i = 0; ; i++) {
      const name = i === 0 ? `${base}.md` : `${base} ${i + 1}.md`;
      const id = dir ? `${dir}/${name}` : name;
      if (id.toLowerCase() === (current ?? '').toLowerCase()) return current!;
      if (!files.has(id)) return id;
    }
  };
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  return {
    platform: 'web',
    getSettings: async () => ({ ...settings }),
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    chooseFolder: async () => ({ ...settings }),
    openFolder: async (dir) => (settings = { ...settings, folder: dir }),
    revealFolder: async () => {},
    revealFile: async () => {},
    listFiles: async () => ({
      files: [...files.values()].map(toNote).sort((a, b) => collator.compare(a.id, b.id)),
      dirs: [...dirs].sort(collator.compare),
    }),
    createNote: async ({ dir = '', title = '', body = '' } = {}) => {
      const id = uniqueId(dir, title || 'Untitled');
      const f = { id, raw: body, created: now(), updated: now() };
      files.set(id, f);
      return toNote(f);
    },
    createFolder: async (parent, name) => {
      const id = parent ? `${parent}/${slug(name)}` : slug(name);
      dirs.add(id);
      return id;
    },
    saveNote: async (input) => {
      const f = files.get(input.id);
      if (!f) throw new Error(`No such file: ${input.id}`);
      const before = toNote(f);
      const { data, header, body: oldBody } = parseFm(f.raw);
      const next = { ...data };
      if (input.title !== before.title && 'title' in data) next.title = input.title;
      const tags = norm(input.tags);
      if (tags.length || 'tags' in data) next.tags = tags;
      if (input.titleColor) next.titleColor = input.titleColor;
      else delete next.titleColor;
      if (input.titleBold === false) next.titleBold = false;
      else delete next.titleBold;
      const body = typeof input.body === 'string' ? input.body : oldBody;
      const same = JSON.stringify(next) === JSON.stringify(data);
      const raw = same ? header + body : Object.keys(next).length ? serializeFm(next) + body.replace(/^\n+/, '') : body;
      let id = input.id;
      if (input.title !== before.title) {
        id = uniqueId(before.dir, input.title || 'Untitled', input.id);
        files.delete(input.id);
      }
      const saved = { id, raw, created: f.created, updated: now() };
      files.set(id, saved);
      return toNote(saved);
    },
    trashNote: async (id) => {
      files.delete(id);
    },
    getTagColors: async () => ({ ...colors }),
    setTagColor: async (tag, color) => (colors = { ...colors, [tag]: color }),
    onFilesChanged: () => () => {},
    onMenuCommand: () => () => {},
  };
}

export const api: ViewerApi = window.viewerApi ?? createBrowserApi();
