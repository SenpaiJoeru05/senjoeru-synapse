/**
 * /api/agent-network — returns the current laid-out React Flow graph plus the
 * latest activity events (used for the page's initial paint before the first
 * WebSocket push arrives). Always returns valid JSON, never crashes.
 */
const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const { buildLaidOutGraph } = require('../lib/graph-builder');

const router = express.Router();
const METRICS_DIR = path.join(__dirname, '../../metrics');

async function readActivity() {
  try {
    const p = path.join(METRICS_DIR, 'activity.json');
    if (!(await fs.pathExists(p))) return [];
    const data = await fs.readJson(p);
    return Array.isArray(data.events) ? data.events : [];
  } catch (_) {
    return [];
  }
}

router.get('/', async (_req, res) => {
  try {
    const [{ nodes, edges }, activity] = await Promise.all([
      buildLaidOutGraph(),
      readActivity(),
    ]);
    res.json({
      type: 'agent-network:update',
      timestamp: new Date().toISOString(),
      nodes,
      edges,
      activity,
    });
  } catch (error) {
    // Never crash — return an empty-but-valid graph.
    res.json({
      type: 'agent-network:update',
      timestamp: new Date().toISOString(),
      nodes: [],
      edges: [],
      activity: [],
      error: error.message,
    });
  }
});

module.exports = router;
