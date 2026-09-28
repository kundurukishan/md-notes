import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../shared/tasks.mjs';

const SAMPLE = `- [ ] Buy milk #errands 📅 2026-10-01
    Get the big carton if it's on sale

    Second paragraph of details
    - [ ] Oat milk
    - [x] Regular milk ✅ 2026-09-27
- [ ] Book dentist appointment #Health
- [x] Return library books #errands ✅ 2026-09-26
`;

// Compact view of a list: titles, with subtasks nested.
const shape = (list) =>
  list.items.map((i) => (i.type === 'text' ? `text:${i.text}` : i.subtasks.length ? [i.title, i.subtasks.map((s) => s.title)] : i.title));

const byTitle = (list, title) => T.allTasks(list).find(({ task }) => task.title === title).task;

test('parses tasks, details, subtasks, tags and dates', () => {
  const list = T.parseList(SAMPLE, { name: 'Groceries' });
  assert.deepEqual(shape(list), [['Buy milk', ['Oat milk', 'Regular milk']], 'Book dentist appointment', 'Return library books']);
  const milk = byTitle(list, 'Buy milk');
  assert.deepEqual(milk.tags, ['errands']);
  assert.equal(milk.due, '2026-10-01');
  assert.equal(milk.details, "Get the big carton if it's on sale\n\nSecond paragraph of details");
  assert.equal(byTitle(list, 'Regular milk').doneDate, '2026-09-27');
  assert.deepEqual(byTitle(list, 'Book dentist appointment').tags, ['health']);
  assert.equal(byTitle(list, 'Return library books').done, true);
});

test('serializing a parsed file reproduces it', () => {
  const list = T.parseList(SAMPLE);
  assert.equal(T.serializeList(list), SAMPLE.replace('#Health', '#health'));
});

test('headings, other text and frontmatter survive a round trip', () => {
  const raw = `---
cssclass: wide
---

# Home

Some intro text.

- [ ] Fix the tap
- [ ] Call the plumber #1 priority

## Garden

- [ ] Mow the lawn
`;
  const list = T.parseList(raw);
  assert.deepEqual(shape(list), ['text:# Home\n\nSome intro text.', 'Fix the tap', 'Call the plumber #1 priority', 'text:## Garden', 'Mow the lawn']);
  assert.equal(T.serializeList(list), raw);

  // New tasks go after leading text, before the first task.
  const added = T.addTask(list, { id: 'n', title: 'New' });
  assert.equal(shape(added)[1], 'New');

  const dated = T.setSort(list, 'date');
  assert.match(T.serializeList(dated), /^---\ncssclass: wide\nsort: date\n---\n/);
  assert.equal(T.parseList(T.serializeList(dated)).sort, 'date');
  assert.equal(T.serializeList(T.setSort(dated, 'manual')), raw);
});

test('deeper nested checkboxes are kept as subtask details', () => {
  const raw = '- [ ] Parent\n    - [ ] Child\n        - [ ] Grandchild\n';
  const list = T.parseList(raw);
  assert.deepEqual(shape(list), [['Parent', ['Child']]]);
  assert.equal(byTitle(list, 'Child').details, '- [ ] Grandchild');
  assert.equal(T.serializeList(list), raw);
});

test('tabs and two-space indents are understood', () => {
  const list = T.parseList('- [ ] A\n\tdetail\n  - [ ] B\n');
  assert.deepEqual(shape(list), [['A', ['B']]]);
  assert.equal(byTitle(list, 'A').details, 'detail');
});

test('empty files and empty tasks', () => {
  assert.equal(T.serializeList(T.parseList('')), '');
  const list = T.addTask(T.parseList(''), { id: 'x' });
  assert.equal(T.serializeList(list), '- [ ]\n');
  assert.deepEqual(shape(T.parseList('- [ ]\n')), ['']);
});

test('addTask at top, after a task, and as a subtask', () => {
  let list = T.parseList('- [ ] a\n- [ ] b\n');
  const a = byTitle(list, 'a').id;
  list = T.addTask(list, { id: 't', title: 'top' });
  list = T.addTask(list, { id: 'm', title: 'mid', afterId: a });
  list = T.addTask(list, { id: 's', title: 'sub', parent: a });
  list = T.addTask(list, { id: 's2', title: 'sub2', parent: a, afterId: 's' });
  assert.deepEqual(shape(list), ['top', ['a', ['sub', 'sub2']], 'mid', 'b']);
});

test('setDone cascades to subtasks and reopening a subtask reopens the parent', () => {
  let list = T.parseList(SAMPLE);
  const milk = byTitle(list, 'Buy milk').id;
  list = T.setDone(list, milk, true, '2026-09-28');
  assert.ok(T.allTasks(list).filter(({ task }) => ['Buy milk', 'Oat milk'].includes(task.title)).every(({ task }) => task.done && task.doneDate === '2026-09-28'));
  assert.equal(byTitle(list, 'Regular milk').doneDate, '2026-09-27');

  list = T.setDone(list, byTitle(list, 'Oat milk').id, false);
  assert.equal(byTitle(list, 'Buy milk').done, false);
  assert.equal(byTitle(list, 'Oat milk').done, false);
});

test('indent, outdent and move', () => {
  let list = T.parseList('- [ ] a\n- [x] done\n- [ ] b\n- [ ] c\n');
  const id = (t) => byTitle(list, t).id;
  // Indent skips the completed task above.
  list = T.indentTask(list, id('b'));
  assert.deepEqual(shape(list), [['a', ['b']], 'done', 'c']);
  // A task with subtasks can't be indented.
  assert.deepEqual(shape(T.indentTask(list, id('a'))), shape(list));

  list = T.outdentTask(list, id('b'));
  assert.deepEqual(shape(list), ['a', 'b', 'done', 'c']);

  list = T.moveTask(list, id('c'), id('a'), 'before');
  assert.deepEqual(shape(list), ['c', 'a', 'b', 'done']);
  list = T.indentTask(list, id('a'));
  list = T.moveTask(list, id('b'), id('a'), 'after');
  assert.deepEqual(shape(list), [['c', ['a', 'b']], 'done']);
  // A task with subtasks can't be dropped among subtasks.
  list = T.addTask(list, { id: 'p', title: 'p' });
  list = T.addTask(list, { id: 'q', title: 'q', parent: 'p' });
  assert.deepEqual(shape(T.moveTask(list, 'p', id('a'), 'after')), shape(list));
});

test('clearCompleted, deleteTask and moveToList', () => {
  let list = T.parseList(SAMPLE);
  list = T.clearCompleted(list);
  assert.deepEqual(shape(list), [['Buy milk', ['Oat milk']], 'Book dentist appointment']);

  const other = T.parseList('- [ ] x\n');
  const res = T.moveToList(list, other, byTitle(list, 'Buy milk').id);
  assert.deepEqual(shape(res.from), ['Book dentist appointment']);
  assert.deepEqual(shape(res.to), [['Buy milk', ['Oat milk']], 'x']);

  assert.deepEqual(shape(T.deleteTask(res.to, byTitle(res.to, 'Oat milk').id)), ['Buy milk', 'x']);
});

test('updateTask and renameTag', () => {
  let list = T.parseList(SAMPLE);
  const milk = byTitle(list, 'Buy milk').id;
  list = T.updateTask(list, milk, { title: 'Buy\nmilk!', tags: ['#Shopping', 'errands', 'shopping'], due: 'soon', details: 'x\r\ny\n\n' });
  const t = byTitle(list, 'Buy milk!');
  assert.deepEqual(t.tags, ['shopping', 'errands']);
  assert.equal(t.due, null);
  assert.equal(t.details, 'x\ny');

  list = T.renameTag(list, 'errands', 'chores');
  assert.match(T.serializeList(list), /Return library books #chores ✅/);
  list = T.renameTag(list, 'chores', '');
  assert.doesNotMatch(T.serializeList(list), /#chores/);
});

test('views: open tree, completed, date sort, collectOpen', () => {
  const list = T.parseList('- [ ] late 📅 2026-12-01\n- [ ] none\n- [ ] soon 📅 2026-10-01\n    - [x] sub done ✅ 2026-09-20\n- [x] old ✅ 2026-09-01\n');
  assert.deepEqual(T.openTree(list).map(({ task }) => task.title), ['late', 'none', 'soon']);
  assert.deepEqual(T.openTree(T.setSort(list, 'date')).map(({ task }) => task.title), ['soon', 'late', 'none']);
  assert.deepEqual(T.completedTasks(list).map(({ task }) => task.title), ['sub done', 'old']);
  assert.equal(T.openCount(list), 3);
  const due = T.collectOpen([list], (task) => task.due && task.due <= '2026-10-01');
  assert.deepEqual(due.map((r) => r.task.title), ['soon']);
});

test('reconcileIds keeps ids of unchanged tasks after an external edit', () => {
  const before = T.parseList(SAMPLE);
  const after = T.reconcileIds(before, T.parseList(SAMPLE.replace('Book dentist', 'Book the dentist')));
  assert.equal(after.id, before.id);
  assert.equal(byTitle(after, 'Buy milk').id, byTitle(before, 'Buy milk').id);
  assert.equal(byTitle(after, 'Oat milk').id, byTitle(before, 'Oat milk').id);
  assert.notEqual(byTitle(after, 'Book the dentist appointment').id, byTitle(before, 'Book dentist appointment').id);
});

test('TaskStore reads, edits, renames and trashes list files', async () => {
  const { createRequire } = await import('node:module');
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { TaskStore } = createRequire(import.meta.url)('../electron/tasks.cjs');

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mdnotes-tasks-'));
  const dir = path.join(root, 'Tasks');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'Groceries.md'), SAMPLE.replace('#Health', '#health'));
  const store = new TaskStore(dir, path.join(root, '.trash', 'Tasks'), T);
  await store.load();

  const [groceries] = store.all();
  assert.equal(groceries.name, 'Groceries');
  const milkId = byTitle(groceries, 'Buy milk').id;

  // Concurrent operations apply in order.
  await Promise.all([
    store.apply(groceries.id, 'addTask', [{ id: 'eggs', title: 'Eggs', tags: ['errands'] }]),
    store.apply(groceries.id, 'setDone', [milkId, true, '2026-09-28']),
  ]);
  let raw = await fs.readFile(path.join(dir, 'Groceries.md'), 'utf8');
  assert.match(raw, /^- \[ \] Eggs #errands\n- \[x\] Buy milk #errands 📅 2026-10-01 ✅ 2026-09-28\n/);

  // External edits are picked up and keep ids for unchanged tasks.
  await fs.writeFile(path.join(dir, 'Groceries.md'), raw.replace('Eggs', 'Free-range eggs'));
  assert.equal(await store.load(), true);
  assert.equal(byTitle(store.all()[0], 'Buy milk').id, milkId);
  assert.equal(await store.load(), false);

  const later = await store.createList('Later / someday');
  assert.equal(later.name, 'Later someday'); // '/' can't be in a filename
  await store.moveToList(groceries.id, later.id, milkId);
  raw = await fs.readFile(path.join(dir, `${later.name}.md`), 'utf8');
  assert.match(raw, /Buy milk/);

  const renamed = await store.renameList(later.id, 'Someday');
  assert.equal(renamed.name, 'Someday');
  assert.deepEqual((await fs.readdir(dir)).sort(), ['Groceries.md', 'Someday.md']);

  await store.renameTag('errands', 'shop');
  assert.match(await fs.readFile(path.join(dir, 'Groceries.md'), 'utf8'), /#shop/);

  await store.deleteList(renamed.id);
  assert.deepEqual(await fs.readdir(dir), ['Groceries.md']);
  assert.deepEqual(await fs.readdir(path.join(root, '.trash', 'Tasks')), ['Someday.md']);
  await assert.rejects(store.apply(groceries.id, 'nope', []));
});
