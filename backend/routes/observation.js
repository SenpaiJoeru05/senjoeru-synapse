/**
 * Read-only views over the Phase-2 observation-history tables.
 * Populated by ObservationService; never mutated here.
 */
const express = require('express');

function clampLimit(v, def = 100) {
  return Math.min(Math.max(Number(v) || def, 1), 1000);
}

/** @param {import('../repositories/observation-repository').ObservationRepository} repo */
function createObservationRouter(repo) {
  const router = express.Router();

  router.get('/repos', (req, res) => {
    try {
      res.json({ snapshots: repo.getRepoSnapshots(req.query.repo, clampLimit(req.query.limit)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/sessions', (req, res) => {
    try {
      res.json({ sessions: repo.getSessions(clampLimit(req.query.limit)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  router.get('/agent-activity', (req, res) => {
    try {
      res.json({ activity: repo.getAgentActivity(req.query.agent, clampLimit(req.query.limit)) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

module.exports = { createObservationRouter };
