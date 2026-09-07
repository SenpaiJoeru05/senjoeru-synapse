/**
 * Assistant Mode — the floating voice window opened from Joeru → Chat.
 *
 * Voice runs entirely in the main process: neural TTS via Piper and
 * recognition via Windows System.Speech. The renderer plays audio and draws
 * the orb, nothing more. That division is not stylistic — the first attempt ran
 * Whisper through onnxruntime WASM here and faulted Chromium with an access
 * violation, blanking the window with no diagnostics.
 *
 * Questions about the state of work are answered from local endpoints in tens
 * of milliseconds and cost nothing. Only what the router cannot classify goes
 * to Joeru, which is slower and spends tokens — and the UI says which happened.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Bot, Send, Volume2, VolumeX, X, Loader2, Zap, Cloud, Mic, Sparkles } from 'lucide-react'
import { answerLocally, classify, type Answer } from '../lib/assistant-intents'
import { api } from '../lib/api'
import VoiceOrb from '../components/VoiceOrb'
import type { AssistantInsights } from '../electron'
import { say, hush, hear, stopHearing, voiceAvailable, disposeVoice, MicLevel } from '../lib/voice'

interface Turn {
  question: string
  answer: Answer | null
  pending?: boolean
}

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking'

const EXAMPLES = [
  "what's the status",
  'what should we do next',
  "what's broken",
  'how much have I spent',
]

/**
 * Assistant Mode is always Joeru — no agent picker, unlike the Chat tab.
 *
 * This window exists for "what's the status" and daily questions about Joel's
 * own work, so the assistant answering them should be his assistant, with the
 * persona, project context and memory that come with the agent definition.
 *
 * Omitting this is not neutral: OpenCode falls back to its generic `build`
 * agent, which has no persona and no team, and answers as a plain coding
 * assistant. That is what made earlier replies read as out of context.
 */
const AGENT = 'joeru'

/**
 * Joeru's persona on a fast brain — this window only.
 *
 * The agent and the model are separate choices: AGENT supplies the persona,
 * project context and memory instructions, while this decides what executes
 * them. Joeru's own declared tier (nemotron-3-ultra) answered "who am I
 * talking to" correctly but took 55.5s, which is unusable for something you
 * talk to. The same question on muse-spark took 5.2s.
 *
 * So: keep the agent, swap the brain. This override is scoped to Assistant
 * Mode and does not touch the Chat tab or any other caller — a specialist
 * doing real engineering work still runs on the tier its definition declares.
 * Set to undefined to fall back to that behaviour here too.
 *
 * Measured time-to-first-token across the free models:
 * muse-spark-1.3 1.6s · ling-3.0-flash-fin 2.1s · mimo-v2.5 4.1s ·
 * nemotron-3.5-lightning 6.2s · nemotron-3-ultra 9.2s.
 */
const MODEL: { providerID: string; modelID: string } | undefined = {
  providerID: 'opencode',
  modelID: 'muse-spark-1.3-contributor-free',
}

/**
 * Elapsed seconds while Joeru thinks.
 *
 * Streaming was measured and rejected: the first token arrives at 13.2s of a
 * 14.1s turn, so there is nothing to stream — the wait is time-to-first-token,
 * not buffering. A counter at least stops it reading as a hang.
 */
function Elapsed() {
  const [s, setS] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setS((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="tabular-nums">{s}s</span>
}

/**
 * What the assistant has noticed about your questions.
 *
 * A question answered by the local router costs nothing and returns in ~1.5s.
 * One that falls through to Claude costs quota and ~13s. So a question asked
 * repeatedly through the slow path is worth turning into a local intent — and
 * this shows which, from real usage rather than guesswork.
 *
 * It suggests; it does not act. Generating and activating a data lookup
 * unreviewed is how a confidently wrong answer becomes permanent — you would
 * hear it every day without knowing it was reading the wrong field.
 */
function LearnedPanel() {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<AssistantInsights | null>(null)

  useEffect(() => {
    if (!open) return
    window.electronAPI?.assistantInsights?.().then(setData).catch(() => setData(null))
  }, [open])

  if (!window.electronAPI?.assistantInsights) return null

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[10px] uppercase tracking-wide text-gray-600 hover:text-gray-400"
      >
        what I have learned
      </button>
    )
  }

  const candidates = data?.candidates ?? []
  const totals = data?.totals ?? {}

  return (
    <div className="rounded-xl border border-white/10 p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-gray-300">Questions I keep answering slowly</span>
        <button onClick={() => setOpen(false)} className="text-gray-600 hover:text-gray-400">close</button>
      </div>

      <div className="font-mono text-[11px] text-gray-500">
        {data ? `${data.distinct} distinct · ` : ''}
        {Object.entries(totals).map(([r, n]) => `${r} ${n}`).join(' · ') || 'nothing logged yet'}
      </div>

      {candidates.length === 0 ? (
        <p className="text-gray-500">
          Nothing repeated through the slow path yet. Ask a few off-script questions and
          anything you repeat will show up here as a candidate to make instant.
        </p>
      ) : (
        <div className="space-y-1.5">
          {candidates.map((c) => (
            <div key={c.key} className="rounded-lg bg-surface2 p-2">
              <div className="text-gray-300">&ldquo;{c.phrasing}&rdquo;</div>
              <div className="font-mono text-[10px] text-gray-500 mt-0.5">
                asked {c.count}× · {c.slowCalls} slow · worst {(c.slowestMs / 1000).toFixed(1)}s
                {c.phrasings.length > 1 ? ` · ${c.phrasings.length} phrasings` : ''}
              </div>
            </div>
          ))}
          <p className="text-gray-500 pt-1">
            Tell Claude Code to add these to <span className="font-mono">assistant-intents.ts</span> and
            they become instant and free.
          </p>
        </div>
      )}
    </div>
  )
}

export default function Assistant() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [muted, setMuted] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null)
  const [voiceReady, setVoiceReady] = useState(false)
  const [voices, setVoices] = useState<{ id: string; label: string; current: boolean }[]>([])
  const [voiceId, setVoiceId] = useState<string>('')

  const scrollRef = useRef<HTMLDivElement>(null)
  const mutedRef = useRef(false)
  const micRef = useRef<MicLevel | null>(null)
  const sessionRef = useRef<string | null>(null)
  const busy = phase !== 'idle'

  useEffect(() => { mutedRef.current = muted }, [muted])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns])

  // Report what voice is actually available rather than assuming, so a missing
  // Piper install reads as a message instead of a dead button.
  useEffect(() => {
    let alive = true
    window.electronAPI?.voiceInfo?.().then((info) => {
      if (!alive) return
      setVoiceReady(!!info?.tts?.available)
      setVoices(info?.tts?.voices ?? [])
      setVoiceId(info?.tts?.voice ?? '')
      if (!info?.tts?.available && info?.tts?.reason) setStatus(info.tts.reason)
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  useEffect(() => () => {
    micRef.current?.stop()
    hush()
    stopHearing()
    disposeVoice()   // only here — the audio device stays warm between answers
  }, [])

  const speakAnswer = useCallback(async (text: string) => {
    if (mutedRef.current || !voiceAvailable() || !text) return
    setPhase('speaking')
    try {
      // The orb picks up the analyser the moment playback is scheduled, rather
      // than being polled on a guessed delay.
      await say(text, (a) => setAnalyser(a))
    } catch (e: any) {
      setStatus(`voice failed: ${e?.message ?? e}`)
    } finally {
      setAnalyser(null)
      setPhase('idle')
    }
  }, [])

  async function ensureSession(): Promise<string> {
    if (sessionRef.current) return sessionRef.current
    const s = await api.joeruCreateSession('Assistant Mode (voice)')
    sessionRef.current = s?.id
    if (!sessionRef.current) throw new Error('could not start a Joeru session')
    return sessionRef.current
  }

  const ask = useCallback(async (question: string) => {
    const q = question.trim()
    if (!q) return

    setInput('')
    setStatus(null)
    setPhase('thinking')
    setTurns((t) => [...t, { question: q, answer: null, pending: true }])

    // Recorded for every turn so the slow ones can be found later and made
    // instant. Fire-and-forget — it must not add latency to the answer.
    const askedAt = Date.now()
    const log = (route: 'local' | 'claude' | 'joeru' | 'failed', intent?: string | null) => {
      window.electronAPI?.logQuestion?.({ question: q, route, ms: Date.now() - askedAt, intent })
    }

    try {
      const local = await answerLocally(q)
      if (local) {
        log('local', local.intent)
        setTurns((t) => [...t.slice(0, -1), { question: q, answer: local }])
        await speakAnswer(local.speech)
        return
      }

      // Claude Code first, OpenCode as the backstop.
      //
      // Measured: `claude -p --model haiku` answers in ~6-8s and already knows
      // this project, because ~/.claude/CLAUDE.md imports joeru-kit's
      // AGENTS.md. Joeru on a free model took 12-78s and, being rate limited,
      // often did not answer at all. Claude spends subscription quota, which is
      // why haiku rather than the strongest model — these are short questions.
      if (window.electronAPI?.claudeAsk) {
        try {
          const answer = (await window.electronAPI.claudeAsk(q)).trim()
          if (answer) {
            log('claude')
            setTurns((t) => [...t.slice(0, -1), {
              question: q,
              answer: { intent: 'ask', speech: answer, lines: [], source: 'claude' },
            }])
            await speakAnswer(answer)
            return
          }
        } catch (e: any) {
          // Quota, auth or a missing CLI. Fall through to OpenCode rather than
          // failing outright — that is the point of having two.
          setStatus(`Claude unavailable (${e?.message ?? e}); trying Joeru…`)
        }
      }

      const sessionId = await ensureSession()
      const reply = await api.joeruSend(sessionId, q, AGENT, MODEL)

      // A provider failure arrives as a 200 with the error on the message, so
      // check for it before concluding the reply was empty.
      const failure = replyError(reply)
      const text = extractText(reply)

      if (failure && !text) {
        log('failed')
        setTurns((t) => [...t.slice(0, -1), {
          question: q,
          answer: { intent: 'ask', speech: failure, lines: [], source: 'joeru' },
        }])
        // Spoken too — a silent failure in a voice window is indistinguishable
        // from the app having hung.
        await speakAnswer(failure)
        return
      }

      log('joeru')
      const said = text || 'Joeru returned nothing.'
      setTurns((t) => [...t.slice(0, -1), {
        question: q,
        answer: { intent: 'ask', speech: said, lines: [], source: 'joeru' },
      }])
      await speakAnswer(said)
    } catch (err: any) {
      const msg = `That failed: ${err?.message ?? 'unknown error'}`
      setTurns((t) => [...t.slice(0, -1), {
        question: q,
        answer: { intent: 'ask', speech: msg, lines: [], source: 'local' },
      }])
      setPhase('idle')
    }
  }, [speakAnswer])

  /** One click does the right thing for whatever it is currently doing. */
  async function onOrbClick() {
    if (phase === 'speaking') { await hush(); setAnalyser(null); setPhase('idle'); return }
    if (phase === 'listening') { await stopHearing(); return }
    if (phase === 'thinking') return

    setStatus(null)
    setPhase('listening')

    // The orb reacts to the microphone while the main process transcribes.
    const mic = new MicLevel()
    micRef.current = mic
    setAnalyser(await mic.start())

    try {
      const heard = await hear()
      // Detach the orb BEFORE closing the context. Reversing these leaves the
      // animation loop reading an AnalyserNode whose context has been closed —
      // a freed native object, which crashes the renderer with an access
      // violation rather than throwing something catchable.
      setAnalyser(null)
      mic.stop()
      micRef.current = null

      if (!heard?.text) { setPhase('idle'); setStatus('I did not catch that'); return }
      setStatus(heard.confidence < 0.4 ? `heard (low confidence): "${heard.text}"` : null)
      await ask(heard.text)
    } catch (e: any) {
      setAnalyser(null)   // detach before close — see above
      mic.stop()
      micRef.current = null
      setPhase('idle')
      setStatus(`listening failed: ${e?.message ?? e}`)
    }
  }

  function toggleMute() {
    setMuted((m) => {
      if (!m) hush()
      return !m
    })
  }

  const hint = phase === 'listening' ? 'Listening — click to stop'
    : phase === 'speaking' ? 'Speaking — click to interrupt'
    : phase === 'thinking' ? 'Working…'
    : status ?? (voiceReady ? 'Click to speak' : 'Voice unavailable — you can still type')

  return (
    <div className="h-screen flex flex-col bg-background text-white overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Assistant Mode</span>
        </div>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {voices.length > 1 && (
            <select
              value={voiceId}
              onChange={async (e) => {
                const id = e.target.value
                try {
                  const info = await window.electronAPI?.setVoice?.(id)
                  setVoiceId(info?.voice ?? id)
                  setVoices(info?.voices ?? voices)
                  // Speak on change so the choice can be judged by ear.
                  if (!mutedRef.current) await say('Voice set.')
                } catch (err: any) {
                  setStatus(`could not switch voice: ${err?.message ?? err}`)
                }
              }}
              title="Voice"
              className="bg-surface2 border border-white/10 rounded-lg text-[11px] text-gray-400 px-1.5 py-1 focus:outline-none focus:border-primary"
            >
              {voices.map((v) => (
                <option key={v.id} value={v.id}>{v.id}</option>
              ))}
            </select>
          )}
          <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10">
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button onClick={() => window.electronAPI?.closeAssistant?.()} title="Close"
            className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/10">
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
                <button key={e} onClick={() => ask(e)} disabled={busy}
                  className="block w-full text-left px-3 py-1.5 rounded-lg bg-surface2 hover:bg-white/10 disabled:opacity-50 text-gray-300 text-xs">
                  {e}
                </button>
              ))}
            </div>
            <p className="text-xs pt-1">
              Anything else goes to Joeru on Claude Haiku — slower, and it spends quota.
            </p>
            <div className="pt-2"><LearnedPanel /></div>
          </div>
        )}

        {turns.map((t, i) => (
          <div key={i} className="space-y-1.5">
            <div className="text-sm text-gray-400">{t.question}</div>

            {t.pending ? (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {classify(t.question) === 'ask'
                  ? <><span>Asking Joeru…</span><Elapsed /></>
                  : 'Checking…'}
              </div>
            ) : t.answer ? (
              <div className="rounded-xl bg-surface2 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  {t.answer.source === 'local'
                    ? <Zap className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
                    : t.answer.source === 'claude'
                      ? <Sparkles className="w-3.5 h-3.5 text-violet-400 mt-0.5 shrink-0" />
                      : <Cloud className="w-3.5 h-3.5 text-sky-400 mt-0.5 shrink-0" />}
                  <p className="text-sm leading-relaxed">{t.answer.speech}</p>
                </div>
                {t.answer.lines.length > 0 && (
                  <div className="font-mono text-[11px] text-gray-500 space-y-0.5 pl-5">
                    {t.answer.lines.map((l, j) => <div key={j}>{l}</div>)}
                  </div>
                )}
                <div className="text-[10px] uppercase tracking-wide text-gray-600 pl-5">
                  {t.answer.source === 'local' ? 'local · no tokens'
                    : t.answer.source === 'claude' ? 'joeru · claude haiku · subscription quota'
                    : 'joeru · opencode free tier'}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-white/10">
        <div className="flex flex-col items-center pt-4 pb-2">
          <button
            onClick={onOrbClick}
            disabled={phase === 'thinking' || !voiceAvailable()}
            title={phase === 'speaking' ? 'Interrupt' : 'Click and speak'}
            className="relative rounded-full disabled:opacity-50 transition-transform hover:scale-[1.03] active:scale-[0.98]"
          >
            <VoiceOrb
              analyser={analyser}
              active={phase === 'listening'}
              busy={phase === 'thinking' || phase === 'speaking'}
            />
            <span className="absolute inset-0 flex items-center justify-center">
              {phase === 'thinking'
                ? <Loader2 className="w-5 h-5 text-white/90 animate-spin" />
                : phase === 'listening'
                  ? <span className="w-3 h-3 rounded-sm bg-white/90" />
                  : <Mic className="w-5 h-5 text-white/80" />}
            </span>
          </button>

          <div className="h-4 mt-1 text-[11px] text-gray-500 text-center px-3 truncate max-w-full">
            {hint}
          </div>
        </div>

        <form onSubmit={(e) => { e.preventDefault(); ask(input) }}
          className="flex items-center gap-2 p-3 pt-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="…or type instead"
            className="flex-1 px-3 py-2 rounded-lg bg-surface2 border border-white/10 focus:border-primary focus:outline-none text-sm"
          />
          <button type="submit" disabled={busy || !input.trim()}
            className="p-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-40">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
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

/**
 * A failed turn still returns HTTP 200 with the error attached to the message,
 * so there is nothing to catch — the reply simply has no text. Reporting that
 * as "Joeru returned nothing" hid a rate limit behind what looked like a bug
 * in the assistant. Translate the ones worth acting on.
 */
function replyError(reply: any): string | null {
  const err = reply?.info?.error ?? reply?.error
  if (!err) return null

  const message = String(err?.data?.message ?? err?.message ?? '')
  const status = err?.data?.statusCode ?? err?.statusCode

  if (status === 429 || /rate limit/i.test(message)) {
    return 'The free model tier is rate limited right now. Wait a minute and ask again — '
      + 'the instant answers above still work, since they never call a model.'
  }
  if (status === 401 || status === 403) {
    return 'The model provider rejected the request — check the OpenCode credentials.'
  }
  return message
    ? `Joeru could not answer: ${message}`
    : `Joeru could not answer: ${err?.name ?? 'unknown provider error'}`
}
