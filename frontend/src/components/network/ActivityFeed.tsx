import { AnimatePresence, motion } from 'framer-motion'
import {
  Bot, ListTodo, CheckCircle, GitCommit, FileText, Activity as ActivityIcon,
  type LucideIcon,
} from 'lucide-react'
import type { FeedItem } from '@/lib/network-types'

const ICONS: Record<string, LucideIcon> = {
  Bot, ListTodo, CheckCircle, GitCommit, FileText,
}

const TYPE_COLOR: Record<string, string> = {
  agent: 'text-cyan-300',
  task: 'text-fuchsia-300',
  commit: 'text-emerald-300',
}

function clock(ms: number): string {
  const dt = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`
}

export default function ActivityFeed({ items }: { items: FeedItem[] }) {
  return (
    <div className="flex h-full w-[300px] flex-col border-r border-white/[0.06] bg-white/[0.02] backdrop-blur-xl">
      <div className="flex items-center gap-2 px-4 py-3.5 border-b border-white/[0.06]">
        <ActivityIcon size={15} className="text-cyan-300" />
        <span className="text-[13px] font-semibold text-white">Activity</span>
        <span className="ml-auto text-[10px] text-slate-500">{items.length} events</span>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 scrollbar-thin">
        {items.length === 0 && (
          <p className="px-1 pt-6 text-center text-[11px] text-slate-500">
            Waiting for agent activity…
          </p>
        )}
        <AnimatePresence initial={false}>
          {items.map((e) => {
            const Icon = ICONS[e.icon] ?? ActivityIcon
            const color = TYPE_COLOR[e.type] ?? 'text-slate-300'
            return (
              <motion.div
                key={e.key}
                layout
                initial={{ opacity: 0, x: -16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Icon size={13} className={color} />
                  <span className="text-[12px] font-medium text-slate-100 leading-tight">{e.title}</span>
                  <span className="ml-auto shrink-0 text-[9px] tabular-nums text-slate-500">{clock(e.at)}</span>
                </div>
                {e.description && (
                  <p className="mt-1 pl-[21px] text-[10.5px] leading-snug text-slate-400 line-clamp-2">
                    {e.description}
                  </p>
                )}
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
