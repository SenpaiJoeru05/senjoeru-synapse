/**
 * AgentProfileService — imports agent personas (read-only) from the collector's
 * agents.json into SQLite so the Team/profiles view has a permanent record.
 *
 * Observer-only: `.claude/agents/*.md` is Claude-owned; the collector parses it
 * into metrics/agents.json, and this service upserts the persona fields into the
 * agent_profiles table (keyed by the wiring slug). Idempotent; safe per poll.
 */
const path = require('path');
const fs = require('fs-extra');

// Fallback slug when an older agents.json lacks the `slug` field.
function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

class AgentProfileService {
  /**
   * @param {import('../repositories/agent-profile-repository').AgentProfileRepository} repo
   * @param {string} metricsDir - absolute path to the metrics/ directory
   */
  constructor(repo, metricsDir) {
    this.repo = repo;
    this.metricsDir = metricsDir;
  }

  _readAgents() {
    try {
      const p = path.join(this.metricsDir, 'agents.json');
      const data = fs.existsSync(p) ? fs.readJsonSync(p) : null;
      return data && Array.isArray(data.agents) ? data.agents : [];
    } catch (_) { return []; }
  }

  /** Upsert every agent's persona into SQLite. Returns count synced. */
  sync() {
    const agents = this._readAgents();
    const now = new Date().toISOString();
    let synced = 0;
    for (const a of agents) {
      if (!a || !a.name) continue;
      this.repo.upsert({
        slug: a.slug || slugify(a.name),
        display_name: a.displayName || null,
        title: a.title || null,
        role_name: a.name,
        description: a.currentTask || null,
        model: a.model || null,
        now,
      });
      synced++;
    }
    return { synced };
  }
}

module.exports = { AgentProfileService, slugify };
