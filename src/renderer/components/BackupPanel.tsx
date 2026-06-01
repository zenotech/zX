import React, { useState, useEffect } from 'react';
import { 
  History, ShieldAlert, CheckCircle2, AlertTriangle, 
  FolderSync, ArrowRight, Save, Eye, EyeOff, RotateCcw, 
  CheckSquare, Square, Trash2, FileText, ChevronDown, ChevronUp
} from 'lucide-react';

interface GitFile {
  path: string;
  status: string;
}

interface Backup {
  hash: string;
  date: string;
  description: string;
}

interface BackupPanelProps {
  activeProject: string;
  apiCall: (endpoint: string, method?: string, body?: any) => Promise<any>;
  theme: 'dark' | 'light';
}

export default function BackupPanel({ activeProject, apiCall, theme }: BackupPanelProps) {
  const [gitStatus, setGitStatus] = useState<{ initialized: boolean; files: GitFile[]; has_gitignore: boolean } | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [gitignoreContent, setGitignoreContent] = useState<string>('');
  
  // UI interactive states
  const [selectedFiles, setSelectedFiles] = useState<{ [key: string]: boolean }>({});
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [showGitignore, setShowGitignore] = useState<boolean>(false);
  const [gitignoreInput, setGitignoreInput] = useState<string>('');
  
  // Modals & alerts
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [showConfirmRestore, setShowConfirmRestore] = useState<Backup | null>(null);

  // Fetch status and log
  const loadGitData = async () => {
    setError('');
    try {
      const statusData = await apiCall('/api/git/status');
      setGitStatus(statusData);

      if (statusData && statusData.initialized) {
        // Fetch backup history log
        const logData = await apiCall('/api/git/log');
        setBackups(logData.backups || []);

        // Load gitignore content
        const ignoreData = await apiCall('/api/git/gitignore');
        setGitignoreContent(ignoreData.content || '');
        setGitignoreInput(ignoreData.content || '');

        // Pre-check changed files
        const initialSelected: { [key: string]: boolean } = {};
        statusData.files.forEach((f: GitFile) => {
          // Pre-select zx_database, zx_state, and hooks files
          const lowerPath = f.path.toLowerCase();
          if (
            lowerPath.includes('zx_database.csv') || 
            lowerPath.includes('zx_state.json') || 
            lowerPath.startsWith('hooks/')
          ) {
            initialSelected[f.path] = true;
          } else {
            initialSelected[f.path] = false;
          }
        });
        setSelectedFiles(initialSelected);
      }
    } catch (err: any) {
      console.error('Failed to load git status/log', err);
      setError(err.message || 'Failed to connect to Git sidecar backup service.');
    }
  };

  useEffect(() => {
    if (activeProject) {
      loadGitData();
    }
  }, [activeProject]);

  const handleInitialize = async () => {
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      const res = await apiCall('/api/git/init', 'POST');
      if (res.status === 'success') {
        setSuccess('Git Backup System initialized successfully!');
        await loadGitData();
      }
    } catch (err: any) {
      setError(err.message || 'Initialization failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const filesToCommit = Object.keys(selectedFiles).filter(f => selectedFiles[f]);
    if (filesToCommit.length === 0) {
      setError('Please select at least one file to backup.');
      return;
    }

    if (!commitMessage.trim()) {
      setError('Please specify a description for the backup.');
      return;
    }

    setLoading(true);
    try {
      const res = await apiCall('/api/git/commit', 'POST', {
        files: filesToCommit,
        message: commitMessage.trim()
      });
      if (res.status === 'success') {
        setSuccess('Backup created successfully!');
        setCommitMessage('');
        await loadGitData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create backup.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGitignore = async () => {
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await apiCall('/api/git/gitignore', 'POST', {
        content: gitignoreInput
      });
      if (res.status === 'success') {
        setSuccess('.gitignore file updated successfully!');
        setGitignoreContent(gitignoreInput);
        await loadGitData();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save .gitignore.');
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (backup: Backup) => {
    setLoading(true);
    setError('');
    setSuccess('');
    setShowConfirmRestore(null);
    try {
      const res = await apiCall('/api/git/restore', 'POST', {
        commit_hash: backup.hash
      });
      if (res.status === 'success') {
        setSuccess(`Workspace successfully restored to backup of "${backup.description}"! Re-syncing database...`);
        
        // Reload whole app to seamlessly fetch updated files, database rows, hooks & state configs
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      }
    } catch (err: any) {
      setError(err.message || 'Revert operation failed.');
      setLoading(false);
    }
  };

  const toggleSelectFile = (path: string) => {
    setSelectedFiles(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  };

  const toggleSelectAll = () => {
    if (!gitStatus) return;
    const allChecked = gitStatus.files.every(f => selectedFiles[f.path]);
    const nextState: { [key: string]: boolean } = {};
    gitStatus.files.forEach(f => {
      nextState[f.path] = !allChecked;
    });
    setSelectedFiles(nextState);
  };

  const getStatusColorClass = (status: string) => {
    switch (status) {
      case 'M': return 'badge-status pending';
      case '??': return 'badge-status running';
      case 'D': return 'badge-status failed';
      default: return 'badge-status';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'M': return 'Modified';
      case '??': return 'Untracked';
      case 'D': return 'Deleted';
      default: return status;
    }
  };

  if (!gitStatus) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', padding: '40px', color: 'var(--text-secondary)' }}>
        <div className="spinner-border spinner-border-sm text-info me-2" role="status"></div>
        <span>Connecting to Backup Service...</span>
      </div>
    );
  }

  // Not Initialized State
  if (!gitStatus.initialized) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '40px', textAlign: 'center', overflowY: 'auto' }}>
        <div className="glass-panel animate-slide-up" style={{ maxWidth: '540px', padding: '36px', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
          <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: 'rgba(212, 137, 14, 0.1)', display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--accent-cyan)' }}>
            <FolderSync size={32} />
          </div>
          <h3 style={{ fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)' }}>
            Initialize Git Workspace Backup
          </h3>
          <p style={{ fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            A Git repository was not found in this project workspace. 
            Initialize the backup system to easily take snapshots, version control hooks/shared states, and rollback any unwanted database deletions.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', fontSize: '13px', color: 'var(--text-muted)', textAlign: 'left', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <span style={{ display: 'flex', gap: '8px' }}><CheckCircle2 size={15} style={{ color: 'var(--status-completed)', flexShrink: 0, marginTop: '2px' }} /> <strong>Version Control database & state</strong> (revert parameter changes instantly)</span>
            <span style={{ display: 'flex', gap: '8px' }}><CheckCircle2 size={15} style={{ color: 'var(--status-completed)', flexShrink: 0, marginTop: '2px' }} /> <strong>Track Python hooks modifications</strong> (undo code experimental errors)</span>
            <span style={{ display: 'flex', gap: '8px' }}><CheckCircle2 size={15} style={{ color: 'var(--status-completed)', flexShrink: 0, marginTop: '2px' }} /> <strong>Sensible simulation ignoring</strong> (automatically excludes large `runs/` folders)</span>
          </div>

          {error && (
            <div className="alert alert-danger w-100 d-flex align-items-center gap-2 py-2 px-3 text-start border-0" style={{ fontSize: '13px' }}>
              <AlertTriangle size={14} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <button 
            onClick={handleInitialize} 
            disabled={loading}
            className="btn btn-cyan w-100 py-2 justify-content-center"
            style={{ fontWeight: 600, fontSize: '14px' }}
          >
            {loading ? 'Initializing Backup Repository...' : 'Initialize Git Backup'}
          </button>
        </div>
      </div>
    );
  }

  // Active Git Backup Panel Layout
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      
      {/* Top action and message bar */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-secondary)' }}>
        <div>
          <h3 style={{ fontSize: '16px', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <History size={18} style={{ color: 'var(--accent-cyan)' }} /> Workspace Backup Controller
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Git active repo: {activeProject}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={loadGitData} 
            className="btn btn-sm"
            style={{ fontSize: '12px', height: '30px' }}
            title="Refresh Git Status"
          >
            <RotateCcw size={13} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main scrolling columns panel */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', flexGrow: 1, overflow: 'hidden' }}>
        
        {/* LEFT COLUMN - Backup form and gitignore */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px', borderRight: '1px solid var(--border-color)' }}>
          
          {/* Alerts */}
          {error && (
            <div className="alert alert-danger d-flex align-items-center gap-2 py-2 px-3 border-0">
              <AlertTriangle size={15} style={{ flexShrink: 0 }} />
              <span className="small">{error}</span>
            </div>
          )}
          {success && (
            <div className="alert alert-success d-flex align-items-center gap-2 py-2 px-3 border-0">
              <CheckCircle2 size={15} style={{ flexShrink: 0 }} />
              <span className="small">{success}</span>
            </div>
          )}

          {/* Form to create backup */}
          <form onSubmit={handleCreateBackup} className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid var(--border-color)' }}>
            <h4 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <FolderSync size={15} style={{ color: 'var(--accent-cyan)' }} /> Stage & Backup Files
            </h4>

            {/* Changed files selector list */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  CHANGED WORKSPACE FILES ({gitStatus.files.length})
                </label>
                {gitStatus.files.length > 0 && (
                  <button 
                    type="button" 
                    onClick={toggleSelectAll} 
                    className="btn btn-sm p-0 text-decoration-none text-link" 
                    style={{ background: 'transparent', border: 'none', color: 'var(--accent-cyan)', fontSize: '11px' }}
                  >
                    {gitStatus.files.every(f => selectedFiles[f.path]) ? 'Deselect All' : 'Select All'}
                  </button>
                )}
              </div>

              {gitStatus.files.length === 0 ? (
                <div style={{ padding: '20px', background: 'var(--bg-secondary)', borderRadius: '6px', border: '1px solid var(--border-color)', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                  <CheckCircle2 size={24} style={{ color: 'var(--status-completed)', display: 'block', margin: '0 auto 8px' }} />
                  Your workspace is fully backed up. No changed files detected!
                </div>
              ) : (
                <div style={{ border: '1px solid var(--border-color)', borderRadius: '6px', overflow: 'hidden', background: 'var(--bg-primary)', maxHeight: '180px', overflowY: 'auto' }}>
                  {gitStatus.files.map(f => (
                    <div 
                      key={f.path} 
                      onClick={() => toggleSelectFile(f.path)}
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between', 
                        padding: '8px 12px', 
                        borderBottom: '1px solid var(--border-color)',
                        cursor: 'pointer',
                        background: selectedFiles[f.path] ? 'rgba(212, 137, 14, 0.02)' : 'transparent',
                      }}
                      className="explorer-node"
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                        {selectedFiles[f.path] ? (
                          <CheckSquare size={14} style={{ color: 'var(--accent-cyan)' }} />
                        ) : (
                          <Square size={14} style={{ color: 'var(--text-muted)' }} />
                        )}
                        <FileText size={13} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                        <span style={{ fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {f.path}
                        </span>
                      </div>
                      <span className={getStatusColorClass(f.status)} style={{ fontSize: '10px', padding: '1px 6px' }}>
                        {getStatusLabel(f.status)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Commit Message / Description */}
            <div>
              <label htmlFor="backup-desc" className="form-label" style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
                BACKUP DESCRIPTION (snapshot summary)
              </label>
              <textarea 
                id="backup-desc"
                rows={2}
                placeholder="e.g. Saved workspace configuration prior to Slurm iteration 2"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                disabled={gitStatus.files.length === 0}
                className="form-control w-100"
                style={{ resize: 'none', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', fontSize: '13px' }}
              />
            </div>

            <button 
              type="submit" 
              disabled={loading || gitStatus.files.length === 0}
              className="btn btn-cyan justify-content-center"
              style={{ fontWeight: 500 }}
            >
              {loading ? 'Creating Snapshot...' : 'Create Workspace Backup'}
            </button>
          </form>

          {/* GITIGNORE SECTION */}
          <div className="glass-panel" style={{ border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            <button 
              onClick={() => setShowGitignore(!showGitignore)}
              className="w-100 py-3 px-4 d-flex justify-content-between align-items-center"
              style={{ background: 'var(--bg-secondary)', border: 'none', color: 'var(--text-primary)', cursor: 'pointer', textAlign: 'left' }}
            >
              <span style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Save size={14} style={{ color: 'var(--text-secondary)' }} />
                Configure .gitignore exclusions
              </span>
              {showGitignore ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            </button>
            
            {showGitignore && (
              <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-primary)' }}>
                <p style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                  Customize which directories are ignored by git backups. Large simulation folders (`runs/`) are excluded by default to avoid huge backup size and slow commits.
                </p>
                <textarea 
                  rows={8}
                  value={gitignoreInput}
                  onChange={(e) => setGitignoreInput(e.target.value)}
                  className="form-control w-100"
                  style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', lineHeight: '1.4' }}
                />
                <button 
                  onClick={handleSaveGitignore} 
                  disabled={loading}
                  className="btn btn-sm align-self-end"
                  style={{ fontSize: '12px', padding: '6px 14px' }}
                >
                  <Save size={13} />
                  <span>Save .gitignore</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN - Timeline Backup History */}
        <div style={{ padding: '24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--bg-secondary)' }}>
          <h4 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.05em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <History size={14} style={{ color: 'var(--accent-purple)' }} /> BACKUP TIMELINE ({backups.length})
          </h4>

          {backups.length === 0 ? (
            <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              No snapshots taken yet. Use the selector on the left to capture your first workspace backup!
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', position: 'relative', paddingLeft: '14px', borderLeft: '1px solid var(--border-color)' }}>
              {backups.map((b, i) => (
                <div key={b.hash} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {/* Timeline dot */}
                  <div style={{ 
                    position: 'absolute', 
                    left: '-18.5px', 
                    top: '4px', 
                    width: '8px', 
                    height: '8px', 
                    borderRadius: '50%', 
                    background: i === 0 ? 'var(--accent-cyan)' : 'var(--text-muted)',
                    boxShadow: i === 0 ? '0 0 8px var(--accent-cyan-glow)' : 'none'
                  }} />

                  <div className="glass-panel" style={{ padding: '12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                      <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {b.hash.substring(0, 8)}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                        {new Date(b.date).toLocaleDateString()} {new Date(b.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    <p style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: 500, margin: '4px 0 10px', wordBreak: 'break-word', lineHeight: '1.4' }}>
                      {b.description}
                    </p>

                    <button 
                      onClick={() => setShowConfirmRestore(b)}
                      disabled={loading}
                      className="btn btn-sm py-1 px-2 border-0 w-100 justify-content-center text-danger"
                      style={{ 
                        fontSize: '11px', 
                        background: 'rgba(239, 68, 68, 0.06)',
                        height: '24px',
                        borderRadius: '4px',
                      }}
                    >
                      <RotateCcw size={11} />
                      <span>Undo Changes (Restore)</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* CONFIRM UNDO/RESTORE MODAL */}
      {showConfirmRestore && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0, 0, 0, 0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1050, backdropFilter: 'blur(4px)' }}>
          <div className="glass-panel animate-slide-up" style={{ width: '400px', padding: '24px', border: '1px solid var(--border-color)' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '10px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldAlert style={{ color: 'var(--status-failed)' }} /> Confirm Workspace Revert?
            </h3>
            
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '16px' }}>
              Are you sure you want to revert your database, shared state, and python hooks to the backup:
              <strong style={{ display: 'block', margin: '8px 0', padding: '6px 10px', background: 'var(--bg-secondary)', borderRadius: '4px', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                "{showConfirmRestore.description}" ({showConfirmRestore.hash.substring(0, 8)})
              </strong>
              This will overwrite all unstaged or modified changes in your currently tracked files. This operation cannot be undone.
            </p>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button 
                onClick={() => setShowConfirmRestore(null)} 
                className="btn btn-sm"
                style={{ fontSize: '12px', padding: '6px 14px' }}
              >
                Cancel
              </button>
              <button 
                onClick={() => handleRestore(showConfirmRestore)} 
                className="btn btn-sm btn-danger text-white"
                style={{ fontSize: '12px', padding: '6px 14px', background: 'var(--status-failed)' }}
              >
                Confirm Restore
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
