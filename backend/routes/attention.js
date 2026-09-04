/**
 * Read-only "needs your attention" queue (zero-token, derived on read).
 */
const express = require('express');

/** @param {import('../services/attention-service').AttentionService} service */
function createAttentionRouter(service) {
  const router = express.Router();
  router.get('/', (req, res) => {
    try {
      res.json(service.summary(new Date()));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
  return router;
}

module.exports = { createAttentionRouter };
