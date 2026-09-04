import { Fragment, useEffect, useState } from 'react'
import {
  ResponsiveContainer, ComposedChart, Bar, AreaChart, Area, BarChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { TrendingUp, CheckCircle, GitCommit, DollarSign, Clock, RefreshCw, Activity, CalendarDays, Users } from 'lucide-react'
import { api } from '@/lib/api'
import { useTasks } from '@/lib/realtime'

const AXIS = { stroke: '#6b7280', tick: { fill: '#9ca3af', fontSize: 11 }, axisLine: { stroke: '#374151' }, tickLine: false }
const TOOLTIP = {
  contentStyle: { backgroundColor: 'rgba(26,26,36,0.95)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '10px', fontSize: 12 },
  itemStyle: { color: '#fff', fontSize: 12 },
}

function Stat({ icon: Icon, label, value, sub, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; color: string
}) {
  return (
    <div className="glass-card !p-4">
      <div className="flex items-center gap-2 mb-1 text-sm text-gray-400">
        <Icon className={`w-4 h-4 ${color}`} /> {label}
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  )
}

// ── Activity heatmap (GitHub-style calendar over commits + completions) ───────
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
function heatLevel(total: number, max: number): string {
  if (!total) return 'bg-white/[0.04]'
  const r = total / max
  if (r > 0.66) return 'bg-emerald-400'
  if (r > 0.33) return 'bg-emerald-500/70'
  return 'bg-emerald-500/40'
}
function ActivityHeatmap({ series }: { series: any[] }) {
  const days = series
    .filter((d) => d.date)
    .map((d) => ({ date: d.date as string, total: (d.commits || 0) + (d.completed || 0), commits: d.commits || 0, completed: d.completed || 0, dt: new Date(`${d.date}T00:00:00`) }))
  if (days.length === 0) return <p className="text-gray-600 text-xs py-6 text-center">No dated activity yet.</p>

  const firstWeekday = days[0].dt.getDay()
  const numCols = Math.ceil((days.length + firstWeekday) / 7)
  const grid: (typeof days[0] | null)[][] = Array.from({ length: numCols }, () => Array(7).fill(null))
  days.forEach((d, i) => {
    const off = i + firstWeekday
    grid[Math.floor(off / 7)][off % 7] = d
  })
  const max = Math.max(1, ...days.map((d) => d.total))
  const totalActivity = days.reduce((s, d) => s + d.total, 0)

  return (
    <div>
      <div className="flex gap-[3px] overflow-x-auto scrollbar-hide pb-1">
        {/* weekday labels */}
        <div className="flex flex-col gap-[3px] pr-1.5 shrink-0">
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="h-4 w-3 text-[9px] text-gray-600 leading-4 text-right">{i % 2 ? w : ''}</span>
          ))}
        </div>
        {grid.map((col, ci) => (
          <div key={ci} className="flex flex-col gap-[3px] shrink-0">
            {col.map((cell, ri) => cell ? (
              <div
                key={ri}
                title={`${cell.date}: ${cell.commits} commits, ${cell.completed} tasks done`}
                className={`w-4 h-4 rounded-[3px] ${heatLevel(cell.total, max)} hover:ring-1 hover:ring-white/40`}
              />
            ) : <div key={ri} className="w-4 h-4 rounded-[3px] bg-white/[0.03]" />)}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 text-[11px] text-gray-600">
        <span>{totalActivity} events over {days.length} days</span>
        <div className="flex items-center gap-1">
          <span>less</span>
          <span className="w-3 h-3 rounded-[3px] bg-white/[0.06]" />
          <span className="w-3 h-3 rounded-[3px] bg-emerald-500/40" />
          <span className="w-3 h-3 rounded-[3px] bg-emerald-500/70" />
          <span className="w-3 h-3 rounded-[3px] bg-emerald-400" />
          <span>more</span>
        </div>
      </div>
    </div>
  )
}

// ── Repo × contributor matrix (who owns which repo, from task assignments) ────
function heatCell(n: number, max: number): string {
  if (!n) return 'bg-white/[0.03] text-gray-700'
  const r = n / max
  if (r > 0.66) return 'bg-primary/70 text-white'
  if (r > 0.33) return 'bg-primary/40 text-white'
  return 'bg-primary/20 text-primary'
}
function ContributionMatrix({ tasks }: { tasks: any[] }) {
  const m: Record<string, Record<string, number>> = {}
  const agentSet = new Set<string>()
  const repoSet = new Set<string>()
  for (const t of tasks) {
    const agent = (t.assignedAgent || 'Unassigned').replace(/ Engineer$/, '')
    const repos = (t.repos || []).map((r: any) => r.name).filter(Boolean)
      .filter((n: string) => !/^n\/a/i.test(n))
    for (const repo of repos) {
      repoSet.add(repo); agentSet.add(agent)
      m[repo] = m[repo] || {}
      m[repo][agent] = (m[repo][agent] || 0) + 1
    }
  }
  const repos = [...repoSet].sort()
  const agents = [...agentSet].sort()
  if (repos.length === 0 || agents.length === 0) {
    return <p className="text-gray-600 text-xs py-6 text-center">No repo/agent task assignments recorded yet.</p>
  }
  const max = Math.max(1, ...repos.flatMap((r) => agents.map((a) => m[r]?.[a] || 0)))

  return (
    <div className="overflow-x-auto scrollbar-hide">
      <div
        className="grid gap-1 w-max"
        style={{ gridTemplateColumns: `minmax(88px, max-content) repeat(${agents.length}, 32px)` }}
      >
        {/* header row: empty corner + vertical agent labels (in-flow, so nothing overflows the box) */}
        <div />
        {agents.map((a) => (
          <div key={a} className="h-24 flex items-end justify-center pb-1">
            <span title={a} className="text-[10px] text-gray-400 whitespace-nowrap [writing-mode:vertical-rl] rotate-180 max-h-[88px] overflow-hidden">
              {a}
            </span>
          </div>
        ))}
        {/* rows */}
        {repos.map((r) => (
          <Fragment key={r}>
            <div className="flex items-center justify-end pr-2 font-mono text-[11px] text-gray-300 whitespace-nowrap" title={r}>{r}</div>
            {agents.map((a) => {
              const n = m[r]?.[a] || 0
              return (
                <div
                  key={a}
                  title={`${a} → ${r}: ${n} task${n !== 1 ? 's' : ''}`}
                  className={`h-8 rounded-md flex items-center justify-center text-xs tabular-nums ${heatCell(n, max)}`}
                >
                  {n || ''}
                </div>
              )
            })}
          </Fragment>
        ))}
      </div>
    </div>
  )
}

export default function Insights() {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const tasks = useTasks()

  const load = () => {
    setLoading(true)
    api.getInsights(30).then(setData).catch(() => setData(null)).finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (loading && !data) return <div className="p-8 text-gray-400 text-sm">Computing insights…</div>
  if (!data) return <div className="p-8 text-gray-500 text-sm">No insights available yet.</div>

  const { velocity, repoHealth, cost, sessions } = data

  return (
    <div className="p-8 w-full">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold neon-text flex items-center gap-2">
            <TrendingUp className="w-7 h-7 text-primary" /> Insights & Analytics
          </h1>
          <p className="text-gray-400 mt-1 text-sm">Last {data.windowDays} days · computed locally · zero-token</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface text-gray-400 hover:text-white transition-colors text-sm">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
        <Stat icon={CheckCircle} color="text-success" label="Completed" value={String(velocity.totalCompleted)} sub={`in ${data.windowDays} days`} />
        <Stat icon={GitCommit} color="text-emerald-400" label="Commits" value={String(velocity.totalCommits)} sub={`in ${data.windowDays} days`} />
        <Stat icon={DollarSign} color="text-warning" label="Total AI cost" value={`$${(cost.totalCost || 0).toFixed(2)}`} sub="all-time (recorded)" />
        <Stat icon={Clock} color="text-primary" label="Sessions" value={String(sessions.total)} sub={`${sessions.activeNow} active · avg ${sessions.avgDurationMin}m`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
        {/* Velocity */}
        <div className="glass-card">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><Activity className="w-5 h-5 text-primary" /> Engineering velocity</h2>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={velocity.series} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" {...AXIS} interval={4} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="commits" name="commits" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="completed" name="tasks done" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Cost trend */}
        <div className="glass-card">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2"><DollarSign className="w-5 h-5 text-warning" /> AI cost trend</h2>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={cost.series} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="costG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="day" {...AXIS} interval={4} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} cursor={{ stroke: 'rgba(245,158,11,0.3)' }} />
              <Area type="monotone" dataKey="cost" name="cost ($)" stroke="#f59e0b" strokeWidth={2} fill="url(#costG)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Repo health */}
        <div className="glass-card">
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><GitCommit className="w-5 h-5 text-emerald-400" /> Repository health</h2>
          <div className="space-y-1.5">
            {repoHealth.map((r: any) => (
              <div key={r.repo} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface2">
                <span className="flex-1 text-sm font-mono truncate">{r.repo}</span>
                <span className="text-[11px] text-emerald-300">{r.commits} commits</span>
                <span className="text-[11px] text-gray-500">{r.changes} changes</span>
                <span className="text-[11px] text-gray-600 w-16 text-right">
                  {r.daysSince == null ? 'never' : r.daysSince === 0 ? 'today' : `${r.daysSince}d`}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Active hours */}
        <div className="glass-card">
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2"><Clock className="w-5 h-5 text-primary" /> Active hours (sessions)</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sessions.byHour} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="hour" {...AXIS} interval={2} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip {...TOOLTIP} cursor={{ fill: 'rgba(99,102,241,0.08)' }} />
              <Bar dataKey="sessions" fill="#8b5cf6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Activity heatmap + contribution matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
        <div className="glass-card">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-emerald-400" /> Activity heatmap
          </h2>
          <ActivityHeatmap series={velocity.series} />
          <p className="text-[11px] text-gray-600 mt-3">Commits + task completions per day, last {data.windowDays} days.</p>
        </div>

        <div className="glass-card">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" /> Repo ownership
          </h2>
          <ContributionMatrix tasks={tasks} />
          <p className="text-[11px] text-gray-600 mt-3">Tasks each engineer has taken on per repository — who owns what.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-600 mt-4 flex items-center gap-1.5">
        <CheckCircle className="w-3 h-3 text-success" /> All computed locally from SQLite history — no AI, no tokens.
      </p>
    </div>
  )
}
