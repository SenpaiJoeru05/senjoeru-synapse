import { useEffect, useMemo, useState } from 'react'
import {
  History as HistoryIcon, CheckCircle, GitCommit, Clock, Search,
  MonitorPlay, ListTree, Filter, Circle, Terminal, FolderGit2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useRealtime } from '@/lib/realtime'

// ── types ──────────────────────────────────────────────────────────────────
interface ExecEvent {
  id: number
  type: string
  entityId: string | null
  title: string
  detail: string
  occurredAt: string | null
  recordedAt: string
}
interface DbTask { id: string; title: string; status: string; progress: number }
interface TaskSnapshot {
  historyId: number
  status: string
  progress: number
  capturedAt: string
  taskLastUpdated: string | null
}
interface Session {
  session_id: string
  pid: number | null
  cwd: string | null
  repo: string | null
  kind: string | null
  version: string | null
  started_at: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  ended_at: string | null
  active: number
}

// ── helpers ──────────────────────────────────────────────────────────────────
function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms)) return ''
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function durationMin(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const start = new Date(a).getTime(), end = new Date(b).getTime()
  if (isNaN(start) || isNaN(end) || end < start) return null
  return Math.round((end - start) / 60000)
}
function fmtDuration(min: number | null): string {
  if (min == null) return '—'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  return `${h}h ${min % 60}m`
}
function basename(p: string | null): string {
  if (!p) return '—'
  return String(p).split(/[/\\]/).filter(Boolean).pop() ?? p
}

const STATUS_BADGE: Record<string, string> = {
  Working: 'bg-primary/20 text-primary',
  Reviewing: 'bg-secondary/20 text-secondary',
  Pending: 'bg-warning/20 text-warning',
  Completed: 'bg-success/20 text-success',
  Failed: 'bg-error/20 text-error',
}
function badge(status: string) {
  return STATUS_BADGE[status] ?? 'bg-gray-500/20 text-gray-400'
}

const REPO_BADGE: Record<string, string> = {
  'fs-llm-service': 'bg-violet-500/20 text-violet-300',
  'cs-dashboard': 'bg-emerald-500/20 text-emerald-300',
  'chat-widget': 'bg-cyan-500/20 text-cyan-300',
  'fsweb': 'bg-amber-500/20 text-amber-300',
  'seller-page': 'bg-purple-500/20 text-purple-300',
}
function repoBadge(repo: string | null) {
  return REPO_BADGE[repo ?? ''] ?? 'bg-gray-500/20 text-gray-400'
}

type Tab = 'timeline' | 'sessions' | 'tasks'
type TimelineFilter = 'all' | 'git_commit' | 'task_completed'

// ── Timeline tab ────────────────────────────────────────────────────────────
function TimelineTab({ execution }: { execution: ExecEvent[] }) {
  const [filter, setFilter] = useState<TimelineFilter>('all')
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return execution.filter((e) => {
      if (filter !== 'all' && e.type !== filter) return false
      if (!needle) return true
      return (
        e.title.toLowerCase().includes(needle) ||
        (e.detail ?? '').toLowerCase().includes(needle) ||
        (e.entityId ?? '').toLowerCase().includes(needle)
      )
    })
  }, [execution, filter, q])

  const counts = useMemo(() => ({
    all: execution.length,
    git_commit: execution.filter((e) => e.type === 'git_commit').length,
    task_completed: execution.filter((e) => e.type === 'task_completed').length,
  }), [execution])

  const chips: { key: TimelineFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'git_commit', label: 'Commits' },
    { key: 'task_completed', label: 'Tasks done' },
  ]

  return (
    <div className="glass-card">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Filter className="w-4 h-4 text-gray-500" />
        {chips.map((c) => (
          <button
            key={c.key}
            onClick={() => setFilter(c.key)}
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              filter === c.key ? 'bg-primary/20 text-primary ring-1 ring-primary/40' : 'bg-surface2 text-gray-400 hover:text-white'
            }`}
          >
            {c.label} <span className="opacity-60">{counts[c.key]}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="w-4 h-4 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter events…"
            className="w-52 pl-8 pr-3 py-1.5 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-gray-500 text-sm py-10 text-center">No events match this filter.</p>
      ) : (
        <div className="space-y-2 max-h-[68vh] overflow-y-auto scrollbar-hide">
          {filtered.map((e) => {
            const isCommit = e.type === 'git_commit'
            const Icon = isCommit ? GitCommit : CheckCircle
            const cls = isCommit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-success/20 text-success'
            return (
              <div key={e.id} className="flex items-start gap-3 p-3 rounded-lg bg-surface2">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${cls}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium leading-tight">{e.title}</p>
                  {e.detail && <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{e.detail}</p>}
                  <p className="text-[11px] text-gray-600 mt-0.5">
                    {isCommit ? 'commit' : 'task completed'}
                    {e.entityId ? ` · ${e.entityId}` : ''}
                  </p>
                </div>
                <span className="text-[11px] text-gray-500 whitespace-nowrap shrink-0">
                  {relativeTime(e.occurredAt ?? e.recordedAt)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Sessions tab (explorer + replay) ────────────────────────────────────────
function SessionsTab({ execution }: { execution: ExecEvent[] }) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getSessions(100)
      .then((r) => { if (!cancelled) setSessions(r.sessions ?? []) })
      .catch(() => { if (!cancelled) setSessions([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const current = sessions.find((s) => s.session_id === selected) ?? null

  // "Replay": execution events that fall inside the selected session's window.
  const replay = useMemo(() => {
    if (!current) return []
    const start = current.first_seen_at ? new Date(current.first_seen_at).getTime() : null
    const endIso = current.ended_at ?? current.last_seen_at
    const end = endIso ? new Date(endIso).getTime() : Date.now()
    if (start == null) return []
    return execution
      .filter((e) => {
        const t = new Date(e.occurredAt ?? e.recordedAt).getTime()
        return !isNaN(t) && t >= start - 60000 && t <= end + 60000
      })
      .sort((a, b) => new Date(a.occurredAt ?? a.recordedAt).getTime() - new Date(b.occurredAt ?? b.recordedAt).getTime())
  }, [current, execution])

  if (loading) return <div className="glass-card text-gray-400 text-sm">Loading sessions…</div>
  if (sessions.length === 0) {
    return (
      <div className="glass-card text-gray-500 text-sm py-10 text-center">
        No observed sessions yet. Sessions appear here once Claude Code runs in a monitored repo.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
      {/* session list */}
      <div className="glass-card">
        <h2 className="text-sm font-bold mb-3 flex items-center gap-2 text-gray-300">
          <MonitorPlay className="w-4 h-4 text-primary" /> Observed sessions ({sessions.length})
        </h2>
        <div className="space-y-1.5 max-h-[68vh] overflow-y-auto scrollbar-hide">
          {sessions.map((s) => {
            const dur = durationMin(s.first_seen_at, s.ended_at ?? s.last_seen_at)
            const isSel = s.session_id === selected
            return (
              <button
                key={s.session_id}
                onClick={() => setSelected(isSel ? null : s.session_id)}
                className={`w-full text-left p-3 rounded-lg transition-colors ${
                  isSel ? 'bg-primary/15 ring-1 ring-primary/40' : 'bg-surface2 hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {s.active
                    ? <span className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
                    : <Circle className="w-2 h-2 text-gray-600 shrink-0" />}
                  <span className="text-sm font-medium truncate flex-1">{basename(s.cwd)}</span>
                  {s.repo && <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${repoBadge(s.repo)}`}>{s.repo}</span>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-gray-500 pl-4">
                  <span>{s.active ? 'active' : relativeTime(s.ended_at ?? s.last_seen_at)}</span>
                  <span>· {fmtDuration(dur)}</span>
                  {s.kind && <span>· {s.kind}</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* session detail / replay */}
      <div className="glass-card">
        {!current ? (
          <p className="text-gray-500 text-sm py-10 text-center">
            Select a session to replay everything that happened while it was open.
          </p>
        ) : (
          <div>
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h2 className="text-lg font-bold flex items-center gap-2">
                  <FolderGit2 className="w-5 h-5 text-primary" /> {basename(current.cwd)}
                </h2>
                <p className="text-xs text-gray-500 font-mono truncate mt-1">{current.cwd}</p>
              </div>
              <span className={`text-[11px] px-2 py-1 rounded shrink-0 ${current.active ? 'bg-success/20 text-success' : 'bg-gray-500/20 text-gray-400'}`}>
                {current.active ? 'active' : 'ended'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {[
                { label: 'Duration', value: fmtDuration(durationMin(current.first_seen_at, current.ended_at ?? current.last_seen_at)) },
                { label: 'PID', value: current.pid != null ? String(current.pid) : '—' },
                { label: 'Kind', value: current.kind || '—' },
                { label: 'Version', value: current.version || '—' },
              ].map((m) => (
                <div key={m.label} className="p-2.5 rounded-lg bg-surface2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-600">{m.label}</p>
                  <p className="text-sm font-semibold mt-0.5 truncate">{m.value}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-2 mb-3">
              <Terminal className="w-4 h-4 text-accent" />
              <span className="text-sm font-semibold text-gray-300">Session replay</span>
              <span className="text-[11px] text-gray-600">{replay.length} event{replay.length !== 1 ? 's' : ''} in window</span>
            </div>

            {replay.length === 0 ? (
              <p className="text-gray-600 text-xs py-6 text-center bg-surface2 rounded-lg">
                No recorded commits or task completions fell inside this session's window.
              </p>
            ) : (
              <div className="space-y-3 max-h-[52vh] overflow-y-auto scrollbar-hide">
                {replay.map((e, i) => {
                  const isCommit = e.type === 'git_commit'
                  const Icon = isCommit ? GitCommit : CheckCircle
                  return (
                    <div key={e.id} className="relative pl-6">
                      <span className={`absolute left-0 top-1 w-4 h-4 rounded-full flex items-center justify-center ${isCommit ? 'bg-emerald-500/25 text-emerald-400' : 'bg-success/25 text-success'}`}>
                        <Icon className="w-2.5 h-2.5" />
                      </span>
                      {i < replay.length - 1 && <span className="absolute left-[7px] top-5 bottom-[-12px] w-px bg-white/10" />}
                      <div className="p-2.5 rounded-lg bg-surface2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium truncate">{e.title}</span>
                          <span className="text-[11px] text-gray-500 shrink-0">{relativeTime(e.occurredAt ?? e.recordedAt)}</span>
                        </div>
                        {e.detail && <p className="text-xs text-gray-400 line-clamp-1 mt-0.5">{e.detail}</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tasks tab (append-only history explorer) ────────────────────────────────
function TasksTab({ tasks }: { tasks: DbTask[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<TaskSnapshot[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!selectedId) { setSnapshots([]); return }
    let cancelled = false
    setLoadingHistory(true)
    api.getTaskHistory(selectedId)
      .then((r) => { if (!cancelled) setSnapshots(r.history ?? []) })
      .catch(() => { if (!cancelled) setSnapshots([]) })
      .finally(() => { if (!cancelled) setLoadingHistory(false) })
    return () => { cancelled = true }
  }, [selectedId])

  const sortedTasks = useMemo(() => [...tasks].sort((a, b) => a.title.localeCompare(b.title)), [tasks])
  const selectedTask = sortedTasks.find((t) => t.id === selectedId) ?? null
  const filteredTasks = sortedTasks.filter((t) => t.title.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="glass-card">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-primary" /> Pick a task
        </h2>
        <div className="relative mb-3">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm"
          />
        </div>
        <div className="space-y-1 max-h-[62vh] overflow-y-auto scrollbar-hide">
          {filteredTasks.length === 0 ? (
            <p className="text-gray-500 text-sm py-4 text-center">No tasks match.</p>
          ) : filteredTasks.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                t.id === selectedId ? 'bg-primary/15 ring-1 ring-primary/40' : 'bg-surface2 hover:bg-white/5'
              }`}
            >
              <span className="flex-1 min-w-0 truncate text-sm">{t.title}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${badge(t.status)}`}>{t.status}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="glass-card">
        <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
          <ListTree className="w-5 h-5 text-accent" /> State history
        </h2>
        {!selectedTask ? (
          <p className="text-gray-500 text-sm py-6 text-center">
            Pick a task to view every state it has ever had (append-only).
          </p>
        ) : loadingHistory ? (
          <p className="text-gray-400 text-sm py-6 text-center">Loading history…</p>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className={`text-xs px-2 py-1 rounded ${badge(selectedTask.status)}`}>now: {selectedTask.status}</span>
              <span className="text-xs text-gray-500">{snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-3 max-h-[60vh] overflow-y-auto scrollbar-hide">
              {snapshots.map((s, i) => (
                <div key={s.historyId} className="relative pl-5">
                  <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-primary" />
                  {i < snapshots.length - 1 && <span className="absolute left-[3px] top-3.5 bottom-[-12px] w-px bg-white/10" />}
                  <div className="p-2.5 rounded-lg bg-surface2">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[11px] px-1.5 py-0.5 rounded ${badge(s.status)}`}>{s.status}</span>
                      <span className="text-[11px] text-gray-500">{relativeTime(s.capturedAt)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-background rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-primary" style={{ width: `${s.progress}%` }} />
                      </div>
                      <span className="text-[11px] text-gray-400 tabular-nums w-8 text-right">{s.progress}%</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function History() {
  const { db } = useRealtime()
  const [tab, setTab] = useState<Tab>('timeline')

  // One-time REST fallback so the page paints before the first WS db frame.
  const [fallback, setFallback] = useState<{ tasks: DbTask[]; execution: ExecEvent[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    Promise.all([api.getExecutionHistory(200), api.getDbTasks()])
      .then(([e, t]) => { if (!cancelled) setFallback({ execution: e.events ?? [], tasks: t.tasks ?? [] }) })
      .catch(() => { /* WS frame will fill in */ })
    return () => { cancelled = true }
  }, [])

  const execution: ExecEvent[] = db?.execution ?? fallback?.execution ?? []
  const tasks: DbTask[] = db?.tasks ?? fallback?.tasks ?? []

  const tabs: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'timeline', label: 'Timeline', icon: HistoryIcon },
    { key: 'sessions', label: 'Sessions', icon: MonitorPlay },
    { key: 'tasks', label: 'Task history', icon: ListTree },
  ]

  return (
    <div className="p-8 w-full">
      <div className="mb-5">
        <h1 className="text-3xl font-bold neon-text">History</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Permanent engineering record from SQLite · {execution.length} events · {tasks.length} tasks tracked
        </p>
      </div>

      {/* sub-tab bar */}
      <div className="flex items-center gap-1 mb-5 p-1 rounded-xl bg-surface2 w-fit">
        {tabs.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm transition-colors ${
                tab === t.key ? 'bg-primary text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'timeline' && <TimelineTab execution={execution} />}
      {tab === 'sessions' && <SessionsTab execution={execution} />}
      {tab === 'tasks' && <TasksTab tasks={tasks} />}
    </div>
  )
}
