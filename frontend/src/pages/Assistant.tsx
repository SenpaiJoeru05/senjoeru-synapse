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
import AssistantStats, { useWideEnough } from '../components/AssistantStats'
import type { AssistantInsights } from '../electron'
import { currentState, ground, type Exchange } from '../lib/grounding'
import { acknowledgement } from '../lib/acknowledge'
import {
  parse as parseTaskAction, apply as applyTask, confirmationFor, isYes, isNo,
  type ActionParse as TaskAction, type TaskRef, type TaskStatus,
} from '../lib/task-actions'
import {
  parse as parseMemory, apply as applyMemory,
  confirmationFor as memoryConfirmation, type MemoryDraft,
} from '../lib/memory-actions'
import {
  say, hush, hear, stopHearing, voiceAvailable, disposeVoice, MicLevel,
  usesMainProcessCapture, beginListening, endListening, abortListening,
  type Heard,
} from '../lib/voice'

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
  /** Set while listening; calling it ends the turn. */
  const stopListeningRef = useRef<(() => void) | null>(null)
  /** True only while the "on it" line is playing, not the answer. */
  const ackingRef = useRef(false)
  /**
   * The last few exchanges, sent with each question so follow-ups resolve.
   *
   * A ref rather than state because `ask` must always read the newest value.
   * Held as state it would be captured in the callback's closure, and a
   * question asked right after an answer would ship the history from before
   * it — the one turn that matters most for "mark that as complete".
   */
  const recentRef = useRef<Exchange[]>([])
  /**
   * A change that has been understood but NOT performed.
   *
   * Held until an explicit yes. Read-only intents can afford to act on a
   * misrecognition — it costs a moment. These two write: "mark task three
   * complete" heard as task eight is not undone by saying no afterwards, and a
   * misheard memory is worse than a missing one, being wrong, permanent, and
   * read as authoritative by every agent after it.
   *
   * One ref for both kinds rather than one each, so there can only ever be a
   * single outstanding question. Two would let a yes answer the wrong one.
   */
  const pendingRef = useRef<
    | { kind: 'task'; task: TaskRef; status: TaskStatus }
    | { kind: 'memory'; draft: MemoryDraft }
    | null
  >(null)
  const sessionRef = useRef<string | null>(null)
  const busy = phase !== 'idle'
  // Drives whether the stats rail has room to render.
  const wide = useWideEnough()

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
    abortListening()
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

  /**
   * Say "on it" while the slow work runs, and return when that has finished
   * speaking — NOT when the work has.
   *
   * Separate from speakAnswer because the phase afterwards is different: an
   * answer ends the turn and goes idle, whereas this hands back to 'thinking'
   * because the actual work is still running behind it.
   *
   * Never rejects. This is a courtesy over the top of the real request, so a
   * synthesis failure here must not take down the answer the user is waiting
   * for — it just goes back to being silent.
   */
  const speakAck = useCallback(async (question: string) => {
    if (mutedRef.current || !voiceAvailable()) return
    const line = acknowledgement(question)
    setStatus(line)
    setPhase('speaking')
    ackingRef.current = true
    try {
      await say(line, (a) => setAnalyser(a))
    } catch {
      /* the answer still matters; stay quiet and carry on */
    } finally {
      ackingRef.current = false
      setAnalyser(null)
      // Back to thinking, not idle: the request this covers is still in flight.
      setPhase('thinking')
    }
  }, [])

  /**
   * Record an exchange for the next question's context.
   *
   * A few more than ground() sends, so it can pick the most recent without
   * this having to know how many that is.
   */
  const remember = useCallback((question: string, answer: string) => {
    recentRef.current = [...recentRef.current, { question, answer }].slice(-8)
  }, [])

  /** Perform a confirmed change. Reports failure rather than throwing. */
  const applyTaskStatus = useCallback(async (id: string, status: TaskStatus) => {
    try {
      await applyTask(id, status)
      return true
    } catch (e: any) {
      setStatus(`could not update the task: ${e?.response?.data?.error ?? e?.message ?? e}`)
      return false
    }
  }, [])

  /**
   * File a confirmed memory, and say where it went.
   *
   * The folder and filename are spoken back on success because they are how
   * you would find it again — and because they were chosen by a heuristic, so
   * hearing "as a preference" is the moment to notice it guessed wrong.
   */
  const saveMemory = useCallback(async (draft: MemoryDraft) => {
    try {
      const r = await applyMemory(draft)
      const verb = r?.created === false ? 'Updated' : 'Filed'
      return `${verb} under ${draft.folder}, as ${draft.slug}.`
    } catch (e: any) {
      const reason = e?.response?.data?.error ?? e?.message ?? e
      setStatus(`could not save that memory: ${reason}`)
      // Named out loud, because a memory you believe was filed and was not is
      // the failure that costs you the fact.
      return `I could not save that. ${reason}`
    }
  }, [])

  /**
   * Turn a parsed command into something to say — and, when it is
   * unambiguous, arm the confirmation.
   *
   * Arming here rather than in the parser keeps the parser pure: it decides
   * what was meant, this decides what happens next.
   */
  const describeAction = useCallback(async (
    // Never called with kind:none — the caller has already returned by then,
    // and saying so in the type is what lets the notFound branch below read
    // its `described` field without a cast.
    action: Exclude<TaskAction, { kind: 'none' }>,
  ): Promise<string> => {
    if (action.kind === 'ready') {
      pendingRef.current = { kind: 'task', task: action.task, status: action.status }
      return confirmationFor(action.task, action.status)
    }
    if (action.kind === 'ambiguous') {
      // Named, not counted: "which one" is unanswerable without hearing the
      // options, and the screen carries the full list alongside.
      const names = action.candidates.slice(0, 3).map((c) => c.title).join(', or ')
      return `There are ${action.candidates.length} tasks ${action.described}. Which one — ${names}?`
    }
    return `I could not find ${action.described} to change.`
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

    // Declared out here so the catch below can wait on it too; scoped inside
    // the try it would be invisible there.
    let acked: Promise<void> | null = null

    try {
      /*
       * A pending confirmation owns the next thing said, whatever it is.
       *
       * Checked before anything else so "yes" cannot be classified as small
       * talk and answered with "anytime" while the change is silently dropped.
       * Anything that is not a clear yes or no cancels and is then treated as
       * a fresh question — an unclear reply must never count as consent.
       */
      const pending = pendingRef.current
      if (pending) {
        pendingRef.current = null
        if (isYes(q)) {
          const said = pending.kind === 'task'
            ? (await applyTaskStatus(pending.task.id, pending.status)
              ? `Done. ${pending.task.title} is now ${pending.status.toLowerCase()}.`
              : `I could not update ${pending.task.title}.`)
            : await saveMemory(pending.draft)
          log('local', pending.kind === 'task' ? 'task-action' : 'memory-write')
          remember(q, said)
          setTurns((t) => [...t.slice(0, -1), {
            question: q,
            answer: { intent: 'chat', speech: said, lines: [], source: 'local' },
          }])
          await speakAnswer(said)
          return
        }
        if (isNo(q)) {
          const said = 'Left as it was.'
          log('local', 'task-action')
          remember(q, said)
          setTurns((t) => [...t.slice(0, -1), {
            question: q,
            answer: { intent: 'chat', speech: said, lines: [], source: 'local' },
          }])
          await speakAnswer(said)
          return
        }
        // Neither — fall through and answer it as a question, having cancelled.
        setStatus('Cancelled the change.')
      }

      /*
       * "Remember that…" before task commands, because they collide.
       *
       * Task parsing needs an instruction verb AND a status word, and "make a
       * note that the whisper work is done" has both — "make" and "done" — so
       * reaching task parsing first would file nothing and instead offer to
       * complete a task nobody mentioned. Memory verbs are unambiguous, so
       * testing them first costs nothing and removes the overlap.
       */
      const memory = parseMemory(q)
      if (memory.kind !== 'none') {
        const said = memory.kind === 'ready'
          ? (() => {
            pendingRef.current = { kind: 'memory', draft: memory.draft }
            return memoryConfirmation(memory.draft)
          })()
          : 'Remember what?'
        log('local', 'memory-write')
        remember(q, said)
        setTurns((t) => [...t.slice(0, -1), {
          question: q,
          answer: {
            intent: 'chat',
            speech: said,
            lines: memory.kind === 'ready'
              ? [`${memory.draft.folder}/${memory.draft.slug}.md`]
              : [],
            source: 'local',
          },
        }])
        await speakAnswer(said)
        return
      }

      /*
       * Task commands, before the read-only intents.
       *
       * Their keywords overlap: "mark the review task complete" contains
       * "review", and "complete" would otherwise never be reached. A command
       * has to be recognised as a command before anything tries to read it as
       * a question.
       */
      const action = await parseTaskAction(q)
      if (action.kind !== 'none') {
        const said = await describeAction(action)
        log('local', 'task-action')
        remember(q, said)
        setTurns((t) => [...t.slice(0, -1), {
          question: q,
          answer: {
            intent: 'chat',
            speech: said,
            lines: action.kind === 'ambiguous'
              ? action.candidates.map((c) => `${c.id} · ${c.status} · ${c.title}`)
              : [],
            source: 'local',
          },
        }])
        await speakAnswer(said)
        return
      }

      const local = await answerLocally(q)
      if (local) {
        log('local', local.intent)
        remember(q, local.speech)
        setTurns((t) => [...t.slice(0, -1), { question: q, answer: local }])
        await speakAnswer(local.speech)
        return
      }

      /*
       * Past here every route takes seconds, so say something now.
       *
       * Started but NOT awaited: the acknowledgement synthesises and plays
       * while the request is already in flight, so it costs nothing. Awaiting
       * it here would add its own second or so to every slow answer, which is
       * the opposite of the point.
       *
       * It sits below the local branch above deliberately. Those answers
       * return in milliseconds, and prefixing one with "let me check" would
       * make the fast path sound slow.
       */
      acked = speakAck(q)

      // Claude Code first, OpenCode as the backstop.
      //
      // Measured: `claude -p --model haiku` answers in ~6-8s and already knows
      // this project, because ~/.claude/CLAUDE.md imports joeru-kit's
      // AGENTS.md. Joeru on a free model took 12-78s and, being rate limited,
      // often did not answer at all. Claude spends subscription quota, which is
      // why haiku rather than the strongest model — these are short questions.
      if (window.electronAPI?.claudeAsk) {
        try {
          // Hand it the live numbers. Without them it invents a summary of the
          // board and asks the user to supply the answer — observed, not
          // hypothetical. See lib/grounding.ts.
          const state = await currentState()
          const answer = (await window.electronAPI.claudeAsk(
            ground(q, state, recentRef.current),
          )).trim()
          if (answer) {
            // Let the acknowledgement finish its last word. Cutting speech
            // mid-syllable to start the answer sounds like a fault, and by now
            // it has usually long finished anyway.
            await acked
            log('claude')
            remember(q, answer)
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
        await acked   // as above: never talk over the acknowledgement
        log('failed')
        remember(q, failure)
        setTurns((t) => [...t.slice(0, -1), {
          question: q,
          answer: { intent: 'ask', speech: failure, lines: [], source: 'joeru' },
        }])
        // Spoken too — a silent failure in a voice window is indistinguishable
        // from the app having hung.
        await speakAnswer(failure)
        return
      }

      await acked   // as above: never talk over the acknowledgement
      log('joeru')
      const said = text || 'Joeru returned nothing.'
      remember(q, said)
      setTurns((t) => [...t.slice(0, -1), {
        question: q,
        answer: { intent: 'ask', speech: said, lines: [], source: 'joeru' },
      }])
      await speakAnswer(said)
    } catch (err: any) {
      // The acknowledgement may still be mid-sentence; letting it land keeps
      // the orb and the audio in step even on the failure path.
      await acked
      const msg = `That failed: ${err?.message ?? 'unknown error'}`
      setTurns((t) => [...t.slice(0, -1), {
        question: q,
        answer: { intent: 'ask', speech: msg, lines: [], source: 'local' },
      }])
      setPhase('idle')
    }
  }, [speakAnswer, speakAck, remember, applyTaskStatus, describeAction, saveMemory])

  /**
   * What to do with a transcription, shared by both recognisers.
   *
   * Gate on the cost of being wrong, not on a confidence threshold. The
   * Windows recogniser's confidence is unusable as a gate — measured around
   * 0.002 even on word-perfect transcriptions — and whisper reports none at
   * all, so any floor rejects everything or nothing.
   *
   * What differs is the consequence. A transcription matching a local intent
   * is instant and free, and a misheard phrase rarely lands on one by
   * accident. Anything else goes to Claude: ~13s and real quota, where acting
   * on "I thought it" instead of "hi" answers a question never asked. Those
   * are shown for confirmation instead.
   */
  const routeHeard = useCallback(async (heard: Heard) => {
    if (classify(heard.text) !== 'ask') {
      setStatus(null)
      await ask(heard.text)
      return
    }
    setPhase('idle')
    setInput(heard.text)
    setStatus(
      `Heard "${heard.text}"`
      + (heard.alternate ? ` (or "${heard.alternate}")` : '')
      + ' — edit if wrong, then send.',
    )
  }, [ask])

  /** One click does the right thing for whatever it is currently doing. */
  async function onOrbClick() {
    if (phase === 'speaking') {
      await hush()
      setAnalyser(null)
      /*
       * Silencing the acknowledgement does NOT cancel the work behind it.
       *
       * Going idle here would claim the turn was over while the request was
       * still running, and the answer would then arrive out of nowhere. The
       * request is not cancellable mid-flight, so the honest state is the one
       * that is actually true: still thinking.
       */
      setPhase(ackingRef.current ? 'thinking' : 'idle')
      return
    }
    if (phase === 'listening') {
      // whisper: the turn is a promise waiting on this second click, so
      // resolving it lets the listening path move on to stop and transcribe.
      // System.Speech: it blocks inside its own recognise call, so the only
      // way out is to tell the main process to cancel it.
      if (stopListeningRef.current) { stopListeningRef.current(); stopListeningRef.current = null }
      else await stopHearing()
      return
    }
    if (phase === 'thinking') return

    setStatus(null)
    setPhase('listening')

    /*
     * Two capture paths, and NEITHER records in the renderer.
     *
     * whisper: whisper-stream owns the device through SDL2, and the turn ends
     * on a second click. Windows System.Speech owns its own device too, but
     * blocks until it decides the utterance is over, so the turn ends by
     * itself. Either way the renderer only opens a parallel stream to give the
     * orb something to react to — Windows shares the mic, so both can read it.
     *
     * Recording in the renderer was tried twice and crashed Chromium both
     * times with an access violation on sample-rate conversion. See lib/voice.ts.
     *
     * whisper is preferred on accuracy: on the same clips it scored 7 of 7
     * against System.Speech's 2 of 7.
     */
    if (usesMainProcessCapture()) {
      // The main process owns the microphone; the renderer opens a stream
      // purely so the orb has something to react to. Windows shares the
      // device, so both can read it.
      const mic = new MicLevel()
      micRef.current = mic
      try {
        await beginListening()
        setAnalyser(await mic.start())

        // Wait for the second click, which resolves this.
        await new Promise<void>((resolve) => { stopListeningRef.current = resolve })

        // Detach the orb BEFORE closing the context: the animation loop reads
        // the AnalyserNode, and reading one whose context has closed touches
        // freed memory and crashes the renderer.
        setAnalyser(null)
        mic.stop()
        micRef.current = null

        setPhase('thinking')
        setStatus('Transcribing…')
        const heardStream = await endListening()
        if (!heardStream?.text) { setPhase('idle'); setStatus('I did not catch that'); return }
        await routeHeard(heardStream)
      } catch (e: any) {
        setAnalyser(null)
        mic.stop()
        micRef.current = null
        await abortListening()
        setPhase('idle')
        setStatus(`listening failed: ${e?.message ?? e}`)
      }
      return
    }

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
      await routeHeard(heard)
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
    /*
     * A tinted ground behind the glass, not flat `bg-background`.
     *
     * backdrop-filter has nothing to blur against a solid fill, so the glass
     * utilities render as plain translucent panels on it. The two radial
     * washes give the blur something to pick up, which is the whole reason
     * glassmorphism reads as depth rather than as low-contrast boxes.
     */
    <div
      className="h-screen flex bg-background text-white overflow-hidden"
      style={{
        backgroundImage:
          'radial-gradient(120% 80% at 15% -10%, rgba(34,211,238,0.10), transparent 60%),'
          + 'radial-gradient(100% 70% at 110% 110%, rgba(99,102,241,0.14), transparent 60%)',
      }}
    >
    <div className="flex-1 min-w-0 flex flex-col">
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          {/* A lit chip rather than a bare glyph — the one piece of chrome that
              says this window is listening for you. */}
          <span className="w-6 h-6 rounded-lg glass flex items-center justify-center">
            <Bot className="w-3.5 h-3.5 text-cyan-300" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Assistant Mode</span>
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
              className="glass rounded-lg text-[11px] text-gray-400 px-1.5 py-1 focus:outline-none focus:border-cyan-400/40"
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
                  className="block w-full text-left px-3 py-1.5 rounded-xl glass hover:border-cyan-400/30 hover:text-white disabled:opacity-50 text-gray-300 text-xs transition-colors">
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
              <div className="glass rounded-2xl p-3 space-y-2">
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

      <div className="shrink-0 border-t border-white/5">
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
              size={150}
            />
            {/*
              The state icon sits at the BOTTOM of the sphere, not its centre.
              Centred is where the waveform is drawn, and an opaque glyph there
              covered the one part of this that carries information. Idle is the
              exception — there is no trace to hide, and a microphone in the
              middle is the clearest possible "click me".
            */}
            {phase === 'idle' ? (
              <span className="absolute inset-0 flex items-center justify-center">
                <Mic className="w-5 h-5 text-cyan-200/80" />
              </span>
            ) : (
              <span className="absolute inset-x-0 bottom-1 flex items-center justify-center">
                {phase === 'thinking'
                  ? <Loader2 className="w-4 h-4 text-cyan-200/90 animate-spin" />
                  : phase === 'listening'
                    ? <span className="w-2.5 h-2.5 rounded-sm bg-cyan-200/90 animate-pulse" />
                    : <span className="w-2.5 h-2.5 rounded-full bg-cyan-200/90" />}
              </span>
            )}
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
            className="flex-1 px-3.5 py-2.5 rounded-xl glass placeholder:text-gray-600 focus:border-cyan-400/40 focus:outline-none text-sm"
          />
          <button type="submit" disabled={busy || !input.trim()}
            className="p-2.5 rounded-xl glass text-cyan-300 hover:border-cyan-400/40 hover:text-cyan-200 disabled:opacity-40 transition-colors">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>

    {/*
      The stats rail, only when there is room for it. At the default 440px a
      stats column would leave the conversation about 250px, which is worse
      than showing no stats at all — so widen the window and it appears. The
      window remembers its size now, so that is a one-time gesture.
    */}
    {wide && <AssistantStats />}
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
