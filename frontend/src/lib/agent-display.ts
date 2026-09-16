/**
 * Small display helpers shared between Team.tsx's dispatch cards and
 * AssistantStats.tsx's HUD-rail tile — both render the same
 * AgentActivityEntry shape, so this is a real shared module (both already
 * live inside the same Vite-bundled frontend tree), not a second Node/browser
 * boundary case like shared/describe-tool-call.js.
 */

/** "backend-engineer" -> "Backend Engineer". */
const ACRONYMS = new Set(['ai', 'qa', 'cs', 'ui', 'ux', 'api', 'ml', 'llm', 'devops'])
export function displayAgentName(slug: string): string {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ')
}

/** "4m12s" / "23s" — matches the elapsed-time style already used elsewhere. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/**
 * How long a dispatch ran — frozen once it is over.
 *
 * A finished dispatch measured against `now` keeps counting up, which is the
 * exact thing this feature exists to stop: the first real test of it showed
 * a completed Explore still ticking, and the only honest reading of a rising
 * number is "still running". Once the agent stops, the duration is a fact
 * about the past and must stop moving.
 */
export function runtimeOf(entry: { status: string; startedAt: number; lastEventAt: number }, now: number): string {
  const end = entry.status === 'done' || entry.status === 'failed' ? entry.lastEventAt : now
  return elapsed(end - entry.startedAt)
}

/**
 * Working/starting first, then most recently active — the ordering both the
 * full dispatch grid (Team.tsx) and the single-entry tiles (AssistantStats,
 * the <700px header chip) use to decide what to show first.
 */
export function sortDispatches<T extends { status: string; lastEventAt: number }>(agents: T[]): T[] {
  return [...agents].sort((a, b) => {
    const rank = (s: string) => (s === 'starting' || s === 'working' ? 0 : 1)
    const r = rank(a.status) - rank(b.status)
    return r !== 0 ? r : b.lastEventAt - a.lastEventAt
  })
}
