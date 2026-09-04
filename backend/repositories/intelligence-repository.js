/**
 * IntelligenceRepository — read-only aggregate queries over existing tables
 * (tasks, execution_history) for Phase 3 "explain the data". No writes, no new
 * tables — Phase-3 insights are derived/regeneratable, computed on read.
 */
class IntelligenceRepository {
  constructor(db) {
    this.db = db;

    this._commitsByRepoOnDay = db.prepare(`
      SELECT entity_id AS repo, COUNT(*) AS n
      FROM execution_history
      WHERE event_type = 'git_commit' AND substr(occurred_at, 1, 10) = ?
      GROUP BY entity_id ORDER BY n DESC
    `);
    this._completionsOnDay = db.prepare(`
      SELECT entity_id AS id, title
      FROM execution_history
      WHERE event_type = 'task_completed'
        AND occurred_at IS NOT NULL AND substr(occurred_at, 1, 10) = ?
      ORDER BY occurred_at DESC
    `);
    this._workingTasks = db.prepare(`
      SELECT id, title, status, progress, assigned_agent, task_last_updated
      FROM tasks
      WHERE present_in_board = 1 AND status IN ('Working', 'Reviewing')
      ORDER BY task_last_updated DESC LIMIT 25
    `);
    this._failedTasks = db.prepare(`
      SELECT id, title, status, assigned_agent, task_last_updated
      FROM tasks
      WHERE present_in_board = 1 AND status = 'Failed'
      ORDER BY task_last_updated DESC LIMIT 25
    `);
    this._stalledTasks = db.prepare(`
      SELECT id, title, status, assigned_agent, task_last_updated
      FROM tasks
      WHERE present_in_board = 1
        AND status IN ('Working', 'Reviewing', 'Pending')
        AND (task_last_updated IS NULL OR task_last_updated < ?)
      ORDER BY task_last_updated ASC LIMIT 25
    `);
    this._lastCommitPerRepo = db.prepare(`
      SELECT entity_id AS repo, MAX(occurred_at) AS last_commit
      FROM execution_history
      WHERE event_type = 'git_commit'
      GROUP BY entity_id
    `);
  }

  commitsByRepoOnDay(day) { return this._commitsByRepoOnDay.all(day); }
  completionsOnDay(day) { return this._completionsOnDay.all(day); }
  workingTasks() { return this._workingTasks.all(); }
  failedTasks() { return this._failedTasks.all(); }
  stalledTasks(cutoffIso) { return this._stalledTasks.all(cutoffIso); }
  lastCommitPerRepo() { return this._lastCommitPerRepo.all(); }
}

module.exports = { IntelligenceRepository };
