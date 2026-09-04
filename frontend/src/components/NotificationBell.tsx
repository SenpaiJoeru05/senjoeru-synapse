import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Bell, XCircle, Eye, Clock, DollarSign, X, Check, AlertTriangle } from 'lucide-react'
import { useAttention, type AttentionItem } from '@/lib/useAttention'

const READ_KEY = 'synapse:attention:read'

function loadRead(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}
function saveRead(s: Set<string>) {
  try { localStorage.setItem(READ_KEY, JSON.stringify([...s])) } catch { /* noop */ }
}

const KIND_ICON: Record<string, React.ElementType> = {
  failed: XCircle, review: Eye, stalled: Clock, budget: DollarSign,
}
function accent(sev: string) {
  return sev === 'high'
    ? { chip: 'bg-error/15 text-error', dot: 'bg-error' }
    : { chip: 'bg-warning/15 text-warning', dot: 'bg-warning' }
}
function relTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms)) return ''
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export default function NotificationBell() {
  const navigate = useNavigate()
  const { items } = useAttention()
  const [open, setOpen] = useState(false)
  const [read, setRead] = useState<Set<string>>(loadRead)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 64, right: 24 })

  // Prune read-ids no longer present so a cleared item that RECURS shows again.
  useEffect(() => {
    const present = new Set(items.map((i) => i.id))
    setRead((prev) => {
      const next = new Set([...prev].filter((id) => present.has(id)))
      if (next.size !== prev.size) { saveRead(next); return next }
      return prev
    })
  }, [items])

  // Anchor the (portaled) dropdown just under the bell; keep it aligned on scroll/resize.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const el = btnRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      setPos({ top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  const unread = useMemo(() => items.filter((i) => !read.has(i.id)), [items, read])
  const badge = unread.length

  const markRead = (id: string) => setRead((prev) => { const n = new Set(prev); n.add(id); saveRead(n); return n })
  const clearAll = () => setRead(() => { const n = new Set(items.map((i) => i.id)); saveRead(n); return n })
  const openItem = (it: AttentionItem) => {
    markRead(it.id)
    setOpen(false)
    navigate(it.kind === 'budget' ? '/insights' : '/tasks')
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Alerts"
        className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
          open ? 'bg-white/10 text-white' : 'bg-surface2 border border-white/10 text-gray-400 hover:text-white'
        }`}
      >
        <Bell className="w-4 h-4" />
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-error text-[10px] font-bold text-white flex items-center justify-center">
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {createPortal(
        <AnimatePresence>
          {open && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.12 }}
                style={{ top: pos.top, right: pos.right }}
                className="fixed w-80 z-[100] glass-card !p-0 overflow-hidden shadow-2xl border border-white/10"
              >
                <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-white/10">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-error" />
                    <span className="text-sm font-bold">Alerts</span>
                    {items.length > 0 && <span className="text-[11px] text-gray-500">{items.length}</span>}
                  </div>
                  {items.length > 0 && (
                    <button onClick={clearAll} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white transition-colors">
                      <Check className="w-3 h-3" /> Clear all
                    </button>
                  )}
                </div>

                <div className="max-h-[60vh] overflow-y-auto scrollbar-hide">
                  {items.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <Check className="w-6 h-6 text-success mx-auto mb-2" />
                      <p className="text-sm text-gray-400">You're all caught up.</p>
                    </div>
                  ) : (
                    items.map((it) => {
                      const Icon = KIND_ICON[it.kind] ?? AlertTriangle
                      const a = accent(it.severity)
                      const isUnread = !read.has(it.id)
                      return (
                        <div
                          key={it.id}
                          className={`group flex items-start gap-2.5 px-3.5 py-2.5 border-b border-white/5 last:border-0 transition-colors hover:bg-white/5 ${isUnread ? '' : 'opacity-55'}`}
                        >
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${a.chip}`}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <button onClick={() => openItem(it)} className="flex-1 min-w-0 text-left">
                            <p className="text-sm font-medium truncate leading-tight flex items-center gap-1.5">
                              {isUnread && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.dot}`} />}
                              {it.title}
                            </p>
                            <p className="text-[11px] text-gray-500 truncate">{it.detail}</p>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            {it.since && <span className="text-[10px] text-gray-600">{relTime(it.since)}</span>}
                            <button
                              onClick={() => markRead(it.id)}
                              title="Dismiss"
                              className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-white transition-all"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  )
}
