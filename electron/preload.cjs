// Minimal, sandboxed bridge: the page can ask to quit or toggle full screen, nothing else.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cordite', {
  desktop: true,
  quit: () => ipcRenderer.send('cordite:quit'),
  fullscreen: () => ipcRenderer.send('cordite:fullscreen'),
});
