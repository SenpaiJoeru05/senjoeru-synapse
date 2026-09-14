import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'

/** Mirrors backend/services/agent-activity-service.js's snapshot() shape. */
export interface AgentActivityEntry {
  agentId: string
  agentType: string
  sessionId: string | null
  cwd: string
  repo: string
  status: 'starting' | 'working' | 'done' | 'failed'
  startedAt: number
  lastEventAt: number
  current: { tool: string; detail: string; icon: string; status: string; at: number } | null
  recent: { tool: string; detail: string; icon: string; status: string; at: number }[]
  toolCallCount: number
  lastMessage: string | null
}

interface AgentActivityPayload {
  type: 'agent-activity:update'
  timestamp: string
  agents: AgentActivityEntry[]
}

/**
 * Same connection strategy as useAgentNetwork(): its own WebSocket, not a
 * shared provider.
 *
 * Deliberately NOT riding RealtimeProvider's single socket. The design doc
 * flagged this as something to confirm rather than assume during
 * implementation: the Assistant window renders before RealtimeProvider
 * mounts (task 23's own note, for the same reason AssistantStats falls back
 * to a poll), so a hook that only worked inside that provider would simply
 * not function in the one window this feature matters most for. An
 * independent connection works identically in both places.
 */
const resolveWsUrl = (): string => {
  const override =
    typeof window !== 'undefined' &&
    (window as unknown as { __SYNAPSE_WS_URL__?: string }).__SYNAPSE_WS_URL__
  return override || 'ws://localhost:3001/ws'
}
const WS_URL = resolveWsUrl()
const BACKOFF_BASE = 500
const BACKOFF_MAX = 10_000

export interface AgentActivityState {
  agents: AgentActivityEntry[]
  connected: boolean
  ready: boolean
}

export function useAgentActivity(): AgentActivityState {
  const [agents, setAgents] = useState<AgentActivityEntry[]>([])
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempts = useRef(0)
  const unmounted = useRef(false)

  const applyPayload = useCallback((p: { agents?: AgentActivityEntry[] }) => {
    if (Array.isArray(p.agents)) setAgents(p.agents)
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
        const payload = JSON.parse(evt.data) as AgentActivityPayload
        if (payload?.type === 'agent-activity:update') applyPayload(payload)
      } catch {
        /* ignore malformed / unrelated frame — this socket sees every frame type */
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

    api.getDispatchActivity()
      .then((p) => { if (!unmounted.current) applyPayload(p) })
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

  return { agents, connected, ready }
}
