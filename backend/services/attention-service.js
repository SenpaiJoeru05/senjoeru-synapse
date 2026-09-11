/**
 * AttentionService — Phase "Proactive Attention": the "what needs YOU right now"
 * queue. 100% zero-token, computed on read from SQLite tasks plus the recorded
 * plan-limit snapshot. Derived/regeneratable; nothing persisted.
 *
 * Surfaces four kinds of items a senior engineer should act on:
 *   - failed  : a task marked Failed
 *   - review  : a task waiting in Reviewing
 *   - stalled : a Working/Pending task untouched for >= STALE_DAYS
 *   - limit   : a Claude plan window near or at exhaustion
 *
 * WHY `limit` REPLACED `budget`
 *
 * This used to compare `costs.json` against an hourly/weekly dollar budget. The
 * dollars were never real: the collector priced every token at one flat Sonnet
 * rate, while Chat runs Opus and Assistant Mode runs Haiku, so it overcounted
 * and undercounted at the same time with no way to know the net. And on a
 * subscription there is no per-token bill at all — the figure was a notional
 * API-equivalent price for tokens a flat fee had already covered.
 *
 * What that alert was really for was "warn me before I hit a wall", and the
 * dollar budget was only ever a proxy for the rate limit. Now that the real
 * windows are recorded (see shared/usage-limits.js) the proxy is redundant:
 * "weekly limit 96% used, resets in 3h" is the actual wall, and it cannot
 * drift from reality because the server reports it.
 */

const STALE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const SEV_RANK = { high: 0, medium: 1, low: 2 };

/** Windows worth alerting on, with the wording used in the queue. */
const LIMIT_LABELS = {
  five_hour: 'session (5h) limit',
  seven_day: 'weekly (7d) limit',
  seven_day_opus: 'Opus weekly limit',
  seven_day_sonnet: 'Sonnet weekly limit',
};

/**
 * Almost-out, and worth-knowing.
 *
 * `high` is deliberately close to the wall: a 5-hour window at 80% is normal
 * mid-session and an alert there would fire most afternoons, which is how a
 * queue teaches you to ignore it.
 */
const LIMIT_CRITICAL_PERCENT = 95;
const LIMIT_WARN_PERCENT = 80;

function daysSince(iso, now) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor((now.getTime() - t) / DAY_MS);
}

/** "4h 34m" / "40m", or null when the reset time is unknown or already past. */
function formatReset(resetsAt, nowMs) {
  if (typeof resetsAt !== 'number') return null;
  const seconds = resetsAt - Math.floor(nowMs / 1000);
  if (seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

class AttentionService {
  /**
   * @param {import('../repositories/task-repository').TaskRepository} taskRepo
   * @param {{ getAll: () => object }} settingsService
   * @param {string} [metricsDir] - retained for call-site compatibility; unused
   *   since budget alerts became plan-limit alerts and costs.json stopped
   *   being read here.
   * @param {() => {usage: object|null}} [readUsage] - injectable snapshot reader
   */
  constructor(taskRepo, settingsService, metricsDir, readUsage = null) {
    this.taskRepo = taskRepo;
    this.settingsService = settingsService;
    this.metricsDir = metricsDir;
    /*
     * Injectable so tests can supply a snapshot without writing to the real
     * data directory. Required lazily in the default so that requiring this
     * service never depends on the store being loadable.
     */
    this.readUsage = readUsage
      || (() => {
        try {
          return require('../../shared/usage-store').read();
        } catch (_) { return { usage: null }; }
      });
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

    // ── Plan limit items ──────────────────────────────────────────────────
    const s = this.settingsService ? this.settingsService.getAll() : {};
    /*
     * A configured threshold still applies, because the old budget alert was
     * configurable and taking that away would be a downgrade. It is now a
     * percentage of the real window rather than a dollar ceiling.
     */
    const warnAt = Number(s.usageWarnPercent) > 0
      ? Number(s.usageWarnPercent) : LIMIT_WARN_PERCENT;

    const snapshot = this.readUsage() || {};
    const windows = (snapshot.usage && snapshot.usage.windows) || {};
    for (const [key, win] of Object.entries(windows)) {
      const label = LIMIT_LABELS[key];
      // Unknown window kinds are skipped rather than surfaced by raw key —
      // "seven_day_oauth_apps 12% used" is noise, not an action.
      if (!label || typeof win.usedPercent !== 'number') continue;

      const pct = win.usedPercent;
      const resets = formatReset(win.resetsAt, now.getTime());
      const detail = `${pct}% used${resets ? ` · resets in ${resets}` : ''}`;
      /*
       * `since` is when the reading was taken, not when the window opened.
       * The queue sorts by it, and a snapshot from an hour ago genuinely is
       * older news than a task that changed a minute ago.
       */
      const since = snapshot.usage && snapshot.usage.at
        ? new Date(snapshot.usage.at).toISOString() : null;

      if (pct >= LIMIT_CRITICAL_PERCENT) {
        items.push({ id: `limit:${key}`, kind: 'limit', severity: 'high',
          title: `Almost out of ${label}`, detail, entityId: key, since });
      } else if (pct >= warnAt) {
        items.push({ id: `limit:${key}`, kind: 'limit', severity: 'medium',
          title: `Approaching ${label}`, detail, entityId: key, since });
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
      limit: items.filter((i) => i.kind === 'limit').length,
    };

    return { generatedAt: now.toISOString(), items, counts };
  }
}

module.exports = { AttentionService, STALE_DAYS };
