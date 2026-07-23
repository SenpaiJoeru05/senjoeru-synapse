import { useEffect, useMemo, useState } from 'react'
import { History as HistoryIcon, CheckCircle, GitCommit, Clock, Search } from 'lucide-react'
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

// ── page ──────────────────────────────────────────────────────────────────────
export default function History() {
  const { db } = useRealtime()

  // One-time REST fallback so the page paints before the first WS db frame.
  const [fallback, setFallback] = useState<{ tasks: DbTask[]; execution: ExecEvent[] } | null>(null)
  useEffect(() => {
    let cancelled = false
    Promise.all([api.getExecutionHistory(50), api.getDbTasks()])
      .then(([e, t]) => {
        if (!cancelled) setFallback({ execution: e.events ?? [], tasks: t.tasks ?? [] })
      })
      .catch(() => { /* WS frame will fill in */ })
    return () => { cancelled = true }
  }, [])

  const execution: ExecEvent[] = db?.execution ?? fallback?.execution ?? []
  const tasks: DbTask[] = db?.tasks ?? fallback?.tasks ?? []

  // Task History Explorer — fetch the append-only snapshots for a selected task.
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

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => a.title.localeCompare(b.title)),
    [tasks],
  )
  const selectedTask = sortedTasks.find((t) => t.id === selectedId) ?? null
  const filteredTasks = sortedTasks.filter((t) =>
    t.title.toLowerCase().includes(search.trim().toLowerCase()),
  )

  return (
    <div className="p-8 w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold neon-text">History</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Permanent engineering history from SQLite · {execution.length} recent events · {tasks.length} tasks tracked
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Execution timeline ── */}
        <div className="glass-card">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <HistoryIcon className="w-5 h-5 text-accent" /> Execution Timeline
          </h2>
          {execution.length === 0 ? (
            <p className="text-gray-500 text-sm py-8 text-center">No execution events recorded yet.</p>
          ) : (
            <div className="space-y-2 max-h-[70vh] overflow-y-auto scrollbar-hide">
              {execution.map((e) => {
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

        {/* ── Task history explorer ── */}
        <div className="glass-card">
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" /> Task History Explorer
          </h2>

          {/* Search + clickable task list (replaces the native dropdown). */}
          <div className="relative mb-3">
            <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks…"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm"
            />
          </div>

          <div className="space-y-1 max-h-52 overflow-y-auto scrollbar-hide mb-4">
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

          {!selectedTask ? (
            <p className="text-gray-500 text-sm py-6 text-center">
              Pick a task above to view every state it has ever had (append-only).
            </p>
          ) : loadingHistory ? (
            <p className="text-gray-400 text-sm py-6 text-center">Loading history…</p>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className={`text-xs px-2 py-1 rounded ${badge(selectedTask.status)}`}>
                  now: {selectedTask.status}
                </span>
                <span className="text-xs text-gray-500">{snapshots.length} snapshot{snapshots.length !== 1 ? 's' : ''}</span>
              </div>
              <div className="space-y-3 max-h-[60vh] overflow-y-auto scrollbar-hide">
                {snapshots.map((s, i) => (
                  <div key={s.historyId} className="relative pl-5">
                    <span className="absolute left-0 top-1.5 w-2 h-2 rounded-full bg-primary" />
                    {i < snapshots.length - 1 && (
                      <span className="absolute left-[3px] top-3.5 bottom-[-12px] w-px bg-white/10" />
                    )}
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
    </div>
  )
}
