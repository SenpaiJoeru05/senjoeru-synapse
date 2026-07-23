const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const chokidar = require('chokidar');
const cron = require('node-cron');
const http = require('http');
const { WebSocketServer } = require('ws');
const { buildLaidOutGraph } = require('./lib/graph-builder');
const networkRouter = require('./routes/network');
const { openDatabase } = require('./lib/db');
const { TaskRepository } = require('./repositories/task-repository');
const { TaskSyncService } = require('./services/task-sync-service');
const { createTasksRouter, mapTask } = require('./routes/tasks');
const { WorkspaceRepository } = require('./repositories/workspace-repository');
const { ProjectRepository } = require('./repositories/project-repository');
const { RepositoryRepository } = require('./repositories/repository-repository');
const { SettingsRepository } = require('./repositories/settings-repository');
const { WorkspaceService } = require('./services/workspace-service');
const { ProjectService } = require('./services/project-service');
const { RepositoryService } = require('./services/repository-service');
const { SettingsService } = require('./services/settings-service');
const {
  createWorkspacesRouter, createProjectsRouter, createRepositoriesRouter,
} = require('./routes/core-entities');
const { AnalyticsRepository } = require('./repositories/analytics-repository');
const { AnalyticsService } = require('./services/analytics-service');
const {
  createAnalyticsRouter, createExecutionHistoryRouter, mapExec,
} = require('./routes/analytics');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Paths
const METRICS_DIR = path.join(__dirname, '../metrics');
const CLAUDE_DIR = 'C:\\Users\\joelr\\.claude';
const CLAUDE_TASKS_FILE = path.join(CLAUDE_DIR, 'tasks.json');

// Ensure metrics directory exists
fs.ensureDirSync(METRICS_DIR);

// Initialize metrics files
const initializeMetrics = () => {
  const metricsFiles = [
    'agents.json',
    'tasks.json',
    'tokens.json',
    'costs.json',
    'tests.json',
    'git.json',
    'sessions.json'
  ];

  metricsFiles.forEach(file => {
    const filePath = path.join(METRICS_DIR, file);
    if (!fs.existsSync(filePath)) {
      fs.writeJsonSync(filePath, { lastUpdated: new Date().toISOString(), data: [] });
    }
  });
};

initializeMetrics();

// ─── SQLite application data layer (PHASE-1) ───────────────────────────────
// SQLite is the PERMANENT source of truth for Synapse-owned data. Tasks are
// imported one-way from Claude's `.claude/tasks.json` (see TaskSyncService).
// Failure here must never take down monitoring — degrade gracefully.
let taskRepo = null;
let taskSync = null;
let settingsService = null;
let workspaceService = null;
let projectService = null;
let repositoryService = null;
let analyticsRepo = null;
let analyticsService = null;
try {
  const db = openDatabase();

  // Tasks (imported one-way from Claude's tasks.json).
  taskRepo = new TaskRepository(db);
  taskSync = new TaskSyncService(db, CLAUDE_TASKS_FILE);
  const summary = taskSync.sync(); // initial import on startup

  // Historical analytics + execution history.
  analyticsRepo = new AnalyticsRepository(db);
  analyticsService = new AnalyticsService(analyticsRepo, METRICS_DIR);

  // Relational core + settings.
  workspaceService = new WorkspaceService(new WorkspaceRepository(db));
  projectService = new ProjectService(new ProjectRepository(db));
  repositoryService = new RepositoryService(new RepositoryRepository(db));
  settingsService = new SettingsService(
    new SettingsRepository(db),
    path.join(METRICS_DIR, 'config.json')
  );

  // Seed once: a default workspace + settings imported from config.json.
  const ws = workspaceService.ensureDefault();
  const seeded = settingsService.seedFromConfigIfEmpty();

  // Initial history snapshot from whatever metrics already exist on disk.
  const snap = analyticsService.snapshotAll(taskRepo);
  console.log(
    `[db] SQLite ready; task sync ${JSON.stringify(summary)}; ` +
    `workspace="${ws.name}"; settings ${seeded ? 'seeded from config.json' : 'loaded'}; ` +
    `analytics ${JSON.stringify(snap)}`
  );
} catch (err) {
  console.error('[db] SQLite unavailable — persistence disabled:', err.message);
}

// Snapshot runtime metrics into permanent history. Guarded so a snapshot error
// never breaks the collector ping or startup.
function snapshotAnalyticsSafe(trigger) {
  if (!analyticsService) return;
  try {
    const snap = analyticsService.snapshotAll(taskRepo);
    if (snap.commitsAdded || snap.completionsAdded) {
      console.log(`[db] analytics (${trigger}): ${JSON.stringify(snap)}`);
    }
  } catch (err) {
    console.error(`[db] analytics snapshot failed (${trigger}):`, err.message);
  }
}

// Reconcile SQLite from tasks.json. Guarded so a sync error never breaks the
// caller (startup, the collector ping, or the manual endpoint).
function syncTasksSafe(trigger) {
  if (!taskSync) return;
  try {
    const summary = taskSync.sync();
    if (summary && !summary.skipped && (summary.created || summary.updated)) {
      console.log(`[db] task sync (${trigger}):`, JSON.stringify(summary));
    }
  } catch (err) {
    console.error(`[db] task sync failed (${trigger}):`, err.message);
  }
}

// Agent-network graph (initial paint) — realtime updates come over /ws
app.use('/api/agent-network', networkRouter);

// SQLite-backed views (only mounted when the DB opened successfully).
if (taskRepo) {
  app.use('/api/tasks', createTasksRouter(taskRepo));
}
if (workspaceService) app.use('/api/workspaces', createWorkspacesRouter(workspaceService));
if (projectService) app.use('/api/projects', createProjectsRouter(projectService));
if (repositoryService) app.use('/api/repositories', createRepositoriesRouter(repositoryService));
if (analyticsRepo) {
  app.use('/api/analytics', createAnalyticsRouter(analyticsRepo));
  app.use('/api/execution-history', createExecutionHistoryRouter(analyticsRepo));
}

// API Routes
app.get('/api/metrics/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const filePath = path.join(METRICS_DIR, `${type}.json`);
    
    if (fs.existsSync(filePath)) {
      const data = await fs.readJson(filePath);
      res.json(data);
    } else {
      res.status(404).json({ error: 'Metrics not found' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Read every metrics file, tolerating any that don't exist yet (a missing
// file — e.g. activity.json before the first collector run — must not 500 the
// whole dashboard). Each absent/unreadable file degrades to {}.
const METRIC_FILES = {
  agents: 'agents.json', tasks: 'tasks.json', tokens: 'tokens.json',
  costs: 'costs.json', tests: 'tests.json', git: 'git.json',
  sessions: 'sessions.json', activity: 'activity.json',
};
async function readAllMetrics() {
  const out = {};
  await Promise.all(Object.entries(METRIC_FILES).map(async ([key, file]) => {
    try {
      const p = path.join(METRICS_DIR, file);
      out[key] = (await fs.pathExists(p)) ? await fs.readJson(p) : {};
    } catch (_) {
      out[key] = {};
    }
  }));
  return out;
}

// Point-in-time system/host health. Synchronous stats keep it cheap.
function getSystemHealthData() {
  const os = require('os');
  const cpus = os.cpus();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  let claudeSize = 0;
  try { if (fs.existsSync(CLAUDE_DIR)) claudeSize = fs.statSync(CLAUDE_DIR).size; } catch (_) {}
  return {
    cpu: { cores: cpus.length, model: cpus[0]?.model || 'Unknown' },
    memory: {
      total: totalMemory, used: usedMemory, free: freeMemory,
      usagePercent: ((usedMemory / totalMemory) * 100).toFixed(2),
    },
    claude: { path: CLAUDE_DIR, exists: fs.existsSync(CLAUDE_DIR), size: claudeSize },
    uptime: os.uptime(),
    timestamp: new Date().toISOString(),
  };
}

app.get('/api/metrics', async (req, res) => {
  try {
    res.json(await readAllMetrics());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/metrics/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const filePath = path.join(METRICS_DIR, `${type}.json`);
    const data = {
      ...req.body,
      lastUpdated: new Date().toISOString()
    };
    await fs.writeJson(filePath, data, { spaces: 2 });
    res.json({ success: true, lastUpdated: data.lastUpdated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/claude/info', async (req, res) => {
  try {
    if (fs.existsSync(CLAUDE_DIR)) {
      const stats = await fs.stat(CLAUDE_DIR);
      const directories = ['agents', 'sessions', 'projects', 'history', 'cache', 'debug', 'daemon'];
      const dirInfo = {};
      
      for (const dir of directories) {
        const dirPath = path.join(CLAUDE_DIR, dir);
        if (fs.existsSync(dirPath)) {
          const dirStats = await fs.stat(dirPath);
          dirInfo[dir] = {
            exists: true,
            size: dirStats.size,
            modified: dirStats.mtime
          };
        } else {
          dirInfo[dir] = { exists: false };
        }
      }
      
      res.json({
        exists: true,
        path: CLAUDE_DIR,
        size: stats.size,
        modified: stats.mtime,
        directories: dirInfo
      });
    } else {
      res.json({ exists: false, path: CLAUDE_DIR });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/system/health', async (req, res) => {
  try {
    res.json(getSystemHealthData());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    // SQLite is the source of truth when available.
    if (settingsService) return res.json(settingsService.getAll());

    // Fallback (DB unavailable): read config.json directly, as before.
    const configPath = path.join(METRICS_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      res.json(await fs.readJson(configPath));
    } else {
      res.json({
        claudeDir: CLAUDE_DIR,
        pollInterval: 30,
        monitorClaudeDir: true,
        repositories: [],
        autoRefresh: true,
        notifications: false,
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    // Persist to SQLite (source of truth) and mirror to config.json so the
    // collector keeps reading its operational config unchanged.
    if (settingsService) {
      const saved = settingsService.save(req.body || {});
      return res.json({ success: true, settings: saved });
    }

    // Fallback (DB unavailable): write config.json directly, as before.
    const configPath = path.join(METRICS_DIR, 'config.json');
    const config = { ...req.body, lastUpdated: new Date().toISOString() };
    await fs.writeJson(configPath, config, { spaces: 2 });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/settings/detect-repos', async (req, res) => {
  try {
    const sessionsDir = path.join(CLAUDE_DIR, 'sessions');
    const cwds = new Set();

    if (fs.existsSync(sessionsDir)) {
      const files = await fs.readdir(sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await fs.readJson(path.join(sessionsDir, file));
          if (data.cwd) cwds.add(data.cwd);
        } catch (_) {}
      }
    }

    const detected = [];
    for (const cwd of cwds) {
      // Check if cwd itself is a git repo
      if (fs.existsSync(path.join(cwd, '.git'))) {
        detected.push(cwd);
        continue;
      }
      // Scan immediate subdirectories
      try {
        const entries = await fs.readdir(cwd, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const subPath = path.join(cwd, entry.name);
          if (fs.existsSync(path.join(subPath, '.git'))) {
            detected.push(subPath);
          }
        }
      } catch (_) {}
    }

    // Read current config to exclude already-added repos
    const configPath = path.join(METRICS_DIR, 'config.json');
    let existing = [];
    if (fs.existsSync(configPath)) {
      const config = await fs.readJson(configPath);
      existing = (config.repositories || []).map(r => r.toLowerCase());
    }

    const newRepos = detected.filter(r => !existing.includes(r.toLowerCase()));
    res.json({ detected: detected, newRepos });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Agent-network WebSocket broadcasting ──────────────────────────────
// The collector POSTs /api/internal/graph-refresh after regenerating metrics;
// we debounce, rebuild the graph, and broadcast to all clients — but only when
// the payload actually changed (never spam identical frames).

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

let lastPayloadStr = null;  // stringified {nodes,edges,activity} of last graph broadcast
let lastMetricsStr = null;  // stringified metrics object of last metrics broadcast
let lastDbStr = null;       // stringified SQLite-backed payload of last db broadcast

// SQLite-backed live frame: the permanent task store (current state) + the most
// recent append-only execution events. Pushed on the same debounced cycle so
// Mission Control sees persisted data update in real time.
function buildDbPayload() {
  const tasks = taskRepo ? taskRepo.getAll().map(mapTask) : [];
  const execution = analyticsRepo ? analyticsRepo.getExecutionHistory(50).map(mapExec) : [];
  return { type: 'db:update', timestamp: new Date().toISOString(), tasks, execution };
}

// Full metrics snapshot pushed to the dashboard pages (Overview/Agents/Tasks/
// Analytics/Git/Testing/Activity) so they never poll — same data getMetrics()
// serves over REST, plus live host health.
async function buildMetricsPayload() {
  return {
    type: 'metrics:update',
    timestamp: new Date().toISOString(),
    metrics: await readAllMetrics(),
    health: getSystemHealthData(),
  };
}

async function buildPayload() {
  const { nodes, edges } = await buildLaidOutGraph();
  let activity = [];
  try {
    const p = path.join(METRICS_DIR, 'activity.json');
    if (await fs.pathExists(p)) {
      const data = await fs.readJson(p);
      activity = Array.isArray(data.events) ? data.events : [];
    }
  } catch (_) { /* activity is optional */ }
  return { type: 'agent-network:update', timestamp: new Date().toISOString(), nodes, edges, activity };
}

function broadcast(str) {
  for (const client of wss.clients) {
    if (client.readyState === 1 /* WebSocket.OPEN */) client.send(str);
  }
}

let refreshTimer = null;
function scheduleBroadcast() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    try {
      const payload = await buildPayload();
      // Compare on stable content only. Activity events carry per-poll ids and
      // drifting relative timestamps ("5m ago") that change every cycle; keying
      // the diff on those would defeat the check and re-broadcast every poll.
      // Match the client's dedupe key (type|title|description) plus the icon.
      const cmp = JSON.stringify({
        nodes: payload.nodes,
        edges: payload.edges,
        activity: payload.activity.map(e => ({
          type: e.type, title: e.title, description: e.description, icon: e.icon,
        })),
      });
      if (cmp !== lastPayloadStr) {
        lastPayloadStr = cmp;
        broadcast(JSON.stringify(payload));
        console.log(`[ws] broadcast agent-network:update (clients=${wss.clients.size})`);
      }

      // Metrics frame — dedupe on the metrics object (host health is volatile
      // and intentionally excluded from the comparison).
      const metricsPayload = await buildMetricsPayload();
      const mCmp = JSON.stringify(metricsPayload.metrics);
      if (mCmp !== lastMetricsStr) {
        lastMetricsStr = mCmp;
        broadcast(JSON.stringify(metricsPayload));
        console.log(`[ws] broadcast metrics:update (clients=${wss.clients.size})`);
      }

      // SQLite-backed frame — dedupe on the full db payload (excluding timestamp).
      if (taskRepo || analyticsRepo) {
        const dbPayload = buildDbPayload();
        const dCmp = JSON.stringify({ tasks: dbPayload.tasks, execution: dbPayload.execution });
        if (dCmp !== lastDbStr) {
          lastDbStr = dCmp;
          broadcast(JSON.stringify(dbPayload));
          console.log(`[ws] broadcast db:update (clients=${wss.clients.size})`);
        }
      }
    } catch (err) {
      console.error('[ws] broadcast error:', err.message);
    }
  }, 300);
}

// Collector notifies here after each poll (fire-and-forget on its side).
app.post('/api/internal/graph-refresh', (req, res) => {
  // The collector pings this after every poll — the moment to reconcile the
  // permanent SQLite task store from Claude's tasks.json and snapshot history.
  syncTasksSafe('collector-poll');
  snapshotAnalyticsSafe('collector-poll');
  scheduleBroadcast();
  res.json({ ok: true });
});

// New clients get an immediate snapshot so the page paints without waiting.
wss.on('connection', async (ws) => {
  console.log(`[ws] client connected (total=${wss.clients.size})`);
  try {
    ws.send(JSON.stringify(await buildPayload()));
    ws.send(JSON.stringify(await buildMetricsPayload()));
    if (taskRepo || analyticsRepo) ws.send(JSON.stringify(buildDbPayload()));
  } catch (_) { /* ignore send failures on a just-closed socket */ }
  ws.on('error', () => { /* swallow — reconnect handled client-side */ });
});

// Start server (HTTP + WebSocket share the same port)
server.listen(PORT, () => {
  console.log(`SenJoeru Synapse Backend running on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`Metrics directory: ${METRICS_DIR}`);
  console.log(`Claude directory: ${CLAUDE_DIR}`);
});
