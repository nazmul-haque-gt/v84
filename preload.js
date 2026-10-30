'use strict';
// Runs in the sandboxed preload context. Exposes a small, fixed API to the page; nothing else from Node/Electron.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('pdfEditorNative', {
  isDesktop: true,
  pickOpen: () => ipcRenderer.invoke('pick-open'),
  pickSave: (suggestedName) => ipcRenderer.invoke('pick-save', suggestedName),
  readFile: (p) => ipcRenderer.invoke('read-file', p),
  writeFile: (p, bytes) => ipcRenderer.invoke('write-file', p, bytes),
  grantDrop: (p) => ipcRenderer.invoke('grant-drop', p),
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
  fetchImage: (url) => ipcRenderer.invoke('fetch-image', url),
  fetchPageImage: (url) => ipcRenderer.invoke('fetch-page-image', url),
  openAttachment: (name, bytes) => ipcRenderer.invoke('open-attachment', name, bytes),
  onOpenPdf: (cb) => { ipcRenderer.on('open-pdf', (_event, info) => { try { cb(info); } catch (e) { console.error(e); } }); },
  setTitleBarColors: (color, symbolColor) => ipcRenderer.invoke('set-titlebar-colors', color, symbolColor),
  recentList: () => ipcRenderer.invoke('recent-list'),
  recentOpen: (p) => ipcRenderer.invoke('recent-open', p),
  recentRemove: (p) => ipcRenderer.invoke('recent-remove', p),
  recentClear: () => ipcRenderer.invoke('recent-clear'),
  rendererReady: () => ipcRenderer.invoke('renderer-ready')
});
