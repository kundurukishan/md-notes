// Folder-backed storage for MD Viewer. The app opens any folder and shows the
// Markdown files in it and its subfolders. Files are left as they are: a file
// without frontmatter stays without frontmatter unless you add tags or title
// formatting to it, and frontmatter keys the app doesn't know are preserved.
const fs = require('node:fs/promises');
const path = require('node:path');
const YAML = require('yaml');

const META_DIR = '.mdnotes';
const TAGS_FILE = 'tags.json';
// The header includes the blank line after the closing ---, so header + body
// is the file byte for byte and the body starts with the text.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n(?:\r?\n)?|$)/;
const COLOR_RE = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]+)$/i;
// Folders that are never shown.
const SKIP_DIRS = new Set(['node_modules', '.git', '.trash', '.mdnotes']);
// #tags written in the text, like in Obsidian. A tag starts with a letter and
// isn't part of a word, so "#1", "#fff" and "a#b" don't count.
const INLINE_TAG_RE = /(^|[\s(\[{,;])#([a-z][\w/-]*)/gi;

function cleanColor(value) {
  return typeof value === 'string' && COLOR_RE.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function normalizeTag(tag) {
  return String(tag).trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
}

function normalizeTags(tags) {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Tags written inline in the text (outside code).
function inlineTags(body) {
  const found = new Set();
  const text = body.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  for (const m of text.matchAll(INLINE_TAG_RE)) found.add(normalizeTag(m[2]));
  return [...found];
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

// Splits a file into its frontmatter and body. `data` is the parsed
// frontmatter object (empty when there is none), `header` the raw
// frontmatter text so unchanged frontmatter is written back verbatim.
function parseFile(id, raw, stat) {
  let data = {};
  let body = raw;
  let header = '';
  const match = raw.match(FRONTMATTER_RE);
  if (match) {
    try {
      const parsed = YAML.parse(match[1]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed;
        header = match[0];
        body = raw.slice(match[0].length);
      }
    } catch {
      // Malformed frontmatter: treat the whole file as the body.
    }
  }

  let tags = data.tags;
  if (typeof tags === 'string') tags = tags.split(',');
  tags = Array.isArray(tags) ? normalizeTags(tags) : [];

  const name = path.posix.basename(id).replace(/\.md$/i, '');
  return {
    id,
    dir: path.posix.dirname(id) === '.' ? '' : path.posix.dirname(id),
    name,
    title: typeof data.title === 'string' && data.title.trim() ? data.title : name,
    body,
    tags,
    inlineTags: inlineTags(body),
    titleColor: cleanColor(data.titleColor),
    titleBold: data.titleBold !== false,
    hasFrontmatter: Boolean(header),
    created: toIso(data.created) || (stat ? stat.birthtime.toISOString() : new Date().toISOString()),
    updated: toIso(data.updated) || (stat ? stat.mtime.toISOString() : new Date().toISOString()),
    data,
    header,
  };
}

// The frontmatter object to write for a file after applying `patch`
// (title, tags, titleColor, titleBold). Keys are only added when they carry
// something: a file without frontmatter gets none unless it needs it.
function nextData(file, patch) {
  const data = { ...file.data };
  const had = (key) => Object.prototype.hasOwnProperty.call(file.data, key);
  if ('title' in patch && had('title')) data.title = patch.title;
  if ('tags' in patch) {
    if (patch.tags.length || had('tags')) data.tags = patch.tags;
  }
  if ('titleColor' in patch) {
    if (patch.titleColor) data.titleColor = patch.titleColor;
    else delete data.titleColor;
  }
  if ('titleBold' in patch) {
    if (patch.titleBold === false) data.titleBold = false;
    else delete data.titleBold;
  }
  return data;
}

function serializeFrontmatter(data) {
  // One property per line, with lists such as tags kept on one line: [a, b].
  const doc = new YAML.Document(data);
  YAML.visit(doc, {
    Seq(_key, node) {
      node.flow = true;
    },
  });
  return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false }).trimEnd()}\n---\n\n`;
}

// Writes the file back: the original header when nothing in it changed, so
// files edited only in the text keep their frontmatter byte for byte.
function serializeFile(file, data, body) {
  const same = JSON.stringify(data) === JSON.stringify(file.data);
  if (same) return file.header + body;
  if (!Object.keys(data).length) return body;
  // A file that already had frontmatter keeps its `updated` stamp current.
  if (Object.prototype.hasOwnProperty.call(file.data, 'updated')) data = { ...data, updated: new Date().toISOString() };
  return serializeFrontmatter(data) + body.replace(/^\n+/, '');
}

// Natural order: "Chapter 2" before "Chapter 10", case-insensitive.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

class FolderStore {
  constructor(dir) {
    this.dir = dir;
    // Paths we wrote recently, so the folder watcher can ignore our own writes.
    this.recentWrites = new Map();
  }

  // Ids are paths relative to the folder, with "/" separators: "Work/Plan.md".
  resolve(id, { file = true } = {}) {
    if (typeof id !== 'string' || id.includes('\0')) throw new Error(`Invalid path: ${id}`);
    const parts = id === '' ? [] : id.split('/');
    for (const part of parts) {
      if (!part || part === '.' || part === '..' || part.startsWith('.') || part.includes('\\')) throw new Error(`Invalid path: ${id}`);
    }
    if (file && (!parts.length || !/\.md$/i.test(parts[parts.length - 1]))) throw new Error(`Invalid path: ${id}`);
    return path.join(this.dir, ...parts);
  }

  markWrite(id) {
    this.recentWrites.set(id, Date.now());
  }

  isOwnWrite(id) {
    const at = this.recentWrites.get(id);
    return at !== undefined && Date.now() - at < 1500;
  }

  // Every Markdown file in the folder and its subfolders, plus every folder
  // (so empty ones show up too).
  async list() {
    const files = [];
    const dirs = [];
    const walk = async (rel) => {
      const entries = await fs.readdir(path.join(this.dir, rel), { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const id = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          dirs.push(id);
          await walk(id);
        } else if (e.isFile() && /\.md$/i.test(e.name)) {
          files.push(id);
        }
      }
    };
    await walk('');
    const notes = (await Promise.all(files.map((id) => this.read(id).catch(() => null)))).filter(Boolean);
    notes.sort((a, b) => collator.compare(a.id, b.id));
    dirs.sort(collator.compare);
    return { files: notes.map(publicNote), dirs };
  }

  async read(id) {
    const file = this.resolve(id);
    const [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]);
    return parseFile(id, raw, stat);
  }

  async exists(id) {
    try {
      await fs.access(path.join(this.dir, id));
      return true;
    } catch {
      return false;
    }
  }

  async uniqueName(dir, title, currentId) {
    const base = slugify(title);
    for (let i = 0; ; i++) {
      const name = i === 0 ? `${base}.md` : `${base} ${i + 1}.md`;
      const id = dir ? `${dir}/${name}` : name;
      if (id.toLowerCase() === (currentId || '').toLowerCase()) return currentId;
      if (!(await this.exists(id))) return id;
    }
  }

  // Creates a new, empty note in `dir` ('' for the folder itself).
  async create({ dir = '', title = '', body = '' } = {}) {
    this.resolve(dir, { file: false });
    const id = await this.uniqueName(dir, title || 'Untitled');
    this.markWrite(id);
    await fs.mkdir(path.dirname(this.resolve(id)), { recursive: true });
    await fs.writeFile(this.resolve(id), body, 'utf8');
    return publicNote(await this.read(id));
  }

  async createFolder(parent, name) {
    const clean = slugify(name);
    const id = parent ? `${parent}/${clean}` : clean;
    await fs.mkdir(this.resolve(id, { file: false }), { recursive: true });
    return id;
  }

  // Saves a note, renaming its file when the title changes. Returns the saved
  // note, whose id may differ from the one passed in.
  async save(input) {
    const existing = await this.read(input.id);
    const patch = {};
    const title = typeof input.title === 'string' ? input.title : existing.title;
    if (title !== existing.title) patch.title = title;
    if (Array.isArray(input.tags)) {
      const tags = normalizeTags(input.tags);
      if (tags.join('\n') !== existing.tags.join('\n')) patch.tags = tags;
    }
    if ('titleColor' in input && cleanColor(input.titleColor) !== existing.titleColor) patch.titleColor = cleanColor(input.titleColor);
    if (typeof input.titleBold === 'boolean' && input.titleBold !== existing.titleBold) patch.titleBold = input.titleBold;
    const body = typeof input.body === 'string' ? input.body : existing.body;

    const data = nextData(existing, patch);
    const raw = serializeFile(existing, data, body);
    let id = input.id;
    if ('title' in patch) {
      // The filename follows the title.
      id = await this.uniqueName(existing.dir, title || 'Untitled', input.id);
      if (id !== input.id) {
        this.markWrite(input.id);
        this.markWrite(id);
        await fs.rename(this.resolve(input.id), this.resolve(id));
      }
    }
    if (raw !== existing.header + existing.body || id !== input.id) {
      this.markWrite(id);
      await fs.writeFile(this.resolve(id), raw, 'utf8');
    }
    return publicNote(await this.read(id));
  }

  // Tag colors saved by MD Notes in the folder's .mdnotes/tags.json, if any.
  async getTagColors() {
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(this.dir, META_DIR, TAGS_FILE), 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
}

// What the renderer sees (without the raw frontmatter).
function publicNote(note) {
  const { data, header, ...rest } = note;
  return rest;
}

module.exports = { FolderStore, parseFile, serializeFile, nextData, inlineTags, slugify, normalizeTag };
