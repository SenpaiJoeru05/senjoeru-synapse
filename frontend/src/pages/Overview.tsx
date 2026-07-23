import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import StatCard from '@/components/StatCard'
import { api } from '@/lib/api'
import { useRealtime, useTasks } from '@/lib/realtime'
import { formatBytes, formatNumber } from '@/lib/utils'
import {
  Bot, ListTodo, Coins, Clock, Activity, Cpu, DollarSign,
  TrendingUp, Zap, CheckCircle, ArrowRight, Eye, GitCommit,
} from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'

// ── types ────────────────────────────────────────────────────────────────────

interface SystemHealth {
  cpu: { cores: number; model: string }
  memory: { total: number; used: number; free: number; usagePercent: string }
  claude: { path: string; exists: boolean; size: number }
  uptime: number
}

// ── helpers ──────────────────────────────────────────────────────────────────

const STATUS_SORT: Record<string, number> = {
  working: 0, reviewing: 1, pending: 2, completed: 3, failed: 4,
}
const STATUS_BAR: Record<string, string> = {
  working:   'bg-primary',
  reviewing: 'bg-secondary',
  completed: 'bg-success',
  failed:    'bg-error',
  pending:   'bg-warning',
}
const STATUS_TEXT: Record<string, string> = {
  working:   'text-primary',
  reviewing: 'text-secondary',
  completed: 'text-success',
  failed:    'text-error',
  pending:   'text-warning',
}
const AGENT_ORDER: Record<string, number> = {
  Working: 0, Reviewing: 1, Testing: 2, Idle: 3, Error: 4,
}
const REPO_BADGE: Record<string, string> = {
  'fs-llm-service': 'bg-violet-500/20 text-violet-300',
  'cs-dashboard':   'bg-emerald-500/20 text-emerald-300',
  'chat-widget':    'bg-cyan-500/20 text-cyan-300',
  'fsweb':          'bg-amber-500/20 text-amber-300',
  'seller-page':    'bg-purple-500/20 text-purple-300',
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms)) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 1)   return 'just now'
  if (min < 60)  return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24)   return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7)   return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildActivityFeed(metrics: any, tasks: any[]) {
  const events: any[] = []

  // Real git commits from each repo
  const repos: any[] = metrics?.git?.repos ?? []
  for (const repo of repos) {
    for (const commit of (repo.commits ?? []).slice(0, 4)) {
      const ms = new Date(commit.date).getTime()
      if (isNaN(ms)) continue
      events.push({
        id:          `commit-${repo.name}-${commit.hash}`,
        type:        'commit',
        title:       `New commit in ${repo.name}`,
        description: commit.message,
        meta:        `${commit.author} · ${commit.hash}`,
        timestamp:   commit.date,
        ms,
        repo:        repo.name,
        branch:      repo.branch,
      })
    }
  }

  // Task status changes
  for (const task of tasks) {
    const ms = new Date(task.lastUpdated ?? '').getTime()
    if (!task.lastUpdated || isNaN(ms)) continue
    const label =
      task.status === 'Completed' ? `Completed: ${task.title}` :
      task.status === 'Working'   ? `Working on: ${task.title}` :
      task.status === 'Reviewing' ? `Review needed: ${task.title}` :
      `Updated: ${task.title}`
    events.push({
      id:          `task-${task.id}`,
      type:        'task',
      status:      task.status,
      title:       label,
      description: (task.repos ?? []).map((r: any) => r.notes).filter(Boolean).join(' · ') || task.eta || '',
      meta:        task.assignedAgent ?? '',
      timestamp:   task.lastUpdated,
      ms,
    })
  }

  return events.sort((a, b) => b.ms - a.ms).slice(0, 16)
}

// ── UsageStat ────────────────────────────────────────────────────────────────

function UsageStat({ label, value, icon: Icon, limit }: {
  label: string; value: number; icon: React.ElementType; limit: number | null
}) {
  const pct = limit ? Math.min((value / limit) * 100, 100) : 0
  const barColor  = pct >= 90 ? 'bg-error' : pct >= 70 ? 'bg-warning' : 'bg-gradient-primary'
  const valueColor = pct >= 90 ? 'text-error' : pct >= 70 ? 'text-warning' : 'text-white'
  return (
    <div className="p-3 rounded-xl bg-surface2">
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Icon className="w-3.5 h-3.5" />{label}
        </div>
        <div className="flex items-baseline gap-1">
          <span className={`text-lg font-bold ${valueColor}`}>${value.toFixed(2)}</span>
          {limit && <span className="text-xs text-gray-500">/ ${limit.toFixed(0)}</span>}
        </div>
      </div>
      {limit ? (
        <>
          <div className="w-full bg-background rounded-full h-1.5 mb-1">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className={`h-1.5 rounded-full ${barColor}`}
            />
          </div>
          <p className="text-[11px] text-gray-600">{pct.toFixed(1)}% of your set limit</p>
        </>
      ) : (
        <p className="text-[11px] text-gray-600">Set a limit in Settings to see % usage</p>
      )}
    </div>
  )
}

// ── ActivityIcon ─────────────────────────────────────────────────────────────

function ActivityIcon({ event }: { event: any }) {
  if (event.type === 'commit') {
    return (
      <div className="w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
        <GitCommit className="w-4 h-4" />
      </div>
    )
  }
  const s = event.status
  const cls =
    s === 'Completed' ? 'bg-success/20 text-success' :
    s === 'Working'   ? 'bg-primary/20 text-primary' :
    s === 'Reviewing' ? 'bg-secondary/20 text-secondary' :
    'bg-warning/20 text-warning'
  const Icon =
    s === 'Completed' ? CheckCircle :
    s === 'Working'   ? Zap :
    s === 'Reviewing' ? Eye :
    Clock
  return (
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cls}`}>
      <Icon className="w-4 h-4" />
    </div>
  )
}

// ── Overview ─────────────────────────────────────────────────────────────────

export default function Overview() {
  const navigate = useNavigate()
  // Live metrics + host health arrive over the shared WebSocket — no polling.
  const { metrics, health, ready } = useRealtime() as {
    metrics: any | null; health: SystemHealth | null; ready: boolean
  }
  // Task list from SQLite (Step 10). Called before any early return to satisfy
  // the Rules of Hooks (useTasks reads context internally).
  const allTasks: any[] = useTasks()
  // Settings change rarely and aren't pushed — one REST read is enough.
  const [settings, setSettings] = useState<any | null>(null)
  const loading = !ready && !metrics

  useEffect(() => {
    api.getSettings().then(setSettings).catch(() => {})
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading dashboard...</p>
        </div>
      </div>
    )
  }

  // ── derived data ────────────────────────────────────────────────────────────

  const getGreeting = () => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  }

  const costs        = metrics?.costs
  const hourlyBudget = settings?.hourlyBudget ?? 5
  const weeklyBudget = settings?.weeklyBudget ?? 50
  const thisHour     = costs?.thisHour ?? 0
  const thisWeek     = costs?.weekly ?? 0
  const today        = costs?.today ?? 0

  // Sort: Working → Reviewing → Pending → Completed → Failed, then most recent first
  const sortedTasks = [...allTasks].sort((a, b) => {
    const sa = STATUS_SORT[a.status?.toLowerCase() ?? ''] ?? 99
    const sb = STATUS_SORT[b.status?.toLowerCase() ?? ''] ?? 99
    if (sa !== sb) return sa - sb
    return new Date(b.lastUpdated ?? 0).getTime() - new Date(a.lastUpdated ?? 0).getTime()
  })

  const activeTasks    = allTasks.filter(t => ['working','reviewing','in progress'].includes(t.status?.toLowerCase() ?? '')).length
  const completedTasks = allTasks.filter(t => ['completed','done'].includes(t.status?.toLowerCase() ?? '')).length
  const totalTasks     = allTasks.length
  const overallProgress = totalTasks > 0
    ? Math.round(allTasks.reduce((s, t) => s + (t.progress ?? 0), 0) / totalTasks)
    : 0

  const progressData = [
    { name: 'Completed',  value: completedTasks,                             color: '#10b981' },
    { name: 'In Progress',value: activeTasks,                                color: '#6366f1' },
    { name: 'Pending',    value: totalTasks - completedTasks - activeTasks,  color: '#f59e0b' },
  ]

  // Agents: Working first
  const agentData: any[] = metrics?.agents?.agents ?? []
  const sortedAgents = [...agentData].sort((a, b) =>
    (AGENT_ORDER[a.status] ?? 5) - (AGENT_ORDER[b.status] ?? 5)
  )

  // Activity: assembled from real commits + task updates, sorted newest first
  const activityFeed = buildActivityFeed(metrics, allTasks)

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="p-6">

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold neon-text">{getGreeting()}, SenJoeru</h1>
          <p className="text-gray-400 text-xs mt-1">Welcome back to your AI Operations Center</p>
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface2 border border-white/10"
        >
          <div className="relative">
            <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-success animate-ping opacity-75" />
          </div>
          <span className="text-xs text-gray-400">Auto-refresh: {settings?.pollInterval || 5}s</span>
        </motion.div>
      </div>

      {/* ── Stat cards row ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
        {/* Donut */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="glass-card !p-5">
          <h2 className="text-sm font-bold mb-3 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-success" />Overall Progress
          </h2>
          <div className="relative h-32">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={progressData} cx="50%" cy="50%" innerRadius={40} outerRadius={55}
                  paddingAngle={5} dataKey="value" strokeWidth={0}>
                  {progressData.map((e, i) => (
                    <Cell key={i} fill={e.color} style={{ filter: 'drop-shadow(0 0 6px rgba(99,102,241,0.3))' }} />
                  ))}
                </Pie>
                <Tooltip content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="bg-surface2 border border-white/10 rounded-lg px-3 py-2 shadow-lg">
                      <p className="text-xs text-gray-400">{payload[0].name}</p>
                      <p className="text-sm font-bold text-white">{payload[0].value} tasks</p>
                    </div>
                  ) : null
                } wrapperStyle={{ pointerEvents: 'auto' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <motion.p initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5, type: 'spring' }}
                className="text-xl font-bold neon-text">{overallProgress}%
              </motion.p>
            </div>
          </div>
        </motion.div>

        <StatCard title="Active Agents" value={String(agentData.length || '0')} icon={Bot} delay={0} />
        <StatCard title="Active Tasks"  value={String(activeTasks)}             icon={ListTodo} delay={0.05} />
        <StatCard
          title="Tokens Today"
          value={metrics?.tokens?.today ? formatNumber(metrics.tokens.today) : '0'}
          icon={Coins} delay={0.1} showMiniChart
          miniChart={metrics?.tokens?.daily?.slice(-7).map((d: any) => d.tokens) ?? []}
        />
        <StatCard
          title="Cost Today"
          value={today > 0 ? `$${today.toFixed(2)}` : '$0.00'}
          icon={DollarSign} delay={0.15} showMiniChart
          miniChart={metrics?.tokens?.daily?.slice(-7).map((d: any) => d.cost) ?? []}
        />
      </div>

      {/* ── Tasks + Agents (wider tasks, narrower agents) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 mb-4">

        {/* Task Progress */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          className="glass-card !p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold flex items-center gap-2">
              <ListTodo className="w-5 h-5 text-primary" />Task Progress
            </h2>
            <button onClick={() => navigate('/tasks')}
              className="text-sm text-accent hover:text-accent/80 flex items-center gap-1 transition-colors">
              View All <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2.5 max-h-72 overflow-y-auto scrollbar-hide">
            {sortedTasks.length === 0
              ? <p className="text-gray-500 text-sm text-center py-8">No tasks</p>
              : sortedTasks.slice(0, 10).map(task => {
                  const sk = task.status?.toLowerCase() ?? 'pending'
                  return (
                    <div key={task.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-surface2">
                      {/* status dot */}
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_BAR[sk] ?? 'bg-gray-500'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate leading-tight">{task.title}</p>
                        <p className={`text-[11px] ${STATUS_TEXT[sk] ?? 'text-gray-400'}`}>{task.status}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="w-36 h-1.5 bg-background rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${task.progress}%` }}
                            transition={{ duration: 0.5 }}
                            className={`h-full rounded-full ${STATUS_BAR[sk] ?? 'bg-gray-500'}`}
                          />
                        </div>
                        <span className="text-xs text-gray-400 w-8 text-right tabular-nums">{task.progress}%</span>
                      </div>
                    </div>
                  )
                })
            }
          </div>
        </motion.div>

        {/* Agent Status */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="glass-card !p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold flex items-center gap-2">
              <Bot className="w-5 h-5 text-secondary" />Agent Status
            </h2>
            <button onClick={() => navigate('/agents')}
              className="text-sm text-accent hover:text-accent/80 flex items-center gap-1 transition-colors">
              View All <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto scrollbar-hide">
            {sortedAgents.length === 0
              ? <p className="text-gray-500 text-sm text-center py-8">No active agents</p>
              : sortedAgents.map((agent: any) => {
                  const isWorking = agent.status === 'Working'
                  const initials  = (() => {
                    const w = agent.name.split(' ')
                    if (w.length === 1) return w[0].slice(0, 2).toUpperCase()
                    if (w[0].length <= 2) return w[0].toUpperCase()
                    return (w[0][0] + w[1][0]).toUpperCase()
                  })()
                  const grad = ({
                    'AI Chatbot Engineer': 'from-violet-600 to-indigo-600',
                    'Backend Engineer':    'from-orange-500 to-amber-500',
                    'Frontend Engineer':   'from-cyan-500 to-sky-500',
                    'DB Admin':            'from-purple-600 to-fuchsia-600',
                    'Devops Engineer':     'from-emerald-500 to-green-500',
                    'QA Engineer':         'from-yellow-500 to-amber-400',
                    'Security Reviewer':   'from-red-600 to-rose-500',
                    'Project Manager':     'from-pink-500 to-rose-400',
                    'CS Comms Writer':     'from-indigo-500 to-blue-500',
                    'Flow Analyst':        'from-teal-500 to-cyan-400',
                  } as Record<string,string>)[agent.name] ?? 'from-gray-600 to-gray-500'

                  return (
                    <div key={agent.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-surface2 hover:bg-white/5 transition-colors">
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center`}>
                          <span className="text-[11px] font-bold text-white">{initials}</span>
                        </div>
                        {isWorking && (
                          <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-[#0a0a0f] animate-pulse" />
                        )}
                      </div>
                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate leading-tight">{agent.name}</p>
                        {isWorking && agent.activeCwd
                          ? <p className="text-[11px] text-emerald-400 truncate font-mono">
                              {String(agent.activeCwd).split(/[/\\]/).pop()}
                            </p>
                          : <p className="text-[11px] text-gray-600">Specialist agent</p>
                        }
                      </div>
                      {/* Status badge */}
                      <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 font-medium ${
                        isWorking                    ? 'bg-success/20 text-success' :
                        agent.status === 'Reviewing' ? 'bg-secondary/20 text-secondary' :
                        agent.status === 'Error'     ? 'bg-error/20 text-error' :
                        'bg-gray-500/15 text-gray-500'
                      }`}>
                        {agent.status}
                      </span>
                    </div>
                  )
                })
            }
          </div>
        </motion.div>
      </div>

      {/* ── Recent Activity — full width ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
        className="glass-card !p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold flex items-center gap-2">
            <Activity className="w-5 h-5 text-accent" />Recent Activity
          </h2>
          <button onClick={() => navigate('/activity')}
            className="text-sm text-accent hover:text-accent/80 flex items-center gap-1 transition-colors">
            View All <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {activityFeed.length === 0
          ? <p className="text-gray-500 text-sm text-center py-6">No recent activity</p>
          : (
            <div className="space-y-2 max-h-56 overflow-y-auto scrollbar-hide">
              {activityFeed.slice(0, 10).map(event => (
                <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg bg-surface2 hover:bg-white/5 transition-colors">
                  <ActivityIcon event={event} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium leading-tight mb-0.5">{event.title}</p>
                    <p className="text-xs text-gray-400 line-clamp-1 leading-relaxed">{event.description}</p>
                    {event.meta && (
                      <p className="text-[11px] text-gray-600 mt-0.5 truncate">{event.meta}</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-[11px] text-gray-500 whitespace-nowrap">{relativeTime(event.timestamp)}</span>
                    {event.repo && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${REPO_BADGE[event.repo] ?? 'bg-gray-500/20 text-gray-400'}`}>
                        {event.repo}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </motion.div>

      {/* ── Token Usage + System Health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
          className="glass-card !p-5">
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-warning" />Token Usage Cost
          </h2>
          <div className="space-y-4">
            <UsageStat label="This Hour" value={thisHour} icon={Zap}       limit={hourlyBudget > 0 ? hourlyBudget : null} />
            <UsageStat label="This Week" value={thisWeek} icon={TrendingUp} limit={weeklyBudget > 0 ? weeklyBudget : null} />
            <p className="text-xs text-gray-600 pt-1">
              Computed from JSONL files · Sonnet 4.6 pricing
              {hourlyBudget > 0 && <span> · Limits set in Settings</span>}
            </p>
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}
          className="glass-card !p-5">
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" />System Health
          </h2>
          {health ? (
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-xs text-gray-500 mb-1">CPU</p>
                <p className="font-bold text-lg">{health.cpu.cores} cores</p>
                <p className="text-xs text-gray-600 truncate">{health.cpu.model}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Memory</p>
                <p className="font-bold text-lg">{health.memory.usagePercent}%</p>
                <p className="text-xs text-gray-600">{formatBytes(health.memory.used)} / {formatBytes(health.memory.total)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Claude Dir</p>
                <p className={`font-bold text-sm ${health.claude.exists ? 'text-success' : 'text-error'}`}>
                  {health.claude.exists ? 'Connected' : 'Not Found'}
                </p>
                {health.claude.exists && <p className="text-xs text-gray-600">{formatBytes(health.claude.size)}</p>}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Uptime</p>
                <p className="font-bold text-lg">{Math.floor(health.uptime / 3600)}h</p>
                <p className="text-xs text-gray-600">{Math.floor((health.uptime % 3600) / 60)}m</p>
              </div>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Unable to fetch health data</p>
          )}
        </motion.div>
      </div>

      {/* ── Active Sessions — full width ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
        className="glass-card !p-5">
        <h2 className="text-base font-bold mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-accent" />Active Sessions
          {metrics?.sessions?.active && <span className="ml-1 w-2 h-2 rounded-full bg-success animate-pulse" />}
        </h2>
        {(metrics?.sessions?.activeSessions?.length ?? 0) === 0
          ? <p className="text-gray-500 text-sm">No active Claude Code sessions</p>
          : (
            <div className="space-y-2">
              {(metrics.sessions.activeSessions as any[]).map((s: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-surface2 text-sm">
                  <span className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-xs text-gray-400 truncate">{s.cwd}</p>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 shrink-0">
                    <Clock className="w-3 h-3" />
                    <span>PID {s.pid}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        }
      </motion.div>
    </div>
  )
}
