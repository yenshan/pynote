const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('kata', {
  list: () => ipcRenderer.invoke('problems:list'),
  create: title => ipcRenderer.invoke('problems:create', title),
  open: id => ipcRenderer.invoke('problems:open', id),
  save: (id, code) => ipcRenderer.invoke('problems:save', id, code),
  workspaceInfo: () => ipcRenderer.invoke('workspace:info'),
  chooseFolder: () => ipcRenderer.invoke('workspace:choose'),
  pythonWrite: (id, data) => ipcRenderer.invoke('python:write', id, data),
  pythonResize: (id, cols, rows) => ipcRenderer.invoke('python:resize', id, cols, rows),
  pythonStop: id => ipcRenderer.invoke('python:stop', id),
  codexConnect: () => ipcRenderer.invoke('codex:connect'),
  codexStatus: () => ipcRenderer.invoke('codex:status'),
  ask: (id, text, context, model, effort, source) => ipcRenderer.invoke('codex:ask', id, text, context, model, effort, source),
  stopAI: id => ipcRenderer.invoke('codex:interrupt', id),
  pythonSnapshot: id => ipcRenderer.invoke('python:snapshot', id),
  pythonLoad: (id, cols, rows) => ipcRenderer.invoke('python:load', id, cols, rows),
  pythonDiagnosticReport: id => ipcRenderer.invoke('python:diagnostic-report', id),
  pythonExplain: (id, token, model, effort) => ipcRenderer.invoke('python:explain', id, token, model, effort),
  reveal: id => ipcRenderer.invoke('problems:reveal', id),
  copyText: text => ipcRenderer.invoke('clipboard:write', text),
  closeReady: () => ipcRenderer.invoke('app:close-ready'),
  onEvent: callback => { const listener = (_, event) => callback(event); ipcRenderer.on('kata:event', listener); ipcRenderer.send('app:renderer-ready'); return () => ipcRenderer.removeListener('kata:event', listener); }
});
