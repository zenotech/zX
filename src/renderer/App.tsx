import React, { useState, useEffect, useRef } from 'react';
import { 
  Compass, Database, FileCode2, LineChart, 
  Terminal, FolderOpen, Settings, AlertTriangle, CheckCircle, 
  Activity, Server, FolderSync, Plus, ArrowRight, Sun, Moon,
  Folder, ArrowUp, ChevronRight, Home, Search
} from 'lucide-react';

import DataGrid from './components/DataGrid';
import HookEditor from './components/HookEditor';
import VisualizationDashboard from './components/VisualizationDashboard';
import TerminalPanel from './components/TerminalPanel';
import FileExplorer from './components/FileExplorer';

interface RecentProject {
  path: string;
  server: string;
}

const normalizeRecentProjects = (projects: any[]): RecentProject[] => {
  if (!projects) return [];
  return projects.map(p => {
    if (typeof p === 'string') {
      return { path: p, server: 'Local' };
    }
    if (p && typeof p === 'object' && typeof p.path === 'string') {
      return { path: p.path, server: p.server || 'Local' };
    }
    return null;
  }).filter((p): p is RecentProject => p !== null);
};

export default function App() {
  const [authToken, setAuthToken] = useState<string>('');
  const [port, setPort] = useState<number>(8000);
  const [connectionType, setConnectionType] = useState<'Local' | 'Remote'>('Local');
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('connecting');
  const [sshHosts, setSshHosts] = useState<string[]>([]);
  const [selectedHost, setSelectedHost] = useState<string>('');
  
  const [activeProject, setActiveProject] = useState<string>('');
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [isEstablishingConnection, setIsEstablishingConnection] = useState<boolean>(true);
  
  const [activeView, setActiveView] = useState<'grid' | 'editor' | 'dashboard' | 'terminal' | 'explorer'>('grid');
  const [running, setRunning] = useState<boolean>(false);
  const [hookStage, setHookStage] = useState<string>('');
  
  // UI Modals
  const [showProjectModal, setShowProjectModal] = useState<boolean>(true);
  const [newProjectPath, setNewProjectPath] = useState<string>('');
  const [projectError, setProjectError] = useState<string>('');

  // Template deployment states
  const [templates, setTemplates] = useState<{ id: string; name: string; description: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  // Remote file browser states
  const [showRemoteBrowser, setShowRemoteBrowser] = useState<boolean>(false);
  const [remoteBrowserPath, setRemoteBrowserPath] = useState<string>('');
  const [remoteBrowserDirs, setRemoteBrowserDirs] = useState<string[]>([]);
  const [remoteBrowserLoading, setRemoteBrowserLoading] = useState<boolean>(false);
  const [remoteBrowserError, setRemoteBrowserError] = useState<string>('');

  const loadRemoteDirectories = async (path?: string) => {
    setRemoteBrowserLoading(true);
    setRemoteBrowserError('');
    try {
      const endpoint = path ? `/api/explorer/browse?path=${encodeURIComponent(path)}` : '/api/explorer/browse';
      const data = await apiCall(endpoint);
      if (data) {
        setRemoteBrowserPath(data.current_path);
        setRemoteBrowserDirs(data.directories || []);
      }
    } catch (err: any) {
      console.error('Failed to load remote directories', err);
      setRemoteBrowserError(err.message || 'Failed to list directories.');
    } finally {
      setRemoteBrowserLoading(false);
    }
  };

  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  const wsRef = useRef<WebSocket | null>(null);
  const pendingProjectOpen = useRef<RecentProject | null>(null);

  // Apply theme to document element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Initialize from Electron IPC
  useEffect(() => {
    async function initBridge() {
      try {
        if (window.zxAPI) {
          const token = await window.zxAPI.getAuthToken();
          const bPort = await window.zxAPI.getBackendPort();
          const settings = await window.zxAPI.getSettings();
          const hosts = await window.zxAPI.getSSHHosts();
          
          setAuthToken(token);
          setPort(bPort);
          setRecentProjects(normalizeRecentProjects(settings.recentProjects || []));
          
          const lastConn = (settings.lastConnection as 'Local' | 'Remote') || 'Local';
          setConnectionType(lastConn);
          setSshHosts(hosts);
          if (hosts.length > 0) {
            const firstHost = hosts[0];
            setSelectedHost(firstHost);
            if (lastConn === 'Remote') {
              setConnectionStatus('disconnected');
            }
          }

          if (lastConn === 'Local') {
            const actualPort = await window.zxAPI.startLocalBackend();
            if (actualPort) {
              setPort(actualPort);
            }
          }
        }
      } catch (err) {
        console.error('Failed to initialize bridge', err);
      } finally {
        setIsEstablishingConnection(false);
      }
    }
    initBridge();
  }, []);

  // API Client Helper
  const apiCall = async (endpoint: string, method: string = 'GET', body?: any) => {
    try {
      const headers: HeadersInit = {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      };
      
      const config: RequestInit = {
        method,
        headers,
      };
      
      if (body) {
        config.body = JSON.stringify(body);
      }
      
      const response = await fetch(`http://127.0.0.1:${port}${endpoint}`, config);
      if (!response.ok) {
        let errorMsg = `API Error: ${response.statusText}`;
        try {
          const errorJson = await response.json();
          if (errorJson && errorJson.detail) {
            errorMsg = errorJson.detail;
          }
        } catch (_) {}
        throw new Error(errorMsg);
      }
      return await response.json();
    } catch (err: any) {
      console.error(`Failed API call ${endpoint}:`, err);
      throw err;
    }
  };

  // Keep trying to connect to FastAPI health endpoint to determine backend readiness
  useEffect(() => {
    if (!authToken || connectionStatus !== 'connecting' || isEstablishingConnection) return;
    
    let intervalId: any;
    
    const checkHealth = async () => {
      try {
        const res = await apiCall('/api/health');
        if (res.status === 'ok') {
          setConnectionStatus('connected');
          connectWebSocket();
          
          // Probe if a run is already active on connect
          try {
            const statusRes = await apiCall('/api/run/status');
            setRunning(statusRes.running);
            setHookStage(statusRes.hook_stage || '');
          } catch (e) {
            console.error('Failed to get initial runner status', e);
          }
        }
      } catch (err) {
        // Keep in connecting state
      }
    };
    
    checkHealth();
    intervalId = setInterval(checkHealth, 2000);
    
    return () => clearInterval(intervalId);
  }, [authToken, connectionStatus, port, isEstablishingConnection]);

  // Fetch templates when connected
  useEffect(() => {
    if (connectionStatus === 'connected' && authToken) {
      apiCall('/api/project/templates')
        .then((data) => {
          setTemplates(data || []);
        })
        .catch((err) => {
          console.error('Failed to load templates', err);
        });
    } else {
      setTemplates([]);
      setSelectedTemplate(null);
    }
  }, [connectionStatus, authToken, port]);

  // Cleanup active WebSocket on component unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  // Connect to Status WebSocket
  const connectWebSocket = () => {
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    
    const wsUrl = `ws://127.0.0.1:${port}/ws/status?token=${authToken}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connection_status') {
          console.log('WS Connection Verified');
        } else if (data.type === 'runner_status') {
          setRunning(data.running);
          setHookStage(data.hook_stage || '');
        }
      } catch (e) {
        console.error('Failed parsing ws message', e);
      }
    };
    
    ws.onclose = () => {
      console.log('WS Closed, reconnecting...');
      setTimeout(connectWebSocket, 3000);
    };
  };

  // Poll runner status only while a run is active
  useEffect(() => {
    if (connectionStatus !== 'connected' || !authToken || !running) return;

    let isActive = true;
    const pollStatus = async () => {
      try {
        const data = await apiCall('/api/run/status');
        if (isActive) {
          setRunning(data.running);
          setHookStage(data.hook_stage || '');
        }
      } catch (err) {
        // Silent catch to prevent console noise on quick connection swaps
      }
    };

    const intervalId = setInterval(pollStatus, 1500);
    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }, [connectionStatus, authToken, port, running]);

  const handleOpenProject = async (path: string, templateId?: string) => {
    if (!path.trim()) {
      setProjectError('Please specify a valid path.');
      return;
    }
    setProjectError('');
    try {
      const res = await apiCall('/api/project/open', 'POST', { 
        project_path: path,
        template_id: templateId || undefined
      });
      if (res.status === 'success') {
        setActiveProject(res.project_path);
        setShowProjectModal(false);
        
        // Save to Electron settings
        const currentServer = connectionType === 'Remote' ? selectedHost : 'Local';
        const updatedRecent = [
          { path: res.project_path, server: currentServer },
          ...recentProjects.filter(p => p.path !== res.project_path)
        ].slice(0, 10);
        setRecentProjects(updatedRecent);
        if (window.zxAPI) {
          window.zxAPI.saveSettings({
            recentProjects: updatedRecent,
            lastConnection: connectionType,
            windowWidth: window.innerWidth,
            windowHeight: window.innerHeight
          });
        }
      }
    } catch (err: any) {
      setProjectError(err.message || 'Failed to create/open project on target.');
    }
  };

  const handleSelectRecentProject = async (proj: RecentProject) => {
    const isCorrectServer = proj.server === 'Local' 
      ? (connectionType === 'Local' && connectionStatus === 'connected')
      : (connectionType === 'Remote' && selectedHost === proj.server && connectionStatus === 'connected');

    if (isCorrectServer) {
      handleOpenProject(proj.path);
    } else {
      pendingProjectOpen.current = proj;
      setProjectError('');

      if (proj.server === 'Local') {
        await toggleConnection('Local');
      } else {
        setConnectionType('Remote');
        setSelectedHost(proj.server);
        handleConnectSSH(proj.server);
      }
    }
  };

  // Automatically open project after connecting to the target server
  useEffect(() => {
    if (connectionStatus === 'connected' && pendingProjectOpen.current) {
      const proj = pendingProjectOpen.current;
      const isCorrectServer = proj.server === 'Local'
        ? connectionType === 'Local'
        : (connectionType === 'Remote' && selectedHost === proj.server);

      if (isCorrectServer) {
        pendingProjectOpen.current = null;
        handleOpenProject(proj.path);
      }
    }
  }, [connectionStatus, connectionType, selectedHost]);

  // Clean up pending project on connection errors
  useEffect(() => {
    if (connectionStatus === 'error' && pendingProjectOpen.current) {
      setProjectError(`Failed to connect to ${pendingProjectOpen.current.server} to open project.`);
      pendingProjectOpen.current = null;
    }
  }, [connectionStatus]);

  const handleConnectSSH = async (host: string) => {
    if (!window.zxAPI || !host) return;
    setConnectionStatus('connecting');
    setIsEstablishingConnection(true);
    try {
      const res = await window.zxAPI.connectSSHRemote(host);
      if (res.status === 'success') {
        console.log(`SSH Remote Connection success to ${host} on local forwarded port ${res.port}`);
        if (res.port) {
          setPort(res.port);
        }
      } else {
        setConnectionStatus('error');
      }
    } catch (err) {
      console.error('Failed to connect via SSH remote', err);
      setConnectionStatus('error');
    } finally {
      setIsEstablishingConnection(false);
    }
  };

  const toggleConnection = async (type: 'Local' | 'Remote') => {
    setConnectionType(type);
    if (type === 'Remote') {
      setConnectionStatus('disconnected');
    } else if (type === 'Local') {
      setConnectionStatus('connecting');
      setIsEstablishingConnection(true);
    }

    if (window.zxAPI) {
      try {
        const settings = await window.zxAPI.getSettings();
        window.zxAPI.saveSettings({ ...settings, lastConnection: type });
        if (type === 'Local') {
          const actualPort = await window.zxAPI.startLocalBackend();
          if (actualPort) {
            setPort(actualPort);
          }
        }
      } catch (err) {
        console.error('Failed in toggleConnection', err);
        if (type === 'Local') {
          setConnectionStatus('error');
        }
      } finally {
        if (type === 'Local') {
          setIsEstablishingConnection(false);
        }
      }
    } else {
      if (type === 'Local') {
        setIsEstablishingConnection(false);
      }
    }
  };


  return (
    <div className="layout-container">
      {/* HEADERBAR */}
      <header className="layout-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Compass size={22} className="animate-pulse" style={{ color: 'var(--accent-cyan)' }} />
          <span style={{ fontSize: '18px', fontWeight: 'bold', color: 'var(--text-primary)' }}>
            zX Exploration
          </span>
        </div>

        {/* Theme Toggle Button */}
        <div style={{ display: 'flex', alignItems: 'center', paddingRight: '4px' }}>
          <button
            onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            className="btn btn-sm p-0 d-flex align-items-center justify-content-center"
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{
              background: 'transparent',
              border: 'none',
              borderRadius: '50%',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              color: 'var(--text-primary)',
              transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
            }}
          >
            {theme === 'dark' ? (
              <Sun size={18} style={{ color: '#d4890e' }} />
            ) : (
              <Moon size={18} style={{ color: '#c4572a' }} />
            )}
          </button>
        </div>
      </header>

      {/* MAIN VIEW CONTENT */}
      <main className="layout-main">
        {/* SIDEBAR NAVIGATION */}
        <aside className="layout-sidebar">
          <div style={{ padding: '16px 12px', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button 
              onClick={() => setActiveView('grid')}
              className={`btn w-100 justify-content-start text-start d-flex align-items-center gap-2 mb-1 border-0 ${activeView === 'grid' ? 'btn-primary text-white shadow-sm' : 'btn-link text-secondary text-decoration-none'}`}
            >
              <Database size={16} />
              Parameter Grid
            </button>
            <button 
              onClick={() => setActiveView('editor')}
              className={`btn w-100 justify-content-start text-start d-flex align-items-center gap-2 mb-1 border-0 ${activeView === 'editor' ? 'btn-primary text-white shadow-sm' : 'btn-link text-secondary text-decoration-none'}`}
            >
              <FileCode2 size={16} />
              Python Hooks
            </button>
            <button 
              onClick={() => setActiveView('dashboard')}
              className={`btn w-100 justify-content-start text-start d-flex align-items-center gap-2 mb-1 border-0 ${activeView === 'dashboard' ? 'btn-primary text-white shadow-sm' : 'btn-link text-secondary text-decoration-none'}`}
            >
              <LineChart size={16} />
              Visualization
            </button>
            <button 
              onClick={() => setActiveView('terminal')}
              className={`btn w-100 justify-content-start text-start d-flex align-items-center gap-2 mb-1 border-0 ${activeView === 'terminal' ? 'btn-primary text-white shadow-sm' : 'btn-link text-secondary text-decoration-none'}`}
            >
              <Terminal size={16} />
              Split Terminal
            </button>
            <button 
              onClick={() => setActiveView('explorer')}
              className={`btn w-100 justify-content-start text-start d-flex align-items-center gap-2 mb-1 border-0 ${activeView === 'explorer' ? 'btn-primary text-white shadow-sm' : 'btn-link text-secondary text-decoration-none'}`}
            >
              <FolderSync size={16} />
              File Explorer
            </button>
          </div>
          
          {running && (
            <div className="p-3 border-top border-secondary bg-dark bg-opacity-25">
              <div className="d-flex align-items-center gap-2 text-info small">
                <div className="spinner-border spinner-border-sm text-info" role="status" style={{ width: '12px', height: '12px' }}></div>
                <span className="small">Running Stage: {hookStage || 'Initializing'}</span>
              </div>
            </div>
          )}
        </aside>

        {/* CONTENT WIDGETS */}
        <section className="layout-content">
          {activeView === 'grid' && (
            <div style={{ padding: '24px', flexGrow: 1, height: '100%', overflow: 'hidden' }}>
              <DataGrid 
                authToken={authToken}
                port={port}
                running={running}
                setRunning={setRunning}
                activeProject={activeProject}
                apiCall={apiCall}
              />
            </div>
          )}
          {activeView === 'editor' && (
            <div style={{ padding: '0', flexGrow: 1, height: '100%', overflow: 'hidden' }}>
              <HookEditor 
                activeProject={activeProject}
                apiCall={apiCall}
                theme={theme}
              />
            </div>
          )}
          {activeView === 'dashboard' && (
            <div style={{ padding: '24px', flexGrow: 1, height: '100%', overflow: 'hidden' }}>
              <VisualizationDashboard 
                authToken={authToken}
                port={port}
                activeProject={activeProject}
                running={running}
                apiCall={apiCall}
                theme={theme}
              />
            </div>
          )}
          {activeView === 'terminal' && (
            <div style={{ padding: '24px', flexGrow: 1, height: '100%', overflow: 'hidden' }}>
              <TerminalPanel 
                authToken={authToken}
                port={port}
                theme={theme}
              />
            </div>
          )}
          {activeView === 'explorer' && (
            <div style={{ padding: '0', flexGrow: 1, height: '100%', overflow: 'hidden' }}>
              <FileExplorer 
                activeProject={activeProject}
                apiCall={apiCall}
                theme={theme}
              />
            </div>
          )}
        </section>
      </main>

      {/* STATUSBAR */}
      <footer className="layout-statusbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Server size={12} style={{ color: connectionStatus === 'connected' ? 'var(--status-completed)' : 'var(--status-failed)' }} />
            Sidecar Server: 
            <span style={{ color: connectionStatus === 'connected' ? 'var(--status-completed)' : 'var(--status-pending)', fontWeight: 'bold' }}>
              {connectionStatus.toUpperCase()}
              {connectionStatus === 'connected' && (
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: 'normal', marginLeft: '6px' }}>
                  ({connectionType === 'Remote' ? `Remote SSH: ${selectedHost}` : 'Local'})
                </span>
              )}
            </span>
          </span>
          {activeProject && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FolderOpen size={12} style={{ color: 'var(--accent-cyan)' }} />
              Active Project: <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{activeProject}</span>
              <button 
                onClick={async () => {
                  setActiveProject('');
                  setConnectionStatus('disconnected');
                  if (window.zxAPI) {
                    await window.zxAPI.stopBackend();
                  }
                  setShowProjectModal(true);
                }} 
                className="btn btn-sm btn-outline-secondary py-0 px-2 ms-2" 
                style={{ fontSize: '11px', height: '22px' }}
              >
                Switch Space
              </button>
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {running && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-cyan)' }}>
              <Activity size={12} className="animate-pulse" />
              Exploration active: {hookStage}
            </span>
          )}
          <span style={{ color: 'var(--text-muted)' }}>zX Engine v0.1.0</span>
        </div>
      </footer>

      {/* PROJECT LOADING MODAL (GLASSMORPHISM) */}
      {showProjectModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: theme === 'light' ? 'rgba(0, 0, 0, 0.4)' : 'rgba(5, 6, 8, 0.85)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000, backdropFilter: 'blur(8px)' }}>
          <div className="glass-panel animate-slide-up" style={{ width: '480px', padding: '32px', border: `1px solid ${theme === 'light' ? 'var(--border-color)' : 'rgba(255,255,255,0.1)'}` }}>
            <h3 style={{ fontSize: '20px', fontWeight: '600', marginBottom: '12px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderOpen style={{ color: 'var(--accent-cyan)' }} /> Select zX Project Space
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '24px' }}>
              Create or choose a target directory where your CSV parameters, logs, execution directories, and Python hooks will be saved.
            </p>

            {/* TARGET ENVIRONMENT SELECTOR */}
            <div style={{ marginBottom: '24px', borderBottom: '1px solid var(--border-color)', paddingBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600, letterSpacing: '0.05em' }}>
                TARGET ENVIRONMENT
              </label>
              
              <div className="d-grid gap-2" style={{ gridTemplateColumns: '1fr 1fr', background: 'var(--bg-primary)', borderRadius: '8px', padding: '3px', border: '1px solid var(--border-color)', marginBottom: '12px' }}>
                <button 
                  onClick={() => toggleConnection('Local')}
                  className={`btn btn-sm d-flex align-items-center justify-content-center gap-2 py-2 ${connectionType === 'Local' ? 'btn-primary text-white shadow-sm' : 'btn-link text-secondary text-decoration-none'}`}
                  style={{ borderRadius: '6px' }}
                >
                  <Server size={14} />
                  Local Machine
                </button>
                <button 
                  onClick={() => toggleConnection('Remote')}
                  className={`btn btn-sm d-flex align-items-center justify-content-center gap-2 py-2 ${connectionType === 'Remote' ? 'btn-primary text-white shadow-sm' : 'btn-link text-secondary text-decoration-none'}`}
                  style={{ borderRadius: '6px' }}
                >
                  <FolderSync size={14} />
                  Remote SSH Server
                </button>
              </div>

              {/* CONNECTION STATUS & CONTROLS */}
              {connectionType === 'Local' ? (
                <div className="alert alert-success d-flex align-items-center gap-2 py-2 px-3 mb-0" style={{ border: 'none' }}>
                  <CheckCircle size={14} />
                  <span className="small fw-semibold">Connected to Local zX Sidecar</span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
                  <div style={{ display: 'flex', gap: '8px', width: '100%', alignItems: 'center' }}>
                    <select 
                      value={selectedHost}
                      onChange={(e) => {
                        setSelectedHost(e.target.value);
                        setConnectionStatus('disconnected');
                      }}
                      className="form-select form-select-sm"
                      style={{ flex: 1, minWidth: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
                    >
                      {sshHosts.length === 0 ? (
                        <option value="">No SSH Hosts found in ~/.ssh/config</option>
                      ) : (
                        sshHosts.map(h => <option key={h} value={h}>{h}</option>)
                      )}
                    </select>
                    <button 
                      onClick={() => handleConnectSSH(selectedHost)}
                      disabled={!selectedHost || connectionStatus === 'connecting'}
                      className="btn btn-sm btn-primary"
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      {connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
                    </button>
                  </div>

                  {/* Remote Status Alert */}
                  {connectionStatus === 'connecting' && (
                    <div className="alert alert-info d-flex align-items-center gap-2 py-2 px-3 mb-0" style={{ border: 'none' }}>
                      <div className="spinner-border spinner-border-sm text-info" role="status" style={{ width: '12px', height: '12px' }}></div>
                      <span className="small fw-semibold">
                        Bootstrapping remote environment on {selectedHost}...
                      </span>
                    </div>
                  )}
                  {connectionStatus === 'connected' && (
                    <div className="alert alert-success d-flex align-items-center gap-2 py-2 px-3 mb-0" style={{ border: 'none' }}>
                      <CheckCircle size={14} />
                      <span className="small fw-semibold">
                        Bootstrapping complete! Connected to {selectedHost}.
                      </span>
                    </div>
                  )}
                  {connectionStatus === 'error' && (
                    <div className="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 mb-0" style={{ border: 'none' }}>
                      <AlertTriangle size={14} />
                      <span className="small fw-semibold">
                        Failed to connect to {selectedHost}. Check SSH config.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
              <div>
                <label className="form-label text-secondary mb-1" style={{ fontSize: '12px' }}>
                  PROJECT DIRECTORY PATH
                </label>
                 <div className="d-flex gap-2 w-100 align-items-center">
                  <input 
                    type="text" 
                    placeholder={connectionType === 'Remote' ? "e.g. /home/user/my-zx-exploration" : "e.g. ~/my-zx-exploration"} 
                    value={newProjectPath} 
                    onChange={(e) => setNewProjectPath(e.target.value)}
                    disabled={connectionType === 'Remote' && connectionStatus !== 'connected'}
                    className="form-control form-control-sm"
                    style={{ flex: 1, minWidth: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
                  />
                  {window.zxAPI && (
                    <button
                      onClick={async () => {
                        if (connectionType === 'Local') {
                          try {
                            const selectedPath = await window.zxAPI.openDirectoryDialog();
                            if (selectedPath) {
                              setNewProjectPath(selectedPath);
                            }
                          } catch (err) {
                            console.error('Failed to open directory dialog', err);
                          }
                        } else if (connectionType === 'Remote') {
                          loadRemoteDirectories(newProjectPath || '');
                          setShowRemoteBrowser(true);
                        }
                      }}
                      disabled={connectionType === 'Remote' && connectionStatus !== 'connected'}
                      className="btn btn-sm btn-outline-secondary"
                      style={{ whiteSpace: 'nowrap' }}
                    >
                      Browse...
                    </button>
                  )}
                  <button 
                    onClick={() => handleOpenProject(newProjectPath, selectedTemplate || undefined)}
                    disabled={connectionStatus !== 'connected'}
                    className="btn btn-sm btn-primary d-flex align-items-center gap-1" 
                    style={{ whiteSpace: 'nowrap' }}
                  >
                    Open <ArrowRight size={14} />
                  </button>

                </div>
                {projectError && <div className="text-danger small mt-1">{projectError}</div>}

                {/* TEMPLATE PROJECT cards gallery */}
                {connectionStatus === 'connected' && templates.length > 0 && (
                  <div style={{ marginTop: '20px' }}>
                    <label className="form-label text-secondary mb-2" style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em' }}>
                      TEMPLATE PROJECT (OPTIONAL)
                    </label>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px', maxHeight: '180px', overflowY: 'auto', paddingRight: '4px' }}>
                      
                      {/* Blank / Default Card */}
                      <div 
                        onClick={() => setSelectedTemplate(null)}
                        style={{
                          border: selectedTemplate === null ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)',
                          background: selectedTemplate === null ? 'rgba(0, 180, 216, 0.04)' : 'var(--bg-primary)',
                          borderRadius: '8px',
                          padding: '12px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'flex',
                          flexDirection: 'column',
                          boxShadow: selectedTemplate === null ? '0 0 10px rgba(0, 180, 216, 0.1)' : 'none'
                        }}
                        className="template-card"
                      >
                        <span style={{ fontSize: '13px', fontWeight: '600', color: selectedTemplate === null ? 'var(--accent-cyan)' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <FolderOpen size={14} style={{ color: selectedTemplate === null ? 'var(--accent-cyan)' : 'var(--text-secondary)' }} /> Blank Project
                        </span>
                        <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                          Start with a clean slate and default Python hook templates.
                        </span>
                      </div>

                      {/* Dynamic Templates Cards */}
                      {templates.map(tmpl => {
                        const isSelected = selectedTemplate === tmpl.id;
                        return (
                          <div 
                            key={tmpl.id}
                            onClick={() => setSelectedTemplate(tmpl.id)}
                            style={{
                              border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid var(--border-color)',
                              background: isSelected ? 'rgba(0, 180, 216, 0.04)' : 'var(--bg-primary)',
                              borderRadius: '8px',
                              padding: '12px',
                              cursor: 'pointer',
                              transition: 'all 0.2s',
                              display: 'flex',
                              flexDirection: 'column',
                              boxShadow: isSelected ? '0 0 10px rgba(0, 180, 216, 0.1)' : 'none'
                            }}
                            className="template-card"
                          >
                            <span style={{ fontSize: '13px', fontWeight: '600', color: isSelected ? 'var(--accent-cyan)' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {tmpl.id === 'six_hump_camel' ? <Activity size={14} style={{ color: isSelected ? 'var(--accent-cyan)' : 'var(--text-secondary)' }} /> : <Compass size={14} style={{ color: isSelected ? 'var(--accent-cyan)' : 'var(--text-secondary)' }} />} {tmpl.name}
                            </span>
                            <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: '1.4' }}>
                              {tmpl.description}
                            </span>
                          </div>
                        );
                      })}

                    </div>
                  </div>
                )}

              </div>

              {recentProjects.length > 0 && (
                <div>
                  <label className="form-label text-secondary mb-1" style={{ fontSize: '12px' }}>
                    RECENT PROJECTS
                  </label>
                  <div className="list-group" style={{ maxHeight: '120px', overflowY: 'auto' }}>
                    {recentProjects.map((p, idx) => (
                      <button 
                        key={idx}
                        onClick={() => handleSelectRecentProject(p)}
                        className="list-group-item list-group-item-action d-flex align-items-center justify-content-between py-2 px-3 small border-secondary"
                        style={{ cursor: 'pointer' }}
                      >
                        <div className="d-flex align-items-center justify-content-between w-100 min-w-0">
                          <span className="text-truncate me-2 fw-semibold text-start" style={{ color: 'var(--text-primary)', flex: 1 }}>
                            {p.path}
                          </span>
                          <div className="d-flex align-items-center gap-2 flex-shrink-0 ms-2">
                            <span 
                              className="badge text-uppercase" 
                              style={{ 
                                fontSize: '10px', 
                                background: p.server === 'Local' ? 'rgba(196, 87, 42, 0.15)' : 'rgba(212, 137, 14, 0.15)',
                                color: p.server === 'Local' ? 'var(--accent-purple)' : 'var(--accent-cyan)',
                                border: `1px solid ${p.server === 'Local' ? 'rgba(196, 87, 42, 0.3)' : 'rgba(212, 137, 14, 0.3)'}`,
                                padding: '3px 6px',
                                borderRadius: '4px'
                              }}
                            >
                              {p.server === 'Local' ? 'Local' : p.server}
                            </span>
                            <ArrowRight size={12} className="text-primary" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="d-flex justify-content-end gap-2 border-top border-secondary pt-3 mt-2">
              <button 
                onClick={() => {
                  if (activeProject) setShowProjectModal(false);
                }} 
                className="btn btn-sm btn-outline-secondary"
                style={{ display: activeProject ? 'block' : 'none' }}
              >
                Cancel
              </button>
            </div>

            {/* REMOTE DIRECTORY BROWSER POPUP */}
            {showRemoteBrowser && (
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: theme === 'light' ? 'rgba(255, 255, 255, 0.98)' : 'rgba(10, 11, 16, 0.95)',
                borderRadius: '12px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                zIndex: 1100,
                backdropFilter: 'blur(12px)',
                animation: 'fadeIn 0.2s ease-out'
              }}>
                <h4 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FolderSync style={{ color: 'var(--accent-cyan)' }} size={18} /> Browse Remote Directories
                </h4>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                  Choose a remote project folder on <span className="text-info font-monospace">{selectedHost}</span>
                </p>

                {/* CURRENT PATH BREADCRUMB / PATH BAR */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <button
                    onClick={() => {
                      const lastSlash = remoteBrowserPath.lastIndexOf('/');
                      const parent = lastSlash <= 0 ? '/' : remoteBrowserPath.substring(0, lastSlash);
                      loadRemoteDirectories(parent);
                    }}
                    disabled={!remoteBrowserPath || remoteBrowserPath === '/'}
                    className="btn btn-sm btn-outline-secondary d-flex align-items-center justify-content-center"
                    style={{ width: '32px', height: '32px', padding: 0 }}
                    title="Go Up"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <input
                    type="text"
                    value={remoteBrowserPath}
                    onChange={(e) => setRemoteBrowserPath(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        loadRemoteDirectories(remoteBrowserPath);
                      }
                    }}
                    className="form-control form-control-sm"
                    style={{ flex: 1, minWidth: 0, background: 'var(--bg-primary)', border: '1px solid var(--border-color)', height: '32px', fontSize: '12px' }}
                  />
                  <button
                    onClick={() => loadRemoteDirectories(remoteBrowserPath)}
                    className="btn btn-sm btn-outline-secondary d-flex align-items-center justify-content-center"
                    style={{ width: '32px', height: '32px', padding: 0 }}
                    title="Go to Path"
                  >
                    <ArrowRight size={14} />
                  </button>
                </div>

                {/* DIRECTORIES LISTING */}
                <div style={{
                  flex: 1,
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  overflowY: 'auto',
                  padding: '8px',
                  marginBottom: '16px',
                  position: 'relative'
                }}>
                  {remoteBrowserLoading ? (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
                      display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
                      background: theme === 'light' ? 'rgba(250, 248, 245, 0.9)' : 'rgba(22, 18, 16, 0.8)', color: 'var(--text-secondary)', fontSize: '13px'
                    }}>
                      <div className="spinner-border spinner-border-sm text-primary" role="status" style={{ width: '14px', height: '14px' }}></div>
                      <span>Loading directories...</span>
                    </div>
                  ) : null}

                  {remoteBrowserError && (
                    <div className="text-danger small p-2" style={{ border: '1px solid rgba(239, 68, 68, 0.2)', background: 'rgba(239, 68, 68, 0.05)', borderRadius: '4px' }}>
                      <AlertTriangle size={14} className="me-1 d-inline-block" style={{ verticalAlign: 'text-bottom' }} />
                      {remoteBrowserError}
                    </div>
                  )}

                  {!remoteBrowserLoading && !remoteBrowserError && remoteBrowserDirs.length === 0 && (
                    <div className="text-muted small text-center py-4">
                      No subdirectories found.
                    </div>
                  )}

                  {!remoteBrowserLoading && !remoteBrowserError && remoteBrowserDirs.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {remoteBrowserDirs.map((dirName) => {
                        const nextPath = remoteBrowserPath.endsWith('/') ? `${remoteBrowserPath}${dirName}` : `${remoteBrowserPath}/${dirName}`;
                        const isSelected = remoteBrowserPath === nextPath;
                        return (
                          <div
                            key={dirName}
                            onDoubleClick={() => {
                              loadRemoteDirectories(nextPath);
                            }}
                            onClick={() => {
                              setRemoteBrowserPath(nextPath);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                              padding: '6px 10px',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontSize: '13px',
                              color: 'var(--text-primary)',
                              background: isSelected ? 'rgba(212, 137, 14, 0.08)' : 'transparent',
                              borderLeft: isSelected ? '2px solid var(--accent-cyan)' : '2px solid transparent',
                              transition: 'all 0.15s ease'
                            }}
                            className="remote-dir-item"
                          >
                            <Folder size={14} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
                            <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{dirName}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* BOTTOM BUTTONS */}
                <div className="d-flex justify-content-end gap-2 border-top border-secondary pt-3">
                  <button
                    onClick={() => setShowRemoteBrowser(false)}
                    className="btn btn-sm btn-outline-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setNewProjectPath(remoteBrowserPath);
                      setShowRemoteBrowser(false);
                    }}
                    className="btn btn-sm btn-primary"
                  >
                    Select Folder
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
