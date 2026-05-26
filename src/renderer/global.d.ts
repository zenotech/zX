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
}

declare global {
  interface Window {
    zxAPI: IZxAPI;
  }
}

