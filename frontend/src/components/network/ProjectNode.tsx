import { Handle, Position, type NodeProps } from '@xyflow/react'
import { motion } from 'framer-motion'
import { FolderGit2 } from 'lucide-react'
import type { ProjectData } from '@/lib/network-types'

/**
 * Project node — the tier between the workspace and its repos.
 *
 * Deliberately quieter than the root and dimmer than a working agent: a project
 * is a grouping, not an actor. Before this tier existed the graph hung every
 * repo off one root named after a single project, which read as though that
 * project commanded everything.
 */
export default function ProjectNode({ data, selected }: NodeProps) {
  const d = data as ProjectData

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ y: -2, scale: 1.03 }}
      transition={{ type: 'spring', stiffness: 240, damping: 20 }}
      className={[
        'relative flex items-center gap-2.5 rounded-xl px-4 py-2.5 backdrop-blur-xl border cursor-pointer',
        'border-violet-400/30 bg-violet-500/[0.06]',
        selected ? 'ring-2 ring-violet-300/50' : '',
      ].join(' ')}
      style={{ boxShadow: '0 0 24px -10px rgba(167,139,250,0.45)' }}
    >
      <Handle type="target" position={Position.Top} className="!bg-violet-300/70 !border-none !w-1.5 !h-1.5" />

      {d.emoji
        ? <span className="text-base leading-none">{d.emoji}</span>
        : <FolderGit2 size={15} className="text-violet-300" />}

      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-slate-100 leading-tight">{d.label}</p>
        <p className="text-[10px] text-slate-400 tabular-nums">
          {d.repoCount} {d.repoCount === 1 ? 'repo' : 'repos'}
        </p>
      </div>

      <Handle type="source" position={Position.Bottom} className="!bg-violet-300/70 !border-none !w-1.5 !h-1.5" />
    </motion.div>
  )
}
