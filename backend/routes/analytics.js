/**
 * Read-only views over the historical tables (token/cost history, metrics
 * time-series, execution history). Populated by AnalyticsService; never mutated
 * here.
 */
const express = require('express');

function mapExec(row) {
  return {
    id: row.id,
    type: row.event_type,
    entityId: row.entity_id,
    title: row.title,
    detail: row.detail,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
  };
}

/** @param {import('../repositories/analytics-repository').AnalyticsRepository} repo */
function createAnalyticsRouter(repo) {
  const router = express.Router();

  router.get('/tokens', (_req, res) => {
    try { res.json({ history: repo.getTokenHistory() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/costs', (_req, res) => {
    try { res.json({ history: repo.getCostHistory() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/metrics', (req, res) => {
    try { res.json({ metrics: repo.getMetrics(req.query.key) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

/** @param {import('../repositories/analytics-repository').AnalyticsRepository} repo */
function createExecutionHistoryRouter(repo) {
  const router = express.Router();
  router.get('/', (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
      res.json({ count: repo.executionCount(), events: repo.getExecutionHistory(limit).map(mapExec) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  return router;
}

module.exports = { createAnalyticsRouter, createExecutionHistoryRouter, mapExec };
