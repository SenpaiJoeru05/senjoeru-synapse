/**
 * Read-only view of the stored agent personas (Team view).
 * Populated by AgentProfileService; never mutated here.
 */
const express = require('express');

function mapProfile(row) {
  return {
    slug: row.slug,
    displayName: row.display_name,
    title: row.title,
    roleName: row.role_name,
    description: row.description,
    model: row.model,
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
  };
}

/** @param {import('../repositories/agent-profile-repository').AgentProfileRepository} repo */
function createAgentProfilesRouter(repo) {
  const router = express.Router();
  router.get('/', (_req, res) => {
    try { res.json({ profiles: repo.getAll().map(mapProfile) }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  return router;
}

module.exports = { createAgentProfilesRouter, mapProfile };
