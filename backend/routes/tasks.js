/**
 * /api/tasks — read-only views over the SQLite task store (permanent record +
 * append-only history). Writes happen only via TaskSyncService importing
 * `.claude/tasks.json`; these endpoints never mutate anything.
 */
const express = require('express');

function mapRepos(json) {
  try { return JSON.parse(json || '[]'); } catch (_) { return []; }
}

function mapTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    assignedAgent: row.assigned_agent,
    status: row.status,
    progress: row.progress,
    priority: row.priority,
    eta: row.eta,
    notes: row.notes,
    repos: mapRepos(row.repos_json),
    source: row.source,
    taskLastUpdated: row.task_last_updated,
    presentInBoard: !!row.present_in_board,
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
  };
}

function mapHistory(row) {
  return {
    historyId: row.history_id,
    taskId: row.task_id,
    title: row.title,
    assignedAgent: row.assigned_agent,
    status: row.status,
    progress: row.progress,
    priority: row.priority,
    eta: row.eta,
    notes: row.notes,
    repos: mapRepos(row.repos_json),
    taskLastUpdated: row.task_last_updated,
    capturedAt: row.captured_at,
  };
}

/** @param {import('../repositories/task-repository').TaskRepository} repo */
function createTasksRouter(repo) {
  const router = express.Router();

  // All current tasks (permanent record).
  router.get('/', (_req, res) => {
    try {
      res.json({
        source: 'sqlite',
        tasks: repo.getAll().map(mapTask),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // One task + its full history.
  router.get('/:id', (req, res) => {
    try {
      const task = mapTask(repo.getById(req.params.id));
      if (!task) return res.status(404).json({ error: 'Task not found' });
      res.json({ task, history: repo.getHistory(req.params.id).map(mapHistory) });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Append-only history for one task.
  router.get('/:id/history', (req, res) => {
    try {
      res.json({
        taskId: req.params.id,
        history: repo.getHistory(req.params.id).map(mapHistory),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

module.exports = { createTasksRouter, mapTask, mapHistory };
