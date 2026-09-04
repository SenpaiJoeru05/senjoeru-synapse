/**
 * InsightsService — Phase 5 "what can we improve?": engineering velocity,
 * repository health, AI cost trends, and session analytics. 100% zero-token,
 * computed from the SQLite history tables. Derived on read.
 */
const { InsightsRepository } = require('../repositories/insights-repository');
const { getAllRepos } = require('../../shared/agent-repos');

const DAY_MS = 24 * 60 * 60 * 1000;

function lastNDates(now, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10));
  return out;
}

class InsightsService {
  constructor(db) { this.repo = new InsightsRepository(db); }

  summary(now = new Date(), days = 30) {
    const dates = lastNDates(now, days);
    const since = dates[0];

    // ── Velocity: completions + commits per day (zero-filled) ──────────────
    const compMap = Object.fromEntries(this.repo.completionsByDay(since).map((r) => [r.day, r.n]));
    const commitMap = Object.fromEntries(this.repo.commitsByDay(since).map((r) => [r.day, r.n]));
    const velocity = dates.map((d) => ({
      day: d.slice(5),            // MM-DD for the chart
      date: d,                    // full ISO yyyy-mm-dd for the calendar heatmap
      completed: compMap[d] || 0,
      commits: commitMap[d] || 0,
    }));
    const totalCompleted = velocity.reduce((s, v) => s + v.completed, 0);
    const totalCommits = velocity.reduce((s, v) => s + v.commits, 0);

    // ── Repository health ──────────────────────────────────────────────────
    const commitsByRepo = Object.fromEntries(this.repo.commitsPerRepo().map((r) => [r.repo, r]));
    const changesByRepo = Object.fromEntries(this.repo.snapshotsPerRepo().map((r) => [r.repo, r.changes]));
    const repoHealth = getAllRepos().map((repo) => {
      const c = commitsByRepo[repo];
      const last = c?.last_commit || null;
      const daysSince = last ? Math.floor((now.getTime() - new Date(last).getTime()) / DAY_MS) : null;
      return {
        repo,
        commits: c?.commits || 0,
        changes: changesByRepo[repo] || 0,
        lastCommit: last,
        daysSince,
      };
    }).sort((a, b) => b.commits - a.commits);

    // ── Cost / token trend ─────────────────────────────────────────────────
    const costMap = Object.fromEntries(this.repo.tokenSeries(since).map((r) => [r.day, r]));
    const cost = dates.map((d) => ({ day: d.slice(5), tokens: costMap[d]?.tokens || 0, cost: costMap[d]?.cost || 0 }));
    const totals = this.repo.tokenTotals();

    // ── Session analytics ──────────────────────────────────────────────────
    const sessions = this.repo.sessions();
    const byHour = new Array(24).fill(0);
    let durSum = 0, durCount = 0, activeNow = 0;
    for (const s of sessions) {
      if (s.active) activeNow++;
      if (s.first_seen_at) {
        const h = new Date(s.first_seen_at).getHours();
        if (h >= 0 && h < 24) byHour[h]++;
      }
      const start = s.first_seen_at ? new Date(s.first_seen_at).getTime() : null;
      const end = s.ended_at ? new Date(s.ended_at).getTime() : (s.last_seen_at ? new Date(s.last_seen_at).getTime() : null);
      if (start && end && end > start) { durSum += (end - start); durCount++; }
    }

    return {
      generatedAt: now.toISOString(),
      windowDays: days,
      velocity: { series: velocity, totalCompleted, totalCommits },
      repoHealth,
      cost: { series: cost, totalTokens: totals.tokens || 0, totalCost: totals.cost || 0 },
      sessions: {
        total: sessions.length,
        activeNow,
        avgDurationMin: durCount ? Math.round(durSum / durCount / 60000) : 0,
        byHour: byHour.map((n, h) => ({ hour: h, sessions: n })),
      },
    };
  }
}

module.exports = { InsightsService };
