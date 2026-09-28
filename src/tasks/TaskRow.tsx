import { useEffect, useRef, useState } from 'react';
import type { Task, TaskList, TaskPatch } from '../api';
import { TagChip, TagInput } from '../TagInput';
import { dueLabel, todayKey } from './dates';
import type { TasksApi } from './useTasks';
import { IconCalendar, IconCheck, IconDetails, IconGrip, IconSubtask, IconTrash } from '../Icons';

export const TASK_DRAG_TYPE = 'application/x-mdnotes-task';

export interface TaskRowProps {
  task: Task;
  parent: Task | null;
  list: TaskList;
  tasks: TasksApi;
  colors: Record<string, string>;
  allTags: string[];
  expanded: boolean;
  focusAt: 'start' | 'end' | null;
  // Full list editing: Enter adds the next task, Tab/⇧Tab nest, drag to reorder.
  editing: boolean;
  showList?: boolean;
  draggable?: boolean;
  dropState?: 'before' | 'after' | null;
  dragging?: boolean;
  onFocused: () => void;
  onExpand: (open: boolean) => void;
  onEnter?: () => void;
  onIndent?: () => void;
  onOutdent?: () => void;
  onAddSubtask?: () => void;
  onArrow: (delta: number) => void;
  onDeleted: (focusPrev: boolean) => void;
  onSelectTag: (tag: string) => void;
  onOpenList?: () => void;
  onDragStart?: () => void;
  onDragOver?: (place: 'before' | 'after') => void;
  onDrop?: (place: 'before' | 'after') => void;
  onDragEnd?: () => void;
}

export function TaskRow(props: TaskRowProps) {
  const { task, parent, list, tasks, expanded, focusAt, editing } = props;
  const [draft, setDraft] = useState(task.title);
  const [details, setDetails] = useState(task.details);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const titleTimer = useRef(0);
  const detailsTimer = useRef(0);
  const typing = useRef(false);
  const typingDetails = useRef(false);

  // Follow outside changes unless the user is typing in this row.
  useEffect(() => {
    if (!typing.current) setDraft(task.title);
  }, [task.title]);
  useEffect(() => {
    if (!typingDetails.current) setDetails(task.details);
  }, [task.details]);

  useEffect(() => {
    if (!focusAt || !inputRef.current) return;
    const input = inputRef.current;
    input.focus();
    const at = focusAt === 'start' ? 0 : input.value.length;
    input.setSelectionRange(at, at);
    props.onFocused();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAt]);

  const update = (patch: TaskPatch) => tasks.apply(list.id, 'updateTask', task.id, patch);

  const commitTitle = (value = draft) => {
    window.clearTimeout(titleTimer.current);
    if (value !== task.title) update({ title: value });
  };
  const commitDetails = (value = details) => {
    window.clearTimeout(detailsTimer.current);
    if (value !== task.details) update({ details: value });
  };

  const remove = (focusPrev: boolean) => {
    props.onDeleted(focusPrev);
    tasks.apply(list.id, 'deleteTask', task.id);
  };

  const isBlank = () => !draft.trim() && !task.details && !task.due && !task.tags.length && !task.subtasks.length;

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (e.key === 'Enter') {
      e.preventDefault();
      commitTitle();
      if (editing && props.onEnter) {
        if (draft.trim()) props.onEnter();
      } else {
        input.blur();
      }
    } else if (e.key === 'Tab' && editing) {
      e.preventDefault();
      commitTitle();
      if (e.shiftKey) props.onOutdent?.();
      else props.onIndent?.();
    } else if (e.key === 'Backspace' && editing && !draft && input.selectionStart === 0 && !task.subtasks.length) {
      e.preventDefault();
      remove(true);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      commitTitle();
      props.onArrow(e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Escape') {
      input.blur();
    }
  };

  const due = task.due ? dueLabel(task.due) : null;
  const otherLists = tasks.lists.filter((l) => l.id !== list.id);
  const hasMeta = task.details || due || task.tags.length || props.showList || (parent && props.showList);

  return (
    <div
      ref={rowRef}
      className={[
        'task-row',
        parent && editing ? 'sub' : '',
        expanded ? 'expanded' : '',
        checking ? 'checking' : '',
        props.dragging ? 'dragging' : '',
        props.dropState ? `drop-${props.dropState}` : '',
      ].join(' ')}
      draggable={props.draggable && !expanded}
      onDragStart={(e) => {
        if ((e.target as HTMLElement).closest('input, textarea')) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData(TASK_DRAG_TYPE, JSON.stringify({ listId: list.id, taskId: task.id }));
        props.onDragStart?.();
      }}
      onDragOver={(e) => {
        if (!props.onDragOver || !e.dataTransfer.types.includes(TASK_DRAG_TYPE)) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        props.onDragOver(e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
      }}
      onDrop={(e) => {
        if (!props.onDrop) return;
        e.preventDefault();
        props.onDrop(props.dropState ?? 'before');
      }}
      onDragEnd={props.onDragEnd}
      onBlur={(e) => {
        // Leaving a brand-new task without typing anything discards it.
        if (rowRef.current?.contains(e.relatedTarget as Node)) return;
        if (isBlank() && !expanded) remove(false);
      }}
    >
      {props.draggable && (
        <span className="drag-handle" aria-hidden="true">
          <IconGrip size={14} />
        </span>
      )}
      <button
        className={`task-check${checking ? ' checked' : ''}`}
        aria-label={`Mark "${task.title || 'Untitled task'}" done`}
        onClick={() => {
          commitTitle();
          setChecking(true);
          window.setTimeout(() => tasks.apply(list.id, 'setDone', task.id, true, todayKey()), 260);
        }}
      >
        <IconCheck size={12} />
      </button>
      <div className="task-main">
        <input
          ref={inputRef}
          className="task-title"
          value={draft}
          placeholder="Title"
          aria-label="Task title"
          onChange={(e) => {
            const value = e.target.value;
            setDraft(value);
            window.clearTimeout(titleTimer.current);
            titleTimer.current = window.setTimeout(() => update({ title: value }), 400);
          }}
          onFocus={() => (typing.current = true)}
          onBlur={() => {
            typing.current = false;
            commitTitle();
          }}
          onKeyDown={onKeyDown}
        />
        {!expanded && hasMeta && (
          <div className="task-meta">
            {props.showList && (
              <button className="list-chip" onClick={props.onOpenList} title={`Open ${list.name}`}>
                {list.name}
                {parent ? ` › ${parent.title || 'Untitled task'}` : ''}
              </button>
            )}
            {due && (
              <span className={`due-chip${due.overdue ? ' overdue' : ''}${due.today ? ' today' : ''}`}>
                <IconCalendar size={12} /> {due.label}
              </span>
            )}
            {task.tags.map((t) => (
              <TagChip key={t} tag={t} colors={props.colors} small onClick={() => props.onSelectTag(t)} />
            ))}
            {task.details && (
              <span className="task-details-preview" onClick={() => props.onExpand(true)}>
                {task.details.split('\n')[0]}
              </span>
            )}
          </div>
        )}
        {expanded && (
          <div className="task-details">
            <textarea
              className="task-notes"
              value={details}
              placeholder="Details"
              rows={Math.min(8, Math.max(2, details.split('\n').length))}
              onChange={(e) => {
                const value = e.target.value;
                setDetails(value);
                window.clearTimeout(detailsTimer.current);
                detailsTimer.current = window.setTimeout(() => update({ details: value }), 400);
              }}
              onFocus={() => (typingDetails.current = true)}
              onBlur={() => {
                typingDetails.current = false;
                commitDetails();
              }}
            />
            <div className="detail-row">
              <span className="detail-label">Due</span>
              <input type="date" className="date-input" value={task.due ?? ''} onChange={(e) => update({ due: e.target.value || null })} aria-label="Due date" />
              <button className="chip-button" onClick={() => update({ due: todayKey() })}>
                Today
              </button>
              <button className="chip-button" onClick={() => update({ due: todayKey(1) })}>
                Tomorrow
              </button>
              {task.due && (
                <button className="chip-button" onClick={() => update({ due: null })}>
                  Clear
                </button>
              )}
            </div>
            <div className="detail-row">
              <span className="detail-label">Tags</span>
              <TagInput tags={task.tags} allTags={props.allTags} colors={props.colors} onChange={(tags) => update({ tags })} onSelectTag={props.onSelectTag} />
            </div>
            <div className="detail-row">
              {!parent && props.onAddSubtask && (
                <button className="chip-button" onClick={props.onAddSubtask}>
                  <IconSubtask size={13} /> Add subtask
                </button>
              )}
              {otherLists.length > 0 && (
                <select
                  className="list-select"
                  value=""
                  onChange={(e) => e.target.value && tasks.moveToList(list.id, e.target.value, task.id)}
                  aria-label="Move to list"
                >
                  <option value="">Move to list…</option>
                  {otherLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
              <button className="chip-button danger" onClick={() => remove(false)}>
                <IconTrash size={13} /> Delete
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        className={`icon-button row-action${expanded ? ' on' : ''}`}
        aria-label={expanded ? 'Hide details' : 'Show details'}
        onClick={() => {
          commitDetails();
          props.onExpand(!expanded);
        }}
      >
        <IconDetails size={14} />
      </button>
    </div>
  );
}
