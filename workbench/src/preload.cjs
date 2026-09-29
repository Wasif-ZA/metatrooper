const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('troop', {
  view: (v) => ipcRenderer.invoke('view', v),
  call: (method, params) => ipcRenderer.invoke('call', method, params),
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  readPipeline: (id) => ipcRenderer.invoke('readPipeline', id),
  savePipeline: (projectId, text) => ipcRenderer.invoke('savePipeline', projectId, text),
  runLog: (runId) => ipcRenderer.invoke('runLog', runId),
  longtasks: (entries) => ipcRenderer.invoke('longtasks', entries),
  probe: (state) => ipcRenderer.invoke('probe', state),
  onSnapshot: (fn) => {
    const listener = (_e, s) => fn(s);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  },
});
