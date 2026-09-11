/**
 * Real Claude subscription usage — the 5-hour session window and the 7-day
 * weekly window — normalised from the two places the CLI will tell us.
 *
 * WHY THIS EXISTS
 *
 * Every usage number the dashboard showed before this was Synapse's own
 * invention: it added up `total_cost_usd` from calls Synapse itself made and
 * drew a bar. That is not the account's usage. It missed every interactive
 * Claude Code session (which is most of the real consumption), and it measured
 * dollars, which is not what the plan limits you on.
 *
 * The limits are account-wide, and that is the fact that makes this cheap:
 * ANY call, on any model, from anywhere, comes back with the account's current
 * utilisation. So a one-line Haiku answer in Assistant Mode reports the same
 * 5h/7d numbers as a heavy Opus session in the terminal. We do not need to
 * poll anything or make a call of our own — we read what is already arriving.
 *
 * THE TWO SOURCES, AND WHY SCALE IS PASSED IN RATHER THAN GUESSED
 *
 * 1. `rate_limit_event` on `claude -p --output-format stream-json`:
 *
 *      { "type": "rate_limit_event",
 *        "rate_limit_info": {
 *          "status": "allowed" | "allowed_warning" | "rejected",
 *          "resetsAt": 1789102800,            // unix SECONDS
 *          "rateLimitType": "five_hour",      // the binding window
 *          "unifiedWindows": {
 *            "five_hour": { "utilization": 0.29, "resetsAt": 1789102800 },
 *            "seven_day": { "utilization": 0.64, "resetsAt": 1789131600 } } } }
 *
 *    Here `utilization` is a FRACTION of 1. Confirmed from the CLI's own
 *    formatter, which renders these windows as `Math.round(u * 100)` — 0.29
 *    is 29%, not 0.29%.
 *
 * 2. The statusline hook's `rate_limits`, which uses different key names and
 *    the other scale entirely:
 *
 *      { "five_hour": { "used_percentage": 29, "resets_at": "2026-09-11T05:00:00Z" } }
 *
 *    `used_percentage` is ALREADY 0-100, and `resets_at` is an ISO string
 *    rather than unix seconds.
 *
 * So the same window arrives as 0.29 from one producer and 29 from the other.
 * Sniffing the magnitude to tell them apart is the obvious shortcut and it is
 * wrong in the only case that matters: a genuine 0.64% and a genuine 64% are
 * both plausible readings of `0.64`, and picking the wrong one would report
 * "you're fine" to someone who has minutes left. The caller knows which
 * producer it read, so the caller states the scale. There is no heuristic.
 */

/** Windows worth surfacing, in the order a person asks about them. */
const WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'];

/** The CLI's own labels for these, so our wording matches `/usage`. */
const LABELS = {
  five_hour: 'session limit',
  seven_day: 'weekly limit',
  seven_day_opus: 'Opus limit',
  seven_day_sonnet: 'Sonnet limit',
};

/** Scale of an incoming `utilization`: a fraction of 1, or already 0-100. */
const FRACTION = 'fraction';
const PERCENT = 'percent';

function toPercent(value, scale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const pct = scale === FRACTION ? value * 100 : value;
  // Clamped because "103% used" reads as a bug even when the server means it.
  // Rounded to one decimal: whole percents lose a week's worth of resolution
  // on the 7-day window, and more precision than that is noise.
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/**
 * Reset time as unix seconds, from either unix seconds or an ISO string.
 *
 * Returns null rather than NaN or a 1970 date — an unknown reset must render
 * as "unknown", never as "resets in -20000 hours".
 */
function toEpochSeconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Milliseconds mistaken for seconds would put the reset ~50,000 years out.
    // Anything past year 5138 is certainly ms.
    return value > 1e11 ? Math.round(value / 1000) : Math.round(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return Math.round(ms / 1000);
  }
  return null;
}

function readWindow(raw, scale) {
  if (!raw || typeof raw !== 'object') return null;
  // `utilization` from the stream, `used_percentage` from the statusline.
  const pct = toPercent(
    typeof raw.utilization === 'number' ? raw.utilization : raw.used_percentage,
    scale,
  );
  if (pct === null) return null;
  return { usedPercent: pct, resetsAt: toEpochSeconds(raw.resets_at ?? raw.resetsAt) };
}

/**
 * One normalised snapshot, or null when there is nothing usable.
 *
 * Null matters: it is the difference between "you have used 0%" and "I cannot
 * see your usage", and the first is a lie we would otherwise tell on every
 * API-key or Bedrock session, where these limits do not apply at all.
 */
function normalize({ source, scale, windows, status = null, binding = null, at = Date.now() }) {
  if (!windows || typeof windows !== 'object') return null;
  if (scale !== FRACTION && scale !== PERCENT) {
    throw new Error(`usage-limits: scale must be "${FRACTION}" or "${PERCENT}", got ${scale}`);
  }

  const out = {};
  for (const key of WINDOWS) {
    const win = readWindow(windows[key], scale);
    if (win) out[key] = win;
  }
  if (!Object.keys(out).length) return null;

  return {
    source,
    at,
    status,
    /** Which window the server says is actually binding right now. */
    binding: binding && out[binding] ? binding : null,
    windows: out,
  };
}

/** From a stream-json `rate_limit_event`'s `rate_limit_info`. */
function fromStreamEvent(info, at = Date.now()) {
  if (!info || typeof info !== 'object') return null;
  return normalize({
    source: 'stream',
    scale: FRACTION,
    windows: info.unifiedWindows,
    status: typeof info.status === 'string' ? info.status : null,
    binding: typeof info.rateLimitType === 'string' ? info.rateLimitType : null,
    at,
  });
}

/** From the statusline hook payload's `rate_limits`. */
function fromStatusline(rateLimits, at = Date.now()) {
  return normalize({ source: 'statusline', scale: PERCENT, windows: rateLimits, at });
}

/** Whole hours and minutes until a reset, or null when it is unknown/past. */
function untilReset(resetsAt, now = Date.now()) {
  if (typeof resetsAt !== 'number') return null;
  const seconds = resetsAt - Math.floor(now / 1000);
  if (seconds <= 0) return null;
  return { hours: Math.floor(seconds / 3600), minutes: Math.round((seconds % 3600) / 60) };
}

/** "4h 44m", "44m", or null. */
function formatReset(resetsAt, now = Date.now()) {
  const left = untilReset(resetsAt, now);
  if (!left) return null;
  if (!left.hours) return `${left.minutes}m`;
  return left.minutes ? `${left.hours}h ${left.minutes}m` : `${left.hours}h`;
}

/**
 * A spoken sentence, for the voice assistant.
 *
 * Deliberately says the numbers and nothing else — asked "how much have I
 * used", an answer that also volunteers advice about pacing is the same
 * over-answering that made "ok thanks" produce a budget report.
 */
function describe(snapshot, now = Date.now()) {
  if (!snapshot) return 'I cannot see your usage limits right now.';
  const parts = [];
  for (const key of WINDOWS) {
    const win = snapshot.windows[key];
    if (!win) continue;
    const reset = formatReset(win.resetsAt, now);
    parts.push(`${LABELS[key]} ${win.usedPercent}% used${reset ? `, resets in ${reset}` : ''}`);
  }
  if (!parts.length) return 'I cannot see your usage limits right now.';
  return `${parts.join('; ')}.`;
}

/** True once a snapshot is old enough that it should be shown as stale. */
function isStale(snapshot, maxAgeMs = 30 * 60 * 1000, now = Date.now()) {
  if (!snapshot || typeof snapshot.at !== 'number') return true;
  return now - snapshot.at > maxAgeMs;
}

module.exports = {
  WINDOWS,
  LABELS,
  FRACTION,
  PERCENT,
  normalize,
  fromStreamEvent,
  fromStatusline,
  untilReset,
  formatReset,
  describe,
  isStale,
};
