/**
 * ObservationService — persists "what is happening" (git/sessions/agents) from
 * the disposable runtime JSON into SQLite so it has history (Phase 2).
 *
 * Read-only observation → the only writer of repo_snapshots / observed_sessions
 * / agent_activity. Idempotent + append-on-change, so it is safe to run on every
 * collector poll. Zero-token.
 */
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');
const { ObservationRepository } = require('../repositories/observation-repository');

function hash(obj) {
  return crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex');
}

function repoFromCwd(cwd) {
  if (!cwd) return null;
  const parts = String(cwd).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || null;
}

class ObservationService {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {string} metricsDir - absolute path to the metrics/ directory
   */
  constructor(db, metricsDir) {
    this.db = db;
    this.metricsDir = metricsDir;
    this.repo = new ObservationRepository(db);
    this._tx = db.transaction((now) => this._run(now));
  }

  _read(name) {
    try {
      const p = path.join(this.metricsDir, name);
      return fs.existsSync(p) ? fs.readJsonSync(p) : null;
    } catch (_) { return null; }
  }

  _snapshotRepos(now) {
    const git = this._read('git.json');
    const repos = git && Array.isArray(git.repos) ? git.repos : [];
    let changed = 0;
    for (const r of repos) {
      if (!r || !r.name) continue;
      const modified = Array.isArray(r.modified) ? r.modified.length : 0;
      const staged = Array.isArray(r.staged) ? r.staged.length : 0;
      const state = {
        branch: r.branch || r.current || null,
        tracking: r.tracking || null,
        ahead: r.ahead || 0,
        behind: r.behind || 0,
        modified,
        staged,
      };
      const h = hash(state);
      if (this.repo.latestRepoHash(r.name) === h) continue; // unchanged
      this.repo.insertRepoSnapshot({
        repo_name: r.name,
        branch: state.branch,
        tracking: state.tracking,
        ahead: state.ahead,
        behind: state.behind,
        modified_count: modified,
        staged_count: staged,
        state_hash: h,
        now,
      });
      changed++;
    }
    return changed;
  }

  _snapshotSessions(now) {
    const data = this._read('sessions.json');
    const list = data && Array.isArray(data.activeSessions) ? data.activeSessions : [];
    const seen = new Set();
    for (const s of list) {
      const id = s.sessionId || (s.pid != null ? String(s.pid) : null);
      if (!id) continue;
      seen.add(id);
      this.repo.upsertSession({
        session_id: id,
        pid: s.pid ?? null,
        cwd: s.cwd || null,
        repo: repoFromCwd(s.cwd),
        kind: s.kind || null,
        version: s.version || null,
        started_at: s.startedAt != null ? String(s.startedAt) : null,
        now,
      });
    }
    // Sessions that were active but are gone now → mark ended.
    let ended = 0;
    for (const id of this.repo.activeSessionIds()) {
      if (!seen.has(id)) { this.repo.markSessionEnded(id, now); ended++; }
    }
    return { seen: seen.size, ended };
  }

  _snapshotAgents(now) {
    const data = this._read('agents.json');
    const agents = data && Array.isArray(data.agents) ? data.agents : [];
    let changed = 0;
    for (const a of agents) {
      if (!a || !a.name) continue;
      const state = { status: a.status || 'Idle', active_cwd: a.activeCwd || null };
      const h = hash(state);
      if (this.repo.latestAgentHash(a.name) === h) continue; // unchanged
      this.repo.insertAgentActivity({
        agent_name: a.name,
        status: state.status,
        active_cwd: state.active_cwd,
        state_hash: h,
        now,
      });
      changed++;
    }
    return changed;
  }

  _run(now) {
    const repoChanges = this._snapshotRepos(now);
    const sessions = this._snapshotSessions(now);
    const agentChanges = this._snapshotAgents(now);
    return {
      repoChanges,
      sessionsSeen: sessions.seen,
      sessionsEnded: sessions.ended,
      agentChanges,
    };
  }

  /** Snapshot all observation signals into SQLite. Idempotent; safe per poll. */
  snapshotAll() {
    return this._tx(new Date().toISOString());
  }
}

module.exports = { ObservationService, repoFromCwd };
