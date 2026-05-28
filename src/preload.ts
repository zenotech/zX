import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('zxAPI', {
  getAuthToken: () => ipcRenderer.invoke('get-auth-token'),
  getBackendPort: () => ipcRenderer.invoke('get-backend-port'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: any) => ipcRenderer.invoke('save-settings', settings),
  getSSHHosts: () => ipcRenderer.invoke('get-ssh-hosts'),
  connectSSHRemote: (host: string) => ipcRenderer.invoke('connect-ssh-remote', host),
  startLocalBackend: () => ipcRenderer.invoke('start-local-backend'),
  openDirectoryDialog: () => ipcRenderer.invoke('open-directory-dialog'),
  stopBackend: () => ipcRenderer.invoke('stop-backend'),
  runZmon: (activeProject: string, rowId: number) => ipcRenderer.invoke('run-zmon', activeProject, rowId),
});

