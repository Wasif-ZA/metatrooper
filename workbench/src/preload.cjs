const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('troop', {
  view: (v) => ipcRenderer.invoke('view', v),
  call: (method, params) => ipcRenderer.invoke('call', method, params),
  pickFolder: () => ipcRenderer.invoke('pickFolder'),
  handback: (projectId) => ipcRenderer.invoke('handback', projectId),
  copyText: (text) => ipcRenderer.invoke('copyText', text),
  readText: () => ipcRenderer.invoke('readText'),
  restartCore: () => ipcRenderer.invoke('restartCore'),
  stopCore: () => ipcRenderer.invoke('stopCore'),
  openLogs: () => ipcRenderer.invoke('openLogs'),
  longtasks: (entries) => ipcRenderer.invoke('longtasks', entries),
  probe: (state) => ipcRenderer.invoke('probe', state),
  paneShow: (paneId, bounds) => ipcRenderer.invoke('paneShow', paneId, bounds),
  paneNavigate: (paneId, url) => ipcRenderer.invoke('paneNavigate', paneId, url),
  paneAct: (paneId, action, arg) => ipcRenderer.invoke('paneAct', paneId, action, arg),
  onPaneEvent: (fn) => {
    const listener = (_e, ev) => fn(ev);
    ipcRenderer.on('pane-event', listener);
    return () => ipcRenderer.removeListener('pane-event', listener);
  },
  paneMenu: (items, x, y) => ipcRenderer.invoke('paneMenu', items, x, y),
  panePick: (paneId) => ipcRenderer.invoke('panePick', paneId),
  panePickCancel: (paneId) => ipcRenderer.invoke('panePickCancel', paneId),
  commentSave: (c) => ipcRenderer.invoke('commentSave', c),
  commentDiffLine: (c) => ipcRenderer.invoke('commentDiffLine', c),
  commentFiles: (sessionId, files) => ipcRenderer.invoke('commentFiles', { session_id: sessionId, paths: Array.from(files || [], (f) => webUtils.getPathForFile(f)).filter(Boolean) }),
  git: (projectId, op, arg) => ipcRenderer.invoke('git', projectId, op, arg),
  handbackFile: (projectId, file) => ipcRenderer.invoke('handbackFile', projectId, file),
  snapshotImage: (file) => ipcRenderer.invoke('snapshotImage', file),
  onCommentPicked: (fn) => {
    const listener = (_e, info) => fn(info);
    ipcRenderer.on('comment-picked', listener);
    return () => ipcRenderer.removeListener('comment-picked', listener);
  },
  termAttach: (sessionId, cols, rows) => ipcRenderer.invoke('termAttach', sessionId, cols, rows),
  sessionDiff: (sessionId, scope) => ipcRenderer.invoke('sessionDiff', sessionId, scope),
  sessionDiffFile: (sessionId, file, scope) => ipcRenderer.invoke('sessionDiffFile', sessionId, file, scope),
  filePaths: (files) => Array.from(files || [], (f) => webUtils.getPathForFile(f)).filter(Boolean),
  uiSettings: () => ipcRenderer.invoke('uiSettings'),
  setTheme: (name) => ipcRenderer.invoke('setTheme', name),
  setApproval: (value) => ipcRenderer.invoke('setApproval', value),
  termInput: (sessionId, data) => ipcRenderer.invoke('termInput', sessionId, data),
  termResize: (sessionId, cols, rows) => ipcRenderer.invoke('termResize', sessionId, cols, rows),
  termAck: (sessionId, bytes) => ipcRenderer.invoke('termAck', sessionId, bytes),
  pasteImage: (sessionId) => ipcRenderer.invoke('pasteImage', sessionId),
  linkCheck: (sessionId, candidates) => ipcRenderer.invoke('linkCheck', sessionId, candidates),
  openLink: (target, line, col) => ipcRenderer.invoke('openLink', target, line, col),
  termDetach: (sessionId) => ipcRenderer.invoke('termDetach', sessionId),
  onTerm: (fn) => {
    const listener = (_e, sessionId, msg) => fn(sessionId, msg);
    ipcRenderer.on('term', listener);
    return () => ipcRenderer.removeListener('term', listener);
  },
  onSelectProject: (fn) => {
    const listener = (_e, id) => fn(id);
    ipcRenderer.on('select-project', listener);
    return () => ipcRenderer.removeListener('select-project', listener);
  },
  onOpenNeedsYou: (fn) => {
    const listener = (_e, id) => fn(id);
    ipcRenderer.on('open-needs-you', listener);
    return () => ipcRenderer.removeListener('open-needs-you', listener);
  },
  onSnapshot: (fn) => {
    const listener = (_e, s) => fn(s);
    ipcRenderer.on('snapshot', listener);
    return () => ipcRenderer.removeListener('snapshot', listener);
  },
});
