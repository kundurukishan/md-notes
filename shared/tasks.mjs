// Task lists stored as Markdown, one file per list, using the syntax of the
// Obsidian Tasks plugin:
//
//   - [ ] Buy milk #errands 📅 2026-10-01
//       Details are indented plain lines under a task.
//       - [ ] A subtask (one level)
//   - [x] Return books ✅ 2026-09-26
//
// This module is pure and shared by the Electron main process (which reads and
// writes the files) and the renderer (which applies the same operations
// optimistically). Task ids exist only in memory; they are not written to disk.
//
//   TaskList { id, name, sort: 'manual' | 'date', frontmatter: string | null, items: Item[] }
//   Item     = Task | { type: 'text', text }        (text: headings etc., kept as-is)
//   Task     { type: 'task', id, title, tags, due, done, doneDate, details, subtasks }

const CHECKBOX_RE = /^([ \t]*)[-*+] \[([ xX])\](?:[ \t]+(.*))?$/;
const DUE_RE = /(^|\s)📅\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/u;
const DONE_RE = /(^|\s)✅\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/u;
const TAG_RE = /(^|\s)#([\p{L}\p{N}_\-/]+)(?=\s|$)/gu;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTag(tag) {
  return String(tag).trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
}

export function normalizeTags(tags) {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

// ---- Parsing ----------------------------------------------------------------

function indentWidth(line) {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4;
    else break;
  }
  return width;
}

// Removes up to `cols` columns of leading whitespace.
function dedent(line, cols) {
  let i = 0;
  let width = 0;
  while (i < line.length && width < cols && (line[i] === ' ' || line[i] === '\t')) {
    width += line[i] === '\t' ? 4 : 1;
    i++;
  }
  return line.slice(i);
}

function parseTaskText(text = '', checked) {
  let rest = ` ${text} `;
  const due = rest.match(DUE_RE);
  if (due) rest = rest.replace(DUE_RE, '$1');
  const done = rest.match(DONE_RE);
  if (done) rest = rest.replace(DONE_RE, '$1');
  const tags = [];
  rest = rest.replace(TAG_RE, (match, space, tag) => {
    if (/^\d+$/.test(tag)) return match; // "#1" is not a tag
    tags.push(tag);
    return space;
  });
  return {
    title: rest.replace(/\s+/g, ' ').trim(),
    tags: normalizeTags(tags),
    due: due ? due[2] : null,
    done: checked,
    doneDate: checked && done ? done[2] : null,
  };
}

function makeTask(fields) {
  return { type: 'task', id: newId(), title: '', tags: [], due: null, done: false, doneDate: null, details: '', subtasks: [], ...fields };
}

export function parseList(raw, { id = newId(), name = 'Tasks' } = {}) {
  let lines = raw.replace(/\r\n?/g, '\n').split('\n');
  let frontmatter = null;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      frontmatter = lines.slice(1, end).join('\n');
      lines = lines.slice(end + 1);
    }
  }
  const sortMatch = frontmatter?.match(/^sort:\s*(\w+)\s*$/m);

  const items = [];
  let top = null; // current top-level task
  let sub = null; // current subtask
  let text = null; // current text block lines

  const flushText = () => {
    if (text) {
      while (text.length && !text[text.length - 1].trim()) text.pop();
      if (text.length) items.push({ type: 'text', text: text.join('\n') });
    }
    text = null;
  };
  const addDetail = (task, line, cols) => {
    task.details = task.details ? `${task.details}\n${dedent(line, cols)}` : dedent(line, cols);
  };
  const nextNonBlank = (i) => {
    for (let j = i + 1; j < lines.length; j++) if (lines[j].trim()) return lines[j];
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const indent = indentWidth(line);
    const box = line.match(CHECKBOX_RE);

    if (!line.trim()) {
      // A blank line inside a task's details continues them; otherwise it ends the task.
      const next = nextNonBlank(i);
      if (top && next !== null && indentWidth(next) >= 2) {
        const owner = sub && indentWidth(next) > sub.indentCols + 1 && !CHECKBOX_RE.test(next) ? sub : top;
        if (owner.details) owner.details += '\n';
        continue;
      }
      top = sub = null;
      if (text) text.push('');
      continue;
    }

    if (box && indent < 2) {
      flushText();
      top = makeTask(parseTaskText(box[3], box[2] !== ' '));
      sub = null;
      items.push(top);
    } else if (box && top && (!sub || indent <= sub.indentCols + 1)) {
      sub = makeTask(parseTaskText(box[3], box[2] !== ' '));
      Object.defineProperty(sub, 'indentCols', { value: indent, enumerable: false });
      top.subtasks.push(sub);
    } else if (top && indent >= 2) {
      if (sub && indent > sub.indentCols + 1) addDetail(sub, line, sub.indentCols + 4);
      else addDetail(top, line, 4);
    } else {
      top = sub = null;
      if (!text) text = [];
      text.push(line);
    }
  }
  flushText();

  // Trailing blank lines left inside details by the lookahead are dropped.
  for (const item of items) {
    if (item.type !== 'task') continue;
    item.details = item.details.replace(/\n+$/, '');
    for (const s of item.subtasks) s.details = s.details.replace(/\n+$/, '');
  }

  return { id, name, sort: sortMatch?.[1] === 'date' ? 'date' : 'manual', frontmatter, items };
}

// ---- Serializing ------------------------------------------------------------

function taskLine(task, pad) {
  const parts = [
    task.title.replace(/\s*\n\s*/g, ' ').trim(),
    ...task.tags.map((t) => `#${t}`),
    task.due ? `📅 ${task.due}` : '',
    task.done && task.doneDate ? `✅ ${task.doneDate}` : '',
  ].filter(Boolean);
  return `${pad}- [${task.done ? 'x' : ' '}]${parts.length ? ` ${parts.join(' ')}` : ''}`;
}

function detailLines(details, pad) {
  if (!details) return [];
  return details.split('\n').map((l) => (l.trim() ? `${pad}${l}` : ''));
}

export function serializeList(list) {
  const out = [];
  // Other frontmatter keys are kept; `sort` is only written when not manual.
  const fm = [(list.frontmatter ?? '').replace(/^sort:.*$\n?/m, '').trim(), list.sort === 'date' ? 'sort: date' : '']
    .filter(Boolean)
    .join('\n');
  if (fm) out.push('---', fm, '---', '');
  let prev = null;
  for (const item of list.items) {
    if (item.type === 'text') {
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(item.text, '');
    } else {
      if (prev === 'text' && out[out.length - 1] !== '') out.push('');
      out.push(taskLine(item, ''), ...detailLines(item.details, '    '));
      for (const s of item.subtasks) out.push(taskLine(s, '    '), ...detailLines(s.details, '        '));
    }
    prev = item.type;
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.length ? `${out.join('\n')}\n` : '';
}

// ---- Lookups ----------------------------------------------------------------

export function findTask(list, id) {
  for (const item of list.items) {
    if (item.type !== 'task') continue;
    if (item.id === id) return { task: item, parent: null };
    const s = item.subtasks.find((t) => t.id === id);
    if (s) return { task: s, parent: item };
  }
  return null;
}

// Applies `fn` to every task (top-level and subtasks); `fn` returns the new task.
function mapTasks(list, fn) {
  return {
    ...list,
    items: list.items.map((item) => (item.type === 'task' ? fn({ ...item, subtasks: item.subtasks.map((s) => fn(s, item)) }, null) : item)),
  };
}

function removeTask(list, id) {
  return {
    ...list,
    items: list.items
      .filter((item) => item.type !== 'task' || item.id !== id)
      .map((item) => (item.type === 'task' && item.subtasks.some((s) => s.id === id) ? { ...item, subtasks: item.subtasks.filter((s) => s.id !== id) } : item)),
  };
}

// Inserts a top-level task. Without a reference it goes before the first task
// (after any heading text at the top of the file), or at the end if there are none.
function insertTop(items, task, afterId = null, beforeId = null) {
  const next = [...items];
  let index;
  if (afterId) {
    const i = next.findIndex((x) => x.id === afterId);
    index = i < 0 ? next.length : i + 1;
  } else if (beforeId) {
    index = next.findIndex((x) => x.id === beforeId);
  } else {
    index = next.findIndex((x) => x.type === 'task');
  }
  next.splice(index < 0 ? next.length : index, 0, task);
  return next;
}

function insertSub(parent, task, afterId = null, beforeId = null) {
  const subtasks = [...parent.subtasks];
  let index = 0;
  if (afterId) {
    const i = subtasks.findIndex((s) => s.id === afterId);
    index = i < 0 ? subtasks.length : i + 1;
  } else if (beforeId) {
    index = Math.max(0, subtasks.findIndex((s) => s.id === beforeId));
  }
  subtasks.splice(index, 0, task);
  return { ...parent, subtasks };
}

// ---- Operations -------------------------------------------------------------

export function setSort(list, sort) {
  return { ...list, sort: sort === 'date' ? 'date' : 'manual' };
}

export function addTask(list, { id = newId(), title = '', tags = [], due = null, parent = null, afterId = null } = {}) {
  const task = makeTask({ id, title, tags: normalizeTags(tags), due: due && DATE_RE.test(due) ? due : null });
  const parentTask = parent ? findTask(list, parent) : null;
  if (parentTask && !parentTask.parent) {
    return { ...list, items: list.items.map((i) => (i.id === parent ? insertSub(i, task, afterId) : i)) };
  }
  return { ...list, items: insertTop(list.items, task, afterId) };
}

export function updateTask(list, id, patch) {
  return mapTasks(list, (t) => {
    if (t.id !== id) return t;
    const next = { ...t };
    if (typeof patch.title === 'string') next.title = patch.title.replace(/\s*\n\s*/g, ' ');
    if (typeof patch.details === 'string') next.details = patch.details.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    if ('due' in patch) next.due = patch.due && DATE_RE.test(patch.due) ? patch.due : null;
    if (Array.isArray(patch.tags)) next.tags = normalizeTags(patch.tags);
    return next;
  });
}

// Completing a task completes its subtasks; reopening a subtask reopens its parent.
export function setDone(list, id, done, today) {
  const found = findTask(list, id);
  if (!found) return list;
  return mapTasks(list, (t, parent) => {
    if (done && (t.id === id || parent?.id === id) && !t.done) return { ...t, done: true, doneDate: today };
    if (!done && (t.id === id || (found.parent && t.id === found.parent.id && t.done))) return { ...t, done: false, doneDate: null };
    return t;
  });
}

export function deleteTask(list, id) {
  return removeTask(list, id);
}

export function clearCompleted(list) {
  return {
    ...list,
    items: list.items
      .filter((i) => i.type !== 'task' || !i.done)
      .map((i) => (i.type === 'task' ? { ...i, subtasks: i.subtasks.filter((s) => !s.done) } : i)),
  };
}

// Makes a top-level task (without subtasks of its own) the last subtask of
// the open task above it.
export function indentTask(list, id) {
  const found = findTask(list, id);
  if (!found || found.parent || found.task.subtasks.length) return list;
  const index = list.items.indexOf(found.task);
  const newParent = list.items.slice(0, index).reverse().find((i) => i.type === 'task' && !i.done);
  if (!newParent) return list;
  const items = list.items.filter((i) => i !== found.task).map((i) => (i === newParent ? { ...i, subtasks: [...i.subtasks, found.task] } : i));
  return { ...list, items };
}

// Turns a subtask into a top-level task placed right after its old parent.
export function outdentTask(list, id) {
  const found = findTask(list, id);
  if (!found || !found.parent) return list;
  const without = removeTask(list, id);
  return { ...without, items: insertTop(without.items, { ...found.task, subtasks: [] }, found.parent.id) };
}

// Drag and drop: puts task `id` before or after `targetId`, at the target's
// level. A task with subtasks can only be placed at the top level.
export function moveTask(list, id, targetId, place = 'before') {
  const moving = findTask(list, id);
  const target = findTask(list, targetId);
  if (!moving || !target || id === targetId || target.parent?.id === id) return list;
  if (target.parent && moving.task.subtasks.length) return list;
  const without = removeTask(list, id);
  const ref = place === 'after' ? { after: targetId } : { before: targetId };
  if (target.parent) {
    return {
      ...without,
      items: without.items.map((i) => (i.id === target.parent.id ? insertSub(i, moving.task, ref.after, ref.before) : i)),
    };
  }
  return { ...without, items: insertTop(without.items, moving.task, ref.after, ref.before) };
}

// Moves a task (with its subtasks) to the top of another list.
export function moveToList(from, to, id) {
  const found = findTask(from, id);
  if (!found || from.id === to.id) return { from, to };
  return {
    from: removeTask(from, id),
    to: { ...to, items: insertTop(to.items, found.task) },
  };
}

// Renames a tag in every task; an empty `to` removes it.
export function renameTag(list, from, to) {
  const src = normalizeTag(from);
  const dst = to ? normalizeTag(to) : '';
  return mapTasks(list, (t) => (t.tags.includes(src) ? { ...t, tags: normalizeTags(t.tags.map((x) => (x === src ? dst : x)).filter(Boolean)) } : t));
}

// Operations the renderer may apply to a single list, by name.
export const LIST_OPS = { setSort, addTask, updateTask, setDone, deleteTask, clearCompleted, indentTask, outdentTask, moveTask, renameTag };

// ---- Views ------------------------------------------------------------------

export function allTasks(list) {
  return list.items.filter((i) => i.type === 'task').flatMap((t) => [{ task: t, parent: null }, ...t.subtasks.map((s) => ({ task: s, parent: t }))]);
}

// Open tasks as [{ task, children }]. In date order, undated tasks go last.
export function openTree(list) {
  let top = list.items.filter((i) => i.type === 'task' && !i.done);
  if (list.sort === 'date') {
    top = top
      .map((t, i) => ({ t, i }))
      .sort((a, b) => (a.t.due ?? '9999').localeCompare(b.t.due ?? '9999') || a.i - b.i)
      .map((x) => x.t);
  }
  return top.map((task) => ({ task, children: task.subtasks.filter((s) => !s.done) }));
}

// Completed tasks, most recently completed first: completed top-level tasks
// and completed subtasks of open parents.
export function completedTasks(list) {
  const rows = allTasks(list).filter(({ task, parent }) => task.done && (!parent || !parent.done));
  return rows.map((r, i) => ({ ...r, i })).sort((a, b) => (b.task.doneDate ?? '').localeCompare(a.task.doneDate ?? '') || a.i - b.i);
}

export function openCount(list) {
  return allTasks(list).filter(({ task, parent }) => !task.done && !parent?.done).length;
}

// Open tasks across lists matching `predicate`, with the list they belong to.
export function collectOpen(lists, predicate) {
  const rows = [];
  for (const list of lists) {
    for (const { task, parent } of allTasks(list)) {
      if (!task.done && !parent?.done && predicate(task)) rows.push({ list, task, parent });
    }
  }
  return rows;
}

// Gives tasks in a freshly parsed list the ids of matching tasks in the
// previous version, so external edits don't disturb the UI.
export function reconcileIds(prev, next) {
  if (!prev) return next;
  const pool = new Map();
  for (const { task, parent } of allTasks(prev)) {
    const key = `${parent?.title ?? ''}\u0000${task.title}`;
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(task.id);
  }
  const take = (task, parent) => pool.get(`${parent?.title ?? ''}\u0000${task.title}`)?.shift() ?? task.id;
  return {
    ...next,
    id: prev.id,
    items: next.items.map((i) =>
      i.type === 'task' ? { ...i, id: take(i, null), subtasks: i.subtasks.map((s) => ({ ...s, id: take(s, i) })) } : i,
    ),
  };
}
