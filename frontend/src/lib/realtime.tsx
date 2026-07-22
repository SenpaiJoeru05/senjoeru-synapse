import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '@/lib/api'

/**
 * App-wide realtime data provider.
 *
 * Owns a SINGLE WebSocket connection (ws://localhost:3001/ws) that stays alive
 * across route changes, so every dashboard page reads live data without polling.
 * The backend pushes `metrics:update` frames (all metrics + host health) on each
 * collector cycle; we also do one REST fetch for instant first paint while the
 * socket handshakes. Auto-reconnects with exponential backoff.
 *
 * The Agent Network page keeps its own hook/socket for the graph; this provider
 * ignores graph frames and that hook ignores metrics frames.
 */

// Mirror useAgentNetwork's resolution so both honor the same override.
function resolveWsUrl(): string {
  const override =
    typeof window !== 'undefined' &&
    (window as unknown as { __SYNAPSE_WS_URL__?: string }).__SYNAPSE_WS_URL__
  return override || 'ws://localhost:3001/ws'
}
const WS_URL = resolveWsUrl()
const BACKOFF_BASE = 500
const BACKOFF_MAX = 10_000

export interface RealtimeState {
  metrics: any | null
  health: any | null
  connected: boolean
  ready: boolean
  /** Force an immediate REST re-fetch (e.g. a manual "refresh" button). */
  refresh: () => void
}

const RealtimeContext = createContext<RealtimeState>({
  metrics: null, health: null, connected: false, ready: false, refresh: () => {},
})

export function useRealtime(): RealtimeState {
  return useContext(RealtimeContext)
}

/** Convenience: a single metric slice (agents/tasks/tokens/…) or {} until loaded. */
export function useMetric(key: string): any {
  const { metrics } = useRealtime()
  return metrics?.[key] ?? {}
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [metrics, setMetrics] = useState<any | null>(null)
  const [health, setHealth] = useState<any | null>(null)
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const attempts = useRef(0)
  const unmounted = useRef(false)

  const refresh = () => {
    Promise.all([api.getMetrics(), api.getSystemHealth()])
      .then(([m, h]) => {
        if (unmounted.current) return
        setMetrics(m)
        setHealth(h)
        setReady(true)
      })
      .catch(() => { /* keep last-known data */ })
  }

  useEffect(() => {
    unmounted.current = false

    const applyMetricsFrame = (p: any) => {
      if (p.metrics) setMetrics(p.metrics)
      if (p.health) setHealth(p.health)
      setReady(true)
    }

    const scheduleReconnect = () => {
      if (unmounted.current || reconnectTimer.current) return
      const delay = Math.min(BACKOFF_MAX, BACKOFF_BASE * 2 ** attempts.current)
      attempts.current += 1
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null
        connect()
      }, delay)
    }

    const connect = () => {
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
          const payload = JSON.parse(evt.data)
          if (payload?.type === 'metrics:update') applyMetricsFrame(payload)
        } catch {
          /* ignore malformed / non-metrics frame */
        }
      }
      ws.onerror = () => { try { ws.close() } catch { /* noop */ } }
      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        scheduleReconnect()
      }
    }

    // Instant first paint from REST while the socket handshakes.
    refresh()

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
  }, [])

  return (
    <RealtimeContext.Provider value={{ metrics, health, connected, ready, refresh }}>
      {children}
    </RealtimeContext.Provider>
  )
}
