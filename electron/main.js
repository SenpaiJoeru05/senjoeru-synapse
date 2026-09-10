const {
  app, BrowserWindow, ipcMain, globalShortcut, screen,
} = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const windowState = require('./assistant-window-state');
const isDev = !app.isPackaged;

/**
 * Hotkey to summon the Assistant window from anywhere.
 *
 * A global shortcut rather than a wake word, which is the trade this project
 * already reasoned through: always-on listening needs Porcupine or equivalent,
 * and a keypress delivers most of the benefit for none of the cost — no model,
 * no permanently open microphone, and no false triggers from a meeting.
 *
 * Ctrl+Alt+J is chosen for being unclaimed. Ctrl+Shift+J would have been the
 * obvious mnemonic and is DevTools in every Chromium app, including this one;
 * registering it globally would take it away everywhere.
 */
const HOTKEY = process.env.SYNAPSE_ASSISTANT_HOTKEY || 'Control+Alt+J';

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
    // Reopened where it was last left, when that is still a place a display
    // can show. See assistant-window-state.js.
    ...windowState.initialBounds(screen),
    minWidth: windowState.MIN.width,
    minHeight: windowState.MIN.height,
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

  // A crashed renderer just goes black, with nothing in the window to say why.
  // Speech loads a ~24MB WASM runtime and touches WebGPU, both of which can
  // take the process down, so say so out loud in the terminal.
  assistantWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[assistant] renderer gone: reason=${details.reason} exitCode=${details.exitCode}`);
  });
  assistantWindow.webContents.on('unresponsive', () => {
    console.error('[assistant] renderer unresponsive');
  });
  assistantWindow.webContents.on('console-message', (_e, level, message) => {
    // level 3 is error. Surfacing only errors keeps the dev output readable.
    if (level >= 3) console.error(`[assistant:console] ${message}`);
  });

  windowState.track(assistantWindow);

  assistantWindow.on('closed', () => {
    assistantWindow = null;
  });
}

/**
 * What the hotkey does — summon, or dismiss if it is already in front.
 *
 * A toggle rather than a plain show, because the window is alwaysOnTop: with
 * show-only, the key that conjures it gives you no way to put it away again
 * without reaching for the mouse, which defeats the point of a hotkey.
 *
 * Hidden rather than closed, so the conversation so far survives. Closing
 * destroys the renderer and with it the history that makes "mark that one
 * complete" mean anything.
 */
function toggleAssistantWindow() {
  if (assistantWindow && !assistantWindow.isDestroyed()) {
    if (assistantWindow.isVisible() && assistantWindow.isFocused()) {
      assistantWindow.hide();
      return;
    }
    assistantWindow.show();
    assistantWindow.focus();
    return;
  }
  openAssistantWindow();
}

/**
 * Register the hotkey, and say so either way.
 *
 * `register` returns false when another application already owns the
 * combination, and it does so silently — without this line the key would
 * simply do nothing and look like a bug in this app rather than a collision.
 */
function registerHotkey() {
  let ok = false;
  try {
    ok = globalShortcut.register(HOTKEY, toggleAssistantWindow);
  } catch (err) {
    console.error(`[main] hotkey ${HOTKEY} is not a valid accelerator: ${err.message}`);
    return;
  }
  if (ok) {
    console.log(`[main] Assistant hotkey: ${HOTKEY}`);
  } else {
    console.error(
      `[main] hotkey ${HOTKEY} is already taken by another application. `
      + 'Set SYNAPSE_ASSISTANT_HOTKEY to something else.',
    );
  }
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
  registerHotkey();

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

// Voice lives in the main process on purpose. The renderer attempt — Whisper
// via onnxruntime WASM — faulted Chromium with an access violation and took
// the window black with no diagnostics. A subprocess fails with an exit code.
const tts = require('./tts');
const stt = require('./stt');
const whisper = require('./whisper');
const claude = require('./claude');
const claudeSessions = require('./claude-sessions');

/*
 * Release the voice subprocesses on the way out.
 *
 * `window-all-closed` above cannot do this — it is registered before these
 * requires — and neither process is a child that dies with the window: the
 * parked Piper holds a 60MB model resident, and whisper-stream holds the
 * MICROPHONE, which is the one that matters. Leaving it running means the mic
 * indicator stays on after the app is gone.
 */
app.on('before-quit', () => {
  // A global shortcut outlives the window but not the process; unregistering
  // is still right so a crash-and-restart cycle cannot leave a stale claim.
  try { globalShortcut.unregisterAll(); } catch { /* quitting anyway */ }
  // The bounds writer is debounced, so a move immediately before quitting
  // would otherwise never reach disk.
  try { windowState.flush(assistantWindow); } catch { /* quitting anyway */ }
  try { tts.shutdown(); } catch { /* quitting anyway */ }
  try { whisper.cancelListen(); } catch { /* quitting anyway */ }
  try { whisper.cancel(); } catch { /* quitting anyway */ }
  try { stt.cancel(); } catch { /* quitting anyway */ }
});

// Breadcrumbs for a renderer that dies without a stack. A crashed renderer
// takes its console with it, but an IPC message already received by the main
// process survives — so the last line printed is the step it died on.
ipcMain.on('trace', (_e, step) => {
  console.log(`[assistant:trace] ${step}`);
});

ipcMain.handle('voice-info', async () => ({
  tts: tts.describe(),
  // Windows' recogniser needs no install; presence was verified at build time.
  // whisper when installed, Windows as the fallback — the UI reports which.
  stt: whisper.available()
    ? whisper.describe()
    : { available: process.platform === 'win32', engine: 'Windows System.Speech', reason: null },
  claude: claude.describe(),
}));

// Assistant Mode's answering brain. One question per invocation, triggered by
// the user — the same thing as typing `claude -p` in a terminal.
ipcMain.handle('claude-ask', async (_e, question) => claude.ask(question));

ipcMain.handle('claude-cancel', async () => { claude.cancel(); return true; });

// What gets asked, and which brain answered. A question that keeps falling
// through to the ~13s fallback is a candidate for being made instant, and this
// is the only honest way to find out which ones those are.
const questions = require('./question-log');

ipcMain.on('assistant-log', (_e, entry) => {
  try {
    questions.record(entry?.question, entry?.route, entry?.ms, entry?.intent ?? null);
  } catch (err) {
    console.error(`[questions] ${err.message}`);
  }
});

ipcMain.handle('assistant-insights', async () => questions.insights());

// Returns a WAV buffer. Sent whole rather than streamed: Piper renders a
// sentence in well under a second, so chunking would add complexity for no
// perceptible gain.
ipcMain.handle('voice-speak', async (_e, text) => {
  const wav = await tts.speak(text);
  return wav ? wav.buffer.slice(wav.byteOffset, wav.byteOffset + wav.byteLength) : null;
});

ipcMain.handle('voice-stop-speaking', async () => { tts.cancel(); return true; });

ipcMain.handle('voice-set-voice', async (_e, id) => {
  tts.setVoice(id);
  return tts.describe();
});

ipcMain.handle('voice-listen', async () => stt.listen({ timeoutSeconds: 12 }));

ipcMain.handle('voice-cancel-listen', async () => { stt.cancel(); return true; });

/**
 * Preferred recogniser. whisper.cpp got 7 of 7 on the clips Windows
 * System.Speech got 2 of 7 on, so the renderer records audio and sends it
 * here; System.Speech stays as the fallback when whisper is not installed.
 */
ipcMain.handle('whisper-transcribe', async (_e, wav) => {
  const text = await whisper.transcribe(Buffer.from(wav));
  return { text, confidence: 1, grammar: 'whisper', alternate: '' };
});

ipcMain.handle('whisper-cancel', async () => { whisper.cancel(); return true; });

// Capture lives here too, not in the renderer. Two renderer capture designs
// crashed Chromium on rate conversion; whisper-stream opens the device at
// 16kHz natively through SDL2, so nothing resamples.
ipcMain.handle('listen-start', async () => whisper.startListen());

ipcMain.handle('listen-stop', async () => {
  const text = await whisper.stopListen();
  return { text, confidence: 1, grammar: 'whisper-stream', alternate: '' };
});

ipcMain.handle('listen-cancel', async () => { whisper.cancelListen(); return true; });

/**
 * A Chat-tab turn on the Claude Code CLI.
 *
 * Tool activity is pushed on a separate channel rather than returned with the
 * answer: `invoke` resolves once, and the point of streaming is that you see
 * the Read and the Edit while they happen instead of after. The renderer
 * correlates events by sessionId, so two Chat windows cannot cross wires.
 */
ipcMain.handle('claude-chat', async (event, { sessionId, agent, text }) => {
  const send = (payload) => {
    // The window can close mid-turn; a destroyed webContents throws on send.
    if (!event.sender.isDestroyed()) {
      event.sender.send('claude-chat-event', { sessionId, ...payload });
    }
  };
  try {
    return await claude.chat({ sessionId, agent, text }, send);
  } catch (err) {
    // Rejecting an invoke loses the message shape the renderer needs to fall
    // back cleanly, so failure is data rather than an exception.
    return { text: '', tools: [], error: err.message };
  }
});

/**
 * The CLI's own conversation store, read-only.
 *
 * Rooted at the repo rather than a caller-supplied path, so the renderer
 * cannot ask for another project's transcripts.
 */
const PROJECT_DIR = path.join(__dirname, '..');

ipcMain.handle('claude-sessions', async () => claudeSessions.list(PROJECT_DIR));

ipcMain.handle('claude-session-read', async (_e, id) => {
  try {
    return claudeSessions.read(PROJECT_DIR, id);
  } catch (err) {
    return { turns: [], error: err.message };
  }
});

ipcMain.handle('claude-chat-cancel', async (_e, sessionId) => claude.cancelChat(sessionId));

ipcMain.handle('claude-chat-forget', async (_e, sessionId) => {
  claude.forget(sessionId);
  return true;
});

ipcMain.handle('open-assistant', async () => {
  openAssistantWindow();
  // Park a Piper process now. It loads a 60MB model at startup, and paying
  // that on the first answer was ~800ms of silence before Joeru spoke. Done
  // here rather than at app start so someone who never opens this window never
  // carries the process.
  tts.warm();
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
