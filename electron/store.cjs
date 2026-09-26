// File-backed note storage. Every note is a plain Markdown file with YAML
// frontmatter, so the notes folder stays readable by any other editor.
const fs = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');

const META_DIR = '.mdnotes';
const TRASH_DIR = '.trash';
const TAGS_FILE = 'tags.json';
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const KNOWN_KEYS = new Set(['title', 'tags', 'pinned', 'created', 'updated']);

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
    title: typeof data.title === 'string' ? data.title : id.replace(/\.md$/i, ''),
    body,
    tags,
    pinned: data.pinned === true,
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
    created: note.created,
    updated: note.updated,
    ...(note.extra || {}),
  };
  const yaml = YAML.stringify(data, { lineWidth: 0, collectionStyle: 'flow' }).trimEnd();
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

  resolve(id) {
    if (typeof id !== 'string' || !/\.md$/i.test(id) || id !== path.basename(id) || id.startsWith('.')) {
      throw new Error(`Invalid note id: ${id}`);
    }
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
  }

  async list() {
    await this.ensureDir();
    const entries = await fs.readdir(this.dir, { withFileTypes: true });
    const notes = await Promise.all(
      entries
        .filter((e) => e.isFile() && /\.md$/i.test(e.name) && !e.name.startsWith('.'))
        .map(async (e) => {
          const file = path.join(this.dir, e.name);
          try {
            const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
            return parseNote(e.name, raw, stat);
          } catch {
            return null;
          }
        }),
    );
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

  async create({ title = '', body = '', tags = [] } = {}) {
    await this.ensureDir();
    const now = new Date().toISOString();
    const note = {
      id: await this.uniqueName(title || 'Untitled'),
      title: title || '',
      body,
      tags: normalizeTags(tags),
      pinned: false,
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
      created: existing?.created || new Date().toISOString(),
      updated: new Date().toISOString(),
      extra: existing?.extra || {},
    };

    const desired = await this.uniqueName(title || 'Untitled', existing ? input.id : null);
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
    if (!note.title.trim() && !note.body.trim()) {
      // Nothing worth keeping: an empty note is simply removed.
      this.markWrite(id);
      await fs.unlink(this.resolve(id));
      return;
    }
    const trashDir = path.join(this.dir, TRASH_DIR);
    await fs.mkdir(trashDir, { recursive: true });
    let target = path.join(trashDir, id);
    if (await this.exists(path.join(TRASH_DIR, id))) {
      target = path.join(trashDir, `${id.replace(/\.md$/i, '')} ${Date.now()}.md`);
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

module.exports = { NoteStore, parseNote, serializeNote, slugify, normalizeTag };
