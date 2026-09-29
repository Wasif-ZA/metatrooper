const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayBridge', {
  onCursor: (fn) => ipcRenderer.on('cursor', (_e, p) => fn(p)),
});
