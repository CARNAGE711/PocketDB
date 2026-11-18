/**
 * PocketDB — Electron main process.
 *
 * Responsibilities:
 *  - Create the native desktop window (the "shell").
 *  - Wire the secure preload bridge (contextIsolation ON, nodeIntegration OFF).
 *  - Boot the local file-based storage engine inside this Node process,
 *    entirely offline — all data lives on the user's disk.
 */
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { registerIpc } = require('./ipc.cjs');
const { setupUpdater } = require('./updater.cjs');

const isDev = process.env.NODE_ENV === 'development';

let mainWindow = null;

/** Resolve where PocketDB persists its data files on disk. */
function resolveDataDir() {
  // POCKETDB_DATA_DIR lets power users / tests redirect the storage root.
  return (
    process.env.POCKETDB_DATA_DIR ||
    path.join(app.getPath('userData'), 'pocketdb-data')
  );
}

function createWindow() {
  // Window/taskbar icon: vendored file in dev, resources/ copy when packaged.
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(__dirname, '..', 'build', 'icon.ico');

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0b0f14',
    title: 'PocketDB Studio',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      // Secure bridge: the renderer never touches Node/fs directly.
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  if (isDev) {
    // Vite dev server (started via `npm run dev`).
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production: load the built React bundle from disk (fully offline).
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Minimal native menu with editing/navigation roles. */
function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Reload Studio', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => updaterApi.check(),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Auto-updater pushes status to the renderer via 'update:status'.
const updaterApi = setupUpdater({
  send: (status) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
  },
});

app.whenReady().then(() => {
  // Boot the storage engine + IPC handlers against the resolved data dir.
  registerIpc(resolveDataDir());
  buildMenu();
  createWindow();

  app.on('activate', () => {
    // macOS: re-create the window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
