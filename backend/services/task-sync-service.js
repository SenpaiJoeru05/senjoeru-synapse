/**
 * TaskSyncService — imports the Claude-authored task board into SQLite.
 *
 * Ownership (ARCHITECTURE-V2 "Sanctioned exception: Tasks"):
 *   Claude agents  ->  .claude/tasks.json  ->  THIS service  ->  SQLite  ->  UI
 * The flow is one-directional. This service READS tasks.json (never writes it)
 * and is the ONLY writer of the SQLite tasks/task_history tables.
 *
 * History model = Option A (append-only): every DISTINCT state a task has ever
 * had is captured once in task_history. Re-running with no changes writes
 * nothing new (idempotent); each real change appends exactly one snapshot.
 */
const crypto = require('crypto');
const { readBoardFile, normalizeBoard } = require('../../shared/tasks-board');
const { TaskRepository } = require('../repositories/task-repository');

/** Stable fingerprint of a task's meaningful content (for change detection). */
function contentHash(t) {
  const canonical = JSON.stringify({
    title: t.title,
    assignedAgent: t.assignedAgent,
    status: t.status,
    progress: t.progress,
    priority: t.priority,
    eta: t.eta,
    notes: t.notes,
    repos: t.repos,
  });
  return crypto.createHash('sha1').update(canonical).digest('hex');
}

class TaskSyncService {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {string} boardPath - absolute path to .claude/tasks.json
   */
  constructor(db, boardPath) {
    this.db = db;
    this.boardPath = boardPath;
    this.repo = new TaskRepository(db);
    // Wrap a full sync in one transaction so a mid-sync crash never leaves the
    // history table half-written.
    this._syncTx = db.transaction((tasks, source, now) =>
      this._applyTasks(tasks, source, now)
    );
  }

  _applyTasks(tasks, source, now) {
    const summary = { created: 0, updated: 0, unchanged: 0, historyWritten: 0, total: tasks.length };
    const seen = new Set();

    for (const t of tasks) {
      seen.add(t.id);
      const hash = contentHash(t);
      const existing = this.repo.getById(t.id);
      const reposJson = JSON.stringify(t.repos || []);

      const changed = !existing || existing.content_hash !== hash;
      if (!changed) { summary.unchanged++; continue; }

      this.repo.upsert({
        id: t.id,
        title: t.title,
        assigned_agent: t.assignedAgent,
        status: t.status,
        progress: t.progress,
        priority: t.priority,
        eta: t.eta,
        notes: t.notes,
        repos_json: reposJson,
        source,
        task_last_updated: t.lastUpdated || null,
        content_hash: hash,
        now,
      });

      // Append-only snapshot of this new/changed state.
      this.repo.insertHistory({
        task_id: t.id,
        title: t.title,
        assigned_agent: t.assignedAgent,
        status: t.status,
        progress: t.progress,
        priority: t.priority,
        eta: t.eta,
        notes: t.notes,
        repos_json: reposJson,
        task_last_updated: t.lastUpdated || null,
        content_hash: hash,
        captured_at: now,
      });
      summary.historyWritten++;
      if (existing) summary.updated++; else summary.created++;
    }

    // Tasks that vanished from the board are RETAINED (permanent record) but
    // flagged so the UI can tell "current" from "historical". History is kept.
    let removed = 0;
    for (const id of this.repo.presentIds()) {
      if (!seen.has(id)) { this.repo.markAbsent(id, now); removed++; }
    }
    summary.markedAbsent = removed;
    return summary;
  }

  /**
   * Read tasks.json and reconcile SQLite from it. Returns a summary object, or
   * { skipped: true } when the board is missing/unparseable (SQLite untouched).
   */
  sync() {
    const board = readBoardFile(this.boardPath);
    if (!board) return { skipped: true, reason: 'board missing or unparseable' };
    const tasks = normalizeBoard(board);
    const now = new Date().toISOString();
    const source = board.source || 'claude-tasks';
    return this._syncTx(tasks, source, now);
  }
}

module.exports = { TaskSyncService, contentHash };
