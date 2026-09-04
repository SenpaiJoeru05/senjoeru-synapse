import { useEffect, useState } from 'react'
import {
  Brain, GitCommit, CheckCircle, Zap, AlertTriangle, Clock, RefreshCw, FolderGit2,
} from 'lucide-react'
import { api } from '@/lib/api'

// ── types (loose) ──────────────────────────────────────────────────────────
interface RepoState { repo: string; lastCommit: string | null; daysSince: number | null; state: string }
interface Summary {
  generatedAt: string
  today: { date: string; commits: { total: number; byRepo: { repo: string; n: number }[] }; tasksCompleted: { id: string; title: string }[] }
  active: { workingTasks: any[]; workingAgents: { name: string; role: string }[] }
  blocked: { failedTasks: any[]; stalledTasks: any[] }
  repos: RepoState[]
}

const REPO_STATE: Record<string, { label: string; cls: string }> = {
  active:    { label: 'active',  cls: 'bg-success/20 text-success' },
  quiet:     { label: 'quiet',   cls: 'bg-warning/20 text-warning' },
  stale:     { label: 'stale',   cls: 'bg-error/20 text-error' },
  'no-data': { label: 'no data', cls: 'bg-gray-500/20 text-gray-400' },
}

function daysLabel(d: number | null): string {
  if (d == null) return 'never'
  if (d === 0) return 'today'
  if (d === 1) return '1 day ago'
  return `${d} days ago`
}

function Section({ title, icon: Icon, count, children }: {
  title: string; icon: React.ElementType; count?: number; children: React.ReactNode
}) {
  return (
    <div className="glass-card">
      <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
        <Icon className="w-5 h-5 text-primary" /> {title}
        {count != null && <span className="ml-auto text-sm text-gray-500">{count}</span>}
      </h2>
      {children}
    </div>
  )
}

export default function Intelligence() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    api.getIntelligence()
      .then((s) => setSummary(s))
      .catch(() => setSummary(null))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  if (loading && !summary) {
    return <div className="p-8 text-gray-400 text-sm">Computing intelligence…</div>
  }
  if (!summary) {
    return <div className="p-8 text-gray-500 text-sm">No intelligence available yet.</div>
  }

  const { today, active, blocked, repos } = summary

  return (
    <div className="p-8 w-full">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold neon-text flex items-center gap-2">
            <Brain className="w-7 h-7 text-primary" /> Engineering Intelligence
          </h1>
          <p className="text-gray-400 mt-1 text-sm">
            Explained from your local data · zero-token · computed {new Date(summary.generatedAt).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface2 hover:bg-surface text-gray-400 hover:text-white transition-colors text-sm">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Today */}
        <Section title={`Today · ${today.date}`} icon={GitCommit}>
          <div className="flex gap-4 mb-3">
            <div className="flex-1 p-3 rounded-xl bg-surface2">
              <p className="text-2xl font-bold tabular-nums">{today.commits.total}</p>
              <p className="text-[11px] text-gray-500">commits today</p>
            </div>
            <div className="flex-1 p-3 rounded-xl bg-surface2">
              <p className="text-2xl font-bold tabular-nums text-success">{today.tasksCompleted.length}</p>
              <p className="text-[11px] text-gray-500">tasks completed</p>
            </div>
          </div>
          {today.commits.byRepo.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {today.commits.byRepo.map((r) => (
                <span key={r.repo} className="text-[11px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-mono">
                  {r.repo} · {r.n}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No commits recorded today.</p>
          )}
        </Section>

        {/* Repo activity */}
        <Section title="Repository activity" icon={FolderGit2} count={repos.length}>
          <div className="space-y-1.5">
            {repos.map((r) => {
              const st = REPO_STATE[r.state] ?? REPO_STATE['no-data']
              return (
                <div key={r.repo} className="flex items-center gap-2 p-2 rounded-lg bg-surface2">
                  <span className="flex-1 text-sm font-mono truncate">{r.repo}</span>
                  <span className="text-[11px] text-gray-500">{daysLabel(r.daysSince)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                </div>
              )
            })}
          </div>
        </Section>

        {/* Active */}
        <Section title="Active now" icon={Zap} count={active.workingTasks.length + active.workingAgents.length}>
          {active.workingAgents.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {active.workingAgents.map((a, i) => (
                <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                  {a.name} · working
                </span>
              ))}
            </div>
          )}
          {active.workingTasks.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing in progress right now.</p>
          ) : (
            <div className="space-y-1.5">
              {active.workingTasks.slice(0, 8).map((t) => (
                <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  <span className="flex-1 text-sm truncate">{t.title}</span>
                  <span className="text-[11px] text-gray-500">{t.assigned_agent}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Blocked / stalled */}
        <Section title="Needs attention" icon={AlertTriangle} count={blocked.failedTasks.length + blocked.stalledTasks.length}>
          {blocked.failedTasks.length === 0 && blocked.stalledTasks.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing blocked or stalled. 🎉</p>
          ) : (
            <div className="space-y-1.5">
              {blocked.failedTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg bg-error/10 border border-error/20">
                  <AlertTriangle className="w-3.5 h-3.5 text-error shrink-0" />
                  <span className="flex-1 text-sm truncate">{t.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-error/20 text-error">failed</span>
                </div>
              ))}
              {blocked.stalledTasks.map((t) => (
                <div key={t.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface2">
                  <Clock className="w-3.5 h-3.5 text-warning shrink-0" />
                  <span className="flex-1 text-sm truncate">{t.title}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/20 text-warning">stalled</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <p className="text-[11px] text-gray-600 mt-4 flex items-center gap-1.5">
        <CheckCircle className="w-3 h-3 text-success" /> All computed locally from SQLite — no AI, no tokens.
      </p>
    </div>
  )
}
