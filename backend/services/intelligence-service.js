/**
 * IntelligenceService — Phase 3 "Engineering Intelligence": explains the data
 * instead of just showing it. 100% zero-token, pure computation over SQLite
 * (tasks + execution history) plus live metrics JSON. Derived/regeneratable —
 * nothing is persisted.
 */
const path = require('path');
const fs = require('fs-extra');
const { IntelligenceRepository } = require('../repositories/intelligence-repository');
const { getAllRepos } = require('../../shared/agent-repos');

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 7;   // a Working/Pending task untouched this long = stalled
const QUIET_DAYS = 7;   // repo with no commit within this = "quiet"
const COLD_DAYS = 30;   // ...within this = "cold", beyond = "stale"

class IntelligenceService {
  /**
   * @param {import('better-sqlite3').Database} db
   * @param {string} metricsDir - absolute path to metrics/ (for live agent state)
   */
  constructor(db, metricsDir) {
    this.repo = new IntelligenceRepository(db);
    this.metricsDir = metricsDir;
  }

  _read(name) {
    try {
      const p = path.join(this.metricsDir, name);
      return fs.existsSync(p) ? fs.readJsonSync(p) : null;
    } catch (_) { return null; }
  }

  /** One computed snapshot that answers: what happened today, what's active, what's blocked. */
  summary(now = new Date()) {
    const todayStr = now.toISOString().slice(0, 10);
    const staleCutoff = new Date(now.getTime() - STALE_DAYS * DAY_MS).toISOString();

    // ── Today's recap (3.1) ────────────────────────────────────────────────
    const commitsByRepo = this.repo.commitsByRepoOnDay(todayStr);
    const completions = this.repo.completionsOnDay(todayStr);

    // ── Active / blocked (3.2) ─────────────────────────────────────────────
    const workingTasks = this.repo.workingTasks();
    const failedTasks = this.repo.failedTasks();
    const stalledTasks = this.repo.stalledTasks(staleCutoff);

    const agentsData = this._read('agents.json');
    const workingAgents = (agentsData?.agents ?? [])
      .filter((a) => a.status === 'Working')
      .map((a) => ({ name: a.displayName || a.name, role: a.title || a.name, activeCwd: a.activeCwd || null }));

    // ── Repo activity (last commit → state) ────────────────────────────────
    const lastByRepo = Object.fromEntries(
      this.repo.lastCommitPerRepo().map((r) => [r.repo, r.last_commit])
    );
    const repos = getAllRepos().map((repo) => {
      const last = lastByRepo[repo] || null;
      const daysSince = last ? Math.floor((now.getTime() - new Date(last).getTime()) / DAY_MS) : null;
      const state =
        last == null ? 'no-data' :
        daysSince <= QUIET_DAYS ? 'active' :
        daysSince <= COLD_DAYS ? 'quiet' : 'stale';
      return { repo, lastCommit: last, daysSince, state };
    });

    return {
      generatedAt: now.toISOString(),
      today: {
        date: todayStr,
        commits: { total: commitsByRepo.reduce((s, r) => s + r.n, 0), byRepo: commitsByRepo },
        tasksCompleted: completions,
      },
      active: { workingTasks, workingAgents },
      blocked: { failedTasks, stalledTasks },
      repos,
    };
  }
}

module.exports = { IntelligenceService };
