import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { useAttention } from '@/lib/useAttention'

/**
 * Fires a desktop notification when a NEW high-severity attention item appears
 * (a task failed, a budget went over). Renders nothing. Gated by the
 * `notifications` setting; pre-existing items on load never notify.
 */
export default function AttentionNotifier() {
  const attention = useAttention()
  const [enabled, setEnabled] = useState(false)
  const seen = useRef<Set<string> | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => setEnabled(!!s?.notifications)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!attention.loaded) return

    // First load: remember what's already there so we don't toast history.
    if (seen.current === null) {
      seen.current = new Set(attention.items.map((i) => i.id))
      return
    }

    const fresh = attention.items.filter((i) => !seen.current!.has(i.id))
    attention.items.forEach((i) => seen.current!.add(i.id))
    if (!enabled || fresh.length === 0 || typeof Notification === 'undefined') return

    const highs = fresh.filter((i) => i.severity === 'high')
    if (highs.length === 0) return

    const toast = () => {
      for (const it of highs) {
        try { new Notification('Synapse — needs you', { body: `${it.title} · ${it.detail}` }) } catch { /* noop */ }
      }
    }
    if (Notification.permission === 'granted') toast()
    else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => { if (p === 'granted') toast() })
  }, [attention, enabled])

  return null
}
