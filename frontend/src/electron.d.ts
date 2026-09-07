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
  listen?: () => Promise<{ text: string; confidence: number } | null>
  cancelListen?: () => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
