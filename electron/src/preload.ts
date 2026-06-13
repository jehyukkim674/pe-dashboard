import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('appUpdater', {
  check: () => ipcRenderer.invoke('updater:check'),
  install: () => ipcRenderer.invoke('updater:install'),
  restart: () => ipcRenderer.invoke('updater:restart'),
  openReleasePage: () => ipcRenderer.invoke('updater:openRelease'),
  onProgress: (cb: (percent: number) => void) => {
    const listener = (_e: IpcRendererEvent, percent: number) => cb(percent);
    ipcRenderer.on('updater:progress', listener);
    return () => ipcRenderer.removeListener('updater:progress', listener);
  },
});
