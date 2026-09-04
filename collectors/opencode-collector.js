/**
 * OpenCode collector — makes Joeru's sessions visible in Synapse.
 *
 * Read-only and zero-token, same contract as the Claude collectors: it reads
 * what OpenCode already wrote and never talks to a model.
 *
 * Source is `opencode.db` (SQLite). OpenCode 1.18 moved off the older
 * storage/{session,message,part}/*.json tree — that tree still exists on disk
 * but is frozen at the pre-migration sessions, so reading it reports history
 * that stopped months ago. Read the DB, not the files.
 *
 *   session  one row per conversation, with cost/tokens already aggregated
 *            and `parent_id` set on sessions spawned as subagents
 *   message  `data` is the message JSON (role, agent, cost, tokens)
 *   part     `data` is the part JSON (type, tool, state{input,output})
 *
 * Cost comes from OpenCode's own figures rather than Synapse's pricing table —
 * these runs are on a different provider and free-tier runs really are $0.
 * Recomputing them at Claude prices would invent spend that never happened.
 */

const fs = require('fs-extra');
const path = require('path');
const { getConfig, basename } = require('../shared/workspace-config');

const METRICS_DIR = path.join(__dirname, '../metrics');
const OUTPUT_FILE = path.join(METRICS_DIR, 'opencode.json');

// Keep the payload bounded as history grows; totals stay exact regardless.
const MAX_SESSIONS = 100;
const MAX_DELEGATIONS = 200;

const emptyTokens = () => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });

function addTokens(into, tokens) {
  if (!tokens) return;
  into.input += tokens.input || 0;
  into.output += tokens.output || 0;
  into.reasoning += tokens.reasoning || 0;
  into.cacheRead += tokens.cache?.read || 0;
  into.cacheWrite += tokens.cache?.write || 0;
}

const parseJson = (text) => { try { return JSON.parse(text); } catch { return null; } };

/** `{"id":"nemotron-3-ultra-free","providerID":"opencode"}` → `opencode/nemotron-3-ultra-free` */
function formatModel(raw) {
  if (!raw) return null;
  const m = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!m) return typeof raw === 'string' ? raw : null;
  return m.providerID ? `${m.providerID}/${m.id}` : m.id || null;
}

/**
 * A `task` tool call is one agent handing work to another. OpenCode has moved
 * this input key across versions, so probe the plausible ones rather than
 * pinning to a shape that will quietly stop matching after an upgrade.
 */
function delegationTarget(input) {
  if (!input || typeof input !== 'object') return null;
  return input.subagent_type || input.subagentType || input.agent || input.agentType || null;
}

function openDatabase(file) {
  if (!fs.existsSync(file)) return { db: null, reason: `OpenCode database not found at ${file}` };
  try {
    // node:sqlite is built in on Node 22+, which keeps the collectors free of a
    // native dependency. It is still flagged experimental — the queries here are
    // plain reads, so the exposure is small, but that's why it's isolated.
    const { DatabaseSync } = require('node:sqlite');
    return { db: new DatabaseSync(file, { readOnly: true }), reason: null };
  } catch (err) {
    return { db: null, reason: `Cannot read OpenCode database: ${err.message}` };
  }
}

function unavailable(reason) {
  return {
    lastUpdated: new Date().toISOString(),
    available: false,
    reason,
    totals: { sessions: 0, messages: 0, toolCalls: 0, toolErrors: 0, cost: 0, tokens: emptyTokens() },
    agents: [], delegations: [], sessions: [], tools: {},
  };
}

function collectOpencode() {
  const cfg = getConfig();
  const dbFile = path.join(cfg.paths.opencodeDir, 'opencode.db');

  const { db, reason } = openDatabase(dbFile);
  if (!db) return unavailable(reason);

  try {
    const sessionRows = db.prepare(`
      SELECT id, project_id, parent_id, slug, directory, title, agent, model, cost,
             tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, tokens_cache_write,
             summary_additions, summary_deletions, summary_files, time_created, time_updated
      FROM session ORDER BY time_updated DESC
    `).all();

    const worktrees = {};
    for (const p of db.prepare('SELECT id, worktree FROM project').all()) worktrees[p.id] = p.worktree || '';

    // Group messages and parts by session/message once, rather than querying per row.
    const messagesBySession = new Map();
    for (const row of db.prepare('SELECT id, session_id, data FROM message').all()) {
      const data = parseJson(row.data);
      if (!data) continue;
      if (!messagesBySession.has(row.session_id)) messagesBySession.set(row.session_id, []);
      messagesBySession.get(row.session_id).push({ id: row.id, ...data });
    }

    const partsByMessage = new Map();
    for (const row of db.prepare('SELECT id, message_id, data FROM part').all()) {
      const data = parseJson(row.data);
      if (!data) continue;
      if (!partsByMessage.has(row.message_id)) partsByMessage.set(row.message_id, []);
      partsByMessage.get(row.message_id).push(data);
    }

    const totals = { sessions: 0, messages: 0, toolCalls: 0, toolErrors: 0, cost: 0, tokens: emptyTokens() };
    const byAgent = new Map();
    const tools = {};
    const delegations = [];
    const sessions = [];

    const agentEntry = (name) => {
      if (!byAgent.has(name)) {
        byAgent.set(name, {
          agent: name, sessions: 0, messages: 0, toolCalls: 0,
          cost: 0, tokens: emptyTokens(), lastActive: null,
        });
      }
      return byAgent.get(name);
    };

    // A session with a parent is a subagent run — the delegation actually
    // happening, as opposed to a model merely describing who ought to do it.
    const titleById = new Map(sessionRows.map((s) => [s.id, s.title]));
    for (const s of sessionRows) {
      if (!s.parent_id) continue;
      delegations.push({
        from: titleById.has(s.parent_id) ? (sessionRows.find((p) => p.id === s.parent_id)?.agent || 'unknown') : 'unknown',
        to: s.agent || 'unknown',
        sessionId: s.id,
        parentSessionId: s.parent_id,
        description: s.title || '',
        status: 'session',
        at: s.time_created,
      });
    }

    for (const s of sessionRows) {
      const messages = messagesBySession.get(s.id) || [];
      let toolCalls = 0;
      let toolErrors = 0;
      const agentsSeen = new Set();

      for (const message of messages) {
        if (message.agent) agentsSeen.add(message.agent);

        const isAssistant = message.role === 'assistant';
        const entry = isAssistant ? agentEntry(message.agent || s.agent || 'unknown') : null;

        if (entry) {
          entry.messages += 1;
          entry.cost += message.cost || 0;
          addTokens(entry.tokens, message.tokens);
          const at = message.time?.completed || message.time?.created || null;
          if (at && (!entry.lastActive || at > entry.lastActive)) entry.lastActive = at;
        }

        for (const part of partsByMessage.get(message.id) || []) {
          if (part.type !== 'tool') continue;

          const tool = part.tool || 'unknown';
          tools[tool] = (tools[tool] || 0) + 1;
          toolCalls += 1;
          if (entry) entry.toolCalls += 1;
          if (part.state?.status === 'error') toolErrors += 1;

          if (tool === 'task') {
            const to = delegationTarget(part.state?.input);
            if (to) {
              delegations.push({
                from: message.agent || s.agent || 'unknown',
                to,
                sessionId: s.id,
                parentSessionId: null,
                description: part.state?.input?.description || String(part.state?.input?.prompt || '').slice(0, 200),
                status: part.state?.status || 'unknown',
                at: message.time?.created || s.time_updated,
              });
            }
          }
        }
      }

      for (const name of agentsSeen.size ? agentsSeen : [s.agent || 'unknown']) agentEntry(name).sessions += 1;

      const tokens = {
        input: s.tokens_input || 0,
        output: s.tokens_output || 0,
        reasoning: s.tokens_reasoning || 0,
        cacheRead: s.tokens_cache_read || 0,
        cacheWrite: s.tokens_cache_write || 0,
      };
      const directory = s.directory || worktrees[s.project_id] || '';

      totals.sessions += 1;
      totals.messages += messages.length;
      totals.toolCalls += toolCalls;
      totals.toolErrors += toolErrors;
      totals.cost += s.cost || 0;
      for (const k of Object.keys(totals.tokens)) totals.tokens[k] += tokens[k];

      sessions.push({
        id: s.id,
        parentId: s.parent_id || null,
        slug: s.slug || '',
        title: s.title || '(untitled)',
        directory,
        repo: directory ? basename(directory) : '',
        agent: s.agent || 'unknown',
        agents: [...agentsSeen],
        model: formatModel(s.model),
        messages: messages.length,
        toolCalls,
        toolErrors,
        cost: s.cost || 0,
        tokens,
        additions: s.summary_additions || 0,
        deletions: s.summary_deletions || 0,
        filesChanged: s.summary_files || 0,
        created: s.time_created || null,
        updated: s.time_updated || null,
      });
    }

    delegations.sort((a, b) => (b.at || 0) - (a.at || 0));
    const agents = [...byAgent.values()].sort((a, b) => b.messages - a.messages);

    return {
      lastUpdated: new Date().toISOString(),
      available: true,
      databasePath: dbFile,
      totals,
      agents,
      delegations: delegations.slice(0, MAX_DELEGATIONS),
      sessions: sessions.slice(0, MAX_SESSIONS),
      tools,
    };
  } finally {
    try { db.close(); } catch { /* already closed */ }
  }
}

/** Write metrics/opencode.json. Never throws — a broken read must not stop the poll. */
async function writeOpencodeMetrics() {
  try {
    const data = collectOpencode();
    await fs.writeJson(OUTPUT_FILE, data, { spaces: 2 });
    return data;
  } catch (err) {
    console.error('[opencode] collect failed:', err.message);
    return null;
  }
}

module.exports = { collectOpencode, writeOpencodeMetrics, OUTPUT_FILE };

// `node collectors/opencode-collector.js` for a one-shot check.
if (require.main === module) {
  const data = collectOpencode();
  console.log(JSON.stringify({ ...data, sessions: data.sessions.slice(0, 5) }, null, 2));
}
