// Preload script for Electron
// Provides a safe bridge between renderer and main process if needed
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true
});
