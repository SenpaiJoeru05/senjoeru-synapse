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

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Paths
const METRICS_DIR = path.join(__dirname, '../metrics');
const CLAUDE_DIR = 'C:\\Users\\joelr\\.claude';

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

// Agent-network graph (initial paint) — realtime updates come over /ws
app.use('/api/agent-network', networkRouter);

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
    const configPath = path.join(METRICS_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = await fs.readJson(configPath);
      res.json(config);
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
    } catch (err) {
      console.error('[ws] broadcast error:', err.message);
    }
  }, 300);
}

// Collector notifies here after each poll (fire-and-forget on its side).
app.post('/api/internal/graph-refresh', (req, res) => {
  scheduleBroadcast();
  res.json({ ok: true });
});

// New clients get an immediate snapshot so the page paints without waiting.
wss.on('connection', async (ws) => {
  console.log(`[ws] client connected (total=${wss.clients.size})`);
  try {
    ws.send(JSON.stringify(await buildPayload()));
    ws.send(JSON.stringify(await buildMetricsPayload()));
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
