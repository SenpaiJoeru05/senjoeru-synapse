import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Users, Brain, RefreshCw, Cpu, Zap, Briefcase, GitBranch, ChevronDown } from 'lucide-react'
import { api } from '@/lib/api'
import { useRealtime, useTasks } from '@/lib/realtime'

interface Member {
  slug: string
  displayName: string | null
  title: string
  roleName: string
  model: string | null
  description: string | null
  memory: string | null
  memoryChars: number
}
interface Task {
  id: string
  title: string
  status: string
  progress: number
  assignedAgent: string
  repos?: { name: string; branch: string; status: string; notes?: string }[]
}

const MODEL_BADGE: Record<string, string> = {
  opus: 'bg-fuchsia-500/20 text-fuchsia-300',
  sonnet: 'bg-cyan-500/20 text-cyan-300',
  haiku: 'bg-emerald-500/20 text-emerald-300',
}

const ROLE_PALETTE: Record<string, { grad: string; ring: string; text: string }> = {
  'AI Chatbot Engineer': { grad: 'from-violet-600 to-indigo-500', ring: 'ring-violet-500/50', text: 'text-violet-300' },
  'Backend Engineer': { grad: 'from-orange-500 to-amber-400', ring: 'ring-orange-500/50', text: 'text-orange-300' },
  'Frontend Engineer': { grad: 'from-cyan-500 to-sky-400', ring: 'ring-cyan-500/50', text: 'text-cyan-300' },
  'DB Admin': { grad: 'from-purple-600 to-fuchsia-500', ring: 'ring-purple-500/50', text: 'text-purple-300' },
  'DevOps Engineer': { grad: 'from-emerald-500 to-green-400', ring: 'ring-emerald-500/50', text: 'text-emerald-300' },
  'QA Engineer': { grad: 'from-yellow-500 to-amber-400', ring: 'ring-yellow-500/50', text: 'text-yellow-300' },
  'Security Reviewer': { grad: 'from-red-600 to-rose-400', ring: 'ring-red-500/50', text: 'text-red-300' },
  'Project Manager': { grad: 'from-pink-500 to-rose-400', ring: 'ring-pink-500/50', text: 'text-pink-300' },
  'CS Comms Writer': { grad: 'from-indigo-500 to-blue-400', ring: 'ring-indigo-500/50', text: 'text-indigo-300' },
  'Flow Analyst': { grad: 'from-teal-500 to-cyan-400', ring: 'ring-teal-500/50', text: 'text-teal-300' },
}
const DEFAULT_PALETTE = { grad: 'from-gray-600 to-gray-500', ring: 'ring-gray-500/40', text: 'text-gray-300' }

const TASK_BADGE: Record<string, string> = {
  Working: 'bg-primary/20 text-primary',
  Reviewing: 'bg-secondary/20 text-secondary',
  Pending: 'bg-warning/20 text-warning',
  Completed: 'bg-success/20 text-success',
  Failed: 'bg-error/20 text-error',
}
const STATUS_LABEL: Record<string, string> = {
  Working: 'bg-emerald-500/20 text-emerald-300',
  Idle: 'bg-gray-700/60 text-gray-500',
}
const REPO_DOT: Record<string, string> = {
  'fs-llm-service': 'bg-violet-500',
  'fsweb': 'bg-amber-500',
  'chat-widget': 'bg-cyan-500',
  'cs-dashboard': 'bg-emerald-500',
  'seller-page': 'bg-purple-500',
}

function initials(name: string): string {
  const w = name.trim().split(/\s+/)
  if (w.length === 1) return w[0].slice(0, 2).toUpperCase()
  return (w[0][0] + w[1][0]).toUpperCase()
}

interface Live { working: boolean; activeRepo: string | null; lastUpdate: string | null; status: string }

function MemberCard({ m, live, tasks, index }: { m: Member; live: Live; tasks: Task[]; index: number }) {
  const [showMemory, setShowMemory] = useState(false)
  const name = m.displayName || m.roleName
  const palette = ROLE_PALETTE[m.roleName] ?? DEFAULT_PALETTE
  const activeTasks = tasks.filter((t) => ['Working', 'Reviewing'].includes(t.status))

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`glass-card !p-5 flex flex-col gap-4 transition-all ${live.working ? 'ring-1 ring-emerald-500/30' : ''}`}
    >
      {/* identity */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${palette.grad} flex items-center justify-center ring-2 ${palette.ring} shadow-lg`}>
            <span className="text-xl font-bold text-white tracking-wide">{initials(name)}</span>
          </div>
          <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-[#0a0a0f] ${live.working ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-bold text-base leading-tight text-white truncate">{name}</h3>
              <p className={`text-xs mt-0.5 font-medium ${palette.text} truncate`}>{m.title}</p>
            </div>
            <span className={`shrink-0 text-[11px] px-2.5 py-1 rounded-full font-semibold ${STATUS_LABEL[live.status] ?? STATUS_LABEL.Idle}`}>
              {live.status}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-2">
            {m.model && (
              <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${MODEL_BADGE[m.model] ?? 'bg-gray-500/20 text-gray-400'}`}>
                <Cpu className="w-2.5 h-2.5" />{m.model}
              </span>
            )}
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/15 text-gray-500 font-mono">{m.slug}</span>
          </div>
          {live.working && live.activeRepo && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400 font-mono font-medium">{live.activeRepo}</span>
              <Zap className="w-3 h-3 text-emerald-500" />
            </div>
          )}
        </div>
      </div>

      {/* what they do */}
      {m.description && (
        <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 -mt-1">{m.description}</p>
      )}

      {/* active tasks */}
      {activeTasks.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold">Active tasks</p>
          {activeTasks.slice(0, 3).map((task) => (
            <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg bg-background/60">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-300 truncate">{task.title}</p>
                {(task.repos ?? []).length > 0 && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <GitBranch className="w-2.5 h-2.5 text-gray-600" />
                    {task.repos!.slice(0, 2).map((r) => (
                      <span key={r.name} className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${REPO_DOT[r.name] ?? 'bg-gray-500'}`} />
                        <span className="text-[10px] text-gray-600 font-mono">{r.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="w-12 h-1 bg-surface2 rounded-full overflow-hidden">
                  <div className="h-full bg-primary/60 rounded-full" style={{ width: `${task.progress}%` }} />
                </div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TASK_BADGE[task.status] ?? ''}`}>{task.status}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* memory (collapsible) */}
      <div className="mt-auto">
        <button
          onClick={() => setShowMemory((v) => !v)}
          className="w-full flex items-center gap-1.5 text-left group"
        >
          <Brain className="w-3.5 h-3.5 text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 group-hover:text-gray-300 transition-colors">Memory</span>
          {m.memory
            ? <span className="text-[10px] text-gray-600">{m.memoryChars} chars</span>
            : <span className="text-[10px] text-gray-700">none yet</span>}
          {m.memory && <ChevronDown className={`w-3.5 h-3.5 text-gray-600 ml-auto transition-transform ${showMemory ? 'rotate-180' : ''}`} />}
        </button>
        {m.memory && showMemory && (
          <pre className="mt-2 text-[11px] leading-relaxed text-gray-300 whitespace-pre-wrap bg-background/60 rounded-lg p-3 max-h-56 overflow-y-auto scrollbar-hide font-mono">{m.memory}</pre>
        )}
      </div>

      {/* footer */}
      <div className="flex items-center justify-between pt-2 border-t border-white/5">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <Briefcase className="w-3 h-3" />
          <span>{tasks.length} task{tasks.length !== 1 ? 's' : ''} assigned</span>
        </div>
        <span className="text-[11px] text-gray-600">{live.lastUpdate ?? 'No recent activity'}</span>
      </div>
    </motion.div>
  )
}

export default function Team() {
  const [team, setTeam] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const { metrics } = useRealtime()
  const tasks = useTasks() as Task[]

  const load = () => {
    setLoading(true)
    api.getTeam().then((r) => setTeam(r.team ?? [])).catch(() => setTeam([])).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const liveAgents: any[] = metrics?.agents?.agents ?? []
  const liveFor = useMemo(() => (m: Member): Live => {
    const a = liveAgents.find((x) => x.name === m.roleName || (m.displayName && x.displayName === m.displayName))
    const working = a?.status === 'Working'
    return {
      working,
      status: working ? 'Working' : 'Idle',
      activeRepo: a?.activeCwd ? String(a.activeCwd).split(/[/\\]/).filter(Boolean).pop() ?? null : null,
      lastUpdate: a?.lastUpdate ?? null,
    }
  }, [liveAgents])

  const tasksFor = (m: Member) =>
    tasks.filter((t) => t.assignedAgent === m.roleName || (m.displayName != null && t.assignedAgent === m.displayName))

  const workingCount = team.filter((m) => liveFor(m).working).length
  const idleCount = team.length - workingCount
  const inFlight = tasks.filter((t) => ['Working', 'Reviewing'].includes(t.status)).length

  const stats = [
    { label: 'Engineers', value: team.length, color: 'text-white' },
    { label: 'Working now', value: workingCount, color: 'text-emerald-400' },
    { label: 'Idle', value: idleCount, color: 'text-gray-400' },
    { label: 'Tasks in flight', value: inFlight, color: 'text-primary' },
  ]

  return (
    <div className="p-8 w-full">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold neon-text flex items-center gap-2">
            <Users className="w-7 h-7 text-primary" /> The Team
          </h1>
          <p className="text-gray-400 mt-1 text-sm">
            {team.length} AI engineers · {workingCount} working now · orchestrated by the Project Manager
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface text-gray-400 hover:text-white transition-colors text-sm">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* stats strip */}
      {team.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          {stats.map((s) => (
            <div key={s.label} className="p-3 rounded-xl bg-surface2 border border-white/5">
              <p className={`text-2xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-gray-600 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {loading && team.length === 0 ? (
        <div className="text-gray-400 text-sm">Loading team…</div>
      ) : team.length === 0 ? (
        <div className="text-gray-500 text-sm p-6 glass-card">No agents found in the Claude agents folder.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {team.map((m, i) => (
            <MemberCard key={m.slug} m={m} live={liveFor(m)} tasks={tasksFor(m)} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
