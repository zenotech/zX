/// <reference types="vite/client" />

export interface IZxAPI {
  getAuthToken: () => Promise<string>;
  getBackendPort: () => Promise<number>;
  getSettings: () => Promise<{
    recentProjects: any[];
    lastConnection: string;
    windowWidth: number;
    windowHeight: number;
  }>;
  saveSettings: (settings: any) => Promise<boolean>;
  getSSHHosts: () => Promise<string[]>;
  connectSSHRemote: (host: string) => Promise<{ status: string, host: string, port?: number }>;
  startLocalBackend: () => Promise<number>;
  openDirectoryDialog: () => Promise<string | null>;
  stopBackend: () => Promise<boolean>;
  runZmon: (activeProject: string, rowId: number) => Promise<{ status: string, isRemote?: boolean, port?: number, message?: string }>;
}

declare global {
  interface Window {
    zxAPI: IZxAPI;
  }
}

