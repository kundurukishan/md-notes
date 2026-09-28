// Task lists as Markdown files in the `Tasks` folder inside the notes folder.
// Parsed lists are kept in memory so tasks keep stable ids between edits; the
// parsing and list operations live in shared/tasks.mjs.
const fs = require('node:fs/promises');
const path = require('node:path');
const { slugify } = require('./store.cjs');

class TaskStore {
  // `model` is the imported shared/tasks.mjs module.
  constructor(dir, trashDir, model) {
    this.dir = dir;
    this.trashDir = trashDir;
    this.model = model;
    this.entries = new Map(); // list id -> { file, raw, list }
    this.queue = Promise.resolve();
    this.recentWrites = new Map();
  }

  markWrite(file) {
    this.recentWrites.set(file, Date.now());
  }

  isOwnWrite(file) {
    const at = this.recentWrites.get(file);
    return at !== undefined && Date.now() - at < 1500;
  }

  // Runs changes one at a time so concurrent edits never interleave.
  serialize(fn) {
    const next = this.queue.catch(() => {}).then(fn);
    this.queue = next;
    return next;
  }

  async exists() {
    try {
      await fs.access(this.dir);
      return true;
    } catch {
      return false;
    }
  }

  // (Re)reads every list file. Lists that were already loaded keep their ids.
  // Returns true if anything changed.
  async load() {
    await fs.mkdir(this.dir, { recursive: true });
    const files = (await fs.readdir(this.dir, { withFileTypes: true }))
      .filter((e) => e.isFile() && /\.md$/i.test(e.name) && !e.name.startsWith('.'))
      .map((e) => e.name);
    const byFile = new Map([...this.entries.values()].map((e) => [e.file, e]));
    const next = new Map();
    let changed = files.length !== this.entries.size;
    for (const file of files) {
      const prev = byFile.get(file);
      let raw;
      try {
        raw = await fs.readFile(path.join(this.dir, file), 'utf8');
      } catch {
        continue;
      }
      if (prev && prev.raw === raw) {
        next.set(prev.list.id, prev);
        continue;
      }
      changed = true;
      const parsed = this.model.parseList(raw, { name: file.replace(/\.md$/i, '') });
      const list = this.model.reconcileIds(prev?.list, parsed);
      next.set(list.id, { file, raw, list });
    }
    this.entries = next;
    return changed;
  }

  all() {
    return [...this.entries.values()].map((e) => e.list).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  get(id) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`No task list ${id}`);
    return entry;
  }

  async write(entry, list) {
    const raw = this.model.serializeList(list);
    entry.list = list;
    if (raw === entry.raw) return list;
    const target = path.join(this.dir, entry.file);
    const tmp = path.join(this.dir, `.${entry.file}.${process.pid}.tmp`);
    this.markWrite(entry.file);
    await fs.writeFile(tmp, raw, 'utf8');
    await fs.rename(tmp, target);
    entry.raw = raw;
    return list;
  }

  async uniqueFile(name, current) {
    const base = slugify(name);
    const taken = new Set([...this.entries.values()].filter((e) => e.file !== current).map((e) => e.file.toLowerCase()));
    for (let i = 0; ; i++) {
      const file = i === 0 ? `${base}.md` : `${base} ${i + 1}.md`;
      if (taken.has(file.toLowerCase())) continue;
      if (file === current) return file;
      try {
        await fs.access(path.join(this.dir, file));
      } catch {
        return file;
      }
    }
  }

  createList(name, id, raw = '') {
    return this.serialize(async () => {
      await fs.mkdir(this.dir, { recursive: true });
      const file = await this.uniqueFile(name || 'Untitled list');
      const list = this.model.parseList(raw, { id: id || undefined, name: file.replace(/\.md$/i, '') });
      const entry = { file, raw: null, list };
      this.entries.set(list.id, entry);
      this.markWrite(file);
      await fs.writeFile(path.join(this.dir, file), this.model.serializeList(list), 'utf8');
      entry.raw = this.model.serializeList(list);
      return list;
    });
  }

  renameList(id, name) {
    return this.serialize(async () => {
      const entry = this.get(id);
      const file = await this.uniqueFile(name || 'Untitled list', entry.file);
      if (file !== entry.file) {
        this.markWrite(entry.file);
        this.markWrite(file);
        await fs.rename(path.join(this.dir, entry.file), path.join(this.dir, file));
        entry.file = file;
      }
      entry.list = { ...entry.list, name: file.replace(/\.md$/i, '') };
      return entry.list;
    });
  }

  // Moves the list's file into the notes folder's .trash/Tasks.
  deleteList(id) {
    return this.serialize(async () => {
      const entry = this.get(id);
      await fs.mkdir(this.trashDir, { recursive: true });
      let target = path.join(this.trashDir, entry.file);
      try {
        await fs.access(target);
        target = path.join(this.trashDir, `${entry.file.replace(/\.md$/i, '')} ${Date.now()}.md`);
      } catch {
        // no clash
      }
      this.markWrite(entry.file);
      await fs.rename(path.join(this.dir, entry.file), target);
      this.entries.delete(id);
    });
  }

  apply(id, op, args) {
    const fn = this.model.LIST_OPS[op];
    if (!fn) return Promise.reject(new Error(`Unknown task operation: ${op}`));
    return this.serialize(async () => {
      const entry = this.get(id);
      return this.write(entry, fn(entry.list, ...args));
    });
  }

  moveToList(fromId, toId, taskId) {
    return this.serialize(async () => {
      const from = this.get(fromId);
      const to = this.get(toId);
      const res = this.model.moveToList(from.list, to.list, taskId);
      await this.write(to, res.to);
      await this.write(from, res.from);
      return [res.from, res.to];
    });
  }

  renameTag(from, to) {
    return this.serialize(async () => {
      for (const entry of this.entries.values()) await this.write(entry, this.model.renameTag(entry.list, from, to));
      return this.all();
    });
  }
}

module.exports = { TaskStore };
