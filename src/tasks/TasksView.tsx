import { useEffect, useMemo, useRef, useState } from 'react';
import { collectOpen, completedTasks, newId, openTree } from '../../shared/tasks.mjs';
import type { Task, TaskList } from '../api';
import { TaskRow, TASK_DRAG_TYPE } from './TaskRow';
import { dueLabel, todayKey } from './dates';
import type { TasksApi } from './useTasks';
import { IconCheck, IconChevron, IconMore, IconPlus, IconSidebar, IconSun, IconTrash } from '../Icons';

export { TASK_DRAG_TYPE };

type Focus = { id: string; at: 'start' | 'end' } | null;

interface CommonProps {
  tasks: TasksApi;
  colors: Record<string, string>;
  allTags: string[];
  newTaskSignal: number;
  sidebarOpen: boolean;
  onShowSidebar: () => void;
  onSelectTag: (tag: string) => void;
}

// Runs `fn` whenever the ⌘N signal changes (but not on mount).
function useSignal(signal: number, fn: () => void) {
  const last = useRef(signal);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (signal !== last.current) {
      last.current = signal;
      fnRef.current();
    }
  }, [signal]);
}

function Toolbar({ crumb, sidebarOpen, onShowSidebar, children }: { crumb: string; sidebarOpen: boolean; onShowSidebar: () => void; children?: React.ReactNode }) {
  return (
    <div className="tasks-toolbar drag">
      {!sidebarOpen && (
        <button className="icon-button no-drag" onClick={onShowSidebar} aria-label="Show sidebar">
          <IconSidebar />
        </button>
      )}
      <div className="crumbs">
        <span>Tasks</span>
        <span className="crumb-sep">/</span>
        <span className="crumb-current">{crumb}</span>
      </div>
      {children}
    </div>
  );
}

// ---- A single task list -------------------------------------------------------

interface ListPageProps extends CommonProps {
  list: TaskList;
  revealTaskId: string | null;
  onDeleteList: (list: TaskList) => void;
}

export function ListPage({ list, tasks, colors, allTags, newTaskSignal, sidebarOpen, onShowSidebar, onSelectTag, onDeleteList, revealTaskId }: ListPageProps) {
  const [focus, setFocus] = useState<Focus>(null);
  const [expanded, setExpanded] = useState<string | null>(revealTaskId);
  const [showCompleted, setShowCompleted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drag, setDrag] = useState<{ id: string; over: string | null; place: 'before' | 'after' } | null>(null);
  const [nameDraft, setNameDraft] = useState(list.name);
  const nameRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(
    () => openTree(list).flatMap(({ task, children }) => [{ task, parent: null as Task | null }, ...children.map((c) => ({ task: c, parent: task as Task | null }))]),
    [list],
  );
  const done = useMemo(() => completedTasks(list), [list]);

  useEffect(() => setNameDraft(list.name), [list.name]);
  useEffect(() => {
    setExpanded(revealTaskId);
    setMenuOpen(false);
  }, [list.id, revealTaskId]);

  const apply = tasks.apply;
  const addAtTop = () => {
    const id = newId();
    apply(list.id, 'addTask', { id });
    setFocus({ id, at: 'end' });
  };
  useSignal(newTaskSignal, addAtTop);

  const focusSibling = (id: string, delta: number) => {
    const index = rows.findIndex((r) => r.task.id === id);
    const next = rows[index + delta];
    if (next) setFocus({ id: next.task.id, at: 'end' });
  };

  const rename = () => {
    const name = nameDraft.trim();
    if (name && name !== list.name) tasks.renameList(list.id, name);
    else setNameDraft(list.name);
  };

  return (
    <main className="tasks-pane" onMouseDown={() => menuOpen && setMenuOpen(false)}>
      <Toolbar crumb={list.name} sidebarOpen={sidebarOpen} onShowSidebar={onShowSidebar}>
        <div className="segmented small no-drag" role="group" aria-label="Sort tasks">
          <button className={list.sort === 'manual' ? 'active' : ''} onClick={() => apply(list.id, 'setSort', 'manual')}>
            My order
          </button>
          <button className={list.sort === 'date' ? 'active' : ''} onClick={() => apply(list.id, 'setSort', 'date')}>
            Date
          </button>
        </div>
        <div className="menu-anchor no-drag">
          <button className="icon-button" aria-label="List options" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMenuOpen((o) => !o)}>
            <IconMore />
          </button>
          {menuOpen && (
            <div className="dropdown" onMouseDown={(e) => e.stopPropagation()}>
              <button
                className="context-item"
                onClick={() => {
                  setMenuOpen(false);
                  nameRef.current?.focus();
                  nameRef.current?.select();
                }}
              >
                Rename list
              </button>
              <button
                className="context-item"
                disabled={!done.length}
                onClick={() => {
                  setMenuOpen(false);
                  apply(list.id, 'clearCompleted');
                }}
              >
                Delete completed tasks
              </button>
              <div className="context-sep" />
              <button
                className="context-item danger"
                onClick={() => {
                  setMenuOpen(false);
                  onDeleteList(list);
                }}
              >
                Delete list
              </button>
            </div>
          )}
        </div>
      </Toolbar>

      <div className="document-scroll">
        <div className="tasks-document">
          <input
            ref={nameRef}
            className="title-input list-name-input"
            value={nameDraft}
            placeholder="Untitled list"
            aria-label="List name"
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              else if (e.key === 'Escape') {
                setNameDraft(list.name);
                requestAnimationFrame(() => nameRef.current?.blur());
              }
            }}
          />
          <div className="list-summary">
            {rows.length} open{done.length ? ` · ${done.length} completed` : ''}
          </div>

          <button className="add-task" onClick={addAtTop}>
            <span className="add-task-icon">
              <IconPlus size={14} />
            </span>
            Add a task
          </button>

          <div className="task-rows" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrag((d) => (d ? { ...d, over: null } : d))}>
            {rows.length === 0 && (
              <div className="tasks-empty">
                <IconCheck size={28} />
                <p>{done.length ? 'All done. Nice work!' : 'No tasks yet'}</p>
              </div>
            )}
            {rows.map(({ task, parent }) => (
              <TaskRow
                key={task.id}
                task={task}
                parent={parent}
                list={list}
                tasks={tasks}
                colors={colors}
                allTags={allTags}
                editing
                expanded={expanded === task.id}
                focusAt={focus?.id === task.id ? focus.at : null}
                draggable={list.sort === 'manual'}
                dropState={drag && drag.over === task.id && drag.id !== task.id ? drag.place : null}
                dragging={drag?.id === task.id}
                onFocused={() => setFocus(null)}
                onExpand={(open) => setExpanded(open ? task.id : null)}
                onEnter={() => {
                  const id = newId();
                  apply(list.id, 'addTask', { id, parent: parent?.id ?? null, afterId: task.id });
                  setFocus({ id, at: 'end' });
                }}
                onIndent={() => {
                  apply(list.id, 'indentTask', task.id);
                  setFocus({ id: task.id, at: 'end' });
                }}
                onOutdent={() => {
                  apply(list.id, 'outdentTask', task.id);
                  setFocus({ id: task.id, at: 'end' });
                }}
                onAddSubtask={() => {
                  const id = newId();
                  apply(list.id, 'addTask', { id, parent: task.id });
                  setExpanded(null);
                  setFocus({ id, at: 'end' });
                }}
                onArrow={(delta) => focusSibling(task.id, delta)}
                onDeleted={(focusPrev) => focusPrev && focusSibling(task.id, -1)}
                onSelectTag={onSelectTag}
                onDragStart={() => setDrag({ id: task.id, over: null, place: 'before' })}
                onDragOver={(place) => setDrag((d) => (d ? { ...d, over: task.id, place } : d))}
                onDrop={(place) => {
                  if (drag && drag.id !== task.id) apply(list.id, 'moveTask', drag.id, task.id, place);
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
              />
            ))}
          </div>

          {done.length > 0 && (
            <section className="completed-section">
              <button className={`completed-toggle${showCompleted ? ' open' : ''}`} onClick={() => setShowCompleted((s) => !s)}>
                <IconChevron size={14} />
                Completed ({done.length})
              </button>
              {showCompleted &&
                done.map(({ task, parent }) => (
                  <div key={task.id} className="task-row completed">
                    <button className="task-check checked" aria-label={`Mark "${task.title || 'Untitled task'}" not done`} onClick={() => apply(list.id, 'setDone', task.id, false)}>
                      <IconCheck size={12} />
                    </button>
                    <div className="task-main">
                      <div className="task-title-static">{task.title || 'Untitled task'}</div>
                      {(parent || task.subtasks.length > 0) && (
                        <div className="task-meta">
                          {parent ? `Subtask of ${parent.title || 'Untitled task'}` : `${task.subtasks.length} ${task.subtasks.length === 1 ? 'subtask' : 'subtasks'}`}
                        </div>
                      )}
                    </div>
                    <button className="icon-button row-action" aria-label="Delete task" onClick={() => apply(list.id, 'deleteTask', task.id)}>
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

// ---- Today: overdue and due-today tasks from every list ----------------------

interface TodayPageProps extends CommonProps {
  onOpenList: (listId: string, taskId: string) => void;
  onCreateList: (name: string) => string;
}

export function TodayPage({ tasks, colors, allTags, newTaskSignal, sidebarOpen, onShowSidebar, onSelectTag, onOpenList, onCreateList }: TodayPageProps) {
  const [focus, setFocus] = useState<Focus>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const today = todayKey();

  const rows = useMemo(() => {
    const due = collectOpen(tasks.lists, (t) => Boolean(t.due && t.due <= today));
    // Stable order: by due date, then list, then position in the list.
    return due.map((r, i) => ({ ...r, i })).sort((a, b) => a.task.due!.localeCompare(b.task.due!) || a.i - b.i);
  }, [tasks.lists, today]);
  const overdue = rows.filter((r) => r.task.due! < today);
  const dueToday = rows.filter((r) => r.task.due === today);

  const addTask = () => {
    const listId = tasks.lists[0]?.id ?? onCreateList('My Tasks');
    const id = newId();
    tasks.apply(listId, 'addTask', { id, due: today });
    setFocus({ id, at: 'end' });
  };
  useSignal(newTaskSignal, addTask);

  const ordered = [...overdue, ...dueToday];
  const focusSibling = (id: string, delta: number) => {
    const index = ordered.findIndex((r) => r.task.id === id);
    const next = ordered[index + delta];
    if (next) setFocus({ id: next.task.id, at: 'end' });
  };

  const section = (title: string, items: typeof rows, className = '') =>
    items.length > 0 && (
      <section className={`today-section ${className}`}>
        <h2>
          {title} <span>{items.length}</span>
        </h2>
        {items.map(({ list, task, parent }) => (
          <TaskRow
            key={task.id}
            task={task}
            parent={parent}
            list={list}
            tasks={tasks}
            colors={colors}
            allTags={allTags}
            editing={false}
            showList
            expanded={expanded === task.id}
            focusAt={focus?.id === task.id ? focus.at : null}
            onFocused={() => setFocus(null)}
            onExpand={(open) => setExpanded(open ? task.id : null)}
            onArrow={(delta) => focusSibling(task.id, delta)}
            onDeleted={() => {}}
            onSelectTag={onSelectTag}
            onOpenList={() => onOpenList(list.id, task.id)}
          />
        ))}
      </section>
    );

  return (
    <main className="tasks-pane">
      <Toolbar crumb="Today" sidebarOpen={sidebarOpen} onShowSidebar={onShowSidebar} />
      <div className="document-scroll">
        <div className="tasks-document">
          <h1 className="title-input today-title">Today</h1>
          <div className="list-summary">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <button className="add-task" onClick={addTask}>
            <span className="add-task-icon">
              <IconPlus size={14} />
            </span>
            Add a task for today
          </button>
          {rows.length === 0 && (
            <div className="tasks-empty">
              <IconSun size={28} />
              <p>Nothing due today.</p>
            </div>
          )}
          {section('Overdue', overdue, 'overdue')}
          {section('Today', dueToday)}
        </div>
      </div>
    </main>
  );
}

// ---- Tasks shown above notes on tag pages and in search -------------------------

interface TaskMatchesProps {
  rows: { list: TaskList; task: Task; parent: Task | null }[];
  tasks: TasksApi;
  onOpen: (listId: string, taskId: string) => void;
}

export function TaskMatches({ rows, tasks, onOpen }: TaskMatchesProps) {
  const [showAll, setShowAll] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  if (!rows.length) return null;
  const shown = showAll ? rows : rows.slice(0, 5);
  return (
    <div className="task-matches">
      <div className="task-matches-label">Tasks</div>
      {shown.map(({ list, task }) => (
        <div key={task.id} className={`mini-task${checking === task.id ? ' checking' : ''}`}>
          <button
            className={`task-check small${checking === task.id ? ' checked' : ''}`}
            aria-label={`Mark "${task.title || 'Untitled task'}" done`}
            onClick={() => {
              setChecking(task.id);
              window.setTimeout(() => {
                tasks.apply(list.id, 'setDone', task.id, true, todayKey());
                setChecking(null);
              }, 260);
            }}
          >
            <IconCheck size={10} />
          </button>
          <button className="mini-task-text" onClick={() => onOpen(list.id, task.id)}>
            <span className="mini-task-title">{task.title || 'Untitled task'}</span>
            <span className="mini-task-list">{list.name}</span>
          </button>
          {task.due && (
            <span className={`mini-due${task.due < todayKey() ? ' overdue' : ''}`}>{dueLabel(task.due).label}</span>
          )}
        </div>
      ))}
      {rows.length > 5 && (
        <button className="mini-more" onClick={() => setShowAll((s) => !s)}>
          {showAll ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}
