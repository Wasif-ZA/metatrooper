const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlayBridge', {
  onGlide: (fn) => ipcRenderer.on('cursor.glide', (_e, m) => fn(m)),
  onHide: (fn) => ipcRenderer.on('cursor.hide', (_e, m) => fn(m)),
  arrived: (m) => ipcRenderer.send('cursor.arrived', m),
});
