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
  // whisper.cpp on a WAV the renderer captured. Kept for completeness; the
  // listen* pair below is preferred because it keeps audio out of the renderer.
  transcribe: (wav) => ipcRenderer.invoke('whisper-transcribe', wav),
  cancelTranscribe: () => ipcRenderer.invoke('whisper-cancel'),

  // Capture AND transcription in the main process, via whisper-stream + SDL2.
  listenStart: () => ipcRenderer.invoke('listen-start'),
  listenStop: () => ipcRenderer.invoke('listen-stop'),
  listenCancel: () => ipcRenderer.invoke('listen-cancel'),

  // Assistant Mode's answering brain — the Claude Code CLI in print mode,
  // using the existing login rather than an API key.
  /**
   * Ask within Assistant Mode's session.
   *
   * `prompt` is the grounded text; `question` is what the user actually said,
   * and is used only to choose the model — the grounded prompt mentions tasks
   * and git every turn, so routing on it would escalate everything to Opus.
   * A bare string still works and routes on whatever it is given.
   */
  claudeAsk: (prompt, question) => ipcRenderer.invoke(
    'claude-ask',
    question === undefined ? prompt : { prompt, question },
  ),
  claudeCancel: () => ipcRenderer.invoke('claude-cancel'),
  /**
   * Start a fresh Assistant Mode conversation. Resolves with the new session
   * id and the one it replaced — the old conversation is kept, so the Chat tab
   * can still open it.
   */
  assistantNewConversation: () => ipcRenderer.invoke('assistant-new-conversation'),
  /** Which conversation Assistant Mode is in, or null before the first question. */
  assistantSession: () => ipcRenderer.invoke('assistant-session'),
  /**
   * Tool activity for the answer in flight. Returns an unsubscribe function —
   * without one, every mount adds another listener and one Read is reported
   * as many times as the window has been opened.
   */
  onClaudeAskEvent: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('claude-ask-event', handler);
    return () => ipcRenderer.removeListener('claude-ask-event', handler);
  },

  // The Chat tab on the same CLI, but with a persistent session and the
  // agent's own model tier rather than a pinned fast one.
  claudeChat: (args) => ipcRenderer.invoke('claude-chat', args),
  claudeSessions: () => ipcRenderer.invoke('claude-sessions'),
  claudeSessionRead: (id) => ipcRenderer.invoke('claude-session-read', id),
  claudeSessionRename: (id, title) => ipcRenderer.invoke('claude-session-rename', { id, title }),
  claudeSessionDelete: (id) => ipcRenderer.invoke('claude-session-delete', id),
  claudeSessionSearch: (query) => ipcRenderer.invoke('claude-session-search', query),
  claudeChatCancel: (sessionId) => ipcRenderer.invoke('claude-chat-cancel', sessionId),
  claudeChatForget: (sessionId) => ipcRenderer.invoke('claude-chat-forget', sessionId),
  // Real subscription usage (5-hour and weekly windows). Observed from calls
  // already being made, so this is a cheap read and never itself spends quota.
  claudeUsage: () => ipcRenderer.invoke('claude-usage'),
  /**
   * Fires the moment a new reading is recorded, so the bars move with the
   * answer rather than on the next poll. Returns an unsubscribe function —
   * without one, every mount would add another listener.
   */
  onClaudeUsageUpdate: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('claude-usage-update', handler);
    return () => ipcRenderer.removeListener('claude-usage-update', handler);
  },
  /**
   * Subscribe to tool activity for the turn in flight. Returns an unsubscribe
   * function — without one, every mount would add another listener and the
   * same Read would be reported as many times as the page had been opened.
   */
  onClaudeChatEvent: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on('claude-chat-event', handler);
    return () => ipcRenderer.removeListener('claude-chat-event', handler);
  },

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
