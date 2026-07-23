import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Clock, AlertTriangle, CheckCircle2, Circle, GitBranch,
  ChevronDown, ChevronUp, Filter, RefreshCw
} from 'lucide-react'
import { useRealtime, useTasks } from '@/lib/realtime'

interface TaskRepo {
  name: string
  branch: string
  status: 'Pending' | 'Working' | 'Reviewing' | 'Completed' | 'Failed'
  notes?: string
}

interface Task {
  id: string
  title: string
  assignedAgent: string
  repos?: TaskRepo[]
  progress: number
  status: 'Pending' | 'Working' | 'Reviewing' | 'Completed' | 'Failed'
  eta: string
  priority: 'High' | 'Medium' | 'Low'
  notes?: string
  lastUpdated?: string
}

type TaskStatus = 'Pending' | 'Working' | 'Reviewing' | 'Completed' | 'Failed'

const STATUS_ICONS = {
  Pending: Circle,
  Working: Clock,
  Reviewing: AlertTriangle,
  Completed: CheckCircle2,
  Failed: AlertTriangle,
}

// Different data sources use different vocabularies (e.g. the collector's
// memory-file fallback emits "In Progress"/"Done"). Map everything onto the
// five canonical statuses so lookups never resolve to undefined.
const STATUS_ALIASES: Record<string, TaskStatus> = {
  'in progress': 'Working',
  'inprogress': 'Working',
  'ongoing': 'Working',
  'done': 'Completed',
  'complete': 'Completed',
  'completed': 'Completed',
  'review': 'Reviewing',
  'reviewing': 'Reviewing',
  'todo': 'Pending',
  'to do': 'Pending',
  'pending': 'Pending',
  'working': 'Working',
  'failed': 'Failed',
  'error': 'Failed',
  'blocked': 'Failed',
}

function normalizeStatus(status: unknown): TaskStatus {
  const key = String(status ?? '').trim().toLowerCase()
  return STATUS_ALIASES[key] ?? 'Pending'
}

const STATUS_COLORS = {
  Pending: 'text-gray-400',
  Working: 'text-primary',
  Reviewing: 'text-accent',
  Completed: 'text-success',
  Failed: 'text-error',
}

const STATUS_BADGE = {
  Pending:   'bg-gray-500/20 text-gray-400',
  Working:   'bg-primary/20 text-primary',
  Reviewing: 'bg-accent/20 text-accent',
  Completed: 'bg-success/20 text-success',
  Failed:    'bg-error/20 text-error',
}

const PRIORITY_COLORS = {
  High:   'bg-error/20 text-error',
  Medium: 'bg-warning/20 text-warning',
  Low:    'bg-gray-500/20 text-gray-400',
}

const REPO_COLORS: Record<string, string> = {
  'fs-llm-service': 'bg-primary/20 text-primary border-primary/30',
  'fsweb':          'bg-warning/20 text-warning border-warning/30',
  'chat-widget':    'bg-accent/20 text-accent border-accent/30',
  'cs-dashboard':   'bg-success/20 text-success border-success/30',
  'seller-page':    'bg-purple-500/20 text-purple-400 border-purple-500/30',
}

const REPO_DOT: Record<string, string> = {
  'fs-llm-service': 'bg-primary',
  'fsweb':          'bg-warning',
  'chat-widget':    'bg-accent',
  'cs-dashboard':   'bg-success',
  'seller-page':    'bg-purple-400',
}

function repoColor(name: string) {
  return REPO_COLORS[name] ?? 'bg-gray-500/20 text-gray-400 border-gray-500/30'
}

function repoDot(name: string) {
  return REPO_DOT[name] ?? 'bg-gray-500'
}

const STATUS_ORDER = ['Working', 'Reviewing', 'Pending', 'Completed', 'Failed']

function sortTasks(tasks: Task[]) {
  return [...tasks].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status)
    const bi = STATUS_ORDER.indexOf(b.status)
    if (ai !== bi) return ai - bi
    const pp = { High: 0, Medium: 1, Low: 2 }
    return (pp[a.priority] ?? 1) - (pp[b.priority] ?? 1)
  })
}

function TaskCard({ task, index }: { task: Task; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const StatusIcon = STATUS_ICONS[task.status] ?? Circle
  const hasMultiRepo = (task.repos?.length ?? 0) > 1

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="glass-card overflow-hidden"
    >
      {/* Main row */}
      <div className="flex items-start gap-4">
        <div className={`mt-0.5 ${STATUS_COLORS[task.status]}`}>
          <StatusIcon className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <h3 className="font-bold text-lg leading-tight">{task.title}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{task.assignedAgent}</p>
            </div>
            <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[task.priority]}`}>
              {task.priority}
            </span>
          </div>

          {/* Repo chips */}
          {task.repos && task.repos.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {task.repos.map(repo => (
                <span
                  key={repo.name}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${repoColor(repo.name)}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${repoDot(repo.name)}`} />
                  <span className="font-semibold">{repo.name}</span>
                  <span className="opacity-60">·</span>
                  <GitBranch className="w-2.5 h-2.5 opacity-70" />
                  <span className="opacity-80 font-mono" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.branch}</span>
                  {hasMultiRepo && (
                    <>
                      <span className="opacity-40">·</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_BADGE[repo.status]}`}>{repo.status}</span>
                    </>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Progress */}
          <div className="mb-3">
            <div className="flex justify-between text-xs text-gray-500 mb-1.5">
              <span>Progress</span>
              <span className="font-medium text-white">{task.progress}%</span>
            </div>
            <div className="w-full bg-surface2 rounded-full h-1.5">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${task.progress}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className={`h-1.5 rounded-full ${task.status === 'Failed' ? 'bg-error' : 'bg-gradient-primary'}`}
              />
            </div>
          </div>

          {/* Footer row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded text-xs font-medium ${STATUS_BADGE[task.status]}`}>
                {task.status}
              </span>
              <span className="text-xs text-gray-500">ETA: {task.eta}</span>
            </div>

            {(task.notes || hasMultiRepo) && (
              <button
                onClick={() => setExpanded(e => !e)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                Details
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded details */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-white/5 ml-9 space-y-3">
              {task.notes && (
                <p className="text-sm text-gray-400 italic">"{task.notes}"</p>
              )}
              {task.repos && task.repos.map(repo => repo.notes && (
                <div key={repo.name} className="flex gap-2">
                  <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs border ${repoColor(repo.name)}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${repoDot(repo.name)}`} />
                    {repo.name}
                  </span>
                  <span className="text-xs text-gray-400 self-center">{repo.notes}</span>
                </div>
              ))}
              {task.lastUpdated && (
                <p className="text-xs text-gray-600">
                  Updated {new Date(task.lastUpdated).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function StatusSummary({ tasks }: { tasks: Task[] }) {
  const counts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1
    return acc
  }, {})
  const items: Array<{ status: string; label: string; color: string }> = [
    { status: 'Completed', label: 'Done',      color: 'text-success' },
    { status: 'Working',   label: 'Working',   color: 'text-primary' },
    { status: 'Reviewing', label: 'Review',    color: 'text-accent' },
    { status: 'Pending',   label: 'Pending',   color: 'text-gray-400' },
    { status: 'Failed',    label: 'Failed',    color: 'text-error' },
  ]
  return (
    <div className="flex gap-4 flex-wrap">
      {items.map(({ status, label, color }) => (
        <div key={status} className={`text-center ${color}`}>
          <div className="text-2xl font-bold">{counts[status] ?? 0}</div>
          <div className="text-xs opacity-70">{label}</div>
        </div>
      ))}
    </div>
  )
}

export default function Tasks() {
  const { db, ready, refresh } = useRealtime()
  const [repoFilter, setRepoFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)

  // SQLite is the source of truth for tasks (Step 10); falls back to metrics
  // JSON inside useTasks() only if the DB frame is unavailable.
  const rawTasks = useTasks()
  const lastUpdated: string | null = db?.timestamp ?? null
  // Normalize statuses (task + per-repo) so any data source renders safely.
  const tasks: Task[] = useMemo(() => (rawTasks || []).map((t: Task) => ({
    ...t,
    status: normalizeStatus(t.status),
    repos: (t.repos ?? []).map(r => ({ ...r, status: normalizeStatus(r.status) })),
  })), [rawTasks])
  const loading = !ready && tasks.length === 0

  const allRepos = Array.from(
    new Set(tasks.flatMap(t => (t.repos ?? []).map(r => r.name)))
  ).sort()

  const filtered = sortTasks(
    tasks.filter(t => {
      if (statusFilter && t.status !== statusFilter) return false
      if (repoFilter && !(t.repos ?? []).some(r => r.name === repoFilter)) return false
      return true
    })
  )

  const statuses = ['Working', 'Reviewing', 'Pending', 'Completed', 'Failed']

  return (
    <div className="p-8 w-full">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold neon-text">Tasks</h1>
          <p className="text-gray-400 mt-1 text-sm">
            {tasks.length} total tasks across {allRepos.length} repos
            {lastUpdated && (
              <span className="ml-2 text-gray-600">
                · synced {new Date(lastUpdated).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface text-gray-400 hover:text-white transition-colors text-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Summary strip */}
      {!loading && tasks.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card mb-6 flex items-center justify-between gap-4 flex-wrap"
        >
          <StatusSummary tasks={tasks} />
          <div className="h-12 w-px bg-white/10 hidden sm:block" />
          <div className="text-sm text-gray-500">
            <span className="text-white font-bold">
              {Math.round(tasks.reduce((s, t) => s + t.progress, 0) / tasks.length)}%
            </span>
            {' '}average progress
          </div>
        </motion.div>
      )}

      {/* Filters */}
      {!loading && tasks.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <div className="flex items-center gap-1.5 text-xs text-gray-500 mr-1">
            <Filter className="w-3.5 h-3.5" />
            Filter:
          </div>

          {/* Status filters */}
          {statuses.filter(s => tasks.some(t => t.status === s)).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(statusFilter === s ? null : s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                statusFilter === s ? STATUS_BADGE[s as keyof typeof STATUS_BADGE] + ' ring-1 ring-current' : 'bg-surface2 text-gray-400 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}

          {allRepos.length > 1 && (
            <span className="w-px h-5 bg-white/10 self-center mx-1" />
          )}

          {/* Repo filters */}
          {allRepos.map(repo => (
            <button
              key={repo}
              onClick={() => setRepoFilter(repoFilter === repo ? null : repo)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                repoFilter === repo
                  ? repoColor(repo) + ' ring-1 ring-current'
                  : 'bg-surface2 text-gray-400 border-transparent hover:text-white'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${repoDot(repo)}`} />
              {repo}
            </button>
          ))}

          {(statusFilter || repoFilter) && (
            <button
              onClick={() => { setStatusFilter(null); setRepoFilter(null) }}
              className="px-2.5 py-1 rounded-full text-xs text-gray-500 hover:text-white transition-colors"
            >
              × Clear
            </button>
          )}
        </div>
      )}

      {/* Task list */}
      {loading ? (
        <div className="text-gray-400 text-sm">Loading tasks…</div>
      ) : filtered.length === 0 ? (
        <div className="text-gray-500 text-sm p-6 text-center glass-card">
          {tasks.length === 0 ? 'No tasks found.' : 'No tasks match the current filter.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((task, i) => (
            <TaskCard key={task.id} task={task} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
