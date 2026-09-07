const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const isDev = !app.isPackaged;

let mainWindow;
let assistantWindow = null;
let collectorProcess = null;
let backendProcess = null;

// Spawn a supervised Node child process that auto-restarts on crash.
function spawnSupervised(label, dir, script, assign) {
  function launch() {
    console.log(`[main] Starting ${label}...`);
    const child = spawn(process.execPath, [script], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assign(child);
    child.stdout.on('data', d => process.stdout.write(`[${label}] ` + d));
    child.stderr.on('data', d => process.stderr.write(`[${label}] ` + d));
    child.on('exit', (code) => {
      console.log(`[main] ${label} exited (code ${code}), restarting in 3s...`);
      assign(null);
      setTimeout(launch, 3000);
    });
  }
  launch();
}

function startCollector() {
  const collectorDir = path.join(__dirname, '../collectors');
  spawnSupervised('collector', collectorDir, path.join(collectorDir, 'index.js'),
    (p) => { collectorProcess = p; });
}

// In dev, `npm run dev` starts the backend via concurrently. In a packaged
// build nothing else does — so spawn it here or the REST API + WebSocket
// (and therefore the whole dashboard) would be dead.
function startBackend() {
  const backendDir = path.join(__dirname, '../backend');
  spawnSupervised('backend', backendDir, path.join(backendDir, 'server.js'),
    (p) => { backendProcess = p; });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 780,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0a0a0f',
    frame: true,
    titleBarStyle: 'default',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const startUrl = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../frontend/dist/index.html')}`;

  mainWindow.loadURL(startUrl);

  // DevTools available on demand with F12 — don't auto-open


  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Assistant Mode — a small always-on-top window for spoken status questions.
// Same bundle on the /assistant route, so it shares the API client, theme and
// socket rather than being a second app.
function openAssistantWindow() {
  // Singleton: a second window would mean two speech queues talking over each
  // other, and there is only one voice.
  if (assistantWindow && !assistantWindow.isDestroyed()) {
    assistantWindow.show();
    assistantWindow.focus();
    return;
  }

  assistantWindow = new BrowserWindow({
    width: 440,
    height: 560,
    minWidth: 360,
    minHeight: 420,
    // frame:false needs the renderer to supply its own drag region and close
    // button — see Assistant.tsx.
    frame: false,
    backgroundColor: '#0a0a0f',
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const base = isDev
    ? 'http://localhost:5173'
    : `file://${path.join(__dirname, '../frontend/dist/index.html')}`;
  // A query param, not a route. The app uses BrowserRouter, so a /assistant
  // path resolves against the filesystem under file:// and 404s in the packaged
  // build. ?view=assistant is read before the router mounts and works for both
  // the dev server and file://.
  assistantWindow.loadURL(`${base}?view=assistant`);

  assistantWindow.on('closed', () => {
    assistantWindow = null;
  });
}

app.whenReady().then(() => {
  // Dev runs the backend AND the collector via `concurrently` — spawning our
  // own would mean two collectors polling and writing the same metrics files,
  // which shows up as values flickering between the two writers' views.
  if (!isDev) {
    startBackend();
    startCollector();
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  for (const proc of [collectorProcess, backendProcess]) {
    if (proc) {
      proc.removeAllListeners('exit');
      proc.kill();
    }
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('open-assistant', async () => {
  openAssistantWindow();
  return true;
});

// The assistant window is frameless, so it has no system close button and has
// to ask for one.
ipcMain.handle('close-assistant', async () => {
  if (assistantWindow && !assistantWindow.isDestroyed()) assistantWindow.close();
  return true;
});

// IPC handlers for backend communication
ipcMain.handle('get-metrics', async () => {
  // This will be handled by the backend API
  return {};
});

ipcMain.handle('get-system-info', async () => {
  const os = require('os');
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem()
  };
});
