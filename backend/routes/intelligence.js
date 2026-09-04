/**
 * /api/intelligence — Phase 3 computed insights (zero-token, derived on read).
 */
const express = require('express');

/** @param {import('../services/intelligence-service').IntelligenceService} service */
function createIntelligenceRouter(service) {
  const router = express.Router();
  router.get('/summary', (_req, res) => {
    try { res.json(service.summary()); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  return router;
}

module.exports = { createIntelligenceRouter };
