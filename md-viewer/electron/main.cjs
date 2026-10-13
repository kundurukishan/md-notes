const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { FolderStore } = require('./store.cjs');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  folder: null, // the open folder; null until one is chosen
  recentFolders: [],
  font: 'IBM Plex Sans',
  fontSize: 16,
  lineWidth: 720,
  theme: 'system',
  // Tag colors picked in MD Viewer, per folder: { [folder]: { [tag]: color } }.
  tagColors: {},
};
const MAX_RECENT = 8;

let settings = { ...DEFAULT_SETTINGS };
let store = null;
let watcher = null;
let mainWindow = null;

async function loadSettings() {
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(await fsp.readFile(SETTINGS_FILE, 'utf8')) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

async function saveSettings() {
  await fsp.mkdir(path.dirname(SETTINGS_FILE), { recursive: true });
  await fsp.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
}

async function openFolder(dir) {
  if (!dir) {
    closeStore();
    settings.folder = null;
    await saveSettings();
    buildMenu();
    return;
  }
  // The folder must exist already (a removed drive or deleted folder is not
  // recreated by accident).
  if (!(await fsp.stat(dir).catch(() => null))?.isDirectory()) throw new Error(`Not a folder: ${dir}`);
  closeStore();
  store = new FolderStore(dir);
  settings.folder = dir;
  settings.recentFolders = [dir, ...settings.recentFolders.filter((d) => d !== dir)].slice(0, MAX_RECENT);
  await saveSettings();
  watchFolder();
  buildMenu();
}

function closeStore() {
  watcher?.close();
  watcher = null;
  store = null;
}

// Tell the renderer when files change outside the app (another editor, a
// sync client), ignoring the writes we made ourselves.
function watchFolder() {
  let timer = null;
  try {
    watcher = fs.watch(store.dir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const id = String(filename).split(path.sep).join('/');
      if (id.split('/').some((p) => p.startsWith('.')) || store.isOwnWrite(id)) return;
      clearTimeout(timer);
      timer = setTimeout(() => mainWindow?.webContents.send('files:changed'), 300);
    });
  } catch {
    // Watching is best effort; the app still works without it.
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 700,
    minHeight: 480,
    title: 'MD Viewer',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Open links from notes in the default browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^(https?|mailto):/i.test(url)) shell.openExternal(url);
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendCommand(command, ...args) {
  mainWindow?.webContents.send('menu:command', command, ...args);
}

async function chooseFolder() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open folder',
    defaultPath: settings.folder || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return false;
  await openFolder(result.filePaths[0]);
  return true;
}

function buildMenu() {
  const recent = settings.recentFolders.filter((d) => d !== settings.folder);
  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => sendCommand('settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Note', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new') },
        { label: 'New Folder', accelerator: 'CmdOrCtrl+Shift+N', click: () => sendCommand('new-folder') },
        { type: 'separator' },
        {
          label: 'Open Folder…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (await chooseFolder()) sendCommand('folder-changed');
          },
        },
        {
          label: 'Open Recent',
          submenu: [
            ...recent.map((dir) => ({
              label: dir.replace(app.getPath('home'), '~'),
              click: async () => {
                await openFolder(dir);
                sendCommand('folder-changed');
              },
            })),
            ...(recent.length ? [{ type: 'separator' }] : []),
            {
              label: 'Clear Menu',
              enabled: recent.length > 0,
              click: async () => {
                settings.recentFolders = settings.folder ? [settings.folder] : [];
                await saveSettings();
                buildMenu();
              },
            },
          ],
        },
        { type: 'separator' },
        { label: 'Search', accelerator: 'CmdOrCtrl+F', click: () => sendCommand('search') },
        { type: 'separator' },
        { label: 'Move to Trash', accelerator: 'CmdOrCtrl+Backspace', click: () => sendCommand('trash') },
        { type: 'separator' },
        { label: 'Reveal Folder in Finder', enabled: Boolean(store), click: () => store && shell.openPath(store.dir) },
        { label: 'Reveal Note in Finder', click: () => sendCommand('reveal') },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Text Color…', accelerator: 'CmdOrCtrl+Shift+C', click: () => sendCommand('format') },
        { label: 'Toggle Preview', accelerator: 'CmdOrCtrl+E', click: () => sendCommand('preview') },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+\\', click: () => sendCommand('sidebar') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const needStore = () => {
  if (!store) throw new Error('No folder is open');
  return store;
};

function registerIpc() {
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', async (_e, patch) => {
    const allowed = ['font', 'fontSize', 'lineWidth', 'theme'];
    for (const key of allowed) if (key in patch) settings[key] = patch[key];
    await saveSettings();
    return settings;
  });
  ipcMain.handle('folder:choose', async () => {
    await chooseFolder();
    return settings;
  });
  ipcMain.handle('folder:open', async (_e, dir) => {
    if (dir !== null && typeof dir !== 'string') throw new Error('Invalid folder');
    await openFolder(dir);
    return settings;
  });
  ipcMain.handle('folder:reveal', () => shell.openPath(needStore().dir));
  ipcMain.handle('file:reveal', (_e, id) => shell.showItemInFolder(needStore().resolve(id)));

  ipcMain.handle('files:list', () => (store ? store.list() : { files: [], dirs: [] }));
  ipcMain.handle('files:create', (_e, input) => needStore().create(input));
  ipcMain.handle('files:createFolder', (_e, parent, name) => needStore().createFolder(parent, name));
  ipcMain.handle('files:save', (_e, note) => needStore().save(note));
  ipcMain.handle('files:trash', async (_e, id) => {
    const s = needStore();
    s.markWrite(id);
    await shell.trashItem(s.resolve(id));
  });

  // Colors come from the folder's .mdnotes/tags.json (written by MD Notes)
  // with the ones picked here on top. Picks are kept in the app's settings,
  // so nothing is written into the folder.
  ipcMain.handle('tags:colors', async () => ({ ...(store ? await store.getTagColors() : {}), ...(settings.tagColors[settings.folder] || {}) }));
  ipcMain.handle('tags:setColor', async (_e, tag, color) => {
    const s = needStore();
    settings.tagColors[s.dir] = { ...(settings.tagColors[s.dir] || {}), [tag]: color };
    await saveSettings();
    return { ...(await s.getTagColors()), ...settings.tagColors[s.dir] };
  });
}

// MDVIEWER_SMOKE_TEST=1 launches the packaged app on a temporary folder with a
// note in it, checks that the tree and the editor render, prints SMOKE_OK or
// SMOKE_FAIL, and quits. Used by CI.
const smokeTest = Boolean(process.env.MDVIEWER_SMOKE_TEST);

async function runSmokeTest() {
  const wc = mainWindow.webContents;
  if (wc.isLoading()) await new Promise((resolve) => wc.once('did-finish-load', resolve));
  const ok = await wc.executeJavaScript(`new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const files = document.querySelectorAll('.tree-item.file').length;
      const editor = document.querySelectorAll('.editor .cm-editor').length;
      if (files > 0 && editor > 0) resolve(true);
      else if (Date.now() - started > 15000) resolve(false);
      else setTimeout(check, 200);
    };
    check();
  })`);
  console.log(ok ? 'SMOKE_OK' : 'SMOKE_FAIL');
  app.exit(ok ? 0 : 1);
}

app
  .whenReady()
  .then(async () => {
    await loadSettings();
    if (smokeTest) {
      const dir = path.join(app.getPath('temp'), `mdviewer-smoke-${process.pid}`);
      await fsp.mkdir(path.join(dir, 'Work'), { recursive: true });
      await fsp.writeFile(path.join(dir, 'Work', 'Plan.md'), '# Plan\n\nHello #work\n');
      settings.folder = dir;
    }
    if (settings.folder) {
      try {
        await openFolder(settings.folder);
      } catch {
        // The folder is gone (unmounted drive, deleted): start without one.
        settings.folder = null;
      }
    }
    registerIpc();
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
    if (smokeTest) await runSmokeTest();
  })
  .catch((err) => {
    console.error(err);
    if (smokeTest) console.log('SMOKE_FAIL');
    else dialog.showErrorBox('MD Viewer could not start', String(err?.stack || err));
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
