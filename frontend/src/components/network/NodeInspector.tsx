import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { AgentData, NetworkNode, RepoData, RootData } from '@/lib/network-types'

const PRIORITY_COLOR: Record<string, string> = {
  High: 'text-rose-300 bg-rose-400/10',
  Medium: 'text-amber-300 bg-amber-400/10',
  Low: 'text-slate-300 bg-slate-400/10',
}

const STATUS_COLOR: Record<string, string> = {
  Working: 'text-cyan-300', Completed: 'text-emerald-300', Done: 'text-emerald-300',
  Reviewing: 'text-fuchsia-300', Failed: 'text-rose-300', Pending: 'text-slate-400',
}

/** Last path segment of a working dir, e.g. "d:\FlowerStorePH\fs-llm-service" → "fs-llm-service". */
function cwdName(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || cwd
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 text-[12px]">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 text-right">{value}</span>
    </div>
  )
}

export default function NodeInspector({
  node, onClose,
}: { node: NetworkNode | null; onClose: () => void }) {
  return (
    <AnimatePresence>
      {node && (
        <motion.aside
          initial={{ x: 40, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 40, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 30 }}
          className="absolute right-4 top-4 bottom-4 z-20 w-[320px] overflow-y-auto rounded-2xl
                     border border-white/[0.08] bg-[#0c1120]/85 backdrop-blur-xl p-4
                     shadow-[0_0_40px_-8px_rgba(0,0,0,0.8)] scrollbar-thin"
        >
          <div className="mb-3 flex items-start gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{node.type}</div>
              <div className="text-[15px] font-bold text-white leading-tight">
                {(node.data as { label: string }).label}
              </div>
            </div>
            <button
              onClick={onClose}
              className="ml-auto text-slate-500 hover:text-white transition-colors"
              aria-label="Close inspector"
            >
              <X size={16} />
            </button>
          </div>

          {node.type === 'root' && <RootBody data={node.data as RootData} />}
          {node.type === 'agent' && <AgentBody data={node.data as AgentData} />}
          {node.type === 'repo' && <RepoBody data={node.data as RepoData} />}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}

function RootBody({ data }: { data: RootData }) {
  return (
    <div className="space-y-2 border-t border-white/[0.06] pt-3">
      <Row label="Agents working" value={<b className="text-cyan-300">{data.workingCount}</b>} />
      <Row label="Total agents" value={data.agentCount} />
      <Row label="Repositories" value={data.repoCount} />
    </div>
  )
}

function RepoBody({ data }: { data: RepoData }) {
  return (
    <div className="space-y-2 border-t border-white/[0.06] pt-3">
      <Row label="Status" value={
        <span className={data.working ? 'text-cyan-300' : 'text-slate-400'}>
          {data.working ? 'Active' : 'Quiet'}
        </span>
      } />
      <Row label="Owned by" value={data.owners.join(', ') || '—'} />
    </div>
  )
}

function AgentBody({ data }: { data: AgentData }) {
  return (
    <div className="space-y-3">
      <div className="space-y-2 border-t border-white/[0.06] pt-3">
        <Row label="Status" value={
          <span className={data.working ? 'text-cyan-300' : 'text-slate-400'}>{data.status}</span>
        } />
        <Row label="Project" value={data.assignedProject || 'General'} />
        {data.activeCwd && (
          <Row label="Active in" value={<span className="font-mono text-cyan-300">{cwdName(data.activeCwd)}</span>} />
        )}
        {data.lastUpdate && <Row label="Last update" value={data.lastUpdate} />}
        <Row label="Repos" value={data.repoCount} />
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          Tasks ({data.tasks.length})
        </div>
        {data.tasks.length === 0 ? (
          <p className="text-[11px] text-slate-500">No tasks assigned.</p>
        ) : (
          <div className="space-y-2">
            {data.tasks.map((t) => (
              <div key={t.id || t.title} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex items-start gap-2">
                  <span className="text-[12px] font-medium text-slate-100 leading-tight">{t.title}</span>
                  <span className={[
                    'ml-auto shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium',
                    PRIORITY_COLOR[t.priority] ?? 'text-slate-300 bg-slate-400/10',
                  ].join(' ')}>{t.priority}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <span className={['text-[10px] font-medium', STATUS_COLOR[t.status] ?? 'text-slate-400'].join(' ')}>
                    {t.status}
                  </span>
                  <div className="ml-auto h-1 w-20 overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-cyan-400/70" style={{ width: `${t.progress}%` }} />
                  </div>
                  <span className="text-[9px] tabular-nums text-slate-500">{t.progress}%</span>
                </div>
                {t.repos.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {t.repos.map((r) => (
                      <span key={r} className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[9px] text-slate-300">{r}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
