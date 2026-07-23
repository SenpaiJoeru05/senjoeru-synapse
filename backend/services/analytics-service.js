/**
 * AnalyticsService — persists significant runtime data into permanent history.
 *
 * This is the "synchronization" role from PHASE-1: the collector produces
 * disposable runtime JSON (metrics/*.json); this service decides what is
 * business-significant and writes it into SQLite history — token/cost per day,
 * headline metrics per day, and append-only execution events (task completions
 * + git commits). All writes are idempotent (upsert-by-day / INSERT-OR-IGNORE),
 * so it is safe to run on every collector poll.
 */
const path = require('path');
const fs = require('fs-extra');

const COMPLETED = new Set(['completed', 'done']);

class AnalyticsService {
  /**
   * @param {import('../repositories/analytics-repository').AnalyticsRepository} repo
   * @param {string} metricsDir - absolute path to the metrics/ directory
   */
  constructor(repo, metricsDir) {
    this.repo = repo;
    this.metricsDir = metricsDir;
  }

  _read(name) {
    try {
      const p = path.join(this.metricsDir, name);
      return fs.existsSync(p) ? fs.readJsonSync(p) : null;
    } catch (_) { return null; }
  }

  /** Per-day token + cost history from tokens.json (unbounded, vs JSON's 7 days). */
  snapshotTokens(now) {
    const tokens = this._read('tokens.json');
    const daily = tokens && Array.isArray(tokens.daily) ? tokens.daily : [];
    let days = 0;
    for (const d of daily) {
      if (!d || !d.date) continue;
      this.repo.upsertTokenDay({ bucket_date: d.date, tokens: d.tokens || 0, cost: d.cost || 0, now });
      this.repo.upsertCostDay({ bucket_date: d.date, cost: d.cost || 0, now });
      days++;
    }
    return days;
  }

  /** Headline engineering metrics, one row per (metric, day). */
  snapshotMetrics(now) {
    const bucket = now.slice(0, 10);
    const agents = this._read('agents.json');
    const tasks = this._read('tasks.json');
    const git = this._read('git.json');

    const agentList = agents && Array.isArray(agents.agents) ? agents.agents : [];
    const taskList = tasks && Array.isArray(tasks.tasks) ? tasks.tasks : [];
    const repoList = git && Array.isArray(git.repos) ? git.repos : [];

    const isCompleted = (s) => COMPLETED.has(String(s || '').toLowerCase());
    const isWorking = (s) => String(s || '').toLowerCase() === 'working';

    const metrics = {
      agents_total: agentList.length,
      agents_working: agentList.filter((a) => isWorking(a.status)).length,
      tasks_total: taskList.length,
      tasks_completed: taskList.filter((t) => isCompleted(t.status)).length,
      tasks_working: taskList.filter((t) => isWorking(t.status)).length,
      repos_tracked: repoList.length,
    };

    for (const [key, value] of Object.entries(metrics)) {
      this.repo.upsertMetric({
        metric_key: key, metric_value: value, bucket_date: bucket, dimensions_json: null, now,
      });
    }
    return metrics;
  }

  /** Append git commits as immutable execution events (dedup by repo+hash). */
  recordGitCommits(now) {
    const git = this._read('git.json');
    const repos = git && Array.isArray(git.repos) ? git.repos : [];
    let added = 0;
    for (const repo of repos) {
      for (const c of (repo.commits || [])) {
        if (!c || !c.hash) continue;
        const isNew = this.repo.insertExecutionIfNew({
          event_type: 'git_commit',
          entity_id: repo.name,
          title: `Commit in ${repo.name}`,
          detail: c.message || '',
          dedupe_key: `commit:${repo.name}:${c.hash}`,
          occurred_at: c.date || null,
          now,
        });
        if (isNew) added++;
      }
    }
    return added;
  }

  /**
   * Record an execution event whenever a task reaches a completed state.
   * Dedup key includes the content hash so re-completions after edits are
   * distinct, but the same completed state is never double-recorded.
   */
  reconcileTaskCompletions(taskRepo, now) {
    if (!taskRepo) return 0;
    let added = 0;
    for (const t of taskRepo.getAll()) {
      if (!COMPLETED.has(String(t.status || '').toLowerCase())) continue;
      const isNew = this.repo.insertExecutionIfNew({
        event_type: 'task_completed',
        entity_id: t.id,
        title: t.title,
        detail: `Completed by ${t.assigned_agent || 'agent'}`,
        dedupe_key: `task:${t.id}:${t.content_hash}`,
        occurred_at: t.task_last_updated || null,
        now,
      });
      if (isNew) added++;
    }
    return added;
  }

  /** Run every snapshot. Idempotent; safe to call on each poll. */
  snapshotAll(taskRepo) {
    const now = new Date().toISOString();
    return {
      tokenDays: this.snapshotTokens(now),
      metrics: this.snapshotMetrics(now),
      commitsAdded: this.recordGitCommits(now),
      completionsAdded: this.reconcileTaskCompletions(taskRepo, now),
    };
  }
}

module.exports = { AnalyticsService };
