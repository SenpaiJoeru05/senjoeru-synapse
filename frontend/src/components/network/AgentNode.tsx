import { Handle, Position, type NodeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import { Bot } from 'lucide-react'
import type { AgentData } from '@/lib/network-types'

/**
 * Agent node — cyan glow + pulse when working, muted slate when idle.
 * `selected` (from React Flow) brightens the border.
 */
export default function AgentNode({ data, selected }: NodeProps) {
  const d = data as AgentData
  const working = d.working

  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 220, damping: 20 }}
      className={[
        'relative w-[200px] rounded-xl px-4 py-3 backdrop-blur-xl border transition-colors',
        working
          ? 'border-cyan-400/50 bg-cyan-400/[0.06]'
          : 'border-slate-600/40 bg-slate-500/[0.05]',
        selected ? 'ring-2 ring-cyan-300/60' : '',
      ].join(' ')}
      style={working ? { boxShadow: '0 0 28px -6px rgba(34,211,238,0.6)' } : undefined}
    >
      {working && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl"
          style={{ boxShadow: '0 0 40px 2px rgba(34,211,238,0.35)' }}
          animate={{ opacity: [0.35, 0.8, 0.35] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <Handle type="target" position={Position.Top} className="!bg-slate-400/70 !border-none !w-2 !h-2" />

      <div className="relative flex items-center gap-2.5">
        <div
          className={[
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
            working ? 'bg-cyan-400/15 text-cyan-300' : 'bg-slate-500/15 text-slate-400',
          ].join(' ')}
        >
          <Bot size={17} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-white">{d.label}</div>
          <div className="flex items-center gap-1.5">
            <span
              className={[
                'h-1.5 w-1.5 rounded-full',
                working ? 'bg-cyan-300' : 'bg-slate-500',
              ].join(' ')}
            />
            <span className={working ? 'text-[10px] text-cyan-300' : 'text-[10px] text-slate-400'}>
              {working ? 'Working' : 'Idle'}
            </span>
          </div>
        </div>
      </div>

      <div className="relative mt-2 flex gap-3 text-[10px] text-slate-400">
        <span><b className="text-slate-200">{d.repoCount}</b> repos</span>
        <span><b className="text-slate-200">{d.taskCount}</b> tasks</span>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-cyan-400/70 !border-none !w-2 !h-2" />
    </motion.div>
  )
}
