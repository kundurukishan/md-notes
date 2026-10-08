// File-backed note storage. Every note is a plain Markdown file with YAML
// frontmatter, so the notes folder stays readable by any other editor.
const fs = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');

const META_DIR = '.mdnotes';
const TRASH_DIR = '.trash';
const TAGS_FILE = 'tags.json';
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
// Daily notes live in their own folder, one file per day: Daily Notes/2026-10-08.md.
// Their ids include the folder ("Daily Notes/2026-10-08.md").
const DAILY_DIR = 'Daily Notes';
const DAILY_RE = /^Daily Notes\/(\d{4}-\d{2}-\d{2})\.md$/;
const KNOWN_KEYS = new Set(['title', 'tags', 'pinned', 'created', 'updated', 'titleColor', 'titleBold']);
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+)$/i;

function cleanColor(value) {
  return typeof value === 'string' && COLOR_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function parseNote(id, raw, stat) {
  let data = {};
  let body = raw;
  const match = raw.match(FRONTMATTER_RE);
  if (match) {
    try {
      const parsed = YAML.parse(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
      body = raw.slice(match[0].length).replace(/^\r?\n/, '');
    } catch {
      // Malformed frontmatter: treat the whole file as the body.
    }
  }

  const extra = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.has(key)) extra[key] = value;
  }

  let tags = data.tags;
  if (typeof tags === 'string') tags = tags.split(',');
  tags = Array.isArray(tags) ? normalizeTags(tags) : [];

  return {
    id,
    title: typeof data.title === 'string' ? data.title : path.basename(id).replace(/\.md$/i, ''),
    body,
    tags,
    pinned: data.pinned === true,
    daily: id.match(DAILY_RE)?.[1] ?? null,
    titleColor: cleanColor(data.titleColor),
    titleBold: data.titleBold !== false,
    created: toIso(data.created) || (stat ? stat.birthtime.toISOString() : new Date().toISOString()),
    updated: toIso(data.updated) || (stat ? stat.mtime.toISOString() : new Date().toISOString()),
    extra,
  };
}

function serializeNote(note) {
  const data = {
    title: note.title,
    tags: note.tags,
    ...(note.pinned ? { pinned: true } : {}),
    // Title formatting is only written when it differs from the default.
    ...(note.titleColor ? { titleColor: note.titleColor } : {}),
    ...(note.titleBold === false ? { titleBold: false } : {}),
    created: note.created,
    updated: note.updated,
    ...(note.extra || {}),
  };
  // One property per line, with lists such as tags kept on one line: [a, b].
  const doc = new YAML.Document(data);
  YAML.visit(doc, {
    Seq(_key, node) {
      node.flow = true;
    },
  });
  const yaml = doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd();
  return `---\n${yaml}\n---\n\n${note.body.replace(/^\n+/, '')}`;
}

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normalizeTag(tag) {
  return String(tag).trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
}

function normalizeTags(tags) {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

function slugify(title) {
  const slug = String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return slug || 'Untitled';
}

class NoteStore {
  constructor(dir) {
    this.dir = dir;
    // Paths we wrote recently, so the folder watcher can ignore our own writes.
    this.recentWrites = new Map();
  }

  // Note ids are filenames in the notes folder, or "Daily Notes/<date>.md".
  resolve(id) {
    if (typeof id !== 'string' || !/\.md$/i.test(id) || id.startsWith('.')) throw new Error(`Invalid note id: ${id}`);
    if (id !== path.basename(id) && !DAILY_RE.test(id)) throw new Error(`Invalid note id: ${id}`);
    return path.join(this.dir, id);
  }

  markWrite(name) {
    this.recentWrites.set(name, Date.now());
  }

  isOwnWrite(name) {
    const at = this.recentWrites.get(name);
    return at !== undefined && Date.now() - at < 1500;
  }

  async ensureDir() {
    await fs.mkdir(path.join(this.dir, META_DIR), { recursive: true });
    await fs.mkdir(path.join(this.dir, DAILY_DIR), { recursive: true });
  }

  async list() {
    await this.ensureDir();
    const ids = (await fs.readdir(this.dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && /\.md$/i.test(e.name) && !e.name.startsWith('.'))
      .map((e) => e.name);
    for (const name of await fs.readdir(path.join(this.dir, DAILY_DIR)).catch(() => [])) {
      if (DAILY_RE.test(`${DAILY_DIR}/${name}`)) ids.push(`${DAILY_DIR}/${name}`);
    }
    const notes = await Promise.all(ids.map((id) => this.read(id).catch(() => null)));
    return notes.filter(Boolean);
  }

  async read(id) {
    const file = this.resolve(id);
    const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    return parseNote(id, raw, stat);
  }

  async exists(name) {
    try {
      await fs.access(path.join(this.dir, name));
      return true;
    } catch {
      return false;
    }
  }

  async uniqueName(title, currentId) {
    const base = slugify(title);
    for (let i = 0; ; i++) {
      const name = i === 0 ? `${base}.md` : `${base} ${i + 1}.md`;
      if (name.toLowerCase() === (currentId || '').toLowerCase()) return currentId;
      if (!(await this.exists(name))) return name;
    }
  }

  // Creates a note. With `daily` (a YYYY-MM-DD date) it creates that day's
  // daily note, or returns it if it already exists.
  async create({ title = '', body = '', tags = [], daily = null } = {}) {
    await this.ensureDir();
    let id;
    if (daily) {
      id = `${DAILY_DIR}/${daily}.md`;
      if (!DAILY_RE.test(id)) throw new Error(`Invalid date: ${daily}`);
      if (await this.exists(id)) return this.read(id);
    }
    const now = new Date().toISOString();
    const note = {
      id: id ?? (await this.uniqueName(title || 'Untitled')),
      daily: daily || null,
      title: title || '',
      body,
      tags: normalizeTags(tags),
      pinned: false,
      titleColor: null,
      titleBold: true,
      created: now,
      updated: now,
      extra: {},
    };
    await this.write(note);
    return note;
  }

  async write(note) {
    this.markWrite(note.id);
    await fs.writeFile(this.resolve(note.id), serializeNote(note), 'utf8');
  }

  // Saves a note, renaming its file when the title changes. Returns the saved
  // note, whose id may differ from the one passed in.
  async save(input) {
    await this.ensureDir();
    let existing = null;
    try {
      existing = await this.read(input.id);
    } catch {
      // The file vanished (deleted externally); recreate it below.
    }
    const title = typeof input.title === 'string' ? input.title : existing?.title || '';
    const note = {
      id: input.id,
      title,
      body: typeof input.body === 'string' ? input.body : existing?.body || '',
      tags: normalizeTags(Array.isArray(input.tags) ? input.tags : existing?.tags || []),
      pinned: typeof input.pinned === 'boolean' ? input.pinned : existing?.pinned || false,
      titleColor: 'titleColor' in input ? cleanColor(input.titleColor) : existing?.titleColor ?? null,
      titleBold: typeof input.titleBold === 'boolean' ? input.titleBold : existing?.titleBold ?? true,
      created: existing?.created || new Date().toISOString(),
      updated: new Date().toISOString(),
      extra: existing?.extra || {},
    };

    note.daily = input.id.match(DAILY_RE)?.[1] ?? null;
    // Daily notes keep their date as filename whatever the title.
    const desired = note.daily ? input.id : await this.uniqueName(title || 'Untitled', existing ? input.id : null);
    if (existing && desired !== input.id) {
      this.markWrite(input.id);
      this.markWrite(desired);
      await fs.rename(this.resolve(input.id), this.resolve(desired));
      note.id = desired;
    } else if (!existing) {
      note.id = desired;
    }
    await this.write(note);
    return note;
  }

  // Moves a note into the .trash folder rather than deleting it outright.
  async trash(id) {
    const note = await this.read(id);
    if (!note.body.trim() && (!note.title.trim() || note.daily)) {
      // Nothing worth keeping (an empty note, or a daily note never written
      // in): it is simply removed.
      this.markWrite(id);
      await fs.unlink(this.resolve(id));
      return;
    }
    // Daily notes go to .trash/Daily Notes, other notes to .trash.
    const trashDir = path.join(this.dir, TRASH_DIR, path.dirname(id));
    await fs.mkdir(trashDir, { recursive: true });
    const name = path.basename(id);
    let target = path.join(trashDir, name);
    if (await this.exists(path.join(TRASH_DIR, id))) {
      target = path.join(trashDir, `${name.replace(/\.md$/i, '')} ${Date.now()}.md`);
    }
    this.markWrite(id);
    await fs.rename(this.resolve(id), target);
  }

  async getTagColors() {
    try {
      const raw = await fs.readFile(path.join(this.dir, META_DIR, TAGS_FILE), 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async setTagColors(colors) {
    await this.ensureDir();
    await fs.writeFile(path.join(this.dir, META_DIR, TAGS_FILE), JSON.stringify(colors, null, 2), 'utf8');
    return colors;
  }

  async setTagColor(tag, color) {
    const colors = await this.getTagColors();
    colors[normalizeTag(tag)] = color;
    return this.setTagColors(colors);
  }

  // Renames (or merges) a tag across every note. Passing an empty `to`
  // removes the tag from all notes.
  async renameTag(from, to) {
    const src = normalizeTag(from);
    const dst = to ? normalizeTag(to) : '';
    const notes = await this.list();
    for (const note of notes) {
      if (!note.tags.includes(src)) continue;
      note.tags = normalizeTags(note.tags.map((t) => (t === src ? dst : t)).filter(Boolean));
      await this.write(note);
    }
    const colors = await this.getTagColors();
    if (dst && colors[src] && !colors[dst]) colors[dst] = colors[src];
    delete colors[src];
    await this.setTagColors(colors);
    return this.list();
  }
}

module.exports = { NoteStore, parseNote, serializeNote, slugify, normalizeTag, DAILY_DIR };
