/**
 * The HUD rail — the live state of the workspace, beside the sphere.
 *
 * Shown only when the window is wide enough to hold it. The Assistant window
 * opens at 440px, and a stats column at that width leaves the conversation
 * about 250px, which is worse than having no stats at all. It is resizable and
 * now remembers its size, so widening the window is a real gesture with a real
 * result rather than a setting to find.
 *
 * The numbers are this workspace's own — spend, tasks, attention, git. The
 * reference design this borrows its look from showed weather, restaurants and
 * clothes shops, because it was a mock for a consumer assistant. Those would be
 * decoration here; a HUD full of the figures you actually act on is both more
 * useful and, being real, more convincing.
 *
 * Polled rather than pushed: this window renders before the router and its
 * providers (see App.tsx), so the realtime context does not exist here.
 */
import { useEffect, useState } from 'react'
import { AlertTriangle, Coins, GitBranch, Loader2, Play, Clock } from 'lucide-react'
import { api } from '@/lib/api'
import { money, count, usePresentationMode } from '@/lib/presentation'

/** Slow enough to be free, quick enough that a completed task shows up. */
const POLL_MS = 15_000

/** Below this the rail costs the conversation more room than it earns. */
export const RAIL_MIN_WIDTH = 700

/** Track the window width so the rail can appear and disappear with it. */
export function useWideEnough(min = RAIL_MIN_WIDTH): boolean {
  const [wide, setWide] = useState(() => window.innerWidth >= min)
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= min)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [min])
  return wide
}

interface Snapshot {
  attention: number
  topAttention: string | null
  working: number
  waiting: number
  done: number
  today: number
  tokens: number
  repos: number
  dirty: number
  /** Last seven days of spend, for the sparkline. */
  trend: number[]
}

/**
 * A sparkline as an inline SVG.
 *
 * SVG rather than canvas here, unlike the sphere: this repaints every fifteen
 * seconds, not every frame, and seven points of path data costs nothing.
 */
function Spark({ values, hidden: masked }: { values: number[]; hidden: boolean }) {
  if (masked || values.length < 2) {
    return <div className="h-6 rounded bg-white/5" />
  }
  const max = Math.max(...values, 0.0001)
  const w = 100
  const h = 24
  const step = w / (values.length - 1)
  const points = values.map((v, i) => `${i * step},${h - (v / max) * (h - 2) - 1}`)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-6">
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="rgb(34,211,238)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* The area beneath, so a flat week still reads as a chart. */}
      <polyline
        points={`0,${h} ${points.join(' ')} ${w},${h}`}
        fill="rgba(34,211,238,0.12)"
        stroke="none"
      />
    </svg>
  )
}

function Tile({ icon: Icon, label, value, tone = 'normal' }: {
  icon: typeof Coins; label: string; value: string
  tone?: 'normal' | 'warn' | 'good'
}) {
  const colour = tone === 'warn' ? 'text-amber-300'
    : tone === 'good' ? 'text-emerald-300'
      : 'text-cyan-200'
  return (
    <div className="glass rounded-xl px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-gray-500">
        <Icon className="w-3 h-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-0.5 font-mono text-base leading-none tabular-nums ${colour}`}>
        {value}
      </div>
    </div>
  )
}

export default function AssistantStats() {
  const presenting = usePresentationMode()
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true

    const load = async () => {
      const [tasksM, attentionM, costsM, gitM, tokensM] = await Promise.all([
        api.getMetric('tasks').catch(() => null),
        api.getAttention().catch(() => null),
        api.getMetric('costs').catch(() => null),
        api.getMetric('git').catch(() => null),
        api.getMetric('tokens').catch(() => null),
      ])
      if (!alive) return

      // Every source failing means the backend is down, which is worth saying
      // rather than rendering a rail of confident zeroes.
      if (!tasksM && !attentionM && !costsM && !gitM) { setFailed(true); return }
      setFailed(false)

      const tasks: any[] = tasksM?.tasks ?? []
      const items: any[] = attentionM?.items ?? []
      const repos: any[] = gitM?.repos ?? []

      setSnap({
        attention: items.length,
        topAttention: items[0]?.title ?? null,
        working: tasks.filter((t) => t.status === 'Working').length,
        waiting: tasks.filter((t) => t.status === 'Pending' || t.status === 'Reviewing').length,
        done: tasks.filter((t) => t.status === 'Completed').length,
        today: Number(costsM?.today ?? 0),
        tokens: Number(tokensM?.today ?? 0),
        repos: repos.length,
        dirty: repos.reduce((n, r) => n + (r.modified?.length ?? 0), 0),
        trend: (tokensM?.daily ?? []).slice(-7).map((d: any) => Number(d.cost ?? 0)),
      })
    }

    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  if (failed) {
    return (
      <aside className="w-[190px] shrink-0 p-3 text-[11px] text-gray-500">
        Metrics unavailable — is the backend running?
      </aside>
    )
  }

  if (!snap) {
    return (
      <aside className="w-[190px] shrink-0 flex items-center justify-center">
        <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
      </aside>
    )
  }

  return (
    <aside className="w-[190px] shrink-0 overflow-y-auto p-3 space-y-2 border-l border-white/5">
      <div className="text-[9px] uppercase tracking-[0.15em] text-gray-600 px-0.5">
        Workspace
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tile
          icon={AlertTriangle} label="Attention"
          value={String(snap.attention)}
          tone={snap.attention ? 'warn' : 'good'}
        />
        <Tile icon={Play} label="In progress" value={String(snap.working)} />
        <Tile icon={Clock} label="Waiting" value={String(snap.waiting)} />
        <Tile
          icon={GitBranch} label="Modified"
          value={String(snap.dirty)}
          tone={snap.dirty ? 'warn' : 'normal'}
        />
      </div>

      {/* Spend gets the wide tile because it carries a trend as well as a value. */}
      <div className="glass rounded-xl px-2.5 py-2">
        <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-gray-500">
          <span className="flex items-center gap-1.5"><Coins className="w-3 h-3" />Spend today</span>
          {presenting && <span className="text-amber-300/80 normal-case tracking-normal">hidden</span>}
        </div>
        <div className="mt-0.5 font-mono text-base leading-none tabular-nums text-cyan-200">
          {money(snap.today)}
        </div>
        <div className="mt-1.5"><Spark values={snap.trend} hidden={presenting} /></div>
        <div className="mt-1 text-[9px] text-gray-600 font-mono">
          {presenting ? 'tokens hidden' : `${count(snap.tokens)} tokens`}
        </div>
      </div>

      {snap.topAttention && (
        <div className="glass rounded-xl px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500">Top of the queue</div>
          <p className="mt-1 text-[11px] leading-snug text-gray-300 line-clamp-3">
            {snap.topAttention}
          </p>
        </div>
      )}

      <div className="text-[9px] text-gray-700 font-mono px-0.5 pt-1">
        {snap.repos} repo{snap.repos === 1 ? '' : 's'} · {snap.done} done
      </div>
    </aside>
  )
}
