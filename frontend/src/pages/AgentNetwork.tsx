import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider,
  MarkerType, useEdgesState, useNodesState, useReactFlow,
  type NodeMouseHandler, type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion } from 'framer-motion'
import { Wifi, WifiOff } from 'lucide-react'
import { useAgentNetwork } from '@/lib/useAgentNetwork'
import type { NetworkEdge, NetworkNode } from '@/lib/network-types'
import RootNode from '@/components/network/RootNode'
import AgentNode from '@/components/network/AgentNode'
import RepoNode from '@/components/network/RepoNode'
import ActivityFeed from '@/components/network/ActivityFeed'
import NodeInspector from '@/components/network/NodeInspector'

const nodeTypes: NodeTypes = { root: RootNode, agent: AgentNode, repo: RepoNode }

/** Merge server nodes into local state, preserving user-dragged positions. */
function mergeNodes(prev: NetworkNode[], next: NetworkNode[]): NetworkNode[] {
  const prevById = new Map(prev.map((n) => [n.id, n]))
  return next.map((n) => {
    const old = prevById.get(n.id)
    // Existing node: keep its (possibly dragged) position + selection, refresh data.
    return old ? ({ ...n, position: old.position, selected: old.selected } as NetworkNode) : n
  })
}

/** Style edges by working state (backend already sets the `animated` flag). */
function decorateEdge(e: NetworkEdge): NetworkEdge {
  const working = Boolean((e.data as { working?: boolean })?.working)
  const color = working ? '#22d3ee' : '#334155'
  return {
    ...e,
    animated: working,
    style: { stroke: color, strokeWidth: working ? 2 : 1.4 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
  }
}

function AgentNetworkInner() {
  const { nodes: serverNodes, edges: serverEdges, activity, connected, ready } = useAgentNetwork()

  const [nodes, setNodes, onNodesChange] = useNodesState<NetworkNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<NetworkEdge>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { fitView } = useReactFlow()
  const fitted = useRef(false)

  // Merge incoming graph — preserves viewport + drag positions.
  useEffect(() => {
    setNodes((prev) => mergeNodes(prev, serverNodes))
  }, [serverNodes, setNodes])

  useEffect(() => {
    setEdges(serverEdges.map(decorateEdge))
  }, [serverEdges, setEdges])

  // Fit once, after the first real graph arrives.
  useEffect(() => {
    if (!fitted.current && nodes.length > 0) {
      fitted.current = true
      // next tick so nodes are measured
      requestAnimationFrame(() => fitView({ padding: 0.25, duration: 500 }))
    }
  }, [nodes.length, fitView])

  const onNodeClick: NodeMouseHandler = useCallback((_, node) => setSelectedId(node.id), [])
  const onPaneClick = useCallback(() => setSelectedId(null), [])

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  )

  const stats = useMemo(() => {
    const agents = nodes.filter((n) => n.type === 'agent')
    return {
      agents: agents.length,
      working: agents.filter((n) => (n.data as { working?: boolean }).working).length,
      repos: nodes.filter((n) => n.type === 'repo').length,
    }
  }, [nodes])

  return (
    <div className="flex h-screen w-full bg-[#090d16] text-white overflow-hidden">
      <ActivityFeed items={activity} />

      <div className="relative flex-1">
        {/* Header overlay */}
        <motion.div
          initial={{ y: -12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="absolute left-4 top-4 z-10 flex items-center gap-3"
        >
          <div>
            <h1 className="text-lg font-bold drop-shadow">Agent Network</h1>
            <p className="text-[11px] text-slate-500">Real-time Mission Control · drag · zoom · click to inspect</p>
          </div>
          <span
            className={[
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium backdrop-blur-sm',
              connected
                ? 'border-cyan-400/30 bg-cyan-400/10 text-cyan-300'
                : 'border-amber-400/30 bg-amber-400/10 text-amber-300',
            ].join(' ')}
          >
            {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
        </motion.div>

        {/* Stats */}
        <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 gap-2">
          {[
            { label: 'Agents', value: stats.agents, color: '#94a3b8' },
            { label: 'Working', value: stats.working, color: '#22d3ee' },
            { label: 'Repos', value: stats.repos, color: '#a855f7' },
          ].map((s) => (
            <div
              key={s.label}
              className="flex flex-col items-center rounded-lg border border-white/10 bg-black/50 px-3 py-1.5 backdrop-blur-sm"
            >
              <span className="text-sm font-bold tabular-nums" style={{ color: s.color }}>{s.value}</span>
              <span className="text-[10px] text-slate-500">{s.label}</span>
            </div>
          ))}
        </div>

        {ready && nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
            <p className="text-sm font-medium text-slate-500">No agents discovered yet</p>
            <p className="text-xs text-slate-600">Agents appear once the collector reads active sessions</p>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          nodesConnectable={false}
          className="bg-[#090d16]"
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="#1e293b" />
          <MiniMap
            pannable
            zoomable
            className="!bg-black/60 !border !border-white/10 rounded-lg"
            maskColor="rgba(9,13,22,0.7)"
            nodeColor={(n) =>
              n.type === 'root'
                ? '#a855f7'
                : (n.data as { working?: boolean })?.working ? '#22d3ee' : '#475569'
            }
          />
          <Controls className="!bg-black/60 !border !border-white/10 !rounded-lg [&_button]:!bg-transparent [&_button]:!border-white/10 [&_button]:!text-slate-300" />
        </ReactFlow>

        <NodeInspector node={selectedNode} onClose={() => setSelectedId(null)} />
      </div>
    </div>
  )
}

export default function AgentNetwork() {
  return (
    <ReactFlowProvider>
      <AgentNetworkInner />
    </ReactFlowProvider>
  )
}
