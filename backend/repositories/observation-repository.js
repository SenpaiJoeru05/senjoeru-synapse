/**
 * ObservationRepository — SQL for the Phase-2 observation-history tables:
 * repo_snapshots, observed_sessions, agent_activity.
 *
 * These persist "what is happening" (currently only live JSON) into SQLite so
 * it has history. Read-only observation of external systems → written only by
 * ObservationService.
 */
class ObservationRepository {
  constructor(db) {
    this.db = db;

    // repo_snapshots (append-on-change)
    this._latestRepoHash = db.prepare(
      'SELECT state_hash FROM repo_snapshots WHERE repo_name = ? ORDER BY id DESC LIMIT 1'
    );
    this._insertRepo = db.prepare(`
      INSERT INTO repo_snapshots
        (repo_name, branch, tracking, ahead, behind, modified_count, staged_count, state_hash, captured_at)
      VALUES (@repo_name, @branch, @tracking, @ahead, @behind, @modified_count, @staged_count, @state_hash, @now)
    `);
    this._repoSnapshots = db.prepare(
      'SELECT * FROM repo_snapshots ORDER BY captured_at DESC, id DESC LIMIT ?'
    );
    this._repoSnapshotsByName = db.prepare(
      'SELECT * FROM repo_snapshots WHERE repo_name = ? ORDER BY captured_at DESC, id DESC LIMIT ?'
    );

    // observed_sessions (upsert + mark-ended)
    this._upsertSession = db.prepare(`
      INSERT INTO observed_sessions
        (session_id, pid, cwd, repo, kind, version, started_at, first_seen_at, last_seen_at, ended_at, active)
      VALUES (@session_id, @pid, @cwd, @repo, @kind, @version, @started_at, @now, @now, NULL, 1)
      ON CONFLICT(session_id) DO UPDATE SET
        pid = excluded.pid, cwd = excluded.cwd, repo = excluded.repo,
        kind = excluded.kind, version = excluded.version,
        last_seen_at = excluded.last_seen_at, ended_at = NULL, active = 1
    `);
    this._activeSessionIds = db.prepare(
      'SELECT session_id FROM observed_sessions WHERE active = 1'
    );
    this._markSessionEnded = db.prepare(
      'UPDATE observed_sessions SET active = 0, ended_at = ? WHERE session_id = ? AND active = 1'
    );
    this._sessions = db.prepare(
      'SELECT * FROM observed_sessions ORDER BY last_seen_at DESC LIMIT ?'
    );

    // agent_activity (append-on-change)
    this._latestAgentHash = db.prepare(
      'SELECT state_hash FROM agent_activity WHERE agent_name = ? ORDER BY id DESC LIMIT 1'
    );
    this._insertAgent = db.prepare(`
      INSERT INTO agent_activity (agent_name, status, active_cwd, state_hash, captured_at)
      VALUES (@agent_name, @status, @active_cwd, @state_hash, @now)
    `);
    this._agentActivity = db.prepare(
      'SELECT * FROM agent_activity ORDER BY captured_at DESC, id DESC LIMIT ?'
    );
    this._agentActivityByName = db.prepare(
      'SELECT * FROM agent_activity WHERE agent_name = ? ORDER BY captured_at DESC, id DESC LIMIT ?'
    );
  }

  // repos
  latestRepoHash(name) { return this._latestRepoHash.get(name)?.state_hash ?? null; }
  insertRepoSnapshot(row) { this._insertRepo.run(row); }
  getRepoSnapshots(name, limit = 100) {
    return name ? this._repoSnapshotsByName.all(name, limit) : this._repoSnapshots.all(limit);
  }

  // sessions
  upsertSession(row) { this._upsertSession.run(row); }
  activeSessionIds() { return this._activeSessionIds.all().map((r) => r.session_id); }
  markSessionEnded(id, now) { this._markSessionEnded.run(now, id); }
  getSessions(limit = 100) { return this._sessions.all(limit); }

  // agents
  latestAgentHash(name) { return this._latestAgentHash.get(name)?.state_hash ?? null; }
  insertAgentActivity(row) { this._insertAgent.run(row); }
  getAgentActivity(name, limit = 100) {
    return name ? this._agentActivityByName.all(name, limit) : this._agentActivity.all(limit);
  }
}

module.exports = { ObservationRepository };
