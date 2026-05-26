import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Save, AlertCircle, CheckCircle2, RefreshCw, FileCode, Play } from 'lucide-react';

interface HookEditorProps {
  activeProject: string;
  apiCall: (endpoint: string, method?: string, body?: any) => Promise<any>;
  theme: 'dark' | 'light';
}

const HOOK_FILES = [
  { name: 'initialize.py', label: 'Initialization Hook', desc: 'Sets up initial grid parameters & shared state procedurally.' },
  { name: 'preprocess.py', label: 'Pre-processing Hook', desc: 'Converts row inputs into configuration files inside run_dir.' },
  { name: 'launch.py', label: 'Launch Hook', desc: 'Executes the synchronous sequential CLI processes.' },
  { name: 'extract.py', label: 'Extraction Hook', desc: 'Parses CLI outputs in run_dir and returns dict of results.' },
  { name: 'explore.py', label: 'Exploration Hook', desc: 'Iterates and appends new parametric rows to CSV after batch runs.' },
  { name: 'plot.py', label: 'Visualization Hook', desc: 'Generates custom Plotly graphs from master database.' }
];

export default function HookEditor({ activeProject, apiCall, theme }: HookEditorProps) {
  const [selectedHook, setSelectedHook] = useState(HOOK_FILES[0]);
  const [code, setCode] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [isModified, setIsModified] = useState<boolean>(false);
  
  // Validation status
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'syntax_error' | 'error'>('idle');
  const [errorDetails, setErrorDetails] = useState<{ line: number, offset: number, message: string } | null>(null);

  // Load selected hook content
  const loadHook = async (hookName: string) => {
    setLoading(true);
    setErrorDetails(null);
    setSaveStatus('idle');
    try {
      const res = await apiCall(`/api/hooks/load/${hookName}`);
      setCode(res.content);
      setIsModified(false);
    } catch (err) {
      console.error('Failed loading hook script', err);
      setCode('# Failed loading hook. Ensure project path is open.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeProject) {
      loadHook(selectedHook.name);
    }
  }, [selectedHook, activeProject]);

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setCode(value);
      setIsModified(true);
      if (saveStatus === 'saved') setSaveStatus('idle');
    }
  };

  const handleSave = async () => {
    if (!activeProject) return;
    setSaveStatus('saving');
    setErrorDetails(null);
    try {
      const res = await apiCall('/api/hooks/save', 'POST', {
        name: selectedHook.name,
        content: code
      });
      if (res.valid) {
        setSaveStatus('saved');
        setIsModified(false);
      } else {
        setSaveStatus('syntax_error');
        setErrorDetails(res.error);
      }
    } catch (err) {
      setSaveStatus('error');
      console.error(err);
    }
  };

  // Reference to the latest handleSave function to avoid stale closures in Monaco commands
  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  const handleEditorDidMount = (editor: any, monaco: any) => {
    // Bind Cmd+S (macOS) / Ctrl+S (Windows/Linux)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current();
    });
    
    // Bind Ctrl+S explicitly on macOS (WinCtrl maps to Ctrl on macOS)
    editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current();
    });
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', height: '100%', gap: '16px', padding: '24px', overflow: 'hidden', animation: 'slideUp 0.3s ease-out' }}>
      
      {/* LEFT NAVIGATION COLUMN */}
      <div className="card p-3 shadow-sm d-flex flex-column gap-3" style={{ overflowY: 'auto' }}>
        <h4 className="text-secondary text-uppercase fw-semibold mb-1" style={{ fontSize: '12px', letterSpacing: '0.05em' }}>
          Python Hook Scripts
        </h4>
        
        <div className="list-group list-group-flush gap-1">
          {HOOK_FILES.map(hook => {
            const isActive = selectedHook.name === hook.name;
            return (
              <button
                key={hook.name}
                onClick={() => setSelectedHook(hook)}
                className={`list-group-item list-group-item-action d-flex flex-column align-items-start py-2 px-3 rounded-2 border-0 ${
                  isActive ? 'active btn-primary text-white shadow-sm' : 'text-secondary'
                }`}
                style={{ cursor: 'pointer' }}
              >
                <span className="fw-semibold d-flex align-items-center gap-2" style={{ fontSize: '13px' }}>
                  <FileCode size={14} className={isActive ? 'text-white' : 'text-secondary'} />
                  {hook.name}
                </span>
                <span className={`small mt-1 lh-sm ${isActive ? 'text-white-50' : 'text-muted'}`} style={{ fontSize: '11px' }}>
                  {hook.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT CODE EDITOR PANEL */}
      <div className="card shadow-sm d-flex flex-column" style={{ overflow: 'hidden' }}>
        
        {/* Editor Actions bar */}
        <div className="card-header border-bottom border-secondary d-flex align-items-center justify-content-between py-2 px-3 bg-dark bg-opacity-25">
          <div>
            <h3 className="h6 text-white mb-0">{selectedHook.name}</h3>
            <p className="text-secondary small mb-0" style={{ fontSize: '11px' }}>{selectedHook.desc}</p>
          </div>

          <div className="d-flex align-items-center gap-3">
            {/* Status alerts */}
            {saveStatus === 'saving' && (
              <div className="d-flex align-items-center gap-2 text-info small">
                <div className="spinner-border spinner-border-sm text-info" role="status" style={{ width: '12px', height: '12px' }}></div>
                <span className="small fw-medium">Validating...</span>
              </div>
            )}
            {saveStatus === 'saved' && (
              <span className="badge bg-success d-flex align-items-center gap-1 py-2 px-3 rounded-pill" style={{ fontSize: '11px' }}>
                <CheckCircle2 size={12} /> Syntax Validated
              </span>
            )}
            {saveStatus === 'syntax_error' && (
              <span className="badge bg-danger d-flex align-items-center gap-1 py-2 px-3 rounded-pill" style={{ fontSize: '11px' }}>
                <AlertCircle size={12} /> Syntax Error (Line {errorDetails?.line})
              </span>
            )}
            {isModified && saveStatus === 'idle' && (
              <span className="text-warning small fw-semibold font-monospace" style={{ fontSize: '11px' }}>
                ● Unsaved Changes
              </span>
            )}

            <button 
              onClick={handleSave} 
              className="btn btn-sm btn-primary d-flex align-items-center gap-1 text-white px-3"
              disabled={loading || !activeProject}
            >
              <Save size={14} /> Save Hook
            </button>
          </div>
        </div>

        {/* Monaco Editor Container */}
        <div style={{ flexGrow: 1, position: 'relative', background: theme === 'light' ? '#ffffff' : '#1a1614' }}>
          {loading ? (
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: theme === 'light' ? 'var(--bg-primary)' : '#0d0e12', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10, gap: '8px', color: 'var(--text-secondary)' }}>
              <div className="spinner-border spinner-border-sm text-primary" role="status"></div> Loading hook code...
            </div>
          ) : null}
          
          <Editor
            height="100%"
            defaultLanguage="python"
            theme={theme === 'light' ? 'light' : 'vs-dark'}
            value={code}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            options={{
              fontSize: 14,
              fontFamily: 'JetBrains Mono',
              minimap: { enabled: false },
              automaticLayout: true,
              tabSize: 4,
              insertSpaces: true,
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              glyphMargin: true
            }}
          />
        </div>

        {/* Bottom syntax logs terminal */}
        {saveStatus === 'syntax_error' && errorDetails && (
          <div className="alert alert-danger mb-0 border-0 rounded-0 d-flex flex-column gap-2" style={{ height: '140px', background: '#1c1210', borderTop: '1px solid var(--zui-danger)', padding: '16px', overflowY: 'auto' }}>
            <span className="fw-bold d-flex align-items-center gap-2 small text-danger">
              <AlertCircle size={14} /> PYTHON SYNTAX VERIFICATION FAILURE
            </span>
            <div className="font-monospace small text-danger bg-dark bg-opacity-50 p-2 rounded border border-danger border-opacity-10" style={{ color: '#fca3a8' }}>
              <div><strong>Error:</strong> {errorDetails.message}</div>
              <div className="mt-1"><strong>Location:</strong> Line {errorDetails.line}, Offset {errorDetails.offset}</div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
