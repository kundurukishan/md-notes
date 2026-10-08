const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { NoteStore, parseNote, serializeNote, slugify } = require('../electron/store.cjs');

async function tmpStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mdnotes-'));
  return new NoteStore(dir);
}

test('parse and serialize round-trip keeps unknown frontmatter keys', () => {
  const raw = '---\ntitle: Hello\ntags: [Work, "#ideas"]\npinned: true\nauthor: me\n---\n\n# Body\n';
  const note = parseNote('Hello.md', raw);
  assert.equal(note.title, 'Hello');
  assert.deepEqual(note.tags, ['work', 'ideas']);
  assert.equal(note.pinned, true);
  assert.deepEqual(note.extra, { author: 'me' });
  const again = parseNote('Hello.md', serializeNote(note));
  assert.equal(again.body, '# Body\n');
  assert.deepEqual(again.extra, { author: 'me' });
});

test('frontmatter is written one property per line with tags inline', () => {
  const note = parseNote('A.md', '---\ntitle: A\ntags: [x, y]\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nBody\n');
  assert.equal(serializeNote(note), '---\ntitle: A\ntags: [x, y]\ncreated: 2026-01-01T00:00:00.000Z\nupdated: 2026-01-01T00:00:00.000Z\n---\n\nBody\n');
});

test('files without frontmatter use the filename as title', () => {
  const note = parseNote('Groceries.md', '- milk\n- eggs\n');
  assert.equal(note.title, 'Groceries');
  assert.equal(note.body, '- milk\n- eggs\n');
  assert.deepEqual(note.tags, []);
});

test('slugify strips characters that are unsafe in filenames', () => {
  assert.equal(slugify('a/b:c?'), 'abc');
  assert.equal(slugify('   '), 'Untitled');
});

test('create, save with rename, and trash', async () => {
  const store = await tmpStore();
  const note = await store.create();
  assert.equal(note.id, 'Untitled.md');

  const saved = await store.save({ id: note.id, title: 'Meeting notes', body: 'hi', tags: ['Work'] });
  assert.equal(saved.id, 'Meeting notes.md');
  assert.deepEqual(saved.tags, ['work']);
  assert.equal(await store.exists('Untitled.md'), false);

  const other = await store.create({ title: 'Meeting notes' });
  assert.equal(other.id, 'Meeting notes 2.md');

  // Saving with an unchanged title keeps the same file.
  const resaved = await store.save({ id: saved.id, title: 'Meeting notes', body: 'updated' });
  assert.equal(resaved.id, 'Meeting notes.md');
  assert.equal((await store.read(resaved.id)).body, 'updated');

  await store.trash(saved.id);
  const ids = (await store.list()).map((n) => n.id);
  assert.deepEqual(ids, ['Meeting notes 2.md']);
  assert.equal(await store.exists('.trash/Meeting notes.md'), true);
});

test('rename and delete tags across notes', async () => {
  const store = await tmpStore();
  await store.create({ title: 'A', tags: ['old', 'keep'] });
  await store.create({ title: 'B', tags: ['old'] });
  await store.setTagColor('old', 'blue');

  let notes = await store.renameTag('old', 'New');
  assert.deepEqual(notes.find((n) => n.id === 'A.md').tags, ['new', 'keep']);
  assert.deepEqual(await store.getTagColors(), { new: 'blue' });

  notes = await store.renameTag('new', '');
  assert.deepEqual(notes.find((n) => n.id === 'A.md').tags, ['keep']);
  assert.deepEqual(notes.find((n) => n.id === 'B.md').tags, []);
});

test('rejects path traversal ids', async () => {
  const store = await tmpStore();
  assert.throws(() => store.resolve('../evil.md'));
  assert.throws(() => store.resolve('.hidden.md'));
  assert.throws(() => store.resolve('notes.txt'));
});

test('trashing an empty note deletes it instead of keeping it in .trash', async () => {
  const store = await tmpStore();
  const note = await store.create();
  await store.trash(note.id);
  assert.equal(await store.exists(note.id), false);
  assert.equal(await store.exists('.trash/Untitled.md'), false);
});

test('title color and bold are saved in frontmatter only when set', async () => {
  const store = await tmpStore();
  const note = await store.create({ title: 'Plan' });
  assert.equal(note.titleColor, null);
  assert.equal(note.titleBold, true);
  const raw = () => fs.readFile(path.join(store.dir, 'Plan.md'), 'utf8');
  assert.doesNotMatch(await raw(), /titleColor|titleBold/);

  let saved = await store.save({ id: 'Plan.md', title: 'Plan', titleColor: '#2860B8', titleBold: false });
  assert.equal(saved.titleColor, '#2860b8');
  assert.match(await raw(), /titleColor: "#2860b8"\ntitleBold: false\n/);
  let read = await store.read('Plan.md');
  assert.equal(read.titleColor, '#2860b8');
  assert.equal(read.titleBold, false);
  assert.deepEqual(read.extra, {});

  // Saving without these fields keeps them; null clears the color.
  saved = await store.save({ id: 'Plan.md', title: 'Plan', body: 'x' });
  assert.equal(saved.titleColor, '#2860b8');
  assert.equal(saved.titleBold, false);
  saved = await store.save({ id: 'Plan.md', title: 'Plan', titleColor: null, titleBold: true });
  assert.doesNotMatch(await raw(), /titleColor|titleBold/);

  // Invalid values are ignored.
  assert.equal(parseNote('x.md', '---\ntitleColor: "red; background: x"\n---\n').titleColor, null);
});

test('daily notes live in the Daily Notes folder, one per day', async () => {
  const store = await tmpStore();
  const note = await store.create({ daily: '2026-10-08', title: 'Thursday, October 8, 2026' });
  assert.equal(note.id, 'Daily Notes/2026-10-08.md');
  assert.equal(note.daily, '2026-10-08');
  assert.equal(await store.exists('Daily Notes/2026-10-08.md'), true);

  // Creating the same day again returns the existing note.
  await store.save({ id: note.id, title: note.title, body: 'Standup at 10' });
  const again = await store.create({ daily: '2026-10-08', title: 'ignored' });
  assert.equal(again.body, 'Standup at 10');

  // Renaming the title keeps the date as the filename.
  const renamed = await store.save({ id: note.id, title: 'Launch day', body: 'Standup at 10' });
  assert.equal(renamed.id, 'Daily Notes/2026-10-08.md');
  assert.equal(renamed.daily, '2026-10-08');

  await store.create({ title: 'Regular' });
  const listed = await store.list();
  assert.deepEqual(listed.map((n) => [n.id, n.daily]).sort(), [['Daily Notes/2026-10-08.md', '2026-10-08'], ['Regular.md', null]]);

  // A daily note added by another app without frontmatter is titled by its date.
  await fs.writeFile(path.join(store.dir, 'Daily Notes', '2026-10-09.md'), 'Hello');
  assert.equal((await store.read('Daily Notes/2026-10-09.md')).title, '2026-10-09');

  // Trash keeps the folder.
  await store.trash(note.id);
  assert.equal(await store.exists('.trash/Daily Notes/2026-10-08.md'), true);

  assert.throws(() => store.resolve('Daily Notes/../evil.md'));
  assert.throws(() => store.resolve('Other/2026-10-08.md'));
  await assert.rejects(store.create({ daily: 'not-a-date' }));
});
