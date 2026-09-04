import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Send, Bot, Loader2, PlugZap, Copy, Check,
  ChevronRight, Brain, Terminal, Plus, PanelLeftClose, PanelLeft, MessageSquare,
  Square, Users,
} from 'lucide-react'
import { api } from '@/lib/api'
import Markdown from '@/components/Markdown'

interface ToolCall {
  tool: string
  status: string
  summary: string
}
interface Turn {
  role: 'user' | 'assistant'
  text: string
  tools?: ToolCall[]
  reasoning?: string
  error?: boolean
  seconds?: number
}

const SUGGESTIONS = [
  'What do you know about how I like to work?',
  "What's in my roadmap right now?",
  'Who on the team handles database work?',
]

/** The most useful identifying argument, whatever kind of tool this is. */
function describeInput(input: any): string {
  if (!input || typeof input !== 'object') return ''
  const raw =
    input.filePath || input.path || input.pattern || input.command ||
    input.description || input.query || ''
  return String(raw).replace(/^.*[\\/]([^\\/]+)$/, '$1').slice(0, 80)
}

function relativeTime(ms: number | null | undefined): string {
  if (!ms) return ''
  const secs = Math.round((Date.now() - ms) / 1000)
  if (secs < 60) return 'now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86400)}d`
}

/** Split OpenCode's part array into the three things worth showing. */
function readParts(parts: any[]): { text: string; tools: ToolCall[]; reasoning: string } {
  let text = ''
  let reasoning = ''
  const tools: ToolCall[] = []

  for (const p of parts || []) {
    if (p?.type === 'text' && p.text) text += p.text
    else if (p?.type === 'reasoning' && p.text) reasoning += p.text
    else if (p?.type === 'tool' && p.tool) {
      tools.push({
        tool: p.tool,
        status: p.state?.status || 'unknown',
        summary: describeInput(p.state?.input),
      })
    }
  }
  return { text: text.trim(), tools, reasoning: reasoning.trim() }
}

/* ── pieces ────────────────────────────────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true); setTimeout(() => setDone(false), 1500)
        } catch { /* clipboard blocked */ }
      }}
      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-600 hover:text-gray-300"
      title="Copy reply"
    >
      {done ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

/** Collapsed by default — the reply is the point, the tools are the receipts. */
function ToolTrace({ tools }: { tools: ToolCall[] }) {
  const [open, setOpen] = useState(false)
  const failed = tools.filter(t => t.status === 'error').length

  return (
    <div className="mb-2">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Terminal className="w-3 h-3" />
        {tools.length} tool {tools.length === 1 ? 'call' : 'calls'}
        {failed > 0 && <span className="text-red-400">· {failed} failed</span>}
      </button>

      {open && (
        <div className="mt-1.5 ml-1 pl-3 border-l border-white/10 space-y-1">
          {tools.map((t, i) => (
            <div key={i} className="flex items-baseline gap-2 text-[11px]">
              <span className={`font-mono ${
                t.status === 'error' ? 'text-red-400' : 'text-sky-300'
              }`}>{t.tool}</span>
              {t.summary && <span className="text-gray-600 truncate">{t.summary}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-2">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-300 transition-colors">
        <ChevronRight className={`w-3 h-3 transition-transform ${open ? 'rotate-90' : ''}`} />
        <Brain className="w-3 h-3" /> reasoning
      </button>
      {open && (
        <div className="mt-1.5 ml-1 pl-3 border-l border-white/10 text-[12px] text-gray-500 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  )
}

/* ── page ──────────────────────────────────────────────────────────────────── */

export default function JoeruChat() {
  const [health, setHealth] = useState<any>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const [sessions, setSessions] = useState<any[]>([])
  const [showList, setShowList] = useState(true)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // What the reply looks like *so far*. OpenCode's SSE event payloads aren't
  // documented, so this polls the message instead of guessing at shapes that
  // would break on an upgrade. At 1s against a model that takes 1-60s, the
  // difference is invisible — and tool calls show up as they happen.
  const [live, setLive] = useState<Turn | null>(null)

  // Default to Joeru himself. Sending no agent gets OpenCode's generic `build`
  // agent, which has no persona and no team — the chat would answer as a plain
  // coding assistant rather than as Joeru.
  const [agent, setAgent] = useState('joeru')
  const [team, setTeam] = useState<any[]>([])

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.joeruHealth().then(setHealth).catch(() => setHealth({ running: false }))
    api.getTeam().then((r: any) => setTeam(r?.team || [])).catch(() => setTeam([]))
  }, [])

  async function refreshSessions() {
    try {
      const { sessions: all } = await api.joeruSessions()
      // Root sessions only — subagent runs are steps inside a conversation,
      // not conversations you'd pick up again.
      setSessions(
        (all || [])
          .filter((s: any) => !s.parentID)
          .sort((a: any, b: any) => (b.time?.updated || 0) - (a.time?.updated || 0)),
      )
    } catch { /* server down — the health panel already says so */ }
  }

  useEffect(() => { refreshSessions() }, [health?.running])

  /** Load a past conversation, including ones started in the OpenCode TUI. */
  async function openSession(id: string) {
    if (id === sessionId || sending) return
    setLoadingHistory(true)
    setSessionId(id)
    setTurns([])
    try {
      const { messages } = await api.joeruMessages(id)
      const restored: Turn[] = []
      for (const m of messages || []) {
        const role = m?.info?.role
        if (role !== 'user' && role !== 'assistant') continue
        const { text, tools, reasoning } = readParts(m.parts)
        if (!text && !tools.length) continue
        restored.push({ role, text: text || '_(no text)_', tools, reasoning })
      }
      setTurns(restored)
    } catch (err: any) {
      setTurns([{ role: 'assistant', error: true, text: err?.message || 'Could not load that session' }])
    } finally {
      setLoadingHistory(false)
    }
  }

  function newChat() {
    setSessionId(null)
    setTurns([])
    inputRef.current?.focus()
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, sending])

  // A free-tier reply can take minutes; a ticking counter is the difference
  // between "it's working" and "it's frozen".
  useEffect(() => {
    if (!sending) return
    setElapsed(0)
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [sending])

  // Poll the reply as it's built. Only the newest assistant message matters —
  // anything earlier is already rendered in `turns`.
  useEffect(() => {
    if (!sending || !sessionId) return
    let cancelled = false

    const tick = async () => {
      try {
        const { messages } = await api.joeruMessages(sessionId)
        if (cancelled) return
        const last = [...(messages || [])].reverse()
          .find((m: any) => m?.info?.role === 'assistant')
        if (!last) return
        const { text, tools, reasoning } = readParts(last.parts)
        if (text || tools.length) setLive({ role: 'assistant', text, tools, reasoning })
      } catch { /* transient — the next tick retries */ }
    }

    const t = setInterval(tick, 1000)
    return () => { cancelled = true; clearInterval(t) }
  }, [sending, sessionId])

  async function stop() {
    if (!sessionId) return
    try { await api.joeruAbort(sessionId) } catch { /* already finished */ }
  }

  function grow(el: HTMLTextAreaElement) {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  async function send(preset?: string) {
    const text = (preset ?? draft).trim()
    if (!text || sending) return

    setDraft('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    setTurns(t => [...t, { role: 'user', text }])
    setSending(true)

    const started = Date.now()
    try {
      let id = sessionId
      if (!id) {
        // Title it after the first thing asked, so the list is scannable.
        id = (await api.joeruCreateSession(text.slice(0, 60))).id
        setSessionId(id)
      }

      const reply = await api.joeruSend(id!, text, agent || undefined)
      const { text: replyText, tools, reasoning } = readParts(reply?.parts)
      setTurns(t => [...t, {
        role: 'assistant',
        text: replyText || '_(no text in reply)_',
        tools, reasoning,
        seconds: Math.round((Date.now() - started) / 1000),
      }])
    } catch (err: any) {
      setTurns(t => [...t, {
        role: 'assistant',
        error: true,
        text: err?.response?.data?.error || err.message || 'Request failed',
        seconds: Math.round((Date.now() - started) / 1000),
      }])
    } finally {
      setSending(false)
      setLive(null)
      refreshSessions()
      inputRef.current?.focus()
    }
  }

  if (health && health.running === false) {
    return (
      <div className="glass-card !p-10 text-center">
        <PlugZap className="w-8 h-8 mx-auto mb-3 text-gray-600" />
        <p className="font-medium">Joeru isn't listening</p>
        <p className="text-sm text-gray-500 mt-1">{health.reason}</p>
        <code className="inline-block mt-4 px-3 py-1.5 rounded-lg bg-black/40 text-xs text-emerald-300">
          npm run dev:joeru
        </code>
        <p className="text-[11px] text-gray-600 mt-3">
          `npm run dev` starts this automatically.
        </p>
      </div>
    )
  }

  return (
    <div className="glass-card !p-0 flex overflow-hidden"
         style={{ height: 'calc(100vh - 15rem)' }}>

      {showList && (
        <aside className="w-56 shrink-0 border-r border-white/5 flex flex-col">
          <div className="p-2.5 shrink-0">
            <button onClick={newChat}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm
                         bg-white/[0.04] border border-white/10 hover:border-white/20 transition-colors">
              <Plus className="w-3.5 h-3.5" /> New chat
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
            {sessions.length === 0 && (
              <p className="text-[11px] text-gray-600 px-2 py-3">No conversations yet.</p>
            )}
            {sessions.map(s => (
              <button key={s.id} onClick={() => openSession(s.id)}
                className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors group ${
                  s.id === sessionId ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'
                }`}>
                <div className="flex items-center gap-1.5">
                  <MessageSquare className={`w-3 h-3 shrink-0 ${
                    s.id === sessionId ? 'text-indigo-300' : 'text-gray-600'
                  }`} />
                  <span className={`text-[12px] truncate ${
                    s.id === sessionId ? 'text-gray-100' : 'text-gray-400 group-hover:text-gray-300'
                  }`}>
                    {s.title || s.slug || 'Untitled'}
                  </span>
                </div>
                <span className="text-[10px] text-gray-700 pl-4.5 ml-0.5">
                  {relativeTime(s.time?.updated)}
                </span>
              </button>
            ))}
          </div>
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5 shrink-0">
          <button onClick={() => setShowList(v => !v)}
            className="text-gray-600 hover:text-gray-300 transition-colors"
            title={showList ? 'Hide conversations' : 'Show conversations'}>
            {showList ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </button>
          <span className={`w-1.5 h-1.5 rounded-full ${health?.running ? 'bg-emerald-400' : 'bg-gray-600'}`} />
          <span className="text-sm font-medium">Joeru</span>
          <span className="text-[11px] text-gray-600">
            {health?.running ? 'connected' : 'connecting…'}
          </span>
          {loadingHistory && <Loader2 className="w-3 h-3 animate-spin text-gray-600" />}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-5 py-6 space-y-6">

          {turns.length === 0 && !sending && (
            <div className="pt-10 text-center">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center mx-auto mb-4">
                <Bot className="w-6 h-6 text-white" />
              </div>
              <p className="font-medium">Ask Joeru anything</p>
              <p className="text-xs text-gray-500 mt-1 mb-6">
                He knows your team, your repos, and what you've told him to remember.
              </p>
              <div className="flex flex-col gap-2 max-w-sm mx-auto">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => send(s)}
                    className="text-left text-[13px] text-gray-400 px-3.5 py-2.5 rounded-xl bg-white/[0.03]
                               border border-white/5 hover:border-white/15 hover:text-gray-200 transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) =>
            t.role === 'user' ? (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className="flex justify-end">
                <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-br-md text-sm
                                bg-indigo-500/15 border border-indigo-500/25 whitespace-pre-wrap break-words">
                  {t.text}
                </div>
              </motion.div>
            ) : (
              <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                className="group flex gap-3">
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500
                                flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4 text-white" />
                </div>

                <div className="min-w-0 flex-1">
                  {t.reasoning && <Thinking text={t.reasoning} />}
                  {t.tools && t.tools.length > 0 && <ToolTrace tools={t.tools} />}

                  {t.error ? (
                    <div className="px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25
                                    text-sm text-red-200 break-words">
                      {t.text}
                    </div>
                  ) : (
                    <Markdown>{t.text}</Markdown>
                  )}

                  <div className="flex items-center gap-2 mt-1.5 h-4">
                    {t.seconds !== undefined && (
                      <span className="text-[10px] text-gray-600 tabular-nums">{t.seconds}s</span>
                    )}
                    <CopyButton text={t.text} />
                  </div>
                </div>
              </motion.div>
            ),
          )}

          {sending && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500
                              flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                {live?.tools && live.tools.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {live.tools.map((t, i) => (
                      <div key={i} className="flex items-baseline gap-2 text-[11px]">
                        <span className={`font-mono ${
                          t.status === 'error' ? 'text-red-400'
                            : t.status === 'completed' ? 'text-sky-300' : 'text-amber-300'
                        }`}>{t.tool}</span>
                        {t.summary && <span className="text-gray-600 truncate">{t.summary}</span>}
                        {t.status === 'running' && (
                          <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-400" />
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {live?.text
                  ? <Markdown>{live.text}</Markdown>
                  : (
                    <div className="flex items-center gap-2 text-sm text-gray-400 pt-1">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> thinking…
                    </div>
                  )}

                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] text-gray-600 tabular-nums">{elapsed}s</span>
                  <button onClick={stop}
                    className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md
                               bg-white/5 border border-white/10 text-gray-400
                               hover:text-gray-200 hover:border-white/20 transition-colors">
                    <Square className="w-2.5 h-2.5" /> stop
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

        <div className="border-t border-white/5 p-3 shrink-0">
          <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            onChange={e => { setDraft(e.target.value); grow(e.target) }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
            }}
            placeholder={sending ? 'Waiting for Joeru…' : 'Message Joeru…'}
            disabled={sending}
            className="flex-1 resize-none bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-sm
                       placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50
                       disabled:opacity-50 leading-relaxed"
            style={{ minHeight: '2.875rem', maxHeight: '12.5rem' }}
          />
          <button
            onClick={() => send()}
            disabled={!draft.trim() || sending}
            className="h-[2.875rem] w-[2.875rem] flex items-center justify-center rounded-xl shrink-0
                       bg-gradient-to-br from-indigo-500 to-violet-500 text-white
                       disabled:opacity-30 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="max-w-3xl mx-auto mt-2 flex items-center gap-2 px-1">
            {team.length > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
                <Users className="w-3 h-3" />
                <select
                  value={agent}
                  onChange={e => setAgent(e.target.value)}
                  className="bg-transparent text-gray-400 focus:outline-none cursor-pointer
                             hover:text-gray-200 transition-colors"
                >
                  {team.map((m: any) => (
                    <option key={m.slug} value={m.slug} className="bg-gray-900">
                      {m.displayName || m.slug}
                      {m.slug === 'joeru' ? ' (routes to the team)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="ml-auto text-[10px] text-gray-700">
              Enter to send · Shift+Enter for a new line
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
