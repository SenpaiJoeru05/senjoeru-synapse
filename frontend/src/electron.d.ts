/**
 * The preload bridge (electron/preload.js). Absent in a browser, which is why
 * every member is optional and callers must guard — `npm run dev:web` serves
 * the same bundle with no Electron underneath it.
 */
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
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
