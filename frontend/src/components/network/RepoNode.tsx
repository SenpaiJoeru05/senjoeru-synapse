import { Handle, Position, type NodeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import { Package } from 'lucide-react'
import type { RepoData } from '@/lib/network-types'

/** Repository node — small glass card; subtle cyan tint when its agent works. */
export default function RepoNode({ data, selected }: NodeProps) {
  const d = data as RepoData
  const working = d.working

  return (
    <motion.div
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ y: -3, scale: 1.04 }}
      transition={{ type: 'spring', stiffness: 260, damping: 20 }}
      className={[
        'relative flex items-center gap-2 rounded-lg px-3 py-2 backdrop-blur-xl border cursor-pointer',
        working
          ? 'border-cyan-400/40 bg-cyan-400/[0.05]'
          : 'border-slate-600/40 bg-slate-500/[0.04]',
        selected ? 'ring-2 ring-cyan-300/50' : '',
      ].join(' ')}
      style={working ? { boxShadow: '0 0 18px -6px rgba(34,211,238,0.5)' } : undefined}
    >
      <Handle type="target" position={Position.Top} className="!bg-slate-400/70 !border-none !w-1.5 !h-1.5" />
      <Package size={14} className={working ? 'text-cyan-300' : 'text-slate-400'} />
      <span className="text-[12px] font-medium text-slate-100">{d.label}</span>
    </motion.div>
  )
}
