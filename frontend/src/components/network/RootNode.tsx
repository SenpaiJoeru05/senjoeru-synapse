import { Handle, Position, type NodeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import type { RootData } from '@/lib/network-types'

/** Central hub node — large, purple-glowing FlowerStorePH mark. */
export default function RootNode({ data }: NodeProps) {
  const d = data as RootData
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 18 }}
      className="relative flex flex-col items-center justify-center rounded-2xl px-7 py-5
                 border border-fuchsia-400/30 bg-white/[0.04] backdrop-blur-xl
                 shadow-[0_0_40px_-4px_rgba(168,85,247,0.55)]"
    >
      {/* pulsing purple bloom */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{ boxShadow: '0 0 60px 8px rgba(168,85,247,0.35)' }}
        animate={{ opacity: [0.4, 0.75, 0.4] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
      <div className="relative flex items-center gap-3">
        <span className="text-3xl leading-none drop-shadow-[0_0_10px_rgba(168,85,247,0.8)]">🌸</span>
        <div className="text-left">
          <div className="text-base font-bold tracking-tight text-white">{d.label}</div>
          <div className="text-[11px] text-fuchsia-200/70">AI Engineering Workspace</div>
        </div>
      </div>
      <div className="relative mt-2.5 flex gap-3 text-[10px] text-slate-300/80">
        <span><b className="text-cyan-300">{d.workingCount}</b> working</span>
        <span className="text-slate-500">·</span>
        <span><b className="text-slate-200">{d.agentCount}</b> agents</span>
        <span className="text-slate-500">·</span>
        <span><b className="text-slate-200">{d.repoCount}</b> repos</span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-fuchsia-400/70 !border-none !w-2 !h-2" />
    </motion.div>
  )
}
