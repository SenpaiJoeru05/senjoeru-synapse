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
const { openDatabase, DEFAULT_DB_PATH } = require('./lib/db');
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
const { ObservationRepository } = require('./repositories/observation-repository');
const { ObservationService } = require('./services/observation-service');
const { createObservationRouter } = require('./routes/observation');
const { AgentProfileRepository } = require('./repositories/agent-profile-repository');
const { AgentProfileService } = require('./services/agent-profile-service');
const { createAgentProfilesRouter } = require('./routes/agent-profiles');
const { IntelligenceService } = require('./services/intelligence-service');
const { createIntelligenceRouter } = require('./routes/intelligence');
const { AgentMemoryRepository } = require('./repositories/agent-memory-repository');
const { TeamService } = require('./services/team-service');
const { createTeamRouter } = require('./routes/team');
const {
  NotesRepository, BookmarkRepository, DocIndexRepository,
} = require('./repositories/knowledge-repository');
const { NotesService, BookmarkService } = require('./services/knowledge-service');
const { DocIndexService } = require('./services/doc-index-service');
const { SearchService } = require('./services/search-service');
const {
  createNotesRouter, createBookmarksRouter, createDocsRouter, createSearchRouter,
} = require('./routes/knowledge');
const { InsightsService } = require('./services/insights-service');
const { createInsightsRouter } = require('./routes/insights');
const { AttentionService } = require('./services/attention-service');
const { createAttentionRouter } = require('./routes/attention');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Paths — the `.claude` location comes from the workspace config (falls back to
// <home>/.claude), so the backend is not pinned to one machine.
const { getConfig: getWorkspaceConfig } = require('../shared/workspace-config');
const _wsCfg = getWorkspaceConfig();
const METRICS_DIR = path.join(__dirname, '../metrics');
const CLAUDE_DIR = _wsCfg.paths.claudeDir;
const CLAUDE_TASKS_FILE = _wsCfg.paths.tasksFile;

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
let observationRepo = null;
let observationService = null;
let agentProfileRepo = null;
let agentProfileService = null;
let intelligenceService = null;
let teamService = null;
let notesService = null;
let bookmarkService = null;
let docIndexRepo = null;
let docIndexService = null;
let searchService = null;
let insightsService = null;
let attentionService = null;
let dbRef = null;
try {
  const db = openDatabase();
  dbRef = db;

  // Tasks (imported one-way from Claude's tasks.json).
  taskRepo = new TaskRepository(db);
  taskSync = new TaskSyncService(db, CLAUDE_TASKS_FILE);
  const summary = taskSync.sync(); // initial import on startup

  // Historical analytics + execution history.
  analyticsRepo = new AnalyticsRepository(db);
  analyticsService = new AnalyticsService(analyticsRepo, METRICS_DIR);

  // Observation history (Phase 2): persist git/session/agent state over time.
  observationRepo = new ObservationRepository(db);
  observationService = new ObservationService(db, METRICS_DIR);

  // Agent personas (Track B): import displayName/title from .claude/agents.
  agentProfileRepo = new AgentProfileRepository(db);
  agentProfileService = new AgentProfileService(agentProfileRepo, METRICS_DIR);

  // Engineering intelligence (Phase 3): computed insights, derived on read.
  intelligenceService = new IntelligenceService(db, METRICS_DIR);

  // Team view (Phase 4): personas + memory read live from .claude/agents.
  teamService = new TeamService(path.join(CLAUDE_DIR, 'agents'), new AgentMemoryRepository(db));
  teamService.syncMemory(); // store a permanent copy of agent memory

  // Knowledge Layer (Phase 4): notes, bookmarks, docs index, FTS5 search.
  notesService = new NotesService(new NotesRepository(db));
  bookmarkService = new BookmarkService(new BookmarkRepository(db));
  docIndexRepo = new DocIndexRepository(db);
  docIndexService = new DocIndexService(docIndexRepo, METRICS_DIR);
  searchService = new SearchService(db);
  const docs = docIndexService.reindexIfEmpty(); // index repo docs once if empty
  console.log(`[db] knowledge ready; docs ${JSON.stringify(docs)}; search engine=${searchService.ftsOk ? 'fts5' : 'like'}`);

  // Insights & analytics (Phase 5): computed from history, derived on read.
  insightsService = new InsightsService(db);

  // Relational core + settings.
  workspaceService = new WorkspaceService(new WorkspaceRepository(db));
  projectService = new ProjectService(new ProjectRepository(db));
  repositoryService = new RepositoryService(new RepositoryRepository(db));
  settingsService = new SettingsService(
    new SettingsRepository(db),
    path.join(METRICS_DIR, 'config.json')
  );

  // Proactive attention queue (zero-token; tasks + budgets + costs).
  attentionService = new AttentionService(taskRepo, settingsService, METRICS_DIR);

  // Seed once: a default workspace + settings imported from config.json.
  const ws = workspaceService.ensureDefault();
  const seeded = settingsService.seedFromConfigIfEmpty();

  // Initial history snapshot from whatever metrics already exist on disk.
  const snap = analyticsService.snapshotAll(taskRepo);
  const obs = observationService.snapshotAll();
  const prof = agentProfileService.sync();
  console.log(
    `[db] SQLite ready; task sync ${JSON.stringify(summary)}; ` +
    `workspace="${ws.name}"; settings ${seeded ? 'seeded from config.json' : 'loaded'}; ` +
    `analytics ${JSON.stringify(snap)}; observation ${JSON.stringify(obs)}; profiles ${JSON.stringify(prof)}`
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

// Persist observation (git/session/agent) history. Guarded like the above.
function snapshotObservationSafe(trigger) {
  if (!observationService) return;
  try {
    const obs = observationService.snapshotAll();
    if (obs.repoChanges || obs.sessionsEnded || obs.agentChanges) {
      console.log(`[db] observation (${trigger}): ${JSON.stringify(obs)}`);
    }
  } catch (err) {
    console.error(`[db] observation snapshot failed (${trigger}):`, err.message);
  }
}

// Import agent personas (displayName/title) into SQLite. Guarded.
function syncAgentProfilesSafe(trigger) {
  if (!agentProfileService) return;
  try {
    agentProfileService.sync();
  } catch (err) {
    console.error(`[db] agent-profile sync failed (${trigger}):`, err.message);
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
if (observationRepo) app.use('/api/observation', createObservationRouter(observationRepo));
if (agentProfileRepo) app.use('/api/agents/profiles', createAgentProfilesRouter(agentProfileRepo));
if (intelligenceService) app.use('/api/intelligence', createIntelligenceRouter(intelligenceService));
if (teamService) app.use('/api/team', createTeamRouter(teamService));
if (notesService) app.use('/api/notes', createNotesRouter(notesService));
if (bookmarkService) app.use('/api/bookmarks', createBookmarksRouter(bookmarkService));
if (docIndexService) app.use('/api/docs', createDocsRouter(docIndexRepo, docIndexService));
if (searchService) app.use('/api/search', createSearchRouter(searchService));
if (insightsService) app.use('/api/insights', createInsightsRouter(insightsService));
if (attentionService) app.use('/api/attention', createAttentionRouter(attentionService));

// C1 — Data safety: export a consistent copy of the SQLite database.
app.get('/api/backup/export', (req, res) => {
  try {
    if (!dbRef) return res.status(503).json({ error: 'database unavailable' });
    dbRef.pragma('wal_checkpoint(TRUNCATE)'); // flush WAL so the file is consistent
    res.download(DEFAULT_DB_PATH, 'synapse-export.db');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

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
  opencode: 'opencode.json',
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
  snapshotObservationSafe('collector-poll');
  syncAgentProfilesSafe('collector-poll');
  if (teamService) { try { teamService.syncMemory(); } catch (_) {} }
  scheduleBroadcast();
  res.json({ ok: true });
});

// ── Auto-register repos ────────────────────────────────────────────────────
// "When I chat in a repo, track it automatically." The collector pings this each
// poll; we scan active Claude sessions for git repos not yet tracked and add
// them (repositories → SQLite via SettingsService; a default owner → config so
// they appear connected in the Agent Network, not as orphan nodes).
const DEFAULT_REPO_OWNER = ['project-manager'];

function normRepoPath(p) {
  return String(p || '').toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '');
}

async function detectSessionGitRepos() {
  const sessionsDir = path.join(CLAUDE_DIR, 'sessions');
  const repos = new Set();
  if (!fs.existsSync(sessionsDir)) return [];
  const files = await fs.readdir(sessionsDir);
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = await fs.readJson(path.join(sessionsDir, f));
      // Only the exact cwd you're working in, and only if it's a git repo.
      if (data.cwd && fs.existsSync(path.join(data.cwd, '.git'))) repos.add(data.cwd);
    } catch (_) { /* skip unreadable session */ }
  }
  return [...repos];
}

function registerRepoPaths(candidatePaths) {
  if (!settingsService || !Array.isArray(candidatePaths) || candidatePaths.length === 0) {
    return { added: 0, repos: [] };
  }
  const current = settingsService.getAll().repositories || [];
  const seen = new Set(current.map(normRepoPath));
  const toAdd = [];
  for (const p of candidatePaths) {
    const n = normRepoPath(p);
    if (!seen.has(n)) { seen.add(n); toAdd.push(p); }
  }
  if (toAdd.length === 0) return { added: 0, repos: [] };

  // repositories → SQLite (source of truth) + config.json mirror (merge keeps repoAgents).
  settingsService.save({ repositories: [...current, ...toAdd] });

  // Default owner so a new repo shows a live edge instead of floating orphaned.
  try {
    const cfgPath = path.join(METRICS_DIR, 'config.json');
    const cfg = fs.existsSync(cfgPath) ? fs.readJsonSync(cfgPath) : {};
    cfg.repoAgents = cfg.repoAgents || {};
    for (const p of toAdd) {
      const name = path.basename(p.replace(/[\\/]+$/, ''));
      if (!cfg.repoAgents[name]) cfg.repoAgents[name] = [...DEFAULT_REPO_OWNER];
    }
    fs.writeJsonSync(cfgPath, cfg, { spaces: 2 });
  } catch (_) { /* owner default is best-effort */ }

  return { added: toAdd.length, repos: toAdd };
}

app.post('/api/internal/auto-register', async (req, res) => {
  try {
    const result = registerRepoPaths(await detectSessionGitRepos());
    if (result.added > 0) {
      console.log(`[auto-register] +${result.added}: ${result.repos.map((r) => path.basename(r)).join(', ')}`);
      scheduleBroadcast();
    }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
