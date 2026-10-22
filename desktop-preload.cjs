const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('layaDesktop', Object.freeze({
  saveSession: (session, formats) => ipcRenderer.invoke('laya:save', session, formats),
  close: () => ipcRenderer.send('laya:close'),
}));
