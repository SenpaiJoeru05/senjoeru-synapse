/**
 * Live status of dispatched subagents — in memory, push-driven, not SQLite.
 *
 * WHAT THIS IS FOR
 *
 * Joeru (and any specialist) can delegate with the Task tool, and the
 * dispatched subagent runs invisibly today: the parent conversation shows a
 * `Task`/`Agent` tool call go out and, eventually, a result come back —
 * nothing in between. Verified live before writing this: Claude Code's
 * SubagentStart/PreToolUse/PostToolUse/PostToolUseFailure/SubagentStop hooks
 * fire for a dispatched subagent's OWN internal tool calls, each carrying
 * `agent_id`/`agent_type`, which is exactly what makes a subagent's activity
 * distinguishable from the parent thread's — see docs/plans/
 * AGENT-ACTIVITY-VISIBILITY.md for the full design and how that was checked.
 *
 * WHY IN-MEMORY, NOT A SQLITE TABLE
 *
 * This is a deliberate fit with the ownership model in
 * docs/roadmap/ARCHITECTURE-V2.md's ownership matrix: "Active Agent Status"
 * is explicitly Owner: Collector Engine, Storage: JSON Cache, Persistent: No,
 * Regeneratable: Yes. A restart losing in-flight state is acceptable — the
 * next events rebuild it, and none of this is a business record worth
 * permanent storage. Task 30's own constraint agrees: show what is actively
 * happening NOW, not a full history.
 *
 * WHY NO FAKE PROGRESS BAR
 *
 * There is no reliable total-step count for a dispatched subagent, so a
 * percentage would be a number invented to look precise — the same failure
 * this codebase already caught and rejected once for the CPU gauge ("an idle
 * machine while it is still measuring is a lie the consumer cannot detect").
 * `status` plus a live tool-call count and elapsed time are real; a
 * percentage would not be.
 */
const { describeToolCall } = require('../../shared/describe-tool-call');

/** How many of the most recent actions a card keeps for its trail. */
const RECENT_LIMIT = 5;

/**
 * How long a finished entry stays visible after its last event.
 *
 * Long enough that the user actually SEES "finished" rather than it vanishing
 * the instant the last event lands (a 0ms grace window would look identical
 * to the entry never having existed); short enough that the view does not
 * fill up with old, done work.
 */
const DONE_TTL_MS = 60_000;

class AgentActivityService {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.now] injectable clock, so tests can drive the
   *   TTL sweep without real timers.
   * @param {(cwd: string) => string} [opts.resolveRepo] cwd -> repo NAME.
   *   Defaults to identity-ish (basename), overridable so this service does
   *   not have to import workspace-config itself just to be testable in
   *   isolation from a real config file.
   */
  constructor({ now = () => Date.now(), resolveRepo = defaultResolveRepo } = {}) {
    this.now = now;
    this.resolveRepo = resolveRepo;
    /** @type {Map<string, object>} agentId -> entry */
    this.agents = new Map();
  }

  /**
   * One hook payload in. Never throws — a malformed or unexpected event is
   * ignored rather than taking down the request handler that calls this.
   */
  ingest(event) {
    if (!event || typeof event !== 'object') return;

    /*
     * The one gate that matters: no agent_id, not a subagent's own action.
     *
     * These hooks are configured GLOBALLY (every Claude Code session on the
     * machine), so PreToolUse/PostToolUse fire for the PARENT thread's own
     * tool calls too — verified live, the very first event captured for a
     * Task/Agent dispatch itself carried no agent_id at all. Without this
     * gate, the parent's own Read/Edit/Bash calls would show up as if a
     * "subagent" with no name were doing them.
     */
    const agentId = event.agent_id;
    if (!agentId) return;

    switch (event.hook_event_name) {
      case 'SubagentStart': return this._onStart(event);
      case 'PreToolUse': return this._onPreTool(event);
      case 'PostToolUse': return this._onPostTool(event, 'done');
      case 'PostToolUseFailure': return this._onPostTool(event, 'failed');
      case 'SubagentStop': return this._onStop(event);
      default: return; // an event type this service does not act on yet
    }
  }

  _onStart(event) {
    const cwd = event.cwd || '';
    this.agents.set(event.agent_id, {
      agentId: event.agent_id,
      agentType: event.agent_type || 'agent',
      sessionId: event.session_id || null,
      cwd,
      repo: this.resolveRepo(cwd),
      status: 'starting',
      startedAt: this.now(),
      lastEventAt: this.now(),
      current: null,
      recent: [],
      toolCallCount: 0,
      lastMessage: null,
      // Not exposed in snapshot() directly — internal bookkeeping to match a
      // PostToolUse/PostToolUseFailure back to the PreToolUse it concludes.
      _inFlight: new Map(),
    });
  }

  /** An agent whose SubagentStart this service never saw (e.g. a restart). */
  _getOrAdopt(event) {
    let entry = this.agents.get(event.agent_id);
    if (entry) return entry;
    // Adopt rather than drop: a mid-flight tool call is still real information
    // even if the start event was missed, and dropping it would silently hide
    // a genuinely active agent from every view until it happens to finish.
    entry = {
      agentId: event.agent_id,
      agentType: event.agent_type || 'agent',
      sessionId: event.session_id || null,
      cwd: event.cwd || '',
      repo: this.resolveRepo(event.cwd || ''),
      status: 'working',
      startedAt: this.now(),
      lastEventAt: this.now(),
      current: null,
      recent: [],
      toolCallCount: 0,
      lastMessage: null,
      _inFlight: new Map(),
    };
    this.agents.set(event.agent_id, entry);
    return entry;
  }

  _onPreTool(event) {
    const entry = this._getOrAdopt(event);
    entry.status = 'working';
    entry.lastEventAt = this.now();
    entry.toolCallCount += 1;

    const { icon, label } = describeToolCall(event.tool_name, event.tool_input);
    const action = {
      tool: event.tool_name, detail: label, icon, status: 'in-flight', at: this.now(),
    };
    entry._inFlight.set(event.tool_use_id, action);
    entry.current = action;

    entry.recent.push(action);
    if (entry.recent.length > RECENT_LIMIT) entry.recent.shift();
  }

  _onPostTool(event, status) {
    const entry = this._getOrAdopt(event);
    entry.lastEventAt = this.now();

    const action = entry._inFlight.get(event.tool_use_id);
    if (action) {
      action.status = status;
      entry._inFlight.delete(event.tool_use_id);
      // Only clear `current` if THIS was the one showing — an older call
      // resolving after a newer one started must not blank the newer action.
      if (entry.current === action) entry.current = null;
    }
    // A failed tool call marks that one entry failed without touching the
    // overall status or any earlier, successful action's record.
  }

  _onStop(event) {
    const entry = this._getOrAdopt(event);
    entry.status = 'done';
    entry.lastEventAt = this.now();
    entry.current = null;
    entry.lastMessage = event.last_assistant_message || null;
  }

  /** Drop `done` entries whose grace window has elapsed. Called on a timer. */
  sweep() {
    const cutoff = this.now() - DONE_TTL_MS;
    for (const [id, entry] of this.agents) {
      if (entry.status === 'done' && entry.lastEventAt < cutoff) this.agents.delete(id);
    }
  }

  /** Every current entry, safe to JSON-serialize directly. */
  snapshot() {
    return [...this.agents.values()].map((e) => ({
      agentId: e.agentId,
      agentType: e.agentType,
      sessionId: e.sessionId,
      cwd: e.cwd,
      repo: e.repo,
      status: e.status,
      startedAt: e.startedAt,
      lastEventAt: e.lastEventAt,
      current: e.current ? {
        tool: e.current.tool, detail: e.current.detail, icon: e.current.icon,
        status: e.current.status, at: e.current.at,
      } : null,
      recent: e.recent.map((a) => ({
        tool: a.tool, detail: a.detail, icon: a.icon, status: a.status, at: a.at,
      })),
      toolCallCount: e.toolCallCount,
      lastMessage: e.lastMessage,
    }));
  }
}

/** cwd -> repo name, using no config at all: just the path's own basename. */
function defaultResolveRepo(cwd) {
  return String(cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
}

/**
 * A resolver that knows this workspace's configured repos.
 *
 * Exact match first, then the nearest configured ancestor, then the cwd's
 * own basename — so an unrecognised worktree path still renders as
 * something rather than a blank field.
 */
function configResolveRepo(getConfig) {
  return (cwd) => {
    // Both separator direction AND trailing separator normalised, or a
    // forward-slash cwd (as hooks report it) never matches a backslash-stored
    // config path even when they name the identical directory.
    const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    const target = norm(cwd);
    if (!target) return '';

    const cfg = getConfig();
    const paths = cfg.repoPaths || [];
    let best = null;
    for (const p of paths) {
      const rp = norm(p);
      if (!rp) continue;
      if (target === rp || target.startsWith(`${rp}/`)) {
        // Prefer the LONGEST matching path — the most specific ancestor.
        if (!best || rp.length > best.length) best = rp;
      }
    }
    if (best) return best.split(/[\\/]/).pop();
    return defaultResolveRepo(cwd);
  };
}

module.exports = { AgentActivityService, defaultResolveRepo, configResolveRepo, DONE_TTL_MS };
