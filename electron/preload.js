const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getMetrics: () => ipcRenderer.invoke('get-metrics'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  // Assistant Mode. The Joeru page keys its button off the presence of
  // openAssistant, so a browser (`npm run dev:web`) hides it rather than
  // offering a button that cannot work.
  openAssistant: () => ipcRenderer.invoke('open-assistant'),
  closeAssistant: () => ipcRenderer.invoke('close-assistant'),
  onMetricsUpdate: (callback) => {
    ipcRenderer.on('metrics-update', (event, data) => callback(data));
  },
  removeMetricsListener: () => {
    ipcRenderer.removeAllListeners('metrics-update');
  }
});
