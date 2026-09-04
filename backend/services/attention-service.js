/**
 * AttentionService — Phase "Proactive Attention": the "what needs YOU right now"
 * queue. 100% zero-token, computed on read from SQLite tasks + settings budgets +
 * the disposable cost metrics. Derived/regeneratable; nothing persisted.
 *
 * Surfaces four kinds of items a senior engineer should act on:
 *   - failed  : a task marked Failed
 *   - review  : a task waiting in Reviewing
 *   - stalled : a Working/Pending task untouched for >= STALE_DAYS
 *   - budget  : hourly/weekly AI spend at/over the configured budget
 */
const fs = require('fs-extra');
const path = require('path');

const STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEV_RANK = { high: 0, medium: 1, low: 2 };

function daysSince(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

class AttentionService {
  /**
   * @param {import('../repositories/task-repository').TaskRepository} taskRepo
   * @param {{ getAll: () => object }} settingsService
   * @param {string} metricsDir - absolute path to metrics/ (for costs.json)
   */
  constructor(taskRepo, settingsService, metricsDir) {
    this.taskRepo = taskRepo;
    this.settingsService = settingsService;
    this.metricsDir = metricsDir;
  }

  _readCosts() {
    try {
      const p = path.join(this.metricsDir, 'costs.json');
      return fs.existsSync(p) ? fs.readJsonSync(p) : {};
    } catch (_) { return {}; }
  }

  summary(now = new Date()) {
    const items = [];

    // ── Task-derived items ────────────────────────────────────────────────
    const tasks = this.taskRepo ? this.taskRepo.getAll() : [];
    for (const t of tasks) {
      if (t.present_in_board === 0) continue; // removed from the board → not actionable
      const status = t.status || '';
      const last = t.task_last_updated || t.updated_at || null;
      const who = t.assigned_agent ? ` · ${t.assigned_agent}` : '';

      if (status === 'Failed') {
        items.push({ id: `failed:${t.id}`, kind: 'failed', severity: 'high',
          title: t.title || 'Untitled task', detail: `Failed${who}`, entityId: t.id, since: last });
      } else if (status === 'Reviewing') {
        items.push({ id: `review:${t.id}`, kind: 'review', severity: 'medium',
          title: t.title || 'Untitled task', detail: `Waiting for your review${who}`, entityId: t.id, since: last });
      } else if (status === 'Working' || status === 'Pending') {
        const d = daysSince(last, now);
        if (d != null && d >= STALE_DAYS) {
          items.push({ id: `stalled:${t.id}`, kind: 'stalled', severity: 'medium',
            title: t.title || 'Untitled task', detail: `${status} · untouched ${d}d${who}`, entityId: t.id, since: last });
        }
      }
    }

    // ── Budget items ──────────────────────────────────────────────────────
    const s = this.settingsService ? this.settingsService.getAll() : {};
    const c = this._readCosts();
    const budgets = [
      { key: 'weekly', label: 'weekly', spent: Number(c.weekly) || 0, limit: Number(s.weeklyBudget) || 0 },
      { key: 'hourly', label: 'this hour', spent: Number(c.thisHour) || 0, limit: Number(s.hourlyBudget) || 0 },
    ];
    for (const b of budgets) {
      if (b.limit <= 0) continue;
      const pct = b.spent / b.limit;
      const detail = `$${b.spent.toFixed(2)} / $${b.limit.toFixed(2)} (${Math.round(pct * 100)}%)`;
      if (pct >= 1) {
        items.push({ id: `budget:${b.key}`, kind: 'budget', severity: 'high',
          title: `Over ${b.label} AI budget`, detail, entityId: b.key, since: c.lastUpdated || null });
      } else if (pct >= 0.9) {
        items.push({ id: `budget:${b.key}`, kind: 'budget', severity: 'medium',
          title: `Near ${b.label} AI budget`, detail, entityId: b.key, since: c.lastUpdated || null });
      }
    }

    // High severity first, then most-recent within a severity.
    items.sort((a, b) =>
      (SEV_RANK[a.severity] - SEV_RANK[b.severity]) ||
      (new Date(b.since || 0).getTime() - new Date(a.since || 0).getTime()));

    const counts = {
      total: items.length,
      high: items.filter((i) => i.severity === 'high').length,
      failed: items.filter((i) => i.kind === 'failed').length,
      review: items.filter((i) => i.kind === 'review').length,
      stalled: items.filter((i) => i.kind === 'stalled').length,
      budget: items.filter((i) => i.kind === 'budget').length,
    };

    return { generatedAt: now.toISOString(), items, counts };
  }
}

module.exports = { AttentionService, STALE_DAYS };
