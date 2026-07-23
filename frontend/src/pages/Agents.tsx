import { motion } from 'framer-motion'
import { RefreshCw, Briefcase, GitBranch, Zap } from 'lucide-react'
import { useRealtime, useTasks } from '@/lib/realtime'

interface Agent {
  id: string
  name: string
  status: 'Working' | 'Reviewing' | 'Testing' | 'Idle' | 'Error'
  currentTask: string
  lastUpdate: string
  assignedProject: string
  activeCwd?: string | null
}

interface Task {
  id: string
  title: string
  status: string
  progress: number
  priority: string
  assignedAgent: string
  repos?: { name: string; branch: string; status: string; notes?: string }[]
}

const ROLE_PALETTE: Record<string, { grad: string; ring: string; text: string }> = {
  'AI Chatbot Engineer': { grad: 'from-violet-600 to-indigo-500',  ring: 'ring-violet-500/50', text: 'text-violet-300' },
  'Backend Engineer':    { grad: 'from-orange-500 to-amber-400',   ring: 'ring-orange-500/50', text: 'text-orange-300' },
  'Frontend Engineer':   { grad: 'from-cyan-500 to-sky-400',       ring: 'ring-cyan-500/50',   text: 'text-cyan-300'   },
  'DB Admin':            { grad: 'from-purple-600 to-fuchsia-500', ring: 'ring-purple-500/50', text: 'text-purple-300' },
  'DevOps Engineer':     { grad: 'from-emerald-500 to-green-400',  ring: 'ring-emerald-500/50',text: 'text-emerald-300'},
  'QA Engineer':         { grad: 'from-yellow-500 to-amber-400',   ring: 'ring-yellow-500/50', text: 'text-yellow-300' },
  'Security Reviewer':   { grad: 'from-red-600 to-rose-400',       ring: 'ring-red-500/50',    text: 'text-red-300'    },
  'Project Manager':     { grad: 'from-pink-500 to-rose-400',      ring: 'ring-pink-500/50',   text: 'text-pink-300'   },
  'CS Comms Writer':     { grad: 'from-indigo-500 to-blue-400',    ring: 'ring-indigo-500/50', text: 'text-indigo-300' },
  'Flow Analyst':        { grad: 'from-teal-500 to-cyan-400',      ring: 'ring-teal-500/50',   text: 'text-teal-300'   },
}
const DEFAULT_PALETTE = { grad: 'from-gray-600 to-gray-500', ring: 'ring-gray-500/40', text: 'text-gray-300' }

const TASK_STATUS_BADGE: Record<string, string> = {
  Working:   'bg-primary/20 text-primary border border-primary/30',
  Reviewing: 'bg-secondary/20 text-secondary border border-secondary/30',
  Pending:   'bg-warning/20 text-warning border border-warning/30',
  Completed: 'bg-success/20 text-success border border-success/30',
  Failed:    'bg-error/20 text-error border border-error/30',
}

const STATUS_DOT: Record<string, string> = {
  Working:   'bg-emerald-400 animate-pulse',
  Reviewing: 'bg-violet-400 animate-pulse',
  Testing:   'bg-sky-400 animate-pulse',
  Idle:      'bg-gray-600',
  Error:     'bg-red-400 animate-pulse',
}
const STATUS_LABEL: Record<string, string> = {
  Working:   'bg-emerald-500/20 text-emerald-300',
  Reviewing: 'bg-violet-500/20 text-violet-300',
  Testing:   'bg-sky-500/20 text-sky-300',
  Idle:      'bg-gray-700/60 text-gray-500',
  Error:     'bg-red-500/20 text-red-400',
}

const REPO_DOT: Record<string, string> = {
  'fs-llm-service': 'bg-violet-500',
  'fsweb':          'bg-amber-500',
  'chat-widget':    'bg-cyan-500',
  'cs-dashboard':   'bg-emerald-500',
  'seller-page':    'bg-purple-500',
}

function getInitials(name: string): string {
  const words = name.split(' ')
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  if (words[0].length <= 2) return words[0].toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function AgentCard({ agent, agentTasks, index }: { agent: Agent; agentTasks: Task[]; index: number }) {
  const palette    = ROLE_PALETTE[agent.name] ?? DEFAULT_PALETTE
  const initials   = getInitials(agent.name)
  const isWorking  = agent.status === 'Working'
  const activeTasks = agentTasks.filter(t => ['Working', 'Reviewing'].includes(t.status))
  const repoName   = agent.activeCwd ? String(agent.activeCwd).split(/[/\\]/).pop() : null

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`glass-card !p-5 flex flex-col gap-4 transition-all duration-300 ${
        isWorking ? 'ring-1 ring-emerald-500/30' : ''
      }`}
    >
      {/* Top: avatar + identity + status */}
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${palette.grad} flex items-center justify-center ring-2 ${palette.ring} shadow-lg`}>
            <span className="text-xl font-bold text-white tracking-wide">{initials}</span>
          </div>
          <span className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-[#0a0a0f] ${STATUS_DOT[agent.status]}`} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="font-bold text-base leading-tight text-white truncate">{agent.name}</h3>
              <p className={`text-xs mt-0.5 font-medium ${palette.text}`}>{agent.assignedProject}</p>
            </div>
            <span className={`shrink-0 text-xs px-2.5 py-1 rounded-full font-semibold ${STATUS_LABEL[agent.status]}`}>
              {agent.status}
            </span>
          </div>

          {isWorking && repoName && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400 font-mono font-medium">{repoName}</span>
              <Zap className="w-3 h-3 text-emerald-500" />
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 -mt-1">
        {agent.currentTask || 'Specialist AI agent'}
      </p>

      {/* Active tasks */}
      {activeTasks.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider font-semibold">Active tasks</p>
          {activeTasks.slice(0, 3).map(task => (
            <div key={task.id} className="flex items-center gap-2 p-2 rounded-lg bg-background/60">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-gray-300 truncate">{task.title}</p>
                {(task.repos ?? []).length > 0 && (
                  <div className="flex items-center gap-1 mt-0.5">
                    <GitBranch className="w-2.5 h-2.5 text-gray-600" />
                    {task.repos!.slice(0, 2).map(r => (
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
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TASK_STATUS_BADGE[task.status] ?? ''}`}>
                  {task.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-1 border-t border-white/5">
        <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
          <Briefcase className="w-3 h-3" />
          <span>{agentTasks.length} task{agentTasks.length !== 1 ? 's' : ''} assigned</span>
        </div>
        <span className="text-[11px] text-gray-600">{agent.lastUpdate}</span>
      </div>
    </motion.div>
  )
}

export default function Agents() {
  const { metrics, ready, refresh } = useRealtime()
  const agents: Agent[] = metrics?.agents?.agents || []
  const tasks: Task[] = useTasks() // SQLite source of truth (Step 10)
  const sessionCount: number = metrics?.sessions?.sessionCount || 0
  const loading = !ready && agents.length === 0

  const AGENT_ORDER: Record<string, number> = { Working: 0, Reviewing: 1, Testing: 2, Idle: 3, Error: 4 }
  const sortedAgents = [...agents].sort((a, b) =>
    (AGENT_ORDER[a.status] ?? 5) - (AGENT_ORDER[b.status] ?? 5)
  )
  const workingCount = agents.filter(a => a.status === 'Working').length

  return (
    <div className="p-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold neon-text">AI Agent Team</h1>
          <p className="text-gray-400 text-sm mt-0.5">
            {agents.length} agents ·{' '}
            {sessionCount > 0
              ? <span className="text-emerald-400">{sessionCount} session{sessionCount !== 1 ? 's' : ''} active</span>
              : <span className="text-gray-600">no active sessions</span>
            }
          </p>
        </div>
        <div className="flex items-center gap-3">
          {workingCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-emerald-400 font-medium">{workingCount} working now</span>
            </div>
          )}
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface text-gray-400 hover:text-white transition-colors text-sm"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Stats strip */}
      {!loading && agents.length > 0 && (
        <div className="flex gap-3 mb-5">
          {[
            { label: 'Total Agents',    value: agents.length,                                                              color: 'text-white' },
            { label: 'Working',         value: workingCount,                                                               color: 'text-emerald-400' },
            { label: 'Idle',            value: agents.filter(a => a.status === 'Idle').length,                             color: 'text-gray-400' },
            { label: 'Tasks In Flight', value: tasks.filter(t => ['Working','Reviewing'].includes(t.status)).length,       color: 'text-primary' },
          ].map(s => (
            <div key={s.label} className="flex-1 p-3 rounded-xl bg-surface2 border border-white/5">
              <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</p>
              <p className="text-[11px] text-gray-600 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Agent grid */}
      {loading ? (
        <div className="text-gray-400 text-sm">Loading agents…</div>
      ) : agents.length === 0 ? (
        <div className="text-gray-500 text-sm p-6 glass-card">
          No agents found in <code className="text-gray-300">C:\Users\joelr\.claude\agents\</code>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sortedAgents.map((agent, idx) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              agentTasks={tasks.filter(t => t.assignedAgent === agent.name)}
              index={idx}
            />
          ))}
        </div>
      )}
    </div>
  )
}
