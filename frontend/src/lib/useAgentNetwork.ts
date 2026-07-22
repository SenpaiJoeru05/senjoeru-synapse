import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type {
  ActivityEvent,
  FeedItem,
  NetworkEdge,
  NetworkNode,
  NetworkPayload,
} from './network-types'

// Direct connection (not through the Vite /api proxy) so it works identically
// in dev (page on :5173) and in a packaged Electron build (page on file://).
// The backend WS always listens on localhost:3001, but allow an explicit
// override (injected by the Electron main process, or set for a remote/hosted
// deployment) so the URL isn't hard-locked to localhost.
function resolveWsUrl(): string {
  const override =
    typeof window !== 'undefined' &&
    (window as unknown as { __SYNAPSE_WS_URL__?: string }).__SYNAPSE_WS_URL__
  return override || 'ws://localhost:3001/ws'
}
const WS_URL = resolveWsUrl()
const MAX_ACTIVITY = 200
const BACKOFF_BASE = 500
const BACKOFF_MAX = 10_000

/** Stable identity for an activity event, independent of its per-poll id. */
function eventKey(e: ActivityEvent): string {
  return `${e.type}|${e.title}|${e.description}`
}

/**
 * Merge freshly-received events into the running feed. The collector
 * regenerates activity.json every poll (with new ids each time), so we
 * dedupe by stable content key and only prepend genuinely new events,
 * stamping each with its local arrival time. Newest first, capped.
 */
function mergeActivity(prev: FeedItem[], incoming: ActivityEvent[], now: number): FeedItem[] {
  const seen = new Set(prev.map(p => p.key))
  const fresh: FeedItem[] = []
  for (const e of incoming) {
    const key = eventKey(e)
    if (seen.has(key)) continue
    seen.add(key)
    fresh.push({ key, type: e.type, title: e.title, description: e.description, icon: e.icon, at: now })
  }
  if (fresh.length === 0) return prev
  return [...fresh, ...prev].slice(0, MAX_ACTIVITY)
}

export interface AgentNetworkState {
  nodes: NetworkNode[]
  edges: NetworkEdge[]
  activity: FeedItem[]
  connected: boolean
  ready: boolean
}

/**
 * Owns the realtime connection for the Agent Network page:
 * - one initial REST fetch for instant first paint
 * - a WebSocket that pushes `agent-network:update` frames
 * - automatic reconnect with exponential backoff
 * No polling anywhere. Fully cleaned up on unmount.
 */
export function useAgentNetwork(): AgentNetworkState {
  const [nodes, setNodes] = useState<NetworkNode[]>([])
  const [edges, setEdges] = useState<NetworkEdge[]>([])
  const [activity, setActivity] = useState<FeedItem[]>([])
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempts = useRef(0)
  const unmounted = useRef(false)

  const applyPayload = useCallback((p: NetworkPayload) => {
    if (Array.isArray(p.nodes)) setNodes(p.nodes)
    if (Array.isArray(p.edges)) setEdges(p.edges)
    if (Array.isArray(p.activity)) {
      setActivity(prev => mergeActivity(prev, p.activity, Date.now()))
    }
    setReady(true)
  }, [])

  const connect = useCallback(() => {
    if (unmounted.current) return
    let ws: WebSocket
    try {
      ws = new WebSocket(WS_URL)
    } catch {
      scheduleReconnect()
      return
    }
    wsRef.current = ws

    ws.onopen = () => {
      if (unmounted.current) return
      attempts.current = 0
      setConnected(true)
    }
    ws.onmessage = (evt) => {
      try {
        const payload = JSON.parse(evt.data) as NetworkPayload
        if (payload?.type === 'agent-network:update') applyPayload(payload)
      } catch {
        /* ignore malformed frame */
      }
    }
    ws.onerror = () => { try { ws.close() } catch { /* noop */ } }
    ws.onclose = () => {
      setConnected(false)
      wsRef.current = null
      scheduleReconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyPayload])

  const scheduleReconnect = useCallback(() => {
    if (unmounted.current || reconnectTimer.current) return
    const delay = Math.min(BACKOFF_MAX, BACKOFF_BASE * 2 ** attempts.current)
    attempts.current += 1
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null
      connect()
    }, delay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect])

  useEffect(() => {
    unmounted.current = false

    // Instant first paint from REST while the socket handshakes. Validate the
    // shape the same way the WS path does — a malformed body must not flow
    // through untyped (the REST return is `any`).
    api.getAgentNetwork()
      .then((p) => {
        if (!unmounted.current && p?.type === 'agent-network:update') applyPayload(p)
      })
      .catch(() => { /* WS snapshot will fill in */ })

    connect()

    return () => {
      unmounted.current = true
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }
      const ws = wsRef.current
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
        try { ws.close() } catch { /* noop */ }
        wsRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { nodes, edges, activity, connected, ready }
}
