import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // File dialogs
  openFileDialog: (options: any) => ipcRenderer.invoke('dialog:open-file', options),
  saveFileDialog: (options: any) => ipcRenderer.invoke('dialog:save-file', options),

  // App info
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPaths: () => ipcRenderer.invoke('app:get-paths'),

  // Menu events
  onMenuNewProject: (callback: () => void) => {
    ipcRenderer.on('menu:new-project', callback);
    return () => ipcRenderer.removeListener('menu:new-project', callback);
  },
  onMenuOpenProject: (callback: () => void) => {
    ipcRenderer.on('menu:open-project', callback);
    return () => ipcRenderer.removeListener('menu:open-project', callback);
  },
  onMenuSave: (callback: () => void) => {
    ipcRenderer.on('menu:save', callback);
    return () => ipcRenderer.removeListener('menu:save', callback);
  },
  onMenuSaveAs: (callback: () => void) => {
    ipcRenderer.on('menu:save-as', callback);
    return () => ipcRenderer.removeListener('menu:save-as', callback);
  },
  onMenuExportBuild: (callback: () => void) => {
    ipcRenderer.on('menu:export-build', callback);
    return () => ipcRenderer.removeListener('menu:export-build', callback);
  },
  onMenuPlay: (callback: () => void) => {
    ipcRenderer.on('menu:play', callback);
    return () => ipcRenderer.removeListener('menu:play', callback);
  },
  onMenuStop: (callback: () => void) => {
    ipcRenderer.on('menu:stop', callback);
    return () => ipcRenderer.removeListener('menu:stop', callback);
  },
});
