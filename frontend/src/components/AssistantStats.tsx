/**
 * The HUD rail — the live state of the workspace, beside the sphere.
 *
 * Shown only when the window is wide enough to hold it. The Assistant window
 * opens at 440px, and a stats column at that width leaves the conversation
 * about 250px, which is worse than having no stats at all. It is resizable and
 * now remembers its size, so widening the window is a real gesture with a real
 * result rather than a setting to find.
 *
 * The numbers are this workspace's own — tasks, attention, git, plan limits. The
 * reference design this borrows its look from showed weather, restaurants and
 * clothes shops, because it was a mock for a consumer assistant. Those would be
 * decoration here; a HUD full of the figures you actually act on is both more
 * useful and, being real, more convincing.
 *
 * Polled rather than pushed: this window renders before the router and its
 * providers (see App.tsx), so the realtime context does not exist here.
 */
import { useEffect, useState } from 'react'
import {
  AlertTriangle, Coins, GitBranch, GitCommit, Loader2, Play, Clock as ClockIcon,
  Sun, Moon, FolderOpen, LayoutDashboard, CheckCircle2, XCircle, Award,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { api } from '@/lib/api'
import { count, usePresentationMode } from '@/lib/presentation'
import { formatBytes } from '@/lib/utils'
import { useAgentActivity } from '@/lib/useAgentActivity'
import { toolIcon } from '@/lib/tool-icons'
import { displayAgentName, runtimeOf, sortDispatches } from '@/lib/agent-display'
import UsageLimits from './UsageLimits'

/** Slow enough to be free, quick enough that a completed task shows up. */
const POLL_MS = 15_000

/**
 * Host health on a quicker cadence than the metrics.
 *
 * CPU is a live figure and a dial that moves every fifteen seconds reads as
 * broken. Measured cost of the endpoint on this machine: 19ms, because it
 * walks the Claude directory to size it (369 files, 24.6MB) — cheap now, and
 * worth re-checking if that directory grows by an order of magnitude.
 */
const HEALTH_MS = 5_000

/** Below this the rail costs the conversation more room than it earns. */
export const RAIL_MIN_WIDTH = 700

/**
 * Above this, the window has room for two rails either side of the
 * conversation instead of one — the Environment rail (clock, host health)
 * on the left and a trimmed Workspace status rail on the right, rather than
 * the single combined `AssistantStats` rail Wide width shows.
 */
export const SPLIT_MIN_WIDTH = 1040

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

/** One tracked repo's branch position, for the "Branches" tile. */
interface RepoStatus {
  name: string
  branch: string
  ahead: number
  behind: number
  /** Modified + created + deleted, combined — "how much is unsaved", not which. */
  modified: number
}

interface Snapshot {
  attention: number
  topAttention: string | null
  working: number
  waiting: number
  done: number
  /** Tasks marked Failed — the other half of `done` in the success rate. */
  failed: number
  /**
   * Completed / (Completed + Failed), 0-100. Null when neither has ever
   * happened yet — there is nothing to divide, and 100% from zero data would
   * be a lie of omission rather than a measurement.
   */
  successRate: number | null
  tokens: number
  repos: number
  dirty: number
  /** Last seven days of token volume, for the sparkline. */
  trend: number[]
  repoStatus: RepoStatus[]
  /** Token breakdown by project — for the pie chart widget. */
  projectBreakdown: Array<{ name: string; tokens: number }>
}

/**
 * The workspace snapshot poll — tasks, attention, git, tokens.
 *
 * Extracted so the Split-width rails can share it rather than each mounting
 * their own copy: the right rail (`WorkspaceStatusRail`) needs this and the
 * left rail (`EnvironmentRail`) does not, so only the component that
 * actually renders these numbers pays for fetching them.
 */
function useWorkspaceSnapshot(): { snap: Snapshot | null; failed: boolean } {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true

    const load = async () => {
      const [tasksM, attentionM, gitM, tokensM] = await Promise.all([
        api.getMetric('tasks').catch(() => null),
        api.getAttention().catch(() => null),
        api.getMetric('git').catch(() => null),
        api.getMetric('tokens').catch(() => null),
      ])
      if (!alive) return

      // Every source failing means the backend is down, which is worth saying
      // rather than rendering a rail of confident zeroes.
      if (!tasksM && !attentionM && !tokensM && !gitM) { setFailed(true); return }
      setFailed(false)

      const tasks: any[] = tasksM?.tasks ?? []
      const items: any[] = attentionM?.items ?? []
      const repos: any[] = gitM?.repos ?? []

      const done = tasks.filter((t) => t.status === 'Completed').length
      const failed = tasks.filter((t) => t.status === 'Failed').length
      const finished = done + failed

      setSnap({
        attention: items.length,
        topAttention: items[0]?.title ?? null,
        working: tasks.filter((t) => t.status === 'Working').length,
        waiting: tasks.filter((t) => t.status === 'Pending' || t.status === 'Reviewing').length,
        done,
        failed,
        successRate: finished > 0 ? Math.round((done / finished) * 100) : null,
        tokens: Number(tokensM?.today ?? 0),
        repos: repos.length,
        dirty: repos.reduce((n, r) => n + (r.modified?.length ?? 0), 0),
        trend: (tokensM?.daily ?? []).slice(-7).map((d: any) => Number(d.tokens ?? 0)),
        repoStatus: repos.map((r: any) => ({
          name: r.name,
          branch: r.branch || r.current || '?',
          ahead: Number(r.ahead ?? 0),
          behind: Number(r.behind ?? 0),
          modified: (r.modified?.length ?? 0) + (r.created?.length ?? 0) + (r.deleted?.length ?? 0),
        })),
        projectBreakdown: (tokensM?.byProject ?? []).map((p: any) => ({
          name: p.name || 'unnamed',
          tokens: Number(p.tokens ?? 0),
        })),
      })
    }

    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return { snap, failed }
}

/**
 * Host health, polled on its own faster cadence (see `HEALTH_MS`).
 *
 * Extracted for the same reason as `useWorkspaceSnapshot`: at Split width
 * this is rendered by `EnvironmentRail` alone, and the unchanged Wide rail
 * below uses it too — one poll shared by whichever of the two is actually
 * mounted, rather than each carrying its own copy of the same fetch effect.
 */
function useSystemHealth(): any | null {
  const [health, setHealth] = useState<any | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => api.getSystemHealth()
      .then((h) => { if (alive) setHealth(h) })
      .catch(() => { if (alive) setHealth(null) })
    load()
    const t = setInterval(load, HEALTH_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return health
}

/** Health checks are cheap and change slowly; matches useAttention's cadence. */
const JOERU_HEALTH_MS = 20_000

/**
 * Whether the OpenCode server Joeru talks through is actually reachable.
 *
 * Distinct from `useSystemHealth` above: that is the host machine (CPU, RAM),
 * this is the one backend service Assistant Mode's slow path depends on.
 * `running: false` on a fresh app start is normal — see joeru-service.js's
 * own `health()`, which this simply polls.
 */
function useJoeruHealth(): { running: boolean; reason?: string } | null {
  const [health, setHealth] = useState<{ running: boolean; reason?: string } | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => api.joeruHealth()
      .then((h) => { if (alive) setHealth(h) })
      .catch(() => { if (alive) setHealth({ running: false, reason: 'unreachable' }) })
    load()
    const t = setInterval(load, JOERU_HEALTH_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return health
}

/** A commit, flattened out of its repo for a cross-repo "recent activity" feed. */
interface CommitEntry {
  repo: string
  hash: string
  message: string
  date: string
}

/** Trimmed shape of an /api/attention item — see attention-service.js. */
interface AttentionItemLite {
  id: string
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
}

/** A repo's folder, for the "Quick links" open-in-Explorer buttons. */
interface RepoLink {
  name: string
  path: string
}

interface EnvExtras {
  commits: CommitEntry[]
  attentionItems: AttentionItemLite[]
  repoLinks: RepoLink[]
}

/**
 * What the Environment rail needs beyond the clock and host health: recent
 * commits across every tracked repo, the top of the attention queue, and each
 * repo's folder for "Quick links".
 *
 * A second poll of `git` and `attention` alongside `useWorkspaceSnapshot`'s
 * own — not merged into it, because that hook only runs on the OTHER side of
 * the window (`WorkspaceStatusRail`) and this one has to work when only the
 * Environment rail is mounted. Same POLL_MS cadence, so both sides of the
 * split move together.
 */
function useEnvironmentExtras(): { data: EnvExtras | null; failed: boolean } {
  const [data, setData] = useState<EnvExtras | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true

    const load = async () => {
      const [gitM, attentionM] = await Promise.all([
        api.getMetric('git').catch(() => null),
        api.getAttention().catch(() => null),
      ])
      if (!alive) return

      if (!gitM && !attentionM) { setFailed(true); return }
      setFailed(false)

      const repos: any[] = gitM?.repos ?? []

      const commits: CommitEntry[] = repos
        .flatMap((r) => (r.commits ?? []).map((c: any) => ({
          repo: r.name, hash: c.hash, message: c.message, date: c.date,
        })))
        // Newest first, across every repo — a commit made a minute ago in
        // fsweb belongs above one from yesterday in senjoeru-synapse.
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 5)

      setData({
        commits,
        attentionItems: (attentionM?.items ?? []).slice(0, 5),
        repoLinks: repos.map((r: any) => ({ name: r.name, path: r.path })),
      })
    }

    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return { data, failed }
}

/** "4m ago" / "3h ago" / "2d ago". Never negative — a clock skew reads as "just now". */
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return ''
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * A one-line badge for finished work: Completed against Failed, from the same
 * split the board tracks. Its own poll rather than riding
 * `useWorkspaceSnapshot` — this renders in Assistant.tsx's centre column,
 * which exists at every window width, not just Wide and Split.
 */
function useTaskSuccess(): { rate: number | null; completed: number; failed: number } | null {
  const [data, setData] = useState<{ rate: number | null; completed: number; failed: number } | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => api.getMetric('tasks')
      .then((m) => {
        if (!alive) return
        const tasks: any[] = m?.tasks ?? []
        const completed = tasks.filter((t) => t.status === 'Completed').length
        const taskFailed = tasks.filter((t) => t.status === 'Failed').length
        const finished = completed + taskFailed
        setData({
          rate: finished > 0 ? Math.round((completed / finished) * 100) : null,
          completed,
          failed: taskFailed,
        })
      })
      .catch(() => { if (alive) setData(null) })
    load()
    const t = setInterval(load, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])

  return data
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

/**
 * A radial gauge — the HUD dial, as an SVG arc.
 *
 * `value` of null means "not measured yet" and draws only the track. That
 * distinction matters: CPU utilisation is a rate, so the server has nothing to
 * report until it has two samples, and drawing 0% would claim an idle machine
 * while it was still measuring — a lie the widget could not detect.
 */
function Gauge({ value, label, size = 46 }: {
  value: number | null; label: string; size?: number
}) {
  const stroke = 3.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  // Three quarters of a turn, opening at the bottom, so it reads as a dial
  // rather than a pie. Rotated so the gap is centred at the foot.
  const sweep = 0.75
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100
  const tone = value === null ? 'rgba(255,255,255,0.25)'
    : value > 85 ? 'rgb(248,113,113)'
      : value > 65 ? 'rgb(252,211,77)'
        : 'rgb(34,211,238)'

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-[225deg]">
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke}
            strokeDasharray={`${c * sweep} ${c}`} strokeLinecap="round"
          />
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke={tone} strokeWidth={stroke}
            strokeDasharray={`${c * sweep * pct} ${c}`} strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 600ms ease-out, stroke 600ms linear' }}
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-[10px] tabular-nums text-gray-300">
          {value === null ? '··' : Math.round(value)}
        </span>
      </div>
      <span className="text-[8px] uppercase tracking-wider text-gray-600">{label}</span>
    </div>
  )
}

/**
 * The clock.
 *
 * Built here because it was claimed to exist and did not: Assistant Mode said
 * it had routed the work to a specialist and later that the widget was done,
 * and neither had happened — no task, no component, no commit. This is the
 * real one.
 *
 * Ticks on its own interval rather than off the metrics poll: a clock that
 * updates every fifteen seconds is a clock that is wrong most of the time.
 *
 * Day and night come from the local hour and nothing else. Actual sunrise and
 * sunset need a latitude, which this app does not have and which would mean an
 * external service — so the label says "day"/"night" on a fixed boundary and
 * does not pretend to know when the sun is up where you are.
 */
function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    // Aligned to the next whole second, so the seconds digit does not appear
    // to skip or stall by drifting against the wall clock.
    let timer: number
    const tick = () => {
      setNow(new Date())
      timer = window.setTimeout(tick, 1000 - (Date.now() % 1000))
    }
    timer = window.setTimeout(tick, 1000 - (Date.now() % 1000))
    return () => window.clearTimeout(timer)
  }, [])

  const hour = now.getHours()
  const daytime = hour >= 6 && hour < 18
  const hh = String(hour).padStart(2, '0')
  const mm = String(now.getMinutes()).padStart(2, '0')
  const ss = String(now.getSeconds()).padStart(2, '0')

  return (
    <div className="glass rounded-xl px-2.5 py-2">
      <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-gray-500">
        <span>Local</span>
        <span className="flex items-center gap-1">
          {daytime
            ? <Sun className="w-3 h-3 text-amber-300/80" />
            : <Moon className="w-3 h-3 text-sky-300/80" />}
          {daytime ? 'day' : 'night'}
        </span>
      </div>
      <div className="mt-0.5 font-mono tabular-nums text-cyan-200 leading-none">
        <span className="text-xl">{hh}:{mm}</span>
        {/* Seconds smaller and dimmer: they carry no decision, and at full
            weight the whole tile flickers in peripheral vision. */}
        <span className="text-xs text-cyan-200/50">:{ss}</span>
      </div>
      <div className="mt-1 text-[9px] text-gray-600 font-mono">
        {now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
      </div>
    </div>
  )
}

/** Seconds to something a person reads at a glance. */
function uptimeLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  return `${m}m`
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

/**
 * Commits across every tracked repo, newest first — what actually landed,
 * not what changed working-directory files (that's `RepoBranchStatus` on the
 * other rail).
 *
 * Absent when there is nothing to show, same rule as every other rail tile:
 * an empty "Recent commits" card is noise, not information.
 */
function RecentCommits({ commits }: { commits: CommitEntry[] }) {
  if (commits.length === 0) return null
  return (
    <div className="glass rounded-xl px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-gray-500">
        <GitCommit className="w-3 h-3 shrink-0" />Recent commits
      </div>
      <div className="mt-1.5 space-y-1.5">
        {commits.map((c) => (
          <div key={`${c.repo}:${c.hash}`}>
            <div className="flex items-center gap-1 text-[9px] text-gray-500">
              <span className="font-mono text-cyan-300/80 shrink-0">{c.hash}</span>
              <span className="truncate">{c.repo}</span>
              <span className="ml-auto shrink-0 font-mono text-gray-600">{timeAgo(c.date)}</span>
            </div>
            <p className="text-[10px] leading-snug text-gray-300 line-clamp-2">{c.message}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Severity, as a dot — same colours as the rest of the HUD's warn/good tones. */
const SEV_DOT: Record<AttentionItemLite['severity'], string> = {
  high: 'bg-error',
  medium: 'bg-amber-400',
  low: 'bg-gray-500',
}

/**
 * The top of the "needs you" queue — what `AttentionNotifier` would toast,
 * read instead of waited for. See attention-service.js for what produces
 * `failed` / `review` / `stalled` / `limit`.
 */
function AttentionList({ items }: { items: AttentionItemLite[] }) {
  if (items.length === 0) return null
  return (
    <div className="glass rounded-xl px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-gray-500">Needs you</div>
      <div className="mt-1.5 space-y-1.5">
        {items.map((it) => (
          <div key={it.id} className="flex items-start gap-1.5">
            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${SEV_DOT[it.severity] ?? SEV_DOT.low}`} />
            <div className="min-w-0">
              <p className="text-[10px] leading-snug text-gray-300 line-clamp-2">{it.title}</p>
              <p className="truncate text-[9px] text-gray-600">{it.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Open a tracked repo's folder, or bring the main dashboard to the front.
 *
 * Gone entirely outside Electron — `openRepo`/`focusMainWindow` cross into the
 * main process, and a browser build (`npm run dev:web`) has none to cross
 * into. A button that cannot work is worse than no button.
 */
function QuickLinks({ repos }: { repos: RepoLink[] }) {
  const canOpenRepo = !!window.electronAPI?.openRepo
  const canFocusMain = !!window.electronAPI?.focusMainWindow
  if (!canOpenRepo && !canFocusMain) return null

  return (
    <div className="glass rounded-xl px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-gray-500">Quick links</div>
      <div className="mt-1.5 space-y-1">
        {canFocusMain && (
          <button
            onClick={() => window.electronAPI?.focusMainWindow?.()}
            className="flex w-full items-center gap-1.5 text-left text-[10px] text-gray-400 transition-colors hover:text-cyan-200"
          >
            <LayoutDashboard className="h-3 w-3 shrink-0" />
            <span className="truncate">Dashboard</span>
          </button>
        )}
        {canOpenRepo && repos.map((r) => (
          <button
            key={r.name}
            onClick={() => window.electronAPI?.openRepo?.(r.path)}
            title={r.path}
            className="flex w-full items-center gap-1.5 text-left text-[10px] text-gray-400 transition-colors hover:text-cyan-200"
          >
            <FolderOpen className="h-3 w-3 shrink-0" />
            <span className="truncate">{r.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Which tracked repos have work not yet committed, at a glance — the git
 * metric's `ahead`/`behind`/`modified` the way a standup would say it, not the
 * single "3 modified" total the Tile grid already carries elsewhere.
 */
function RepoBranchStatus({ repos }: { repos: RepoStatus[] }) {
  if (repos.length === 0) return null
  return (
    <div className="glass rounded-xl px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-gray-500">
        <GitBranch className="h-3 w-3 shrink-0" />Branches
      </div>
      <div className="mt-1.5 space-y-1">
        {repos.map((r) => (
          <div key={r.name} className="flex items-center justify-between gap-1.5 text-[10px]">
            <span className="flex min-w-0 items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${r.modified ? 'bg-amber-400' : 'bg-emerald-400'}`}
                title={r.modified ? `${r.modified} file${r.modified === 1 ? '' : 's'} uncommitted` : 'clean'}
              />
              <span className="truncate text-gray-300">{r.name}</span>
            </span>
            <span className="shrink-0 font-mono text-gray-600">
              {r.modified ? `${r.modified}m` : 'clean'}
              {r.ahead > 0 && ` ↑${r.ahead}`}
              {r.behind > 0 && ` ↓${r.behind}`}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * The board's own status counts, said the way a standup would: what's moving,
 * what's waiting, what landed, what didn't. The Wide rail's Tile grid already
 * shows working/waiting as two of its four squares — this is the Split rail's
 * equivalent, one compact card instead of four, because the Environment rail
 * on the other side of Split is what took the room those tiles used to have.
 */
function StandupSummary({ working, waiting, done, failed }: {
  working: number; waiting: number; done: number; failed: number
}) {
  return (
    <div className="glass rounded-xl px-2.5 py-2">
      <div className="text-[9px] uppercase tracking-wider text-gray-500">Standup</div>
      <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] tabular-nums">
        <div className="flex items-center justify-between">
          <span className="text-gray-500 normal-case">working</span>
          <span className="text-cyan-200">{working}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500 normal-case">waiting</span>
          <span className="text-gray-300">{waiting}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500 normal-case">done</span>
          <span className="text-emerald-300">{done}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-500 normal-case">failed</span>
          <span className={failed ? 'text-red-300' : 'text-gray-600'}>{failed}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Whether Joeru's own backend — the OpenCode server, not the host machine —
 * is actually reachable. See `useJoeruHealth`.
 */
function BackendHealthTile() {
  const health = useJoeruHealth()
  if (!health) return null
  return (
    <div className="glass rounded-xl px-2.5 py-2 flex items-center gap-2">
      {health.running
        ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
        : <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />}
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wider text-gray-500">Joeru API</div>
        <div className={`text-[10px] ${health.running ? 'text-emerald-300' : 'text-red-300'}`}>
          {health.running ? 'online' : 'offline'}
        </div>
      </div>
    </div>
  )
}

/**
 * Token distribution by project — shows which projects are consuming the most tokens.
 * Hidden in presentation mode like other spend metrics.
 */
function TokenBreakdown({ projects, hidden: masked }: {
  projects: Array<{ name: string; tokens: number }>;
  hidden: boolean
}) {
  if (masked || projects.length === 0) {
    return <div className="h-20 rounded bg-white/5" />
  }

  // Sort and take top 5 for readability
  const topProjects = projects
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)

  const total = topProjects.reduce((sum, p) => sum + p.tokens, 0)

  // Pie chart colors — reuse the HUD's palette
  const colors = [
    'rgb(34,211,238)',    // cyan-300
    'rgb(99,102,241)',    // indigo-500
    'rgb(168,85,247)',    // purple-500
    'rgb(236,72,153)',    // pink-500
    'rgb(249,115,22)',    // orange-500
  ]

  return (
    <div className="glass rounded-xl px-2.5 py-2">
      <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-gray-500">
        <span>Token distribution</span>
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        {/* Pie chart */}
        <div style={{ width: '60px', height: '60px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={topProjects}
                dataKey="tokens"
                cx="50%"
                cy="50%"
                innerRadius={15}
                outerRadius={30}
                paddingAngle={1}
              >
                {topProjects.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* List of projects */}
        <div className="min-w-0 flex-1 space-y-0.5">
          {topProjects.map((p, i) => (
            <div key={p.name} className="flex items-center justify-between text-[9px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colors[i % colors.length] }}
                />
                <span className="truncate text-gray-400">{p.name}</span>
              </div>
              <span className="shrink-0 font-mono text-gray-600 ml-1">
                {Math.round((p.tokens / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * A pill for the centre column: how much of finished work actually lands.
 * Sits above the sphere, per the plan's "Success rate badge" — see
 * `useTaskSuccess` for why it renders nothing until there is a finished task
 * to measure.
 */
export function SuccessBadge() {
  const data = useTaskSuccess()
  if (!data || data.rate === null) return null

  const tone = data.rate >= 90
    ? 'text-emerald-300 border-emerald-400/25 bg-emerald-400/[0.07]'
    : data.rate >= 70
      ? 'text-amber-300 border-amber-400/25 bg-amber-400/[0.07]'
      : 'text-red-300 border-red-400/25 bg-red-400/[0.07]'

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium ${tone}`}
      title={`${data.completed} completed, ${data.failed} failed`}
    >
      <Award className="h-3 w-3" />
      {data.rate}% success
    </div>
  )
}

/**
 * The single most-active dispatch, one line, for the rail this window
 * actually has room for. Full multi-card detail (recent-action trail, per-
 * card indeterminate stripe) lives on Team.tsx's "Active Dispatches" — this
 * is the glanceable version, not a second copy of that page.
 *
 * Absent entirely with no dispatches running, same as Team.tsx: nothing here
 * to look at is a fact worth showing as no tile, not an idle placeholder.
 */
function DispatchTile() {
  const { agents } = useAgentActivity()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (agents.length === 0) return null

  const entry = sortDispatches(agents)[0]
  const working = entry.status === 'working' || entry.status === 'starting'
  const CurrentIcon = entry.current ? toolIcon(entry.current.icon) : null

  return (
    <div className={`glass rounded-xl px-2.5 py-2 ${working ? 'border border-primary/25' : ''}`}>
      <div className="flex items-center gap-1.5 text-[11px]">
        {entry.status === 'done' ? <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
          : entry.status === 'failed' ? <span className="w-1.5 h-1.5 rounded-full bg-error shrink-0" />
            : <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 animate-pulse" />}
        <span className="font-semibold truncate">{displayAgentName(entry.agentType)}</span>
        {/* "finished" earns its width here: without it a frozen number and a
            running one look identical, which is the confusion this tile is
            supposed to remove. */}
        <span className="ml-auto text-[9px] text-gray-500 shrink-0 tabular-nums">
          {runtimeOf(entry, now)}
          {entry.status === 'done' && ' · done'}
        </span>
      </div>
      {entry.current ? (
        <div className="mt-1 flex items-center gap-1 text-[10px] text-gray-400">
          {CurrentIcon && <CurrentIcon className="w-3 h-3 text-primary/80 shrink-0" />}
          <span className="truncate">{entry.current.detail}</span>
        </div>
      ) : entry.status === 'done' && entry.lastMessage ? (
        <p className="mt-1 text-[10px] text-gray-400 line-clamp-2">&ldquo;{entry.lastMessage}&rdquo;</p>
      ) : null}
      {working && (
        <div className="mt-1.5 h-0.5 rounded-full bg-white/5 overflow-hidden">
          <div className="h-full w-1/3 rounded-full bg-primary/60 animate-[indeterminate_1.4s_ease-in-out_infinite]" />
        </div>
      )}
    </div>
  )
}

/**
 * Left rail at Split width (>=1040px) — "Environment": the clock and the
 * host's own health, nothing that comes from the workspace API.
 *
 * A separate component (not a slice of `AssistantStats`' JSX) so it can call
 * `useSystemHealth()` on its own and skip the workspace snapshot poll
 * entirely — that data belongs to `WorkspaceStatusRail` on the other side.
 */
export function EnvironmentRail() {
  const health = useSystemHealth()
  const { data: extras } = useEnvironmentExtras()

  return (
    <aside
      aria-label="Environment"
      className="w-[170px] shrink-0 overflow-y-auto p-3 space-y-2 border-r border-white/5"
    >
      <Clock />

      {/*
        Attention before commits: what needs a decision outranks what already
        happened, same ordering AttentionNotifier uses for its own toasts.
      */}
      {extras && <AttentionList items={extras.attentionItems} />}
      {extras && <RecentCommits commits={extras.commits} />}
      {extras && <QuickLinks repos={extras.repoLinks} />}

      {health && (
        <div className="glass rounded-xl px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500">System</div>
          <div className="mt-1.5 flex items-start justify-around">
            <Gauge value={health.cpu?.usagePercent ?? null} label="cpu" />
            <Gauge value={Number(health.memory?.usagePercent ?? 0)} label="mem" />
          </div>
          <div className="mt-1.5 space-y-0.5 font-mono text-[9px] text-gray-600">
            <div className="flex justify-between">
              <span>up</span>
              <span className="text-gray-500">{uptimeLabel(health.uptime ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>ram</span>
              <span className="text-gray-500">
                {formatBytes(health.memory?.used ?? 0)} / {formatBytes(health.memory?.total ?? 0)}
              </span>
            </div>
            {health.claude?.exists && (
              <div className="flex justify-between">
                <span>.claude</span>
                <span className="text-gray-500">{formatBytes(health.claude.size ?? 0)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>cores</span>
              <span className="text-gray-500">{health.cpu?.cores ?? '?'}</span>
            </div>
          </div>
        </div>
      )}
    </aside>
  )
}

/**
 * Right rail at Split width (>=1040px) — "Workspace status": a subset of the
 * Wide rail's tiles, not a duplicate of it. Attention, today's tokens, the
 * one dispatch worth watching, and plan limits — the numbers Joel actually
 * acts on. The per-status task counts, "top of the queue" and the repo/done
 * footer stay Wide-rail-only; the Environment rail alongside this one is
 * what used the room instead.
 */
export function WorkspaceStatusRail() {
  const { snap, failed } = useWorkspaceSnapshot()
  const presenting = usePresentationMode()

  if (failed) {
    return (
      <aside
        aria-label="Workspace status"
        className="w-[190px] shrink-0 p-3 text-[11px] text-gray-500 border-l border-white/5"
      >
        Metrics unavailable — is the backend running?
      </aside>
    )
  }

  if (!snap) {
    return (
      <aside
        aria-label="Workspace status"
        className="w-[190px] shrink-0 flex items-center justify-center border-l border-white/5"
      >
        <Loader2 className="w-4 h-4 text-gray-600 animate-spin" />
      </aside>
    )
  }

  return (
    <aside
      aria-label="Workspace status"
      className="w-[190px] shrink-0 overflow-y-auto p-3 space-y-2 border-l border-white/5"
    >
      <Tile
        icon={AlertTriangle} label="Attention"
        value={String(snap.attention)}
        tone={snap.attention ? 'warn' : 'good'}
      />

      <StandupSummary
        working={snap.working} waiting={snap.waiting} done={snap.done} failed={snap.failed}
      />

      <div className="glass rounded-xl px-2.5 py-2">
        <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-gray-500">
          <span className="flex items-center gap-1.5"><Coins className="w-3 h-3" />Tokens today</span>
          {presenting && <span className="text-amber-300/80 normal-case tracking-normal">hidden</span>}
        </div>
        <div className="mt-0.5 font-mono text-base leading-none tabular-nums text-cyan-200">
          {presenting ? '····' : count(snap.tokens)}
        </div>
        <div className="mt-1.5"><Spark values={snap.trend} hidden={presenting} /></div>
      </div>

      <TokenBreakdown projects={snap.projectBreakdown} hidden={presenting} />

      <RepoBranchStatus repos={snap.repoStatus} />

      <BackendHealthTile />

      <DispatchTile />

      <UsageLimits compact />
    </aside>
  )
}

export default function AssistantStats() {
  const presenting = usePresentationMode()
  const { snap, failed } = useWorkspaceSnapshot()
  const health = useSystemHealth()

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
      <Clock />

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
        <Tile icon={ClockIcon} label="Waiting" value={String(snap.waiting)} />
        <Tile
          icon={GitBranch} label="Modified"
          value={String(snap.dirty)}
          tone={snap.dirty ? 'warn' : 'normal'}
        />
      </div>

      {/*
        Tokens, with the week's trend. This tile used to lead with a dollar
        figure; it no longer does, because that figure priced every token at
        one flat Sonnet rate whatever model actually ran, and on a subscription
        there is no per-token bill to report. The token count underneath it was
        always the real measurement, so it is now the headline, and the
        sparkline plots tokens rather than notional cost.

        Still masked in presentation mode: a volume of work is a weaker signal
        than a dollar amount, but it is not nothing.
      */}
      <div className="glass rounded-xl px-2.5 py-2">
        <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-gray-500">
          <span className="flex items-center gap-1.5"><Coins className="w-3 h-3" />Tokens today</span>
          {presenting && <span className="text-amber-300/80 normal-case tracking-normal">hidden</span>}
        </div>
        <div className="mt-0.5 font-mono text-base leading-none tabular-nums text-cyan-200">
          {presenting ? '····' : count(snap.tokens)}
        </div>
        <div className="mt-1.5"><Spark values={snap.trend} hidden={presenting} /></div>
      </div>

      {/*
        Host health. Deliberately NOT masked by presentation mode — CPU and
        memory are facts about a laptop, not about a business, and there is
        nothing here anyone could learn from a recording.
      */}
      {health && (
        <div className="glass rounded-xl px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-gray-500">System</div>
          <div className="mt-1.5 flex items-start justify-around">
            <Gauge value={health.cpu?.usagePercent ?? null} label="cpu" />
            <Gauge value={Number(health.memory?.usagePercent ?? 0)} label="mem" />
          </div>
          <div className="mt-1.5 space-y-0.5 font-mono text-[9px] text-gray-600">
            <div className="flex justify-between">
              <span>up</span>
              <span className="text-gray-500">{uptimeLabel(health.uptime ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span>ram</span>
              <span className="text-gray-500">
                {formatBytes(health.memory?.used ?? 0)} / {formatBytes(health.memory?.total ?? 0)}
              </span>
            </div>
            {health.claude?.exists && (
              <div className="flex justify-between">
                <span>.claude</span>
                <span className="text-gray-500">{formatBytes(health.claude.size ?? 0)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>cores</span>
              <span className="text-gray-500">{health.cpu?.cores ?? '?'}</span>
            </div>
          </div>
        </div>
      )}

      <BackendHealthTile />

      {/*
        Real plan limits, above the queue because running out of window stops
        every other thing on this rail from being actionable.

        Not masked by presentation mode: a percentage of a rate-limit window
        reveals nothing about the business, unlike the spend figures. It is
        also the reason this is separate from the token sparkline above —
        that one is dollars Joel chose, this one is the cap he cannot exceed.
      */}
      <UsageLimits compact />

      {/*
        What Joeru is delegating right now, if anything — fed by the same
        subagent hooks as Team.tsx's "Active Dispatches". This is the rail's
        only view into it, since this window renders before RealtimeProvider
        exists; see useAgentActivity()'s own independent socket.
      */}
      <DispatchTile />

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
