import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { 
  Save, AlertCircle, CheckCircle2, RefreshCw, FileCode, Play,
  Sparkles, Copy, Check, Lock, Unlock, Settings, Trash2, HelpCircle, 
  ChevronRight, ArrowRight
} from 'lucide-react';

interface HookEditorProps {
  activeProject: string;
  apiCall: (endpoint: string, method?: string, body?: any) => Promise<any>;
  theme: 'dark' | 'light';
}

const HOOK_FILES = [
  { name: 'initialize.py', label: 'Initialization Hook', desc: 'Sets up initial grid parameters & shared state procedurally.' },
  { name: 'state.py', label: 'State Hook', desc: 'Customizes and validates updates to the shared global state dictionary.' },
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

  // Gemini AI Assistant State
  const [showAIPanel, setShowAIPanel] = useState<boolean>(false);
  const [apiKey, setApiKey] = useState<string>('');
  const [inputKey, setInputKey] = useState<string>('');
  const [showKeyConfig, setShowKeyConfig] = useState<boolean>(false);
  
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiLoading, setAiLoading] = useState<boolean>(false);
  const [aiResult, setAiResult] = useState<string>('');
  const [aiError, setAiError] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  
  const [aiActiveTab, setAiActiveTab] = useState<'generate' | 'autocomplete'>('generate');
  const [autocompleteSuggest, setAutocompleteSuggest] = useState<string>('');

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  // Load API Key from Shared State
  const fetchApiKey = async () => {
    if (!activeProject) return;
    try {
      const state = await apiCall('/api/state');
      if (state && state.GEMINI_API_KEY) {
        setApiKey(state.GEMINI_API_KEY);
        setInputKey(state.GEMINI_API_KEY);
      } else {
        setApiKey('');
        setInputKey('');
      }
    } catch (err) {
      console.error("Failed to load state for AI assistant", err);
    }
  };

  useEffect(() => {
    fetchApiKey();
  }, [activeProject]);

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputKey.trim()) return;
    try {
      setAiLoading(true);
      const res = await apiCall('/api/state/update', 'POST', {
        updates: { GEMINI_API_KEY: inputKey.trim() }
      });
      if (res.status === 'success') {
        setApiKey(inputKey.trim());
        setShowKeyConfig(false);
        setAiError('');
      } else {
        setAiError('Failed to save API key.');
      }
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || 'Error saving API key.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleClearApiKey = async () => {
    if (!window.confirm("Remove Gemini API Key from project state?")) return;
    try {
      setAiLoading(true);
      const res = await apiCall('/api/state/update', 'POST', {
        updates: { GEMINI_API_KEY: '' }
      });
      if (res.status === 'success') {
        setApiKey('');
        setInputKey('');
        setAiResult('');
        setAutocompleteSuggest('');
        setShowKeyConfig(false);
      }
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || 'Error clearing API key.');
    } finally {
      setAiLoading(false);
    }
  };

  // Load selected hook content
  const loadHook = async (hookName: string) => {
    setLoading(true);
    setErrorDetails(null);
    setSaveStatus('idle');
    setAiResult('');
    setAutocompleteSuggest('');
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
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Bind Cmd+S (macOS) / Ctrl+S (Windows/Linux)
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current();
    });
    
    // Bind Ctrl+S explicitly on macOS (WinCtrl maps to Ctrl on macOS)
    editor.addCommand(monaco.KeyMod.WinCtrl | monaco.KeyCode.KeyS, () => {
      handleSaveRef.current();
    });
  };

  const handleGenerateCode = async (promptText: string) => {
    if (!apiKey) return;
    setAiLoading(true);
    setAiError('');
    setAiResult('');
    try {
      const res = await apiCall('/api/hooks/ai/generate', 'POST', {
        hook_name: selectedHook.name,
        prompt: promptText,
        code: code,
        mode: 'generate'
      });
      if (res.status === 'success') {
        setAiResult(res.generated_code);
      } else {
        setAiError('Failed to generate code.');
      }
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || 'Failed to generate code from Gemini.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleAutocomplete = async () => {
    if (!apiKey || !editorRef.current) return;
    setAiLoading(true);
    setAiError('');
    setAutocompleteSuggest('');
    
    const position = editorRef.current.getPosition();
    const cursorLine = position ? position.lineNumber : null;
    const cursorColumn = position ? position.column : null;

    try {
      const res = await apiCall('/api/hooks/ai/generate', 'POST', {
        hook_name: selectedHook.name,
        code: code,
        mode: 'autocomplete',
        cursor_line: cursorLine,
        cursor_column: cursorColumn
      });
      if (res.status === 'success') {
        setAutocompleteSuggest(res.generated_code);
      } else {
        setAiError('Autocomplete failed.');
      }
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || 'Autocomplete suggestions failed.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleInsertAtCursor = (textToInsert: string) => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const selection = editor.getSelection();
    const range = new monaco.Range(
      selection.startLineNumber,
      selection.startColumn,
      selection.endLineNumber,
      selection.endColumn
    );
    
    const op = {
      identifier: { major: 1, minor: 1 },
      range: range,
      text: textToInsert,
      forceMoveMarkers: true
    };
    
    editor.executeEdits("gemini-ai", [op]);
    editor.focus();
  };

  const handleReplaceWholeFile = (newFullCode: string) => {
    const editor = editorRef.current;
    if (!editor) {
      setCode(newFullCode);
      setIsModified(true);
      return;
    }
    const model = editor.getModel();
    if (model) {
      const fullRange = model.getFullModelRange();
      editor.executeEdits("gemini-ai", [{
        identifier: { major: 1, minor: 1 },
        range: fullRange,
        text: newFullCode,
        forceMoveMarkers: true
      }]);
    }
    editor.focus();
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getPresetPills = () => {
    switch (selectedHook.name) {
      case 'initialize.py':
        return [
          { label: '📊 5-param Explore Grid', prompt: 'Create an initialization function that sets up a 5-parameter grid using numpy, with values evenly spaced, and returns a list of rows to evaluate.' },
          { label: '🔄 Seed Shared State', prompt: 'Write an initialization hook that seeds custom optimization parameters like max_iterations, learning_rate, and tolerance into the state dictionary.' }
        ];
      case 'state.py':
        return [
          { label: '🛡️ Range Validation', prompt: 'Write a state validation hook that checks if learning_rate is between 0.0 and 1.0, raising a ValueError if it is outside this range.' },
          { label: '✨ Auto-initialize iteration', prompt: 'Create a state hook that automatically sets current_iteration to 0 if it is not present in the global state.' }
        ];
      case 'preprocess.py':
        return [
          { label: '📝 Render config template', prompt: 'Write a preprocess hook that loads a template file, replaces variables like {pressure} and {temperature} from the database row, and writes it to the run_dir.' },
          { label: '📁 Create run subdirs', prompt: 'Create a preprocess hook that sets up separate inputs and outputs directories under run_dir.' }
        ];
      case 'launch.py':
        return [
          { label: '🐚 Run CLI process', prompt: 'Write a launch hook that executes a local simulation binary via subprocess.Popen, streams stdout to a log file, and waits for completion.' },
          { label: '🔧 Set env vars', prompt: 'Write a launch hook that reads variables from the state, sets them as shell environment variables, and launches the solver.' }
        ];
      case 'extract.py':
        return [
          { label: '🔍 Parse solver output', prompt: 'Write an extraction hook that reads the final solver log, parses lines matching "Residuals: [value]", and returns a dictionary with the final residual value.' },
          { label: '📈 Extract CSV metrics', prompt: 'Create an extraction hook that loads output.csv inside run_dir, calculates the mean force coefficient, and returns it as a results dict.' }
        ];
      case 'explore.py':
        return [
          { label: '🧠 Pandas next step', prompt: 'Write an explore hook that loads the master database as a pandas DataFrame, computes the gradient of cost with respect to inputs, and appends a new parameter row.' },
          { label: '🎲 Random search step', prompt: 'Create an explore hook that generates a new row by adding normal-distributed random noise to the parameters of the best performing run so far.' }
        ];
      case 'plot.py':
        return [
          { label: '📈 Scatter plot', prompt: 'Write a visualization hook that takes the database DataFrame, creates a Plotly 2D scatter figure plotting iteration vs cost, and returns it in a dictionary.' },
          { label: '📊 3D Surface map', prompt: 'Create a visualization hook that returns a dict containing a Plotly 3D mesh or surface plot of parameters X, Y vs cost.' }
        ];
      default:
        return [];
    }
  };

  return (
    <div style={{ 
      display: 'grid', 
      gridTemplateColumns: showAIPanel ? '260px 1fr 340px' : '260px 1fr', 
      height: '100%', 
      gap: '16px', 
      padding: '24px', 
      overflow: 'hidden', 
      animation: 'slideUp 0.3s ease-out',
      transition: 'grid-template-columns 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
    }}>
      <style>{`
        @keyframes slideLeft {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .preset-pill {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: rgba(255, 255, 255, 0.7);
          transition: all 0.2s ease;
          cursor: pointer;
          font-size: 11px;
          border-radius: 20px;
          display: inline-flex;
          align-items: center;
        }
        .preset-pill:hover {
          background: rgba(0, 188, 212, 0.1);
          border-color: rgba(0, 188, 212, 0.3);
          color: #00bcd4;
        }
        .ai-result-box {
          background: rgba(0, 0, 0, 0.3) !important;
          border: 1px solid rgba(255, 255, 255, 0.08) !important;
          font-family: 'JetBrains Mono', monospace !important;
          font-size: 12px !important;
          color: #e5c7a3 !important;
          max-height: 250px;
          overflow-y: auto;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .pulse-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background-color: #10b981;
          box-shadow: 0 0 8px #10b981;
          display: inline-block;
          animation: pulse 1.5s infinite;
        }
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
      `}</style>
      
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

      {/* MIDDLE CODE EDITOR PANEL */}
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

            {/* Gemini AI Toggle Button */}
            <button
              onClick={() => setShowAIPanel(!showAIPanel)}
              className={`btn btn-sm d-flex align-items-center gap-1 px-3 ${showAIPanel ? 'btn-cyan text-white shadow-sm' : 'btn-outline-secondary'}`}
              style={{ transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)', borderRadius: '6px' }}
              title="Toggle Gemini AI Coding Assistant"
            >
              <Sparkles size={14} className={showAIPanel ? 'text-white' : 'text-primary'} />
              <span className="fw-medium">AI Assistant</span>
            </button>

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

      {/* RIGHT SIDEBAR: GEMINI AI ASSISTANT DRAWER PANEL */}
      {showAIPanel && (
        <div className="card shadow-sm border border-secondary d-flex flex-column" style={{ 
          overflow: 'hidden', 
          background: theme === 'light' ? 'rgba(255, 255, 255, 0.95)' : 'rgba(26, 22, 20, 0.95)',
          backdropFilter: 'blur(10px)',
          borderLeft: '1px solid rgba(0, 188, 212, 0.25)',
          boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
          animation: 'slideLeft 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
          height: '100%'
        }}>
          {/* Sidebar Header */}
          <div className="card-header border-bottom border-secondary d-flex align-items-center justify-content-between py-2 px-3 bg-dark bg-opacity-25">
            <span className="d-flex align-items-center gap-2 text-white fw-bold" style={{ fontSize: '13px' }}>
              <Sparkles size={16} className="text-primary animate-pulse" />
              Gemini AI Assistant
            </span>
            
            {apiKey && (
              <div className="d-flex align-items-center gap-2">
                <span className="pulse-dot" title="Connected to Gemini API" />
                <button 
                  onClick={() => setShowKeyConfig(!showKeyConfig)}
                  className="btn btn-link text-secondary p-0 d-flex align-items-center"
                  title="Configure Gemini Settings"
                >
                  <Settings size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Sidebar Content */}
          <div className="card-body p-3 d-flex flex-column gap-3" style={{ overflowY: 'auto', flexGrow: 1 }}>
            
            {/* 1. API KEY CONFIGDRAWER */}
            {(!apiKey || showKeyConfig) ? (
              <div className="glass-panel p-3 border border-secondary bg-dark bg-opacity-10 rounded d-flex flex-column gap-3">
                <div>
                  <span className="fw-semibold text-white d-flex align-items-center gap-2 mb-1" style={{ fontSize: '13px' }}>
                    <Lock size={14} className="text-warning" />
                    Configure Gemini API Key
                  </span>
                  <span className="small text-muted lh-sm d-block" style={{ fontSize: '11px' }}>
                    Specified keys are stored locally in the project's Shared State (<code>zx_state.json</code>) and sent securely only to Google Gen AI.
                  </span>
                </div>
                
                <form onSubmit={handleSaveApiKey} className="d-flex flex-column gap-2">
                  <input
                    type="password"
                    placeholder="Enter GEMINI_API_KEY..."
                    value={inputKey}
                    onChange={(e) => setInputKey(e.target.value)}
                    className="form-control form-control-sm"
                    style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', fontSize: '12px' }}
                    disabled={aiLoading}
                  />
                  
                  <div className="d-flex gap-2">
                    <button
                      type="submit"
                      disabled={aiLoading || !inputKey.trim()}
                      className="btn btn-sm btn-cyan w-100 py-1 font-semibold"
                      style={{ fontSize: '11px' }}
                    >
                      {aiLoading ? 'Saving...' : 'Save API Key'}
                    </button>
                    
                    {apiKey && (
                      <button
                        type="button"
                        onClick={handleClearApiKey}
                        disabled={aiLoading}
                        className="btn btn-sm btn-outline-danger px-2 py-1"
                        title="Remove API Key"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </form>

                <div className="text-center">
                  <a 
                    href="https://aistudio.google.com/" 
                    target="_blank" 
                    rel="noreferrer"
                    className="small text-decoration-none text-info d-inline-flex align-items-center gap-1"
                    style={{ fontSize: '11px' }}
                  >
                    Get a key from Google AI Studio <ArrowRight size={10} />
                  </a>
                </div>
              </div>
            ) : null}

            {/* AI OPTIONS & MAIN WORKSPACE */}
            {apiKey && !showKeyConfig && (
              <>
                {/* Mode tabs */}
                <div className="nav nav-pills nav-fill bg-dark bg-opacity-50 p-1 rounded border border-secondary" style={{ flexShrink: 0 }}>
                  <button 
                    onClick={() => { setAiActiveTab('generate'); setAiError(''); }}
                    className={`nav-link py-1 px-2 border-0 rounded ${aiActiveTab === 'generate' ? 'active btn-primary text-white shadow-sm' : 'text-secondary'}`}
                    style={{ fontSize: '11px', cursor: 'pointer' }}
                  >
                    Generate Code
                  </button>
                  <button 
                    onClick={() => { setAiActiveTab('autocomplete'); setAiError(''); }}
                    className={`nav-link py-1 px-2 border-0 rounded ${aiActiveTab === 'autocomplete' ? 'active btn-primary text-white shadow-sm' : 'text-secondary'}`}
                    style={{ fontSize: '11px', cursor: 'pointer' }}
                  >
                    Autocomplete
                  </button>
                </div>

                {aiError && (
                  <div className="alert alert-danger py-2 px-3 small border-0 d-flex align-items-start gap-2 mb-0" style={{ fontSize: '11px' }}>
                    <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                    <span>{aiError}</span>
                  </div>
                )}

                {/* TAB 1: CODE GENERATION */}
                {aiActiveTab === 'generate' && (
                  <div className="d-flex flex-column gap-3">
                    <div className="d-flex flex-column gap-1">
                      <label className="text-secondary small fw-semibold" style={{ fontSize: '11px' }}>Describe What to Generate</label>
                      <textarea
                        rows={4}
                        placeholder="e.g., validate the learning rate is between 0.01 and 0.5..."
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        className="form-control form-control-sm"
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', fontSize: '12px' }}
                        disabled={aiLoading}
                      />
                    </div>

                    {/* Presets Row */}
                    <div className="d-flex flex-wrap gap-1.5 align-items-center">
                      <span className="text-secondary small me-1" style={{ fontSize: '10px' }}>Presets:</span>
                      {getPresetPills().map((pill, idx) => (
                        <span 
                          key={idx} 
                          onClick={() => { if (!aiLoading) { setAiPrompt(pill.prompt); handleGenerateCode(pill.prompt); } }}
                          className="preset-pill px-2.5 py-1"
                        >
                          {pill.label}
                        </span>
                      ))}
                    </div>

                    <button
                      onClick={() => handleGenerateCode(aiPrompt)}
                      disabled={aiLoading || !aiPrompt.trim()}
                      className="btn btn-sm btn-primary w-100 d-flex align-items-center justify-content-center gap-1.5 py-2 font-semibold"
                      style={{ fontSize: '12px' }}
                    >
                      {aiLoading ? (
                        <>
                          <div className="spinner-border spinner-border-sm text-white" role="status" style={{ width: '12px', height: '12px' }}></div>
                          Generating Python code...
                        </>
                      ) : (
                        <>
                          <Sparkles size={14} />
                          Generate Code
                        </>
                      )}
                    </button>

                    {/* Generation Results Display */}
                    {aiResult && (
                      <div className="d-flex flex-column gap-2 mt-2 card p-2 bg-dark bg-opacity-25 border border-secondary">
                        <div className="d-flex align-items-center justify-content-between">
                          <span className="small text-secondary fw-semibold font-monospace" style={{ fontSize: '10px' }}>PROPOSED PYTHON CODE:</span>
                          <div className="d-flex align-items-center gap-1.5">
                            <button
                              onClick={() => handleCopyToClipboard(aiResult)}
                              className="btn btn-sm btn-link text-secondary p-0"
                              title="Copy code"
                            >
                              {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                            </button>
                          </div>
                        </div>

                        <pre className="ai-result-box p-2 rounded mb-0 text-start">{aiResult}</pre>

                        <div className="d-flex gap-2">
                          <button
                            onClick={() => handleInsertAtCursor(aiResult)}
                            className="btn btn-sm btn-cyan text-white w-100 py-1.5"
                            style={{ fontSize: '11px' }}
                          >
                            Insert at Cursor
                          </button>
                          <button
                            onClick={() => handleReplaceWholeFile(aiResult)}
                            className="btn btn-sm btn-outline-secondary text-white w-100 py-1.5"
                            style={{ fontSize: '11px' }}
                          >
                            Replace Whole File
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 2: AUTOCOMPLETE */}
                {aiActiveTab === 'autocomplete' && (
                  <div className="d-flex flex-column gap-3">
                    <div className="glass-panel p-3 border border-secondary bg-dark bg-opacity-10 rounded">
                      <span className="fw-semibold text-white d-flex align-items-center gap-2 mb-1" style={{ fontSize: '12px' }}>
                        <HelpCircle size={13} className="text-secondary" />
                        Smart Code Continuation
                      </span>
                      <p className="text-muted lh-sm mb-0" style={{ fontSize: '11px', textAlign: 'justify' }}>
                        Place your typing cursor inside the Monaco editor where you wish to continue writing, then click below. 
                        Gemini will contextually analyze the prefix code and propose the next logical lines of code.
                      </p>
                    </div>

                    <button
                      onClick={handleAutocomplete}
                      disabled={aiLoading}
                      className="btn btn-sm btn-primary w-100 d-flex align-items-center justify-content-center gap-1.5 py-2 font-semibold"
                      style={{ fontSize: '12px' }}
                    >
                      {aiLoading ? (
                        <>
                          <div className="spinner-border spinner-border-sm text-white" role="status" style={{ width: '12px', height: '12px' }}></div>
                          Analyzing prefix & completing...
                        </>
                      ) : (
                        <>
                          <Sparkles size={14} />
                          Suggest Continuation
                        </>
                      )}
                    </button>

                    {/* Autocomplete Results Display */}
                    {autocompleteSuggest && (
                      <div className="d-flex flex-column gap-2 mt-2 card p-2 bg-dark bg-opacity-25 border border-secondary animate-fade-in">
                        <span className="small text-secondary fw-semibold font-monospace" style={{ fontSize: '10px' }}>SUGGESTED COMPLETION:</span>
                        <pre className="ai-result-box p-2 rounded mb-0 text-start">{autocompleteSuggest}</pre>
                        
                        <button
                          onClick={() => handleInsertAtCursor(autocompleteSuggest)}
                          className="btn btn-sm btn-cyan text-white w-100 py-1.5"
                          style={{ fontSize: '11px' }}
                        >
                          Accept & Insert Suggestion
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

