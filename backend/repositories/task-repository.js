/**
 * TaskRepository — the ONLY place that runs SQL for tasks.
 *
 * Per PHASE-1 Repository Pattern: services call these methods; controllers and
 * collectors never touch SQL directly. All writes go through here.
 */
class TaskRepository {
  constructor(db) {
    this.db = db;

    this._getById = db.prepare('SELECT * FROM tasks WHERE id = ?');
    this._getAll = db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC');

    this._upsert = db.prepare(`
      INSERT INTO tasks (
        id, title, assigned_agent, status, progress, priority, eta, notes,
        repos_json, source, task_last_updated, content_hash, present_in_board,
        first_seen_at, updated_at
      ) VALUES (
        @id, @title, @assigned_agent, @status, @progress, @priority, @eta, @notes,
        @repos_json, @source, @task_last_updated, @content_hash, 1,
        @now, @now
      )
      ON CONFLICT(id) DO UPDATE SET
        title             = excluded.title,
        assigned_agent    = excluded.assigned_agent,
        status            = excluded.status,
        progress          = excluded.progress,
        priority          = excluded.priority,
        eta               = excluded.eta,
        notes             = excluded.notes,
        repos_json        = excluded.repos_json,
        source            = excluded.source,
        task_last_updated = excluded.task_last_updated,
        content_hash      = excluded.content_hash,
        present_in_board  = 1,
        updated_at        = excluded.updated_at
    `);

    this._insertHistory = db.prepare(`
      INSERT INTO task_history (
        task_id, title, assigned_agent, status, progress, priority, eta, notes,
        repos_json, task_last_updated, content_hash, captured_at
      ) VALUES (
        @task_id, @title, @assigned_agent, @status, @progress, @priority, @eta,
        @notes, @repos_json, @task_last_updated, @content_hash, @captured_at
      )
    `);

    this._history = db.prepare(
      'SELECT * FROM task_history WHERE task_id = ? ORDER BY captured_at ASC, history_id ASC'
    );
    this._historyCount = db.prepare(
      'SELECT COUNT(*) AS n FROM task_history WHERE task_id = ?'
    );
    this._markAbsent = db.prepare(
      'UPDATE tasks SET present_in_board = 0, updated_at = ? WHERE id = ? AND present_in_board = 1'
    );
    this._allIds = db.prepare('SELECT id FROM tasks WHERE present_in_board = 1');
  }

  getById(id) { return this._getById.get(id); }
  getAll() { return this._getAll.all(); }
  getHistory(id) { return this._history.all(id); }
  historyCount(id) { return this._historyCount.get(id).n; }
  presentIds() { return this._allIds.all().map((r) => r.id); }

  upsert(row) { this._upsert.run(row); }
  insertHistory(row) { this._insertHistory.run(row); }
  markAbsent(id, now) { this._markAbsent.run(now, id); }
}

module.exports = { TaskRepository };
