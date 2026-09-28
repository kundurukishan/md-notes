const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('notesApi', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseFolder: () => ipcRenderer.invoke('settings:chooseFolder'),
  revealFolder: () => ipcRenderer.invoke('folder:reveal'),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  createNote: (input) => ipcRenderer.invoke('notes:create', input),
  saveNote: (note) => ipcRenderer.invoke('notes:save', note),
  trashNote: (id) => ipcRenderer.invoke('notes:trash', id),
  getTagColors: () => ipcRenderer.invoke('tags:colors'),
  setTagColor: (tag, color) => ipcRenderer.invoke('tags:setColor', tag, color),
  renameTag: (from, to) => ipcRenderer.invoke('tags:rename', from, to),
  listTaskLists: () => ipcRenderer.invoke('tasks:all'),
  createTaskList: (name, id) => ipcRenderer.invoke('tasks:createList', name, id),
  renameTaskList: (id, name) => ipcRenderer.invoke('tasks:renameList', id, name),
  deleteTaskList: (id) => ipcRenderer.invoke('tasks:deleteList', id),
  applyTaskOp: (id, op, args) => ipcRenderer.invoke('tasks:apply', id, op, args),
  moveTaskToList: (fromId, toId, taskId) => ipcRenderer.invoke('tasks:moveToList', fromId, toId, taskId),
  onTasksChanged: (callback) => subscribe('tasks:changed', callback),
  onNotesChanged: (callback) => subscribe('notes:changed', callback),
  onMenuCommand: (callback) => subscribe('menu:command', callback),
});
