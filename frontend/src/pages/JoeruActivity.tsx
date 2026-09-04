import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  Bot, Wrench, AlertTriangle, FolderGit2, Cpu, CircleSlash,
  CornerDownRight, Clock, Coins, MessagesSquare,
} from 'lucide-react'
import { useMetric } from '@/lib/realtime'

interface Session {
  id: string
  parentId: string | null
  slug: string
  title: string
  repo: string
  agent: string
  model: string | null
  messages: number
  toolCalls: number
  toolErrors: number
  tools: Record<string, number>
  cost: number
  created: number | null
  updated: number | null
}
interface AgentStat {
  agent: string
  sessions: number
  messages: number
  toolCalls: number
  lastActive: number | null
}

// Tools that change something vs tools that only look. A session made entirely
// of the second kind produced nothing, however busy it looks.
const PRODUCING = ['edit', 'write', 'patch']
const SEARCHING = ['read', 'grep', 'glob', 'list']

/** Enough calls to be a real attempt, with nothing to show for it. */
const STUCK_THRESHOLD = 6

const sum = (tools: Record<string, number> = {}, keys: string[]) =>
  keys.reduce((n, k) => n + (tools[k] || 0), 0)

const total = (tools: Record<string, number> = {}) =>
  Object.values(tools).reduce((a, b) => a + b, 0)

const isStuck = (s: Session) =>
  s.toolCalls >= STUCK_THRESHOLD && sum(s.tools, PRODUCING) === 0

function relativeTime(ms: number | null): string {
  if (!ms) return '—'
  const secs = Math.round((Date.now() - ms) / 1000)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}

function duration(from: number | null, to: number | null): string | null {
  if (!from || !to || to <= from) return null
  const secs = Math.round((to - from) / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`
}

/* ── pieces ────────────────────────────────────────────────────────────────── */

function Stat({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string | number; sub?: string; color: string
}) {
  return (
    <div className="glass-card !p-4 !rounded-xl">
      <div className="flex items-center gap-2 text-xs text-gray-500 mb-1.5">
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-xl font-bold tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[11px] text-gray-600 mt-1.5">{sub}</p>}
    </div>
  )
}

/** Proportional read-vs-write bar — the shape of a session at a glance. */
function ToolBar({ tools, muted }: { tools: Record<string, number>; muted?: boolean }) {
  const searching = sum(tools, SEARCHING)
  const producing = sum(tools, PRODUCING)
  const other = total(tools) - searching - producing
  const n = searching + producing + other
  if (!n) return <div className="h-1 rounded-full bg-white/5" />

  const pct = (v: number) => `${(v / n) * 100}%`
  return (
    <div className="flex h-1 rounded-full overflow-hidden bg-white/5">
      <div className={muted ? 'bg-amber-500/60' : 'bg-sky-500/60'}
           style={{ width: pct(searching) }} title={`${searching} read / search`} />
      <div className="bg-emerald-400/90" style={{ width: pct(producing) }}
           title={`${producing} edit / write`} />
      <div className="bg-white/15" style={{ width: pct(other) }} title={`${other} other`} />
    </div>
  )
}

function SessionRow({ s, child }: { s: Session; child?: boolean }) {
  const producing = sum(s.tools, PRODUCING)
  const stuck = isStuck(s)
  const took = duration(s.created, s.updated)

  return (
    <div
      className={`p-3 rounded-xl border transition-colors ${
        stuck
          ? 'bg-amber-500/[0.04] border-amber-500/25 hover:border-amber-500/40'
          : 'bg-white/[0.02] border-white/5 hover:border-white/15'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        {child && <CornerDownRight className="w-3.5 h-3.5 text-gray-600 shrink-0" />}
        <span className="font-medium text-sm truncate">{s.slug}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-gray-400 shrink-0">
          {s.agent}
        </span>
        {stuck && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
        <span className="ml-auto text-[11px] text-gray-600 shrink-0">
          {relativeTime(s.updated)}
        </span>
      </div>

      <ToolBar tools={s.tools} muted={stuck} />

      <div className="flex items-center gap-3 mt-2 text-[11px] tabular-nums text-gray-500">
        {s.repo && (
          <span className="flex items-center gap-1 min-w-0">
            <FolderGit2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{s.repo}</span>
          </span>
        )}
        <span>{s.messages} msg</span>
        <span>{s.toolCalls} tools</span>
        <span className={producing ? 'text-emerald-400' : 'text-gray-600'}>
          {producing} {producing === 1 ? 'change' : 'changes'}
        </span>
        {s.toolErrors > 0 && <span className="text-red-400">{s.toolErrors} err</span>}
        {took && (
          <span className="ml-auto flex items-center gap-1 shrink-0">
            <Clock className="w-3 h-3" />{took}
          </span>
        )}
      </div>
    </div>
  )
}

/** Horizontal bar sized against the busiest row — relative effort at a glance. */
function BarRow({ label, value, max, hint }: {
  label: string; value: number; max: number; hint: string
}) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-sm truncate">{label}</span>
        <span className="ml-auto text-[11px] text-gray-500 tabular-nums shrink-0">{hint}</span>
      </div>
      <div className="h-1 rounded-full bg-white/5 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-400"
          style={{ width: `${max ? (value / max) * 100 : 0}%` }}
        />
      </div>
    </div>
  )
}

/* ── page ──────────────────────────────────────────────────────────────────── */

export default function JoeruActivity() {
  const data = useMetric('opencode')

  const sessions: Session[] = data?.sessions ?? []
  const agents: AgentStat[] = data?.agents ?? []
  const totals = data?.totals ?? { sessions: 0, messages: 0, toolCalls: 0, cost: 0 }
  const tools: Record<string, number> = data?.tools ?? {}

  // Roots with their subagent runs attached, so a delegation reads as one unit
  // rather than as unrelated rows that happen to be near each other.
  const tree = useMemo(() => {
    const children = new Map<string, Session[]>()
    for (const s of sessions) {
      if (!s.parentId) continue
      if (!children.has(s.parentId)) children.set(s.parentId, [])
      children.get(s.parentId)!.push(s)
    }
    const roots = sessions.filter(s => !s.parentId)
    const orphans = sessions.filter(
      s => s.parentId && !sessions.some(p => p.id === s.parentId),
    )
    return [...roots, ...orphans].map(s => ({ session: s, children: children.get(s.id) ?? [] }))
  }, [sessions])

  const stuck = useMemo(() => sessions.filter(isStuck), [sessions])
  const busiest = Math.max(1, ...agents.map(a => a.toolCalls))
  const toolList = Object.entries(tools).sort((a, b) => b[1] - a[1])
  const maxTool = Math.max(1, ...toolList.map(([, n]) => n))

  if (data?.available === false) {
    return (
      <div className="glass-card !p-10 text-center">
        <CircleSlash className="w-8 h-8 mx-auto mb-3 text-gray-600" />
        <p className="font-medium">OpenCode not detected</p>
        <p className="text-sm text-gray-500 mt-1">{data.reason}</p>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-5"
    >
      {sessions[0]?.model && (
        <div className="flex justify-end -mb-1">
          <span className="flex items-center gap-1.5 text-xs text-gray-500 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/5">
            <Cpu className="w-3.5 h-3.5" /> {sessions[0].model}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat icon={MessagesSquare} label="Sessions" value={totals.sessions}
              sub={`${tree.length} root · ${sessions.length - tree.length} delegated`}
              color="text-indigo-400" />
        <Stat icon={Bot} label="Messages" value={totals.messages} color="text-violet-400" />
        <Stat icon={Wrench} label="Tool calls" value={totals.toolCalls}
              sub={`${sum(tools, PRODUCING)} produced changes`} color="text-sky-400" />
        <Stat icon={Coins} label="Cost" value={`$${(totals.cost ?? 0).toFixed(2)}`}
              sub="free tier" color="text-emerald-400" />
      </div>

      {stuck.length > 0 && (
        <div className="rounded-2xl p-4 bg-amber-500/[0.06] border border-amber-500/25">
          <div className="flex items-center gap-2 text-amber-300 font-medium text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {stuck.length} session{stuck.length > 1 ? 's' : ''} did a lot and changed nothing
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Many reads and searches, no edit or write — usually an agent looping,
            often because it lacks the tool it needs for the job.
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            {stuck.map(s => (
              <span key={s.id}
                className="text-[11px] px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <span className="text-amber-200">{s.slug}</span>
                <span className="text-gray-500"> · {s.agent} · </span>
                <span className="tabular-nums text-amber-300/90">{s.toolCalls} calls, 0 changes</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-5 items-start">
        <div className="lg:col-span-2 glass-card !p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold">Sessions</h2>
            <div className="flex items-center gap-3 text-[11px] text-gray-500">
              <span className="flex items-center gap-1.5">
                <i className="w-2.5 h-1 rounded-full bg-sky-500/60 not-italic" /> read
              </span>
              <span className="flex items-center gap-1.5">
                <i className="w-2.5 h-1 rounded-full bg-emerald-400/90 not-italic" /> change
              </span>
            </div>
          </div>

          {tree.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">No sessions yet.</p>
          ) : (
            <div className="space-y-3">
              {tree.map(({ session, children }) => (
                <div key={session.id}>
                  <SessionRow s={session} />
                  {children.length > 0 && (
                    <div className="mt-2 ml-4 pl-4 border-l border-white/10 space-y-2">
                      {children.map(c => <SessionRow key={c.id} s={c} child />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div className="glass-card !p-5">
            <h2 className="text-base font-bold mb-4">Agents</h2>
            {agents.length === 0 ? (
              <p className="text-sm text-gray-500">No activity yet.</p>
            ) : (
              <div className="space-y-3.5">
                {agents.map(a => (
                  <BarRow key={a.agent} label={a.agent} value={a.toolCalls} max={busiest}
                          hint={`${a.messages} msg · ${a.toolCalls} tools`} />
                ))}
              </div>
            )}
          </div>

          <div className="glass-card !p-5">
            <h2 className="text-base font-bold mb-4">Tool usage</h2>
            {toolList.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing recorded yet.</p>
            ) : (
              <div className="space-y-2.5">
                {toolList.map(([name, count]) => {
                  const produces = PRODUCING.includes(name)
                  return (
                    <div key={name} className="flex items-center gap-2.5">
                      <span className={`text-sm w-16 shrink-0 ${produces ? 'text-emerald-400' : 'text-gray-300'}`}>
                        {name}
                      </span>
                      <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${produces ? 'bg-emerald-400/90' : 'bg-sky-500/60'}`}
                          style={{ width: `${(count / maxTool) * 100}%` }}
                        />
                      </div>
                      <span className="text-[11px] text-gray-500 tabular-nums w-6 text-right shrink-0">
                        {count}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
