const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getMetrics: () => ipcRenderer.invoke('get-metrics'),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  onMetricsUpdate: (callback) => {
    ipcRenderer.on('metrics-update', (event, data) => callback(data));
  },
  removeMetricsListener: () => {
    ipcRenderer.removeAllListeners('metrics-update');
  }
});
