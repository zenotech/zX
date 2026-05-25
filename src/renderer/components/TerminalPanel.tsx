import React, { useState, useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { Plus, Trash2, Maximize2, SplitSquareHorizontal, Columns, LayoutGrid, Terminal as TermIcon } from 'lucide-react';
import 'xterm/css/xterm.css';

interface TerminalPanelProps {
  authToken: string;
  port: number;
  theme: 'dark' | 'light';
}

interface TerminalInstance {
  id: string;
  name: string;
}

export default function TerminalPanel({ authToken, port, theme }: TerminalPanelProps) {
  const [instances, setInstances] = useState<TerminalInstance[]>([
    { id: 'term-1', name: 'Terminal 1' }
  ]);
  const [activeInstanceId, setActiveInstanceId] = useState<string>('term-1');

  const addInstance = () => {
    const nextId = `term-${Date.now()}`;
    const nextNum = instances.length + 1;
    setInstances([...instances, { id: nextId, name: `Terminal ${nextNum}` }]);
    setActiveInstanceId(nextId);
  };

  const removeInstance = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (instances.length === 1) return; // keep at least one
    const remaining = instances.filter(inst => inst.id !== id);
    setInstances(remaining);
    if (activeInstanceId === id) {
      setActiveInstanceId(remaining[0].id);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '16px', animation: 'slideUp 0.3s ease-out' }}>
      
      {/* PANEL CONTROL HEADER */}
      <div className="card p-3 mb-1 d-flex flex-row flex-wrap align-items-center justify-content-between gap-3 shadow-sm">
        <div>
          <h3 className="h6 text-white mb-0 d-flex align-items-center gap-2">
            <TermIcon size={18} /> Split-Pane Developer Terminal
          </h3>
          <p className="text-secondary small mb-0" style={{ fontSize: '11px' }}>General purpose interactive PTY shell sessions on the target environment.</p>
        </div>

        <div className="d-flex gap-2">
          <button 
            onClick={addInstance}
            className="btn btn-sm btn-primary d-flex align-items-center gap-1 text-white px-3" 
          >
            <Plus size={14} /> New Split
          </button>
        </div>
      </div>

      {/* TABS SELECTOR AND GRID VIEW */}
      <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: 0 }}>
        
        {/* TAB LIST */}
        <div className="nav nav-tabs border-bottom-0 bg-dark bg-opacity-50 px-2 pt-2 border border-secondary" style={{ borderTopLeftRadius: '8px', borderTopRightRadius: '8px', overflow: 'hidden' }}>
          {instances.map(inst => {
            const isActive = inst.id === activeInstanceId;
            return (
              <div 
                key={inst.id}
                onClick={() => setActiveInstanceId(inst.id)}
                className={`nav-link d-flex align-items-center gap-2 py-2 px-3 small border-bottom-0 ${
                  isActive ? 'active bg-dark text-white fw-bold border-secondary' : 'text-secondary border-transparent'
                }`}
                style={{ 
                  cursor: 'pointer',
                  borderTopLeftRadius: '6px',
                  borderTopRightRadius: '6px',
                  borderRight: '1px solid var(--border-color)'
                }}
              >
                <span>{inst.name}</span>
                {instances.length > 1 && (
                  <Trash2 
                    size={12} 
                    onClick={(e) => removeInstance(inst.id, e)}
                    className="text-muted hover-text-danger"
                    style={{ transition: 'color 0.2s', cursor: 'pointer' }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* TERMINALS VIEW BOX (Split Pane Layout Grid) */}
        <div style={{ flexGrow: 1, display: 'grid', gridTemplateColumns: instances.length > 1 ? 'repeat(auto-fit, minmax(400px, 1fr))' : '1fr', gap: '16px', minHeight: 0 }}>
          {instances.map(inst => (
            <div 
              key={inst.id}
              style={{ 
                display: inst.id === activeInstanceId || instances.length > 1 ? 'flex' : 'none',
                flexDirection: 'column',
                height: '100%'
              }}
            >
              <TerminalWindow 
                instanceId={inst.id} 
                authToken={authToken} 
                port={port} 
                isActive={inst.id === activeInstanceId}
                theme={theme}
              />
            </div>
          ))}
        </div>

      </div>

    </div>
  );
}

interface TerminalWindowProps {
  instanceId: string;
  authToken: string;
  port: number;
  isActive: boolean;
  theme: 'dark' | 'light';
}

function TerminalWindow({ instanceId, authToken, port, isActive, theme }: TerminalWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current || !authToken) return;

    // Initialize xterm
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'underline',
      theme: {
        background: theme === 'light' ? '#f8f9fa' : '#0d0e12',
        foreground: theme === 'light' ? '#0f172a' : '#e4f3fa',
        cursor: theme === 'light' ? '#0284c7' : '#00f0ff',
        selectionBackground: theme === 'light' ? 'rgba(2, 132, 199, 0.2)' : 'rgba(0, 240, 255, 0.2)',
        black: theme === 'light' ? '#cbd5e1' : '#151720',
        red: '#e63946',
        green: '#2ec4b6',
        yellow: '#f5a623',
        blue: theme === 'light' ? '#0284c7' : '#2a9d8f',
        magenta: '#9b5de5',
        cyan: theme === 'light' ? '#0284c7' : '#00f0ff',
        white: theme === 'light' ? '#0f172a' : '#dec9e9'
      },
      fontFamily: 'JetBrains Mono, Fira Code, var(--font-mono)',
      fontSize: 13,
      lineHeight: 1.2
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Establish WebSocket shell process connection
    const wsUrl = `ws://127.0.0.1:${port}/ws/terminal?token=${authToken}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      term.write('\r\n\x1b[1;36m*** Connected to zX Interactive Shell ***\x1b[0m\r\n\r\n');
      // Initial PTY size sync
      const dims = fitAddon.proposeDimensions();
      if (dims) {
        ws.send(JSON.stringify({
          type: 'resize',
          rows: dims.rows,
          cols: dims.cols
        }));
      }
    };

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    ws.onclose = () => {
      term.write('\r\n\x1b[1;31m*** Terminal connection closed ***\x1b[0m\r\n');
    };

    // User Keystroke listeners -> WebSockets
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'input',
          data: data
        }));
      }
    });

    // Resize listener
    const resizeObserver = new ResizeObserver(() => {
      if (termRef.current && fitAddonRef.current) {
        fitAddonRef.current.fit();
        const dims = fitAddonRef.current.proposeDimensions();
        if (dims && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'resize',
            rows: dims.rows,
            cols: dims.cols
          }));
        }
      }
    });
    
    if (containerRef.current.parentElement) {
      resizeObserver.observe(containerRef.current.parentElement);
    }

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
    };
  }, [authToken, port]);

  // Force resize refitting when tab becomes active
  useEffect(() => {
    if (isActive && fitAddonRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setTimeout(() => {
        fitAddonRef.current?.fit();
        const dims = fitAddonRef.current?.proposeDimensions();
        if (dims) {
          wsRef.current?.send(JSON.stringify({
            type: 'resize',
            rows: dims.rows,
            cols: dims.cols
          }));
        }
      }, 100);
    }
  }, [isActive]);

  // Dynamic terminal theme updates at runtime
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = {
        background: theme === 'light' ? '#f8f9fa' : '#0d0e12',
        foreground: theme === 'light' ? '#0f172a' : '#e4f3fa',
        cursor: theme === 'light' ? '#0284c7' : '#00f0ff',
        selectionBackground: theme === 'light' ? 'rgba(2, 132, 199, 0.2)' : 'rgba(0, 240, 255, 0.2)',
        black: theme === 'light' ? '#cbd5e1' : '#151720',
        red: '#e63946',
        green: '#2ec4b6',
        yellow: '#f5a623',
        blue: theme === 'light' ? '#0284c7' : '#2a9d8f',
        magenta: '#9b5de5',
        cyan: theme === 'light' ? '#0284c7' : '#00f0ff',
        white: theme === 'light' ? '#0f172a' : '#dec9e9'
      };
    }
  }, [theme]);

  return (
    <div className="card p-3 bg-dark border-secondary shadow-sm flex-grow-1" style={{ overflow: 'hidden', borderTopLeftRadius: 0, borderTopRightRadius: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="d-flex justify-content-between align-items-center mb-2 small text-muted font-monospace" style={{ fontSize: '11px' }}>
        <span>SHELL PTY: {instanceId}</span>
        <span className="text-success fw-bold">● Active</span>
      </div>
      <div 
        ref={containerRef} 
        className="w-100 h-100 flex-grow-1"
        style={{ minHeight: '280px', overflow: 'hidden' }} 
      />
    </div>
  );
}
