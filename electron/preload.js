const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getMetrics: () => ipcRenderer.invoke('get-metrics'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  // Assistant Mode. The Joeru page keys its button off the presence of
  // openAssistant, so a browser (`npm run dev:web`) hides it rather than
  // offering a button that cannot work.
  openAssistant: () => ipcRenderer.invoke('open-assistant'),
  closeAssistant: () => ipcRenderer.invoke('close-assistant'),

  // Voice. Both ends run in the main process — neural TTS via Piper and
  // recognition via Windows System.Speech — so the renderer only plays audio
  // and draws, and cannot be crashed by either.
  // Fire-and-forget so it cannot itself block the step being traced.
  trace: (step) => ipcRenderer.send('trace', step),
  voiceInfo: () => ipcRenderer.invoke('voice-info'),
  speak: (text) => ipcRenderer.invoke('voice-speak', text),
  stopSpeaking: () => ipcRenderer.invoke('voice-stop-speaking'),
  setVoice: (id) => ipcRenderer.invoke('voice-set-voice', id),
  listen: () => ipcRenderer.invoke('voice-listen'),
  cancelListen: () => ipcRenderer.invoke('voice-cancel-listen'),

  // Assistant Mode's answering brain — the Claude Code CLI in print mode,
  // using the existing login rather than an API key.
  claudeAsk: (question) => ipcRenderer.invoke('claude-ask', question),
  claudeCancel: () => ipcRenderer.invoke('claude-cancel'),

  // Fire-and-forget: logging must never delay an answer.
  logQuestion: (entry) => ipcRenderer.send('assistant-log', entry),
  assistantInsights: () => ipcRenderer.invoke('assistant-insights'),
  onMetricsUpdate: (callback) => {
    ipcRenderer.on('metrics-update', (event, data) => callback(data));
  },
  removeMetricsListener: () => {
    ipcRenderer.removeAllListeners('metrics-update');
  }
});
