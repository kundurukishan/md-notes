const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('viewerApi', {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  openFolder: (dir) => ipcRenderer.invoke('folder:open', dir),
  revealFolder: () => ipcRenderer.invoke('folder:reveal'),
  revealFile: (id) => ipcRenderer.invoke('file:reveal', id),
  listFiles: () => ipcRenderer.invoke('files:list'),
  createNote: (input) => ipcRenderer.invoke('files:create', input),
  createFolder: (parent, name) => ipcRenderer.invoke('files:createFolder', parent, name),
  saveNote: (note) => ipcRenderer.invoke('files:save', note),
  trashNote: (id) => ipcRenderer.invoke('files:trash', id),
  getTagColors: () => ipcRenderer.invoke('tags:colors'),
  setTagColor: (tag, color) => ipcRenderer.invoke('tags:setColor', tag, color),
  onFilesChanged: (callback) => subscribe('files:changed', callback),
  onMenuCommand: (callback) => subscribe('menu:command', callback),
});
