import { useEffect, useState } from 'react'
import { api } from './api'
import { useRealtime } from './realtime'

export interface AttentionItem {
  id: string
  kind: 'failed' | 'review' | 'stalled' | 'budget'
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
  entityId: string
  since: string | null
}
export interface AttentionCounts {
  total: number
  high: number
  failed: number
  review: number
  stalled: number
  budget: number
}
export interface Attention {
  items: AttentionItem[]
  counts: AttentionCounts
  loaded: boolean
}

const EMPTY: Attention = {
  items: [],
  counts: { total: 0, high: 0, failed: 0, review: 0, stalled: 0, budget: 0 },
  loaded: false,
}

/**
 * The "needs your attention" queue. Refetches whenever a live SQLite frame
 * arrives (tasks changed) and every 20s (to catch budget breaches, which move
 * with cost, not tasks). Zero-token — the backend derives it on read.
 */
export function useAttention(): Attention {
  const { db } = useRealtime()
  const [data, setData] = useState<Attention>(EMPTY)

  useEffect(() => {
    let cancelled = false
    const fetchIt = () =>
      api.getAttention()
        .then((d) => { if (!cancelled) setData({ items: d.items ?? [], counts: d.counts ?? EMPTY.counts, loaded: true }) })
        .catch(() => { /* keep last-known */ })
    fetchIt()
    const iv = setInterval(fetchIt, 20_000)
    return () => { cancelled = true; clearInterval(iv) }
  }, [db])

  return data
}
