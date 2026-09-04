/**
 * InsightsRepository — read-only aggregate queries for Phase 5 analytics over
 * the history tables (execution_history, token_history, repo_snapshots,
 * observed_sessions). No writes; derived on read.
 */
class InsightsRepository {
  constructor(db) {
    this.db = db;

    this._completionsByDay = db.prepare(`
      SELECT substr(occurred_at, 1, 10) AS day, COUNT(*) AS n
      FROM execution_history
      WHERE event_type = 'task_completed' AND occurred_at IS NOT NULL AND substr(occurred_at, 1, 10) >= ?
      GROUP BY day
    `);
    this._commitsByDay = db.prepare(`
      SELECT substr(occurred_at, 1, 10) AS day, COUNT(*) AS n
      FROM execution_history
      WHERE event_type = 'git_commit' AND occurred_at IS NOT NULL AND substr(occurred_at, 1, 10) >= ?
      GROUP BY day
    `);
    this._commitsPerRepo = db.prepare(`
      SELECT entity_id AS repo, COUNT(*) AS commits, MAX(occurred_at) AS last_commit
      FROM execution_history WHERE event_type = 'git_commit'
      GROUP BY entity_id
    `);
    this._snapshotsPerRepo = db.prepare(
      'SELECT repo_name AS repo, COUNT(*) AS changes FROM repo_snapshots GROUP BY repo_name'
    );
    this._tokenSeries = db.prepare(
      'SELECT bucket_date AS day, tokens, cost FROM token_history WHERE bucket_date >= ? ORDER BY bucket_date ASC'
    );
    this._tokenTotals = db.prepare('SELECT SUM(tokens) AS tokens, SUM(cost) AS cost FROM token_history');
    this._sessions = db.prepare(
      'SELECT first_seen_at, last_seen_at, ended_at, active FROM observed_sessions'
    );
    this._taskStatusCounts = db.prepare(
      "SELECT status, COUNT(*) AS n FROM tasks WHERE present_in_board = 1 GROUP BY status"
    );
  }

  completionsByDay(since) { return this._completionsByDay.all(since); }
  commitsByDay(since) { return this._commitsByDay.all(since); }
  commitsPerRepo() { return this._commitsPerRepo.all(); }
  snapshotsPerRepo() { return this._snapshotsPerRepo.all(); }
  tokenSeries(since) { return this._tokenSeries.all(since); }
  tokenTotals() { return this._tokenTotals.get(); }
  sessions() { return this._sessions.all(); }
  taskStatusCounts() { return this._taskStatusCounts.all(); }
}

module.exports = { InsightsRepository };
