const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeTheme } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { NoteStore, DAILY_DIR } = require('./store.cjs');
const { TaskStore } = require('./tasks.cjs');

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const DEFAULT_SETTINGS = {
  notesDir: path.join(app.getPath('documents'), 'MD Notes'),
  font: 'IBM Plex Sans',
  fontSize: 16,
  lineWidth: 720,
  theme: 'system',
  sort: 'updated',
};

let settings = { ...DEFAULT_SETTINGS };
let store = null;
let tasks = null;
let tasksModel = null;
let watchers = [];
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

async function openStore(dir) {
  store = new NoteStore(dir);
  const firstRun = !fs.existsSync(dir);
  await store.ensureDir();
  if (firstRun) await seedWelcomeNote();

  // Task lists are Markdown files in a Tasks folder next to the notes.
  tasks = new TaskStore(path.join(dir, 'Tasks'), path.join(dir, '.trash', 'Tasks'), tasksModel);
  const seedList = !(await tasks.exists());
  await tasks.load();
  if (seedList) await seedTasks();
  watchFolders();
}

async function seedTasks() {
  const due = new Date();
  due.setDate(due.getDate() + 1);
  const tomorrow = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  await tasks.createList(
    'My Tasks',
    null,
    [
      '- [ ] Click a task to add details, tags and a due date #getting-started',
      '- [ ] Press Enter to add the next task, Tab to make it a subtask',
      '- [ ] Drag tasks to reorder them, or onto another list in the sidebar',
      `- [ ] Check the Today view for tasks that are due 📅 ${tomorrow}`,
      '',
    ].join('\n'),
  );
}

async function seedWelcomeNote() {
  await store.create({
    title: 'Welcome to MD Notes',
    tags: ['getting-started'],
    body: [
      'Everything you write is saved as a plain **Markdown** file on your Mac.',
      '',
      '## Shortcuts',
      '',
      '- `⌘N` new note (or task, in Tasks)',
      '- `⌘1` notes, `⌘2` today\'s tasks',
      '- `⌘F` search notes',
      '- `⌘E` toggle preview',
      '- `⌘,` settings',
      '',
      '## Tags',
      '',
      'Add tags under the title. Click a tag in the sidebar to filter notes, or right-click it to change its color.',
      '',
      '- [x] Write your first note',
      '- [ ] Pick your favorite font in Settings',
      '',
    ].join('\n'),
  });
  await store.setTagColor('getting-started', 'purple');
}

// Tell the renderer when files change outside the app (e.g. edited in another
// editor or synced by Google Drive), ignoring the writes we made ourselves.
function watchFolders() {
  for (const w of watchers) w.close();
  watchers = [];
  // `prefix` turns a filename into the owner's id (e.g. "Daily Notes/").
  const watch = (dir, owner, onChange, prefix = '') => {
    let timer = null;
    try {
      watchers.push(
        fs.watch(dir, (_event, filename) => {
          if (!filename || !/\.md$/i.test(filename) || filename.startsWith('.') || owner.isOwnWrite(prefix + filename)) return;
          clearTimeout(timer);
          timer = setTimeout(onChange, 300);
        }),
      );
    } catch {
      // Watching is best effort; the app still works without it.
    }
  };
  watch(store.dir, store, () => mainWindow?.webContents.send('notes:changed'));
  watch(path.join(store.dir, DAILY_DIR), store, () => mainWindow?.webContents.send('notes:changed'), `${DAILY_DIR}/`);
  watch(tasks.dir, tasks, async () => {
    if (await tasks.serialize(() => tasks.load())) mainWindow?.webContents.send('tasks:changed');
  });
}

// Painted before the page loads, so it should match the theme's background.
function windowBackground() {
  if (settings.theme === 'sepia') return '#fbf7f0';
  const dark = settings.theme === 'dark' || (settings.theme !== 'light' && nativeTheme.shouldUseDarkColors);
  return dark ? '#1e1e1f' : '#ffffff';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    title: 'MD Notes',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    backgroundColor: windowBackground(),
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

function sendCommand(command) {
  mainWindow?.webContents.send('menu:command', command);
}

function buildMenu() {
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
        { label: 'New Note or Task', accelerator: 'CmdOrCtrl+N', click: () => sendCommand('new') },
        { label: 'Search Notes', accelerator: 'CmdOrCtrl+F', click: () => sendCommand('search') },
        { type: 'separator' },
        { label: 'Toggle Pin', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendCommand('pin') },
        { label: 'Move to Trash', accelerator: 'CmdOrCtrl+Backspace', click: () => sendCommand('trash') },
        { type: 'separator' },
        { label: 'Reveal Notes Folder in Finder', click: () => shell.openPath(store.dir) },
        { role: 'close' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Notes', accelerator: 'CmdOrCtrl+1', click: () => sendCommand('show-notes') },
        { label: 'Today', accelerator: 'CmdOrCtrl+2', click: () => sendCommand('show-today') },
        { type: 'separator' },
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

function registerIpc() {
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', async (_e, patch) => {
    const allowed = ['font', 'fontSize', 'lineWidth', 'theme', 'sort'];
    for (const key of allowed) if (key in patch) settings[key] = patch[key];
    await saveSettings();
    return settings;
  });
  ipcMain.handle('settings:chooseFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose notes folder',
      defaultPath: settings.notesDir,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return settings;
    settings.notesDir = result.filePaths[0];
    await saveSettings();
    await openStore(settings.notesDir);
    return settings;
  });
  ipcMain.handle('folder:reveal', () => shell.openPath(store.dir));

  ipcMain.handle('notes:list', () => store.list());
  ipcMain.handle('notes:create', (_e, input) => store.create(input));
  ipcMain.handle('notes:save', (_e, note) => store.save(note));
  ipcMain.handle('notes:trash', (_e, id) => store.trash(id));

  ipcMain.handle('tags:colors', () => store.getTagColors());
  ipcMain.handle('tags:setColor', (_e, tag, color) => store.setTagColor(tag, color));
  ipcMain.handle('tags:rename', async (_e, from, to) => {
    await store.renameTag(from, to);
    await tasks.renameTag(from, to);
  });

  ipcMain.handle('tasks:all', () => tasks.all());
  ipcMain.handle('tasks:createList', (_e, name, id) => tasks.createList(name, id));
  ipcMain.handle('tasks:renameList', (_e, id, name) => tasks.renameList(id, name));
  ipcMain.handle('tasks:deleteList', (_e, id) => tasks.deleteList(id));
  ipcMain.handle('tasks:apply', (_e, id, op, args) => tasks.apply(id, op, Array.isArray(args) ? args : []));
  ipcMain.handle('tasks:moveToList', (_e, fromId, toId, taskId) => tasks.moveToList(fromId, toId, taskId));
}

// MDNOTES_SMOKE_TEST=1 launches the packaged app, checks that notes and task
// lists render, prints SMOKE_OK or SMOKE_FAIL, and quits. Used by CI.
const smokeTest = Boolean(process.env.MDNOTES_SMOKE_TEST);

async function runSmokeTest() {
  const wc = mainWindow.webContents;
  if (wc.isLoading()) await new Promise((resolve) => wc.once('did-finish-load', resolve));
  const ok = await wc.executeJavaScript(`new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const notes = document.querySelectorAll('.note-item').length;
      const lists = document.querySelectorAll('.lists-nav .nav-item').length;
      if (notes > 0 && lists > 1) resolve(true);
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
    tasksModel = await import('../shared/tasks.mjs');
    await loadSettings();
    if (smokeTest) settings.notesDir = path.join(app.getPath('temp'), `mdnotes-smoke-${process.pid}`);
    await openStore(settings.notesDir);
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
    else dialog.showErrorBox('MD Notes could not start', String(err?.stack || err));
    app.exit(1);
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
