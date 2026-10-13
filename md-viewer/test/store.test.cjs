const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FolderStore, parseFile, serializeFile, nextData, inlineTags, slugify } = require('../electron/store.cjs');

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdviewer-'));
  return new FolderStore(dir);
}

const read = (store, id) => fs.readFile(path.join(store.dir, id), 'utf8');

test('a file without frontmatter is titled by its name and keeps its text as-is', () => {
  const note = parseFile('Work/Groceries.md', '- milk\n- eggs #errands\n');
  assert.equal(note.title, 'Groceries');
  assert.equal(note.name, 'Groceries');
  assert.equal(note.dir, 'Work');
  assert.equal(note.body, '- milk\n- eggs #errands\n');
  assert.equal(note.hasFrontmatter, false);
  assert.deepEqual(note.tags, []);
  assert.deepEqual(note.inlineTags, ['errands']);
});

test('frontmatter from MD Notes is read, and unknown keys survive a save', () => {
  const raw = '---\ntitle: Hello\ntags: [Work, "#ideas"]\npinned: true\nauthor: me\n---\n\n# Body\n';
  const note = parseFile('Hello.md', raw);
  assert.equal(note.title, 'Hello');
  assert.deepEqual(note.tags, ['work', 'ideas']);
  assert.equal(note.hasFrontmatter, true);
  // Nothing changed in the frontmatter: the header is written back verbatim.
  assert.equal(serializeFile(note, nextData(note, {}), '# Body\n'), raw);
  // A tag change rewrites the frontmatter, keeping the other keys.
  const out = serializeFile(note, nextData(note, { tags: ['work'] }), '# Body\n');
  assert.equal(out, '---\ntitle: Hello\ntags: [work]\npinned: true\nauthor: me\n---\n\n# Body\n');
});

test('inline #tags ignore code, numbers and headings', () => {
  assert.deepEqual(inlineTags('# Heading\nHello #world and #1 and a#b\n`#code` and\n```\n#fenced\n```\n(#paren) #Mixed/Case #world'), ['world', 'paren', 'mixed/case']);
});

test('slugify strips characters that are unsafe in filenames', () => {
  assert.equal(slugify('a/b:c?'), 'abc');
  assert.equal(slugify('   '), 'Untitled');
});

test('lists Markdown files in subfolders and every folder, skipping hidden ones', async () => {
  const store = await tmpStore();
  await fs.mkdir(path.join(store.dir, 'Work', 'Projects'), { recursive: true });
  await fs.mkdir(path.join(store.dir, 'Empty'), { recursive: true });
  await fs.mkdir(path.join(store.dir, '.hidden'), { recursive: true });
  await fs.mkdir(path.join(store.dir, 'node_modules'), { recursive: true });
  await fs.writeFile(path.join(store.dir, 'b.md'), 'B');
  await fs.writeFile(path.join(store.dir, 'a10.md'), 'A10');
  await fs.writeFile(path.join(store.dir, 'a2.md'), 'A2');
  await fs.writeFile(path.join(store.dir, 'notes.txt'), 'not markdown');
  await fs.writeFile(path.join(store.dir, 'Work', 'Projects', 'Launch.md'), '# Launch');
  await fs.writeFile(path.join(store.dir, '.hidden', 'secret.md'), 'x');
  await fs.writeFile(path.join(store.dir, 'node_modules', 'pkg.md'), 'x');

  const { files, dirs } = await store.list();
  assert.deepEqual(files.map((f) => f.id), ['a2.md', 'a10.md', 'b.md', 'Work/Projects/Launch.md']);
  assert.deepEqual(dirs, ['Empty', 'Work', 'Work/Projects']);
  assert.equal(files[3].dir, 'Work/Projects');
  assert.equal('data' in files[0], false);
});

test('editing the text of a plain file never adds frontmatter', async () => {
  const store = await tmpStore();
  await fs.writeFile(path.join(store.dir, 'Plain.md'), '# Hi\n');
  const saved = await store.save({ id: 'Plain.md', title: 'Plain', body: '# Hi there\n', tags: [], titleColor: null, titleBold: true });
  assert.equal(saved.id, 'Plain.md');
  assert.equal(await read(store, 'Plain.md'), '# Hi there\n');
  assert.equal(saved.hasFrontmatter, false);
});

test('adding a tag to a plain file adds only a tags key', async () => {
  const store = await tmpStore();
  await fs.writeFile(path.join(store.dir, 'Plain.md'), '# Hi\n');
  const saved = await store.save({ id: 'Plain.md', title: 'Plain', body: '# Hi\n', tags: ['Work'] });
  assert.deepEqual(saved.tags, ['work']);
  assert.equal(await read(store, 'Plain.md'), '---\ntags: [work]\n---\n\n# Hi\n');
  // Removing the tag again keeps the (now empty) key, like MD Notes does.
  await store.save({ id: 'Plain.md', title: 'Plain', body: '# Hi\n', tags: [] });
  assert.equal(await read(store, 'Plain.md'), '---\ntags: []\n---\n\n# Hi\n');
});

test('renaming the title renames the file, and updates a frontmatter title', async () => {
  const store = await tmpStore();
  await fs.mkdir(path.join(store.dir, 'Work'));
  await fs.writeFile(path.join(store.dir, 'Work', 'Plan.md'), 'text');
  let saved = await store.save({ id: 'Work/Plan.md', title: 'Q4 plan', body: 'text' });
  assert.equal(saved.id, 'Work/Q4 plan.md');
  assert.equal(saved.title, 'Q4 plan');
  assert.equal(await read(store, 'Work/Q4 plan.md'), 'text');
  assert.equal(await store.exists('Work/Plan.md'), false);

  await fs.writeFile(path.join(store.dir, 'Work', 'Other.md'), '---\ntitle: Other\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nbody\n');
  saved = await store.save({ id: 'Work/Other.md', title: 'Renamed', body: 'body\n' });
  assert.equal(saved.id, 'Work/Renamed.md');
  const raw = await read(store, 'Work/Renamed.md');
  assert.match(raw, /^---\ntitle: Renamed\nupdated: \d{4}-/);
  assert.doesNotMatch(raw, /2026-01-01/);

  // A name clash gets a numbered file.
  await fs.writeFile(path.join(store.dir, 'Work', 'Taken.md'), 'x');
  saved = await store.save({ id: 'Work/Renamed.md', title: 'Taken', body: 'body\n' });
  assert.equal(saved.id, 'Work/Taken 2.md');

  // A daily note from MD Notes keeps its date filename as long as the title is unchanged.
  await fs.writeFile(path.join(store.dir, '2026-10-08.md'), '---\ntitle: Thursday, October 8, 2026\n---\n\nStandup\n');
  saved = await store.save({ id: '2026-10-08.md', title: 'Thursday, October 8, 2026', body: 'Standup at 10\n' });
  assert.equal(saved.id, '2026-10-08.md');
  assert.equal(await read(store, '2026-10-08.md'), '---\ntitle: Thursday, October 8, 2026\n---\n\nStandup at 10\n');
});

test('create makes a unique Untitled file in the folder asked for', async () => {
  const store = await tmpStore();
  const a = await store.create({ dir: '', title: 'Untitled' });
  const b = await store.create({ dir: '', title: 'Untitled' });
  assert.equal(a.id, 'Untitled.md');
  assert.equal(b.id, 'Untitled 2.md');
  const sub = await store.createFolder('', 'Ideas');
  assert.equal(sub, 'Ideas');
  const c = await store.create({ dir: 'Ideas' });
  assert.equal(c.id, 'Ideas/Untitled.md');
  assert.equal(c.body, '');
});

test('title color and bold are saved only when set, in the file\'s frontmatter', async () => {
  const store = await tmpStore();
  await fs.writeFile(path.join(store.dir, 'Plan.md'), 'x\n');
  let saved = await store.save({ id: 'Plan.md', title: 'Plan', body: 'x\n', titleColor: '#2860B8', titleBold: false });
  assert.equal(saved.titleColor, '#2860b8');
  assert.equal(saved.titleBold, false);
  assert.equal(await read(store, 'Plan.md'), '---\ntitleColor: "#2860b8"\ntitleBold: false\n---\n\nx\n');
  saved = await store.save({ id: 'Plan.md', title: 'Plan', body: 'x\n', titleColor: null, titleBold: true });
  assert.equal(await read(store, 'Plan.md'), 'x\n');
  assert.equal(parseFile('x.md', '---\ntitleColor: "red; background: x"\n---\n').titleColor, null);
});

test('rejects paths that leave the folder or touch hidden files', async () => {
  const store = await tmpStore();
  assert.throws(() => store.resolve('../evil.md'));
  assert.throws(() => store.resolve('Work/../../evil.md'));
  assert.throws(() => store.resolve('.hidden.md'));
  assert.throws(() => store.resolve('.git/x.md'));
  assert.throws(() => store.resolve('notes.txt'));
  assert.throws(() => store.resolve('', { file: true }));
  assert.equal(store.resolve('', { file: false }), store.dir);
  assert.equal(store.resolve('Work/Plan.md'), path.join(store.dir, 'Work', 'Plan.md'));
});
