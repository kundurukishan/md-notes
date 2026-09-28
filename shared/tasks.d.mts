export interface Task {
  type: 'task';
  id: string;
  title: string;
  tags: string[];
  due: string | null;
  done: boolean;
  doneDate: string | null;
  details: string;
  subtasks: Task[];
}

export interface TextItem {
  type: 'text';
  text: string;
  id?: undefined;
}

export type Item = Task | TextItem;

export interface TaskList {
  id: string;
  name: string;
  sort: 'manual' | 'date';
  frontmatter: string | null;
  items: Item[];
}

export interface TaskRef {
  task: Task;
  parent: Task | null;
}

export interface NewTask {
  id?: string;
  title?: string;
  tags?: string[];
  due?: string | null;
  parent?: string | null;
  afterId?: string | null;
}

export type TaskPatch = Partial<Pick<Task, 'title' | 'details' | 'due' | 'tags'>>;

export function newId(): string;
export function normalizeTag(tag: string): string;
export function normalizeTags(tags: string[]): string[];
export function parseList(raw: string, opts?: { id?: string; name?: string }): TaskList;
export function serializeList(list: TaskList): string;
export function findTask(list: TaskList, id: string): TaskRef | null;

export function setSort(list: TaskList, sort: 'manual' | 'date'): TaskList;
export function addTask(list: TaskList, input?: NewTask): TaskList;
export function updateTask(list: TaskList, id: string, patch: TaskPatch): TaskList;
export function setDone(list: TaskList, id: string, done: boolean, today?: string): TaskList;
export function deleteTask(list: TaskList, id: string): TaskList;
export function clearCompleted(list: TaskList): TaskList;
export function indentTask(list: TaskList, id: string): TaskList;
export function outdentTask(list: TaskList, id: string): TaskList;
export function moveTask(list: TaskList, id: string, targetId: string, place?: 'before' | 'after'): TaskList;
export function moveToList(from: TaskList, to: TaskList, id: string): { from: TaskList; to: TaskList };
export function renameTag(list: TaskList, from: string, to: string): TaskList;

export interface ListOps {
  setSort: typeof setSort;
  addTask: typeof addTask;
  updateTask: typeof updateTask;
  setDone: typeof setDone;
  deleteTask: typeof deleteTask;
  clearCompleted: typeof clearCompleted;
  indentTask: typeof indentTask;
  outdentTask: typeof outdentTask;
  moveTask: typeof moveTask;
  renameTag: typeof renameTag;
}
export type ListOpName = keyof ListOps;
export type ListOpArgs<K extends ListOpName> = ListOps[K] extends (list: TaskList, ...args: infer A) => TaskList ? A : never;
export const LIST_OPS: ListOps;

export function allTasks(list: TaskList): TaskRef[];
export function openTree(list: TaskList): { task: Task; children: Task[] }[];
export function completedTasks(list: TaskList): TaskRef[];
export function openCount(list: TaskList): number;
export function collectOpen(lists: TaskList[], predicate: (task: Task) => boolean): { list: TaskList; task: Task; parent: Task | null }[];
export function reconcileIds(prev: TaskList | null | undefined, next: TaskList): TaskList;
