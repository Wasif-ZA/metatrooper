const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('troop', {
  view: (v) => ipcRenderer.invoke('view', v),
  call: (method, params) => ipcRenderer.invoke('call', method, params),
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  readPipeline: (id) => ipcRenderer.invoke('readPipeline', id),
  savePipeline: (projectId, text) => ipcRenderer.invoke('savePipeline', projectId, text),
  runLog: (runId) => ipcRenderer.invoke('runLog', runId),
  review: (runId) => ipcRenderer.invoke('review', runId),
  handback: (projectId, runId) => ipcRenderer.invoke('handback', projectId, runId),
  copyText: (text) => ipcRenderer.invoke('copyText', text),
  longtasks: (entries) => ipcRenderer.invoke('longtasks', entries),
  probe: (state) => ipcRenderer.invoke('probe', state),
  paneShow: (paneId, bounds) => ipcRenderer.invoke('paneShow', paneId, bounds),
  paneNavigate: (paneId, url) => ipcRenderer.invoke('paneNavigate', paneId, url),
  panePick: (paneId) => ipcRenderer.invoke('panePick', paneId),
  panePickCancel: (paneId) => ipcRenderer.invoke('panePickCancel', paneId),
  commentSave: (c) => ipcRenderer.invoke('commentSave', c),
  commentDiffLine: (c) => ipcRenderer.invoke('commentDiffLine', c),
  commentFiles: (sessionId, files) => ipcRenderer.invoke('commentFiles', { session_id: sessionId, paths: Array.from(files || [], (f) => webUtils.getPathForFile(f)).filter(Boolean) }),
  handbackFile: (projectId, runId, file) => ipcRenderer.invoke('handbackFile', projectId, runId, file),
  snapshotImage: (file) => ipcRenderer.invoke('snapshotImage', file),
  onCommentPicked: (fn) => {
    const listener = (_e, info) => fn(info);
    ipcRenderer.on('comment-picked', listener);
    return () => ipcRenderer.removeListener('comment-picked', listener);
  },
  onSnapshot: (fn) => {
    const listener = (_e, s) => fn(s);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  },
});
