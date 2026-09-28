import { useCallback, useEffect, useRef, useState } from 'react';
import { LIST_OPS, moveToList as moveBetween, newId, parseList } from '../../shared/tasks.mjs';
import { api, type ListOpArgs, type ListOpName, type TaskList } from '../api';

const byName = (a: TaskList, b: TaskList) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// Task lists with optimistic updates: each operation is applied locally right
// away (with the same code the main process runs), then sent to the main
// process. Its result replaces the local copy once no other operation on that
// list is still in flight.
export function useTasks() {
  const [lists, setLists] = useState<TaskList[]>([]);
  const [loaded, setLoaded] = useState(false);
  const listsRef = useRef<TaskList[]>([]);
  const pending = useRef(new Map<string, number>());

  const commit = useCallback((fn: (prev: TaskList[]) => TaskList[]) => {
    listsRef.current = fn(listsRef.current).sort(byName);
    setLists(listsRef.current);
  }, []);

  const busy = (id: string) => (pending.current.get(id) ?? 0) > 0;

  const reload = useCallback(async () => {
    const fresh = await api.listTaskLists();
    commit((prev) => fresh.map((l) => (busy(l.id) ? (prev.find((p) => p.id === l.id) ?? l) : l)));
    setLoaded(true);
  }, [commit]);

  useEffect(() => {
    void reload();
    return api.onTasksChanged(() => void reload());
  }, [reload]);

  const track = useCallback(
    async (ids: string[], request: Promise<TaskList[]>) => {
      for (const id of ids) pending.current.set(id, (pending.current.get(id) ?? 0) + 1);
      try {
        const results = await request;
        for (const id of ids) pending.current.set(id, (pending.current.get(id) ?? 1) - 1);
        commit((prev) => prev.map((l) => (busy(l.id) ? l : (results.find((r) => r.id === l.id) ?? l))));
      } catch (err) {
        console.error('Task update failed', err);
        for (const id of ids) pending.current.set(id, 0);
        await reload();
      }
    },
    [commit, reload],
  );

  const apply = useCallback(
    <K extends ListOpName>(listId: string, op: K, ...args: ListOpArgs<K>) => {
      const fn = LIST_OPS[op] as (list: TaskList, ...a: unknown[]) => TaskList;
      commit((prev) => prev.map((l) => (l.id === listId ? fn(l, ...(args as unknown[])) : l)));
      void track([listId], api.applyTaskOp(listId, op, args).then((l) => [l]));
    },
    [commit, track],
  );

  const createList = useCallback(
    (name: string) => {
      const list = parseList('', { id: newId(), name });
      commit((prev) => [...prev, list]);
      void track([list.id], api.createTaskList(name, list.id).then((l) => [l]));
      return list.id;
    },
    [commit, track],
  );

  const renameList = useCallback(
    (id: string, name: string) => {
      commit((prev) => prev.map((l) => (l.id === id ? { ...l, name } : l)));
      void track([id], api.renameTaskList(id, name).then((l) => [l]));
    },
    [commit, track],
  );

  const deleteList = useCallback(
    async (id: string) => {
      commit((prev) => prev.filter((l) => l.id !== id));
      await api.deleteTaskList(id).catch(() => reload());
    },
    [commit, reload],
  );

  const moveToList = useCallback(
    (fromId: string, toId: string, taskId: string) => {
      const from = listsRef.current.find((l) => l.id === fromId);
      const to = listsRef.current.find((l) => l.id === toId);
      if (!from || !to || fromId === toId) return;
      const res = moveBetween(from, to, taskId);
      commit((prev) => prev.map((l) => (l.id === fromId ? res.from : l.id === toId ? res.to : l)));
      void track([fromId, toId], api.moveTaskToList(fromId, toId, taskId));
    },
    [commit, track],
  );

  return { lists, loaded, reload, apply, createList, renameList, deleteList, moveToList };
}

export type TasksApi = ReturnType<typeof useTasks>;
