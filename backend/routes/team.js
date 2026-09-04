/**
 * /api/team — the AI engineering team (personas + memory), read live from
 * `.claude/agents`. Read-only.
 */
const express = require('express');

/** @param {import('../services/team-service').TeamService} service */
function createTeamRouter(service) {
  const router = express.Router();
  router.get('/', (_req, res) => {
    try { res.json({ team: service.getTeam() }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  return router;
}

module.exports = { createTeamRouter };
