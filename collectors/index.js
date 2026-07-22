const chokidar = require('chokidar');
const fs = require('fs-extra');
const path = require('path');
const simpleGit = require('simple-git');
const axios = require('axios');

// Backend endpoint pinged after each poll so it can rebuild + broadcast the
// agent-network graph. Fire-and-forget: the backend may not be running.
const BACKEND_REFRESH_URL = 'http://localhost:3001/api/internal/graph-refresh';

async function notifyBackend() {
  try {
    await axios.post(BACKEND_REFRESH_URL, {}, { timeout: 2000 });
  } catch (_) {
    // Backend down or slow — non-fatal, metrics are still on disk.
  }
}

const METRICS_DIR = path.join(__dirname, '../metrics');
const CLAUDE_DIR = 'C:\\Users\\joelr\\.claude';
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');

// Claude Sonnet 4.6 pricing per token
const PRICING = {
  input:       3.00 / 1_000_000,
  output:     15.00 / 1_000_000,
  cache_read:  0.30 / 1_000_000,
  cache_write: 3.75 / 1_000_000,
};

fs.ensureDirSync(METRICS_DIR);

// ─── helpers ──────────────────────────────────────────────────────────────────

function calcCost(t) {
  return (
    (t.input       || 0) * PRICING.input +
    (t.output      || 0) * PRICING.output +
    (t.cacheRead   || 0) * PRICING.cache_read +
    (t.cacheWrite  || 0) * PRICING.cache_write
  );
}

function formatProjectName(dirName) {
  return dirName
    .replace(/^[dD]--/, '')
    .replace(/JOELRAYTON-WORKS-/, '')
    .replace(/FlowerStorePH-/, 'FlowerStorePH / ')
    .replace(/-/g, ' ');
}

function dayKey(isoTimestamp) {
  return isoTimestamp ? isoTimestamp.slice(0, 10) : null;
}

function hourKey(isoTimestamp) {
  return isoTimestamp ? isoTimestamp.slice(0, 13) : null; // "2026-06-29T14"
}

function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function isoCurrentHour() {
  return new Date().toISOString().slice(0, 13);
}

// Walk all *.jsonl files under a directory recursively
async function findJsonlFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await findJsonlFiles(full);
      results.push(...sub);
    } else if (entry.name.endsWith('.jsonl')) {
      results.push(full);
    }
  }
  return results;
}

// ─── token collector ──────────────────────────────────────────────────────────

async function collectTokens() {
  if (!fs.existsSync(PROJECTS_DIR)) return null;

  const projectDirs = await fs.readdir(PROJECTS_DIR);

  // byDay[YYYY-MM-DD] = { input, output, cacheRead, cacheWrite }
  const byDay = {};
  // byHour[YYYY-MM-DDTHH] = { input, output, cacheRead, cacheWrite }
  const byHour = {};
  // byProject[dirName] = { input, output, cacheRead, cacheWrite }
  const byProject = {};
  // sessions: [{ id, project, tokens, cost, date }]
  const sessionList = [];

  for (const projDir of projectDirs) {
    const projPath = path.join(PROJECTS_DIR, projDir);
    const stat = await fs.stat(projPath).catch(() => null);
    if (!stat || !stat.isDirectory()) continue;

    const jsonlFiles = await findJsonlFiles(projPath);

    for (const filePath of jsonlFiles) {
      const sessionId = path.basename(filePath, '.jsonl');
      let sessionTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let sessionDate = null;

      const content = await fs.readFile(filePath, 'utf8').catch(() => '');
      const lines = content.split('\n').filter(l => l.includes('"usage"'));

      const seenMsgIds = new Set();

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const usage = entry.message?.usage;
          if (!usage) continue;

          // Each Claude response is written multiple times (thinking/text/tool_use chunks).
          // Deduplicate by message id so we count tokens exactly once per API call.
          const msgId = entry.message?.id;
          if (msgId) {
            if (seenMsgIds.has(msgId)) continue;
            seenMsgIds.add(msgId);
          }

          const input      = usage.input_tokens || 0;
          const output     = usage.output_tokens || 0;
          const cacheRead  = usage.cache_read_input_tokens || 0;
          const cacheWrite = usage.cache_creation_input_tokens || 0;
          const day        = dayKey(entry.timestamp);
          const hour       = hourKey(entry.timestamp);

          if (day) {
            if (!byDay[day]) byDay[day] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
            byDay[day].input      += input;
            byDay[day].output     += output;
            byDay[day].cacheRead  += cacheRead;
            byDay[day].cacheWrite += cacheWrite;
            if (!sessionDate) sessionDate = day;
          }

          if (hour) {
            if (!byHour[hour]) byHour[hour] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
            byHour[hour].input      += input;
            byHour[hour].output     += output;
            byHour[hour].cacheRead  += cacheRead;
            byHour[hour].cacheWrite += cacheWrite;
          }

          if (!byProject[projDir]) byProject[projDir] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
          byProject[projDir].input      += input;
          byProject[projDir].output     += output;
          byProject[projDir].cacheRead  += cacheRead;
          byProject[projDir].cacheWrite += cacheWrite;

          sessionTokens.input      += input;
          sessionTokens.output     += output;
          sessionTokens.cacheRead  += cacheRead;
          sessionTokens.cacheWrite += cacheWrite;
        } catch (_) { /* skip malformed lines */ }
      }

      const totalSessionTokens = sessionTokens.input + sessionTokens.output +
                                  sessionTokens.cacheRead + sessionTokens.cacheWrite;
      if (totalSessionTokens > 0) {
        sessionList.push({
          id: sessionId,
          project: formatProjectName(projDir),
          tokens: totalSessionTokens,
          cost: parseFloat(calcCost(sessionTokens).toFixed(4)),
          date: sessionDate,
        });
      }
    }
  }

  // Build last 7 days array
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
    const t = byDay[dateStr] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const tokens = t.input + t.output + t.cacheRead + t.cacheWrite;
    daily.push({ day: dayName, date: dateStr, tokens, cost: parseFloat(calcCost(t).toFixed(4)) });
  }

  const today = isoToday();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);

  const todayT = byDay[today] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const yesterdayT = byDay[yesterdayStr] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const todayTokens = todayT.input + todayT.output + todayT.cacheRead + todayT.cacheWrite;
  const yesterdayTokens = yesterdayT.input + yesterdayT.output + yesterdayT.cacheRead + yesterdayT.cacheWrite;
  const weeklyTokens = daily.reduce((s, d) => s + d.tokens, 0);

  const trend = yesterdayTokens > 0
    ? Math.round(((todayTokens - yesterdayTokens) / yesterdayTokens) * 100)
    : 0;

  // Top sessions by token count (last 10)
  const topSessions = sessionList
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10)
    .map((s, i) => ({ session: `Session ${i + 1}`, tokens: s.tokens, project: s.project, date: s.date }));

  // Per-project breakdown
  const projectBreakdown = Object.entries(byProject)
    .map(([name, t]) => ({
      name: formatProjectName(name),
      tokens: t.input + t.output + t.cacheRead + t.cacheWrite,
      cost: parseFloat(calcCost(t).toFixed(4)),
    }))
    .sort((a, b) => b.tokens - a.tokens);

  const tokensData = {
    lastUpdated: new Date().toISOString(),
    today: todayTokens,
    weekly: weeklyTokens,
    trend,
    weeklyTrend: 0,
    daily,
    sessions: topSessions,
    byProject: projectBreakdown,
  };

  const todayCost = calcCost(todayT);
  const weeklyCost = daily.reduce((s, d) => s + d.cost, 0);

  const currentHour = isoCurrentHour();
  const thisHourT = byHour[currentHour] || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const thisHourCost = parseFloat(calcCost(thisHourT).toFixed(4));

  const costsData = {
    lastUpdated: new Date().toISOString(),
    today: parseFloat(todayCost.toFixed(4)),
    thisHour: thisHourCost,
    weekly: parseFloat(weeklyCost.toFixed(4)),
    monthly: parseFloat((weeklyCost * 4.3).toFixed(2)),
    trend,
    weeklyTrend: 0,
  };

  await fs.writeJson(path.join(METRICS_DIR, 'tokens.json'), tokensData, { spaces: 2 });
  await fs.writeJson(path.join(METRICS_DIR, 'costs.json'), costsData, { spaces: 2 });

  console.log(`[tokens] today=${todayTokens.toLocaleString()} weekly=${weeklyTokens.toLocaleString()} cost_today=$${todayCost.toFixed(4)}`);
}

// ─── session collector ────────────────────────────────────────────────────────

async function collectSessions() {
  const activeSessions = [];

  if (fs.existsSync(SESSIONS_DIR)) {
    const files = await fs.readdir(SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = await fs.readJson(path.join(SESSIONS_DIR, file));
        activeSessions.push({
          pid:       data.pid,
          sessionId: data.sessionId,
          cwd:       data.cwd,
          version:   data.version,
          kind:      data.kind,
          startedAt: data.startedAt,
        });
      } catch (_) {}
    }
  }

  const sessionsData = {
    lastUpdated:    new Date().toISOString(),
    sessionCount:   activeSessions.length,
    active:         activeSessions.length > 0,
    claudePath:     CLAUDE_DIR,
    exists:         fs.existsSync(CLAUDE_DIR),
    activeSessions,
  };

  await fs.writeJson(path.join(METRICS_DIR, 'sessions.json'), sessionsData, { spaces: 2 });
  console.log(`[sessions] active=${activeSessions.length}`);
}

// ─── task collector (from Claude memory files) ────────────────────────────────

function parseMemoryFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split('\n')) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) fm[key.trim()] = rest.join(':').trim();
  }
  return fm;
}

// Emit the canonical task-status vocabulary used by the dashboard + tasks.json
// schema: Pending | Working | Reviewing | Completed | Failed.
function deriveTaskStatus(body) {
  const lower = body.toLowerCase();
  if (lower.includes('failed') || lower.includes('error') || lower.includes('blocked')) return 'Failed';
  if (lower.includes('aligned') || lower.includes('implemented') || lower.includes('committed') || lower.includes('completed') || lower.includes('done')) return 'Completed';
  if (lower.includes('working') || lower.includes('in progress') || lower.includes('pending')) return 'Working';
  return 'Working';
}

function deriveProgress(body) {
  const lower = body.toLowerCase();
  if (lower.includes('✅') || lower.includes('aligned') || lower.includes('implemented')) return 90;
  if (lower.includes('blocked') || lower.includes('pending') || lower.includes('not yet built')) return 20;
  if (lower.includes('interim') || lower.includes('partial')) return 60;
  return 50;
}

const CLAUDE_TASKS_FILE = path.join(CLAUDE_DIR, 'tasks.json');

// Valid JSON string escapes. Agents occasionally paste code (e.g. PHP `$queue`
// as `\$queue`) into task notes, producing invalid escapes that break the whole
// board. Repair those rather than silently discarding the real board.
const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

function repairInvalidJsonEscapes(raw) {
  let out = '';
  let inStr = false;
  let fixes = 0;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!inStr) { out += c; if (c === '"') inStr = true; continue; }
    if (c === '\\') {
      const nxt = raw[i + 1];
      if (VALID_JSON_ESCAPES.has(nxt)) { out += c + nxt; i++; }
      else { fixes++; out += nxt; i++; } // drop stray backslash, keep the char
    } else { out += c; if (c === '"') inStr = false; }
  }
  return { text: out, fixes };
}

// Read the live board, tolerating invalid escape sequences. Returns the parsed
// object, or null if it's unrecoverable.
async function readTasksBoardLenient() {
  const raw = await fs.readFile(CLAUDE_TASKS_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (_) {
    const { text, fixes } = repairInvalidJsonEscapes(raw);
    try {
      const parsed = JSON.parse(text);
      console.warn(`[tasks] ⚠ tasks.json had ${fixes} invalid JSON escape(s) — auto-repaired in memory (live file not modified)`);
      return parsed;
    } catch (err) {
      console.error(`[tasks] ⚠ tasks.json is corrupt and could not be auto-repaired: ${err.message}`);
      return null;
    }
  }
}

async function collectTasks() {
  // Priority 1: C:\Users\joelr\.claude\tasks.json — live file updated by Claude agents
  if (fs.existsSync(CLAUDE_TASKS_FILE)) {
    const source = await readTasksBoardLenient();
    if (source) {
      const tasks = (source.tasks || []).map((t, i) => ({
        id:            t.id || String(i + 1),
        title:         t.title,
        assignedAgent: t.assignedAgent || 'AI Chatbot Engineer',
        repos:         t.repos || [],
        progress:      t.progress ?? 0,
        status:        t.status || 'Pending',
        eta:           t.eta || 'TBD',
        priority:      t.priority || 'Medium',
        notes:         t.notes || '',
        lastUpdated:   t.lastUpdated || source.lastUpdated,
      }));

      await fs.writeJson(path.join(METRICS_DIR, 'tasks.json'), {
        lastUpdated: new Date().toISOString(),
        source: 'claude-tasks',
        tasks,
      }, { spaces: 2 });

      console.log(`[tasks] loaded=${tasks.length} from C:\\Users\\joelr\\.claude\\tasks.json`);
      return;
    }
    // Board exists but is unrecoverable — warn loudly before falling back so the
    // memory-derived stand-in is never mistaken for the real board.
    console.warn('[tasks] ⚠ falling back to memory-derived tasks — statuses are heuristic, not authoritative');
  }

  // Fallback: derive from Claude memory files
  const tasks = [];
  let id = 1;
  if (!fs.existsSync(PROJECTS_DIR)) {
    await fs.writeJson(path.join(METRICS_DIR, 'tasks.json'), { lastUpdated: new Date().toISOString(), tasks }, { spaces: 2 });
    return;
  }

  const projectDirs = await fs.readdir(PROJECTS_DIR);
  for (const projDir of projectDirs) {
    const memDir = path.join(PROJECTS_DIR, projDir, 'memory');
    if (!fs.existsSync(memDir)) continue;
    const memFiles = await fs.readdir(memDir);
    for (const file of memFiles) {
      if (!file.endsWith('.md') || file === 'MEMORY.md') continue;
      try {
        const content = await fs.readFile(path.join(memDir, file), 'utf8');
        const fm = parseMemoryFrontmatter(content);
        if (!fm.name || !fm.description) continue;
        const body = content.replace(/^---[\s\S]*?---/, '').trim();
        tasks.push({
          id: String(id++),
          title: fm.description.replace(/"/g, '').trim(),
          assignedAgent: 'Claude Agent',
          progress: deriveProgress(body),
          status: deriveTaskStatus(body),
          eta: 'Ongoing',
          priority: body.toLowerCase().includes('critical') || body.toLowerCase().includes('blocked') ? 'High' : 'Medium',
          project: formatProjectName(projDir),
        });
      } catch (_) {}
    }
  }

  await fs.writeJson(path.join(METRICS_DIR, 'tasks.json'), {
    lastUpdated: new Date().toISOString(),
    source: 'memory-files',
    tasks,
  }, { spaces: 2 });

  console.log(`[tasks] loaded=${tasks.length} from memory files (fallback)`);
}

// ─── agent collector (from C:\Users\joelr\.claude\agents\*.md definitions) ────

function relativeTime(ms) {
  const diff = Date.now() - ms;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function parseAgentFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fm = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim();
    if (key) fm[key] = val;
  }
  return fm;
}

function formatAgentName(slug) {
  // "ai-chatbot-engineer" → "AI Chatbot Engineer"
  return slug
    .split('-')
    .map(word => {
      // Keep known acronyms uppercased
      if (['ai', 'db', 'qa', 'cs'].includes(word.toLowerCase())) {
        return word.toUpperCase();
      }
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

function inferProject(description) {
  if (!description) return 'General';
  return description.includes('FlowerStorePH') ? 'FlowerStorePH' : 'General';
}

// Which agents are primary for a given CWD?
// Sourced from the shared single-source-of-truth map (also used by the backend
// graph-builder) so repo<->agent assignments never drift between processes.
const { REPO_PRIMARY_AGENTS } = require('../shared/agent-repos');

// How we detect "working": a session's JSONL conversation file was written recently.
// Claude writes to it after every response — so mtime = time of last Claude reply.
const ACTIVE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

// Convert a CWD path to the Claude project directory name.
// "d:\FlowerStorePH\fs-llm-service"  →  "d--FlowerStorePH-fs-llm-service"
function cwdToProjectDirName(cwd) {
  return cwd
    .replace(/^([a-zA-Z]):[\\\/]/, (_, letter) => letter + '--')
    .replace(/[\\\/]/g, '-')
    .replace(/\s+/g, '-');
}

// Returns mtime (ms) of the most recently written JSONL file for this CWD's project dir.
// Returns 0 if no project dir or no JSONL files found.
async function getLatestJSONLMtime(cwd) {
  if (!fs.existsSync(PROJECTS_DIR)) return 0;
  const expectedName = cwdToProjectDirName(cwd).toLowerCase();
  let matchDir = null;
  try {
    const dirs = await fs.readdir(PROJECTS_DIR);
    matchDir = dirs.find(d => d.toLowerCase() === expectedName);
  } catch (_) { return 0; }
  if (!matchDir) return 0;

  const projectPath = path.join(PROJECTS_DIR, matchDir);
  let latestMtime = 0;
  try {
    const files = await fs.readdir(projectPath);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      try {
        const stat = await fs.stat(path.join(projectPath, file));
        if (stat.mtimeMs > latestMtime) latestMtime = stat.mtimeMs;
      } catch (_) {}
    }
  } catch (_) {}
  return latestMtime;
}

async function getActiveAgentNames() {
  // activeNames:          Map<agentName, cwd> — only sessions with recent JSONL activity
  // activeCwds:           all CWDs with open sessions (regardless of activity)
  // lastActivityByAgent:  Map<agentName, mtimeMs> — most recent activity across ANY
  //                       session, so the inspector's "Last update" reflects real
  //                       work (not the agent's .md definition-file mtime).
  const activeNames = new Map();
  const activeCwds  = [];
  const lastActivityByAgent = new Map();
  const now = Date.now();

  if (!fs.existsSync(SESSIONS_DIR)) return { activeNames, activeCwds, lastActivityByAgent };

  const sessionFiles = (await fs.readdir(SESSIONS_DIR)).filter(f => f.endsWith('.json'));

  for (const file of sessionFiles) {
    try {
      const data = await fs.readJson(path.join(SESSIONS_DIR, file));
      if (!data.cwd) continue;
      activeCwds.push(data.cwd);

      // mtime of the newest JSONL for this cwd = time of the last Claude reply.
      const mtime      = await getLatestJSONLMtime(data.cwd);
      const minutesAgo = mtime ? Math.round((now - mtime) / 60_000) : 0;
      const isRecent   = mtime > 0 && (now - mtime) < ACTIVE_THRESHOLD_MS;

      console.log(`[sessions]   ${path.basename(data.cwd)}: last activity ${mtime ? minutesAgo + 'm ago' : 'never'} → ${isRecent ? 'WORKING' : 'idle'}`);

      // Map this session's cwd to the agents that own the repo.
      const fullPathLower = data.cwd.toLowerCase().replace(/\\/g, '/');
      const matched = new Set();
      for (const [repo, names] of Object.entries(REPO_PRIMARY_AGENTS)) {
        if (repo === 'flowerstoreph') continue;
        if (fullPathLower.includes('/' + repo) || fullPathLower.endsWith(repo)) {
          names.forEach(n => matched.add(n));
        }
      }
      if (matched.size === 0 && fullPathLower.includes('flowerstoreph')) {
        REPO_PRIMARY_AGENTS['flowerstoreph'].forEach(n => matched.add(n));
      }

      for (const n of matched) {
        // Track last activity for every matched agent, recent or not.
        if (mtime > (lastActivityByAgent.get(n) || 0)) lastActivityByAgent.set(n, mtime);
        // Only recently-active sessions mark an agent as "Working".
        if (isRecent && !activeNames.has(n)) activeNames.set(n, data.cwd);
      }
    } catch (_) {}
  }

  console.log(`[sessions] working agents: ${[...activeNames.keys()].join(', ') || 'none'}`);
  return { activeNames, activeCwds, lastActivityByAgent };
}

async function collectAgents() {
  const AGENTS_DIR = path.join(CLAUDE_DIR, 'agents');
  const agents = [];

  // Determine which agents are currently Working from active sessions
  const { activeNames, activeCwds, lastActivityByAgent } = await getActiveAgentNames();
  const sessionSummary = activeCwds.length > 0
    ? activeCwds.map(c => path.basename(c)).join(', ')
    : null;

  if (fs.existsSync(AGENTS_DIR)) {
    const files = (await fs.readdir(AGENTS_DIR)).filter(f => f.endsWith('.md'));

    for (let i = 0; i < files.length; i++) {
      const filePath = path.join(AGENTS_DIR, files[i]);
      try {
        const content = await fs.readFile(filePath, 'utf8');

        const fm = parseAgentFrontmatter(content);
        const slug = fm.name || path.basename(files[i], '.md');
        const description = fm.description || '';
        const formattedName = formatAgentName(slug);
        const truncatedDesc = description.length > 100
          ? description.slice(0, 97) + '...'
          : description;

        const activeCwd = activeNames.get(formattedName) || null;
        const isWorking = activeCwd !== null;

        // "Last update" = the agent's most recent real activity, not the age of
        // its .md definition file. Falls back to a clear label when it has never
        // been seen working in any tracked session.
        const lastActivityMs = lastActivityByAgent.get(formattedName) || 0;

        agents.push({
          id:              String(i + 1),
          name:            formattedName,
          status:          isWorking ? 'Working' : 'Idle',
          currentTask:     truncatedDesc || 'No description',
          progress:        0,
          runtime:         0,
          lastUpdate:      lastActivityMs ? relativeTime(lastActivityMs) : 'No recent activity',
          assignedProject: inferProject(description),
          activeCwd,
        });
      } catch (_) {}
    }
  }

  const activeCount = agents.filter(a => a.status === 'Working').length;

  await fs.writeJson(path.join(METRICS_DIR, 'agents.json'), {
    lastUpdated: new Date().toISOString(),
    agents,
    active:      activeCount,
    total:       agents.length,
    activeSessions: activeCwds.length,
    sessionSummary,
  }, { spaces: 2 });

  if (activeCount > 0) {
    console.log(`[agents] total=${agents.length} active=${activeCount} (${sessionSummary})`);
  } else {
    console.log(`[agents] total=${agents.length} all-idle`);
  }
}

// ─── git collector (real repos from FlowerStorePH) ───────────────────────────

// Repos to monitor — add/remove as needed
const GIT_REPOS = [
  'd:\\FlowerStorePH\\fs-llm-service',
  'd:\\FlowerStorePH\\cs-dashboard',
  'd:\\FlowerStorePH\\chat-widget',
  'd:\\FlowerStorePH\\fsweb',
];

async function collectGit() {
  // Try to load repo list from metrics/config.json; fall back to GIT_REPOS constant
  let repoList = GIT_REPOS;
  try {
    const configPath = path.join(METRICS_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = await fs.readJson(configPath);
      if (Array.isArray(config.repositories) && config.repositories.length > 0) {
        repoList = config.repositories;
      }
    }
  } catch (_) {
    // config.json missing or malformed — stick with hardcoded fallback
  }

  const repos = [];

  for (const repoPath of repoList) {
    if (!fs.existsSync(repoPath)) continue;
    try {
      const git = simpleGit(repoPath);
      const [status, log] = await Promise.all([
        git.status(),
        git.log({ maxCount: 5 }),
      ]);

      repos.push({
        path: repoPath,
        name: path.basename(repoPath),
        branch: status.current,
        current: status.current,
        tracking: status.tracking,
        files: status.files,
        staged: status.staged,
        modified: status.modified,
        created: status.created,
        deleted: status.deleted,
        commits: log.all.map(c => ({
          hash: c.hash.slice(0, 7),
          message: c.message,
          author: c.author_name,
          date: c.date,
        })),
        ahead: status.ahead,
        behind: status.behind,
      });
    } catch (err) {
      console.error(`[git] ${path.basename(repoPath)}: ${err.message}`);
    }
  }

  await fs.writeJson(path.join(METRICS_DIR, 'git.json'), {
    lastUpdated: new Date().toISOString(),
    repos,
  }, { spaces: 2 });

  console.log(`[git] repos=${repos.length} (${repos.map(r => r.name).join(', ')})`);
}

// ─── activity collector (generates events from real data) ─────────────────────

async function collectActivity() {
  const events = [];
  
  // Load existing data to generate events from
  const [agentsData, tasksData, gitData] = await Promise.all([
    fs.readJson(path.join(METRICS_DIR, 'agents.json')).catch(() => ({ agents: [] })),
    fs.readJson(path.join(METRICS_DIR, 'tasks.json')).catch(() => ({ tasks: [] })),
    fs.readJson(path.join(METRICS_DIR, 'git.json')).catch(() => ({ repos: [] })),
  ]);

  // Generate agent activity events
  const agents = agentsData.agents || [];
  agents.forEach((agent, index) => {
    if (agent.status === 'Working') {
      events.push({
        id: `agent-${agent.id}`,
        type: 'agent',
        title: `${agent.name} is working`,
        description: agent.currentTask || 'Processing assigned task',
        timestamp: agent.lastUpdate || 'just now',
        icon: 'Bot'
      });
    }
  });

  // Generate task activity events
  const tasks = tasksData.tasks || [];
  const recentTasks = tasks.slice(0, 5);
  recentTasks.forEach((task, index) => {
    if (task.status === 'Working') {
      events.push({
        id: `task-${task.id}-working`,
        type: 'task',
        title: `Task in progress: ${task.title.substring(0, 40)}...`,
        description: `Assigned to ${task.assignedAgent || 'AI Agent'} - ${task.progress}% complete`,
        timestamp: task.lastUpdated || 'recently',
        icon: 'ListTodo'
      });
    } else if (task.status === 'Completed') {
      events.push({
        id: `task-${task.id}-completed`,
        type: 'task',
        title: `Task completed: ${task.title.substring(0, 40)}...`,
        description: `Completed by ${task.assignedAgent || 'AI Agent'}`,
        timestamp: task.lastUpdated || 'recently',
        icon: 'CheckCircle'
      });
    }
  });

  // Generate git activity events
  const repos = gitData.repos || [];
  repos.forEach(repo => {
    if (repo.commits && repo.commits.length > 0) {
      const latestCommit = repo.commits[0];
      events.push({
        id: `commit-${repo.name}-${latestCommit.hash || latestCommit.date || 'latest'}`,
        type: 'commit',
        title: `New commit in ${repo.name}`,
        description: latestCommit.message,
        timestamp: latestCommit.date || 'recently',
        icon: 'GitCommit'
      });
    }
    
    // Show files being worked on
    if (repo.modified && repo.modified.length > 0) {
      events.push({
        id: `files-${repo.name}`,
        type: 'task',
        title: `Modified files in ${repo.name}`,
        description: `${repo.modified.length} files modified, ${repo.staged?.length || 0} staged`,
        timestamp: 'recently',
        icon: 'FileText'
      });
    }
  });

  // Sort by most recent (simple timestamp-based sorting)
  events.sort((a, b) => {
    // If timestamps are relative, try to sort by type priority
    const typePriority = { agent: 3, commit: 2, task: 1 };
    return (typePriority[b.type] || 0) - (typePriority[a.type] || 0);
  });

  // Keep only last 20 events
  const recentEvents = events.slice(0, 20);

  await fs.writeJson(path.join(METRICS_DIR, 'activity.json'), {
    lastUpdated: new Date().toISOString(),
    events: recentEvents
  }, { spaces: 2 });

  console.log(`[activity] events=${recentEvents.length}`);
}

// ─── main poll loop ───────────────────────────────────────────────────────────

async function poll() {
  try {
    await Promise.all([
      collectTokens(),
      collectSessions(),
      collectTasks(),
      collectAgents(),
      collectGit(),
      collectActivity(),
    ]);
    // Metrics regenerated — tell the backend to rebuild + broadcast the graph.
    notifyBackend();
  } catch (err) {
    console.error('[collector] error:', err.message);
  }
}

// Watch Claude dir + tasks.json + config.json for instant updates
const watchPaths = [
  path.join(CLAUDE_DIR, 'sessions'),
  path.join(CLAUDE_DIR, 'projects'),
  CLAUDE_TASKS_FILE,                       // tasks.json — Claude agents write here
  path.join(METRICS_DIR, 'config.json'),   // settings — repo list changes take effect immediately
];

const existingWatchPaths = watchPaths.filter(p => {
  try { return fs.existsSync(path.dirname(p)) || fs.existsSync(p); } catch { return false; }
});

console.log(`Watching: sessions, projects, tasks.json, config.json`);
const watcher = chokidar.watch(existingWatchPaths, {
  ignored:          /(^|[\/\\])\../,
  persistent:       true,
  ignoreInitial:    true,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
});

watcher.on('change', (p) => {
  console.log(`[watch] changed: ${path.basename(p)}`);
  poll();
});
watcher.on('add', (p) => {
  if (p === CLAUDE_TASKS_FILE) console.log('[watch] tasks.json created');
  else console.log(`[watch] new session: ${path.basename(p)}`);
  poll();
});
// Session files are deleted when Claude Code exits — catch that to clear Working status immediately
watcher.on('unlink', (p) => {
  console.log(`[watch] session closed: ${path.basename(p)}`);
  poll();
});

// Initial run + interval polling (respect pollInterval from config, default 15s)
async function startPolling() {
  let intervalMs = 15_000;
  try {
    const configPath = path.join(METRICS_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = await fs.readJson(configPath);
      if (typeof cfg.pollInterval === 'number' && cfg.pollInterval >= 5) {
        intervalMs = cfg.pollInterval * 1000;
      }
    }
  } catch (_) {}
  console.log(`Starting SenJoeru Synapse Collectors... (poll every ${intervalMs / 1000}s)`);
  poll();
  setInterval(poll, intervalMs);
  console.log('Collectors started successfully');
}

startPolling();
