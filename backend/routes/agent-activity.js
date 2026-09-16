/**
 * Ingest for Claude Code's subagent hooks, and a REST snapshot for a fresh
 * page load. See backend/services/agent-activity-service.js for what this
 * actually does with an event, and docs/plans/AGENT-ACTIVITY-VISIBILITY.md
 * for the full design.
 *
 * Called by a `command`-type hook (see joeru-kit's buildHooks()), not by the
 * frontend — this is Synapse's first INBOUND integration point from Claude
 * Code itself, flagged as such in the design doc rather than treated as just
 * another route.
 */
const express = require('express');

/** @param {import('../services/agent-activity-service').AgentActivityService} service */
function createAgentActivityRouter(service, onIngest) {
  const router = express.Router();

  /*
   * No auth, same as every other route here — consistent with this
   * project's stated model (localhost only, trusts all local callers). No
   * new trust boundary: the same tool-call detail already lands on disk in
   * .claude/projects/**\/*.jsonl, which the collector already reads in full;
   * this only changes the delivery mechanism for the subset that matters.
   *
   * Always 200, even on a malformed body - ingest() never throws (tested),
   * but this endpoint must never be the reason a hook script's fire-and-
   * forget POST looks like a failure in some log somewhere. The hook is
   * async and nothing reads this response anyway.
   */
  router.post('/agent-events', (req, res) => {
    try {
      service.ingest(req.body);
      onIngest?.();
    } catch (_) { /* ingest() does not throw, but a hostile body must never 500 here */ }
    res.json({ ok: true });
  });

  router.get('/agent-activity', (req, res) => {
    res.json({ agents: service.snapshot() });
  });

  return router;
}

module.exports = { createAgentActivityRouter };
