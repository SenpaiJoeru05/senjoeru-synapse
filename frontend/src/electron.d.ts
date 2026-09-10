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
  /** One-shot question through the Claude Code CLI. Resolves with the answer. */
  claudeAsk?: (question: string) => Promise<string>
  claudeCancel?: () => Promise<boolean>

  /**
   * A Chat-tab turn on the same CLI, in a persistent session.
   *
   * Unlike claudeAsk this pins no model — the agent's declared tier applies —
   * and the conversation lives in the CLI's own session store, so a follow-up
   * costs a fraction of the first turn instead of re-sending the transcript.
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
  /** Resolves to WAV bytes, or null if the synthesis was cancelled. */
  speak?: (text: string) => Promise<ArrayBuffer | null>
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
