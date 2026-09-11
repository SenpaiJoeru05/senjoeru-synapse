/**
 * Real subscription usage: the 5-hour session window and the 7-day weekly one.
 *
 * These are the limits the plan actually enforces, reported by the API itself.
 * They are unrelated to the dollar figures on the Overview page — that is a
 * budget Joel set himself, and a percentage of it says nothing about whether
 * he is about to be cut off mid-session.
 *
 * Three states, and the third is the one worth getting right:
 *   - fresh   → the numbers, with time to reset
 *   - stale   → the numbers, explicitly labelled with their age
 *   - unknown → says so, and draws no bars
 *
 * "Unknown" must never render as 0%. It is what an API-key, Bedrock or Vertex
 * session shows permanently (plan windows do not apply there), and what every
 * session shows until the first answer streams. An empty bar in that state
 * reads as "you have your whole allowance left", which is the one wrong
 * impression this widget exists to prevent.
 */
import { useEffect, useState } from 'react'
import { Activity } from 'lucide-react'
import { api } from '../lib/api'

interface Window {
  usedPercent: number
  /** Unix SECONDS, or null when unknown. */
  resetsAt: number | null
}

interface Snapshot {
  at: number
  status: string | null
  binding: string | null
  windows: Record<string, Window>
}

interface Payload {
  usage: Snapshot | null
  stale: boolean
  ageMs: number | null
}

/** Matches the CLI's own wording, so this and `/usage` do not disagree. */
const LABELS: Record<string, string> = {
  five_hour: 'Session (5h)',
  seven_day: 'Weekly (7d)',
  seven_day_opus: 'Opus (7d)',
  seven_day_sonnet: 'Sonnet (7d)',
}
const ORDER = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']

function tone(pct: number) {
  if (pct > 90) return 'rgb(248,113,113)'
  if (pct > 75) return 'rgb(251,146,60)'
  if (pct > 50) return 'rgb(252,211,77)'
  return 'rgb(34,211,238)'
}

/** "4h 57m" / "44m" / null. Local, so the bar and the label cannot drift. */
function formatReset(resetsAt: number | null, now: number): string | null {
  if (typeof resetsAt !== 'number') return null
  const seconds = resetsAt - Math.floor(now / 1000)
  if (seconds <= 0) return null
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  if (!hours) return `${minutes}m`
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return 'never'
  const minutes = Math.round(ageMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
}

export default function UsageLimits({ compact = false }: { compact?: boolean }) {
  const [payload, setPayload] = useState<Payload | null>(null)
  // Ticks the reset countdown without re-fetching — the reset time is fixed,
  // only the distance to it moves.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true

    async function load() {
      try {
        /*
         * Prefer the preload bridge: it reads the snapshot straight from the
         * main process, so it works even when the backend is not running. The
         * HTTP route is the browser build's path (`npm run dev:web`).
         */
        const data = window.electronAPI?.claudeUsage
          ? await window.electronAPI.claudeUsage()
          : await api.usage()
        if (alive) setPayload(data as Payload)
      } catch {
        if (alive) setPayload({ usage: null, stale: true, ageMs: null })
      }
    }

    load()

    /*
     * Pushed updates, so the bars move with the answer that changed them.
     *
     * Without this the widget learned about a new reading on its next poll —
     * up to a minute after the fact, which looks broken when you have just
     * asked a question and are watching the bar. The poll stays as a fallback:
     * the push only exists under Electron, and only covers readings this
     * process recorded (a statusline write from a terminal session arrives via
     * the file, which the poll is what notices).
     */
    const unsubscribe = window.electronAPI?.onClaudeUsageUpdate?.((data) => {
      if (alive) setPayload(data as Payload)
    })

    // Polling is cheap — it reads a small file and never makes a Claude call.
    const poll = setInterval(load, 60_000)
    const tick = setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      alive = false
      clearInterval(poll)
      clearInterval(tick)
      unsubscribe?.()
    }
  }, [])

  const usage = payload?.usage ?? null
  const windows = usage ? ORDER.filter((k) => usage.windows[k]) : []

  /*
   * Two sizes, one component. Compact is the Assistant HUD rail, which is a
   * narrow column of 9-11px glass tiles — a widget with its own larger scale
   * looked pasted on next to the System tile.
   */
  const shell = compact
    ? 'glass rounded-xl px-2.5 py-2'
    : 'rounded-xl border border-white/10 bg-white/[0.03] p-3 backdrop-blur'
  const heading = compact
    ? 'text-[9px] uppercase tracking-wider text-gray-500'
    : 'flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-gray-400'
  const nameSize = compact ? 'text-[9.5px]' : 'text-[11px]'
  const pctSize = compact ? 'text-[9.5px]' : 'text-[11px]'
  const bodySize = compact ? 'text-[9px] leading-snug' : 'text-[11px] leading-relaxed'

  return (
    <div className={shell}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={heading}>
          {!compact && <Activity className="h-3.5 w-3.5" />} Plan limits
        </span>
        {usage && (
          <span
            className={`font-mono tabular-nums ${compact ? 'text-[9px]' : 'text-[10px]'} ${payload?.stale ? 'text-amber-400/80' : 'text-gray-600'}`}
            title={payload?.stale ? 'No answer has streamed recently, so this reading is old' : 'Observed on the last answer'}
          >
            {formatAge(payload?.ageMs ?? null)}
          </span>
        )}
      </div>

      {!usage || !windows.length ? (
        /*
         * Deliberately no bars here. See the note at the top — an empty bar in
         * this state is read as "nothing used", which is the opposite of what
         * "not observed yet" means.
         */
        <p className={`${bodySize} text-gray-600`}>
          Not seen yet — arrives with the next answer. Nothing is spent to check.
        </p>
      ) : (
        <div className={compact ? 'space-y-1.5' : 'space-y-2.5'}>
          {windows.map((key) => {
            const win = usage.windows[key]
            const reset = formatReset(win.resetsAt, now)
            const isBinding = usage.binding === key
            return (
              <div key={key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`${nameSize} ${isBinding ? 'text-gray-300' : 'text-gray-500'}`}>
                    {LABELS[key] ?? key}
                  </span>
                  <span className={`font-mono ${pctSize} tabular-nums text-gray-300`}>
                    {win.usedPercent}%
                  </span>
                </div>
                <div className={`mt-1 overflow-hidden rounded-full bg-white/[0.07] ${compact ? 'h-1' : 'h-1.5'}`}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, win.usedPercent))}%`,
                      background: tone(win.usedPercent),
                      transition: 'width 600ms ease-out, background 600ms linear',
                    }}
                  />
                </div>
                <p className="mt-0.5 font-mono text-[9px] tabular-nums text-gray-600">
                  {reset ? `resets in ${reset}` : 'reset unknown'}
                </p>
              </div>
            )
          })}
          {usage.status === 'rejected' && (
            <p className="text-[9.5px] font-medium text-red-400">
              Limit reached — requests rejected.
            </p>
          )}
          {usage.status === 'allowed_warning' && (
            <p className="text-[9.5px] font-medium text-amber-400">Approaching the limit.</p>
          )}
        </div>
      )}
    </div>
  )
}
