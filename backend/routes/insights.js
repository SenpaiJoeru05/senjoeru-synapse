/** /api/insights — Phase 5 computed analytics (zero-token, derived on read). */
const express = require('express');

/** @param {import('../services/insights-service').InsightsService} service */
function createInsightsRouter(service) {
  const router = express.Router();
  router.get('/summary', (req, res) => {
    try {
      const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 90);
      res.json(service.summary(new Date(), days));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  return router;
}

module.exports = { createInsightsRouter };
