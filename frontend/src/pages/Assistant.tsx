/**
 * Assistant Mode — the floating window opened from Joeru → Chat.
 *
 * Phase 1 is text in, voice out. Local intents answer from endpoints that cost
 * nothing and return in well under a second; anything else is handed to Joeru,
 * and the UI says so BEFORE it starts waiting, because that path takes 10-35s
 * and silence reads as a hang.
 *
 * No microphone yet. Speech recognition in Electron is its own problem (see
 * docs/plans/ASSISTANT-MODE.md) and the answers are worth judging first.
 */
import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Volume2, VolumeX, X, Loader2, Zap, Cloud } from 'lucide-react'
import { answerLocally, classify, type Answer } from '../lib/assistant-intents'
import { api } from '../lib/api'

interface Turn {
  question: string
  answer: Answer | null
  pending?: boolean
}

const EXAMPLES = [
  "what's the status",
  'what should we do next',
  "what's broken",
  'how much have I spent',
]

/**
 * The fallback runs on a fast model rather than the agent's own tier.
 *
 * Measured time-to-first-token on the free models, same prompt, model verified
 * from the reply rather than the request:
 *
 *   nemotron-3-ultra-free            9.2s   (the roster default)
 *   nemotron-3.5-lightning-free      6.2s
 *   mimo-v2.5-free                   4.1s
 *   ling-3.0-flash-fin-free          2.1s
 *   muse-spark-1.3-contributor-free  1.6s
 *
 * Assistant Mode asks short questions, where 4x faster matters more than the
 * deep model's judgement — and anything needing judgement should go to a Claude
 * Code tab, not a voice window. Set this to undefined to fall back to whatever
 * tier the agent declares. Single samples on a trivial prompt: treat the
 * ordering as real and the absolute numbers as rough.
 */
const FAST_MODEL = { providerID: 'opencode', modelID: 'muse-spark-1.3-contributor-free' }

/**
 * Elapsed seconds, for the Joeru wait only.
 *
 * Streaming was considered and rejected: measured against the configured model,
 * the first token arrives 13.2s in and the whole reply lands 0.9s later. There
 * is nothing to stream — the wait is time-to-first-token, not buffering. A
 * counter at least makes it legible, so a slow answer does not read as a hang.
 */
function Elapsed() {
  const [s, setS] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setS((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="tabular-nums">{s}s</span>
}

export default function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [muted, setMuted] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Kept in a ref as well so mute takes effect mid-utterance without the
  // speak() closure holding a stale value.
  const mutedRef = useRef(false)

  useEffect(() => { mutedRef.current = muted }, [muted])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  // Stop talking if the window goes away mid-sentence.
  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  function speak(text: string) {
    if (mutedRef.current || !window.speechSynthesis || !text) return
    window.speechSynthesis.cancel()   // never queue; the latest answer wins
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.05
    window.speechSynthesis.speak(u)
  }

  function toggleMute() {
    setMuted((m) => {
      if (!m) window.speechSynthesis?.cancel()   // silence immediately
      return !m
    })
  }

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return

    setInput('')
    setBusy(true)

    const isLocal = classify(q) !== 'ask'
    setTurns((t) => [...t, { question: q, answer: null, pending: true }])

    try {
      const local = await answerLocally(q)
      if (local) {
        setTurns((t) => [...t.slice(0, -1), { question: q, answer: local }])
        speak(local.speech)
        return
      }

      // Fall through to Joeru. One session per window lifetime.
      const sessionId = await ensureSession()
      const reply = await api.joeruSend(sessionId, q, undefined, FAST_MODEL)
      const text = extractText(reply) || 'Joeru returned nothing.'
      const answer: Answer = { intent: 'ask', speech: text, lines: [], source: 'joeru' }
      setTurns((t) => [...t.slice(0, -1), { question: q, answer }])
      speak(text)
    } catch (err: any) {
      const msg = `That failed: ${err?.message ?? 'unknown error'}`
      setTurns((t) => [...t.slice(0, -1), {
        question: q,
        answer: { intent: 'ask', speech: msg, lines: [], source: isLocal ? 'local' : 'joeru' },
      }])
      speak(msg)
    } finally {
      setBusy(false)
    }
  }

  const sessionRef = useRef<string | null>(null)
  async function ensureSession(): Promise<string> {
    if (sessionRef.current) return sessionRef.current
    const s = await api.joeruCreateSession('Assistant Mode')
    sessionRef.current = s?.id
    if (!sessionRef.current) throw new Error('could not start a Joeru session')
    return sessionRef.current
  }

  return (
    <div className="h-screen flex flex-col bg-background text-white overflow-hidden">
      {/* Frameless: this strip is the only way to move the window. */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Assistant Mode</span>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={toggleMute}
            title={muted ? 'Unmute' : 'Mute'}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10"
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => window.electronAPI?.closeAssistant?.()}
            title="Close"
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {turns.length === 0 && (
          <div className="text-sm text-gray-500 space-y-2">
            <p>Ask about the current state of work. These are answered locally —
              instantly, and without spending tokens:</p>
            <div className="space-y-1">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  onClick={() => ask(e)}
                  className="block w-full text-left px-3 py-1.5 rounded-lg bg-surface2 hover:bg-white/10 text-gray-300 text-xs"
                >
                  {e}
                </button>
              ))}
            </div>
            <p className="text-xs pt-1">Anything else goes to Joeru, which is slower and costs tokens.</p>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-1.5">
            <div className="text-sm text-gray-400">{t.question}</div>

            {t.pending ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {classify(t.question) === 'ask' ? (
                  <>
                    <span>Asking Joeru on a fast model…</span>
                    <Elapsed />
                  </>
                ) : 'Checking…'}
              </div>
            ) : t.answer ? (
              <div className="rounded-xl bg-surface2 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  {t.answer.source === 'local'
                    ? <Zap className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    : <Cloud className="w-3.5 h-3.5 text-sky-400 mt-0.5 shrink-0" />}
                  <p className="text-sm leading-relaxed">{t.answer.speech}</p>
                </div>
                {t.answer.lines.length > 0 && (
                  <div className="font-mono text-[11px] text-gray-500 space-y-0.5 pl-5">
                    {t.answer.lines.map((l, j) => <div key={j}>{l}</div>)}
                  </div>
                )}
                <div className="text-[10px] uppercase tracking-wide text-gray-600 pl-5">
                  {t.answer.source === 'local' ? 'local · no tokens' : 'joeru · spent tokens'}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(input) }}
        className="flex items-center gap-2 p-3 border-t border-white/10 shrink-0"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the current work…"
          className="flex-1 px-3 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="p-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  )
}

/** OpenCode replies are a parts array; pull the text blocks out of it. */
function extractText(reply: any): string {
  const parts = reply?.parts ?? []
  return parts
    .filter((p: any) => p?.type === 'text' && p.text)
    .map((p: any) => p.text)
    .join('\n')
    .trim()
}
