/**
 * The preload bridge (electron/preload.js). Absent in a browser, which is why
 * every member is optional and callers must guard — `npm run dev:web` serves
 * the same bundle with no Electron underneath it.
 */
export interface TtsInfo {
  available: boolean
  exe: string
  /** Currently selected voice id, e.g. "alan". */
  voice: string
  voiceLabel: string
  /** Only voices present on disk — never offer one that is not downloaded. */
  voices: { id: string; label: string; current: boolean }[]
  reason: string | null
}

/** A question repeatedly answered by a slow route — worth making local. */
export interface QuestionCandidate {
  key: string
  phrasing: string
  phrasings: string[]
  count: number
  slowCalls: number
  slowestMs: number
  lastAsked: string
}

export interface AssistantInsights {
  candidates: QuestionCandidate[]
  /** Call counts per route: local / claude / joeru / failed. */
  totals: Record<string, number>
  distinct: number
  file: string
}

/**
 * A plan-usage reading.
 *
 * `usage: null` means never observed — which is NOT zero usage, and must not
 * render as an empty bar. It stays null permanently on API-key, Bedrock and
 * Vertex sessions, where plan windows do not apply.
 *
 * Recorded as a side effect of Chat and Assistant Mode answers, so it costs
 * nothing to read and can legitimately be stale; `ageMs` and `stale` exist to
 * be shown, not hidden.
 */
export interface UsagePayload {
  usage: {
    source: 'stream' | 'statusline'
    /** When this reading was observed, ms since epoch. */
    at: number
    status: 'allowed' | 'allowed_warning' | 'rejected' | null
    /** Which window the server says is currently binding. */
    binding: string | null
    windows: Record<string, {
      /** 0-100, one decimal. */
      usedPercent: number
      /** Unix SECONDS, or null when unknown. */
      resetsAt: number | null
    }>
  } | null
  stale: boolean
  ageMs: number | null
}

export interface ElectronAPI {
  getMetrics?: () => Promise<unknown>
  getSystemInfo?: () => Promise<{
    platform: string
    arch: string
    cpus: number
    totalMemory: number
    freeMemory: number
  }>
  onMetricsUpdate?: (cb: (data: unknown) => void) => void
  removeMetricsListener?: () => void
  openAssistant?: () => Promise<boolean>
  closeAssistant?: () => Promise<boolean>

  /** Breadcrumb to the main process — survives a renderer crash. */
  trace?: (step: string) => void
  voiceInfo?: () => Promise<{
    tts: TtsInfo
    stt: { available: boolean; engine: string }
    claude?: {
      available: boolean
      cli: string | null
      model: string
      agent: string
      /** False when joeru-kit has not been built here — answers would be plain Claude. */
      agentInstalled: boolean
      reason: string | null
    }
  }>
  /**
   * A question through the Claude Code CLI, within Assistant Mode's session.
   *
   * No longer one-shot: the main process holds one session for the life of the
   * app run, so a follow-up actually refers back. The session id is not a
   * parameter — the renderer must not be able to answer into a different
   * conversation than the one the reset button controls.
   */
  claudeAsk?: (prompt: string, question?: string) => Promise<string>
  claudeCancel?: () => Promise<boolean>
  /**
   * Start a fresh Assistant Mode conversation, without restarting the app.
   *
   * The previous conversation is kept, not deleted — it stays openable from
   * Chat's sidebar, which is the point of giving these sessions real titles.
   */
  assistantNewConversation?: () => Promise<{ id: string; previous: string | null }>
  /** Which conversation Assistant Mode is in, or null before the first question. */
  assistantSession?: () => Promise<{ id: string | null }>
  /**
   * Tool activity for the answer in flight. Returns an unsubscribe function.
   *
   * Same event shape as the Chat channel because both come from one reader in
   * the main process — the two used to have separate parsers and only Chat
   * showed tool calls.
   */
  onClaudeAskEvent?: (cb: (e: {
    type: 'tool' | 'text' | 'reasoning' | 'done'
    name?: string
    input?: unknown
    text?: string
    costUsd?: number
    turns?: number
  }) => void) => () => void

  /**
   * A Chat-tab turn on the same CLI, in a persistent session.
   *
   * Joeru is pinned to the cheap model here as in the voice window — he is the
   * dispatcher, not the implementer. A specialist picked from the dropdown
   * keeps its OWN declared tier, which is how the roster puts the right brain
   * on the right job. The conversation lives in the CLI's own session store,
   * so a follow-up costs a fraction of the first turn.
   */
  claudeChat?: (args: { sessionId: string; agent?: string; text: string }) => Promise<{
    text: string
    tools: { name: string; input: unknown; at: number }[]
    cancelled?: boolean
    /** Set instead of throwing, so the caller can fall back to OpenCode. */
    error?: string
  }>
  /**
   * Stop the turn in flight for one session. Resolves false when there was
   * nothing running, so a button pressed after the answer landed is
   * distinguishable from a real cancellation.
   */
  claudeChatCancel?: (sessionId: string) => Promise<boolean>
  /** Conversations the CLI has stored for this project, newest first. */
  claudeSessions?: () => Promise<{
    id: string; title: string; updated: number; bytes: number
  }[]>
  /** Replay one stored conversation. Tool calls are summarised, not replayed. */
  claudeSessionRead?: (id: string) => Promise<{
    turns: { role: 'user' | 'assistant'; text: string; tools?: { name: string; input: unknown }[] }[]
    error?: string
  }>
  /** Set a title, or clear it with an empty string to restore the derived one. */
  claudeSessionRename?: (id: string, title: string) => Promise<{ id?: string; title?: string | null; error?: string }>
  /** Delete a conversation. Idempotent — a missing one reports removed:false. */
  claudeSessionDelete?: (id: string) => Promise<{ removed: boolean; reason?: string; error?: string }>
  /** Find a phrase across stored conversations. Needs at least two characters. */
  claudeSessionSearch?: (query: string) => Promise<{
    id: string; title: string; snippet: string; matches: number; updated: number
  }[]>
  /** Drop a session so the next turn starts fresh rather than resuming. */
  claudeChatForget?: (sessionId: string) => Promise<boolean>
  /**
   * Real plan usage, as reported by the API itself.
   *
   * `usage` is null when it has never been observed — which is NOT the same as
   * 0% used, and must not render as an empty bar. It stays null forever on an
   * API-key, Bedrock or Vertex session, where plan windows do not apply.
   *
   * Recorded as a side effect of Chat and Assistant Mode answers, so it costs
   * nothing to read and can legitimately be stale; `ageMs` and `stale` are
   * there to be shown, not hidden.
   */
  claudeUsage?: () => Promise<UsagePayload>
  /**
   * New readings, pushed as they are recorded. Returns an unsubscribe function.
   *
   * Broadcast to every window, because the windows are account-wide: an
   * Assistant Mode answer moves the same bars the Overview is drawing.
   */
  onClaudeUsageUpdate?: (cb: (p: UsagePayload) => void) => () => void
  /** Live tool activity for the turn in flight. Returns an unsubscribe function. */
  onClaudeChatEvent?: (cb: (e: {
    sessionId: string
    type: 'tool' | 'text' | 'reasoning' | 'done'
    name?: string
    input?: unknown
    text?: string
    costUsd?: number
    turns?: number
  }) => void) => () => void

  logQuestion?: (entry: {
    question: string
    route: 'local' | 'claude' | 'joeru' | 'failed'
    ms: number
    intent?: string | null
  }) => void
  assistantInsights?: () => Promise<AssistantInsights>
  /**
   * Synthesised audio, plus the caption track for it.
   *
   * `spoken` is the text Piper actually received — markdown stripped, since it
   * reads "**bold**" out as "star star bold star star". `cues` are timed as
   * fractions of playback (0..1) and are built from `spoken`, not from the
   * original: the two differ in length wherever emphasis or a link was
   * removed, and caption timing is proportional to length.
   *
   * `wav` is null when the synthesis was cancelled.
   */
  speak?: (text: string) => Promise<{
    wav: ArrayBuffer | null
    spoken: string
    cues: { text: string; from: number; to: number }[]
  } | ArrayBuffer | null>
  stopSpeaking?: () => Promise<boolean>
  setVoice?: (id: string) => Promise<TtsInfo>
  /** Resolves to null when nothing was said before the timeout. */
  listen?: () => Promise<{
    text: string
    /** From the Windows recogniser. Observed values are very low even on good
     *  transcriptions, so treat it as a hint, not a gate. */
    confidence: number
    /** Which grammar produced it — measurement says always 'dictation'. */
    grammar: string
    /** Runner-up transcription, for diagnosing a misrecognition. */
    alternate: string
  } | null>
  cancelListen?: () => Promise<boolean>
  /** whisper.cpp — takes a 16kHz mono WAV recorded by the renderer. */
  transcribe?: (wav: ArrayBuffer) => Promise<{
    text: string
    confidence: number
    grammar: string
    alternate: string
  }>
  cancelTranscribe?: () => Promise<boolean>

  /**
   * Capture and transcription entirely in the main process (whisper-stream via
   * SDL2). Preferred over the record-in-renderer path, which crashed Chromium
   * on sample-rate conversion.
   */
  listenStart?: () => Promise<{ started: boolean }>
  listenStop?: () => Promise<{
    text: string
    confidence: number
    grammar: string
    alternate: string
  }>
  listenCancel?: () => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
