import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Square, Plus, Trash2, ShieldAlert, FileInput, 
  RefreshCw, CheckSquare, SquareCheck, RefreshCwOff, ShieldCheck, HelpCircle,
  Monitor
} from 'lucide-react';

interface DataGridProps {
  authToken: string;
  port: number;
  running: boolean;
  setRunning: (running: boolean) => void;
  activeProject: string;
  apiCall: (endpoint: string, method?: string, body?: any) => Promise<any>;
  theme: 'dark' | 'light';
}

export default function DataGrid({ authToken, port, running, setRunning, activeProject, apiCall, theme }: DataGridProps) {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [editingCell, setEditingCell] = useState<{ rowIdx: number, colKey: string } | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  
  // Execution options with localStorage persistence namespaced by activeProject
  const [execPreprocess, setExecPreprocess] = useState<boolean>(() => {
    const saved = localStorage.getItem(`zx_exec_preprocess_${activeProject}`);
    return saved !== null ? saved === 'true' : true;
  });
  const [execLaunch, setExecLaunch] = useState<boolean>(() => {
    const saved = localStorage.getItem(`zx_exec_launch_${activeProject}`);
    return saved !== null ? saved === 'true' : true;
  });
  const [execExtract, setExecExtract] = useState<boolean>(() => {
    const saved = localStorage.getItem(`zx_exec_extract_${activeProject}`);
    return saved !== null ? saved === 'true' : true;
  });
  const [execExplore, setExecExplore] = useState<boolean>(() => {
    const saved = localStorage.getItem(`zx_exec_explore_${activeProject}`);
    return saved !== null ? saved === 'true' : true;
  });
  const [forceRerun, setForceRerun] = useState<boolean>(() => {
    const saved = localStorage.getItem(`zx_force_rerun_${activeProject}`);
    return saved !== null ? saved === 'true' : false;
  });

  // Sync execution options to localStorage when changed
  useEffect(() => {
    if (activeProject) {
      localStorage.setItem(`zx_exec_preprocess_${activeProject}`, String(execPreprocess));
    }
  }, [execPreprocess, activeProject]);

  useEffect(() => {
    if (activeProject) {
      localStorage.setItem(`zx_exec_launch_${activeProject}`, String(execLaunch));
    }
  }, [execLaunch, activeProject]);

  useEffect(() => {
    if (activeProject) {
      localStorage.setItem(`zx_exec_extract_${activeProject}`, String(execExtract));
    }
  }, [execExtract, activeProject]);

  useEffect(() => {
    if (activeProject) {
      localStorage.setItem(`zx_exec_explore_${activeProject}`, String(execExplore));
    }
  }, [execExplore, activeProject]);

  useEffect(() => {
    if (activeProject) {
      localStorage.setItem(`zx_force_rerun_${activeProject}`, String(forceRerun));
    }
  }, [forceRerun, activeProject]);

  // Sync checkbox state when activeProject changes
  useEffect(() => {
    if (!activeProject) return;
    const pSaved = localStorage.getItem(`zx_exec_preprocess_${activeProject}`);
    setExecPreprocess(pSaved !== null ? pSaved === 'true' : true);

    const lSaved = localStorage.getItem(`zx_exec_launch_${activeProject}`);
    setExecLaunch(lSaved !== null ? lSaved === 'true' : true);

    const exSaved = localStorage.getItem(`zx_exec_extract_${activeProject}`);
    setExecExtract(exSaved !== null ? exSaved === 'true' : true);

    const esSaved = localStorage.getItem(`zx_exec_explore_${activeProject}`);
    setExecExplore(esSaved !== null ? esSaved === 'true' : true);

    const fSaved = localStorage.getItem(`zx_force_rerun_${activeProject}`);
    setForceRerun(fSaved !== null ? fSaved === 'true' : false);
  }, [activeProject]);

  // Close context menu on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Right-click Row Context Menu state
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, rowId: number } | null>(null);

  const handleRowContextMenu = (e: React.MouseEvent, rowId: number) => {
    e.preventDefault();
    
    const menuWidth = 160;
    const menuHeight = 82;
    let x = e.clientX;
    let y = e.clientY;
    
    // Boundary check
    if (x + menuWidth > window.innerWidth) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight) {
      y = window.innerHeight - menuHeight - 10;
    }
    
    setContextMenu({ x, y, rowId });
  };

  // Hover Popover States for zx_hook.log and explore_{iteration}.log
  const [popoverType, setPopoverType] = useState<'status' | 'iteration' | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<number | null>(null);
  const [hoveredIteration, setHoveredIteration] = useState<number | null>(null);
  const [showPopover, setShowPopover] = useState<boolean>(false);
  const [popoverCoords, setPopoverCoords] = useState<{ top: number, left: number } | null>(null);
  const [logContent, setLogContent] = useState<string>('');
  const [loadingLog, setLoadingLog] = useState<boolean>(false);

  const hideTimeoutRef = useRef<any>(null);
  const activeFetchRowIdRef = useRef<number | null>(null);
  const activeFetchIterationRef = useRef<number | null>(null);

  // Fetch zx_hook.log via REST API
  const fetchLog = async (rowId: number) => {
    setLoadingLog(true);
    setLogContent('');
    activeFetchRowIdRef.current = rowId;
    activeFetchIterationRef.current = null;
    
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/run/log/${rowId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (response.ok) {
        const text = await response.text();
        if (activeFetchRowIdRef.current === rowId) {
          setLogContent(text);
        }
      } else {
        if (activeFetchRowIdRef.current === rowId) {
          setLogContent(`Error fetching log: ${response.statusText}`);
        }
      }
    } catch (err: any) {
      if (activeFetchRowIdRef.current === rowId) {
        setLogContent(`Failed to load log: ${err.message || err}`);
      }
    } finally {
      if (activeFetchRowIdRef.current === rowId) {
        setLoadingLog(false);
      }
    }
  };

  // Fetch explore_{iteration}.log via REST API
  const fetchExploreLog = async (iteration: number) => {
    setLoadingLog(true);
    setLogContent('');
    activeFetchRowIdRef.current = null;
    activeFetchIterationRef.current = iteration;
    
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/run/explore-log/${iteration}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (response.ok) {
        const text = await response.text();
        if (activeFetchIterationRef.current === iteration) {
          setLogContent(text);
          setShowPopover(true);
        }
      } else {
        if (activeFetchIterationRef.current === iteration) {
          setShowPopover(false);
        }
      }
    } catch (err: any) {
      if (activeFetchIterationRef.current === iteration) {
        setShowPopover(false);
      }
    } finally {
      if (activeFetchIterationRef.current === iteration) {
        setLoadingLog(false);
      }
    }
  };

  // Live polling of logs for active running rows
  useEffect(() => {
    if (!showPopover || hoveredRowId === null || popoverType !== 'status') return;
    
    const hoveredRow = data.find(r => r._zx_row_id === hoveredRowId);
    if (hoveredRow?._zx_status !== 'running') return;
    
    const interval = setInterval(() => {
      fetchLog(hoveredRowId);
    }, 1500);
    
    return () => clearInterval(interval);
  }, [showPopover, hoveredRowId, data, popoverType]);

  // Clean up timeouts
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  // Handlers for dynamic coordinates, edge check, and hover timeout delay
  const handleStatusMouseEnter = (e: React.MouseEvent, rowId: number) => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    
    setHoveredRowId(rowId);
    setPopoverType('status');
    setShowPopover(true);
    fetchLog(rowId);
    
    const rect = e.currentTarget.getBoundingClientRect();
    const popoverWidth = 500;
    
    // Place to the left of the badge by default
    let left = rect.left - popoverWidth - 16;
    let top = rect.top;
    
    // Position boundaries checks
    if (left < 10) {
      left = rect.right + 16;
    }
    if (left + popoverWidth > window.innerWidth) {
      left = Math.max(10, window.innerWidth - popoverWidth - 20);
    }
    
    const popoverHeight = 350;
    if (top + popoverHeight > window.innerHeight) {
      top = Math.max(10, window.innerHeight - popoverHeight - 20);
    }
    
    setPopoverCoords({ top, left });
  };

  const handleStatusMouseLeave = () => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowPopover(false);
      setHoveredRowId(null);
      setPopoverType(null);
    }, 200);
  };

  const handleIterationMouseEnter = (e: React.MouseEvent, iteration: number) => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    
    if (iteration <= 0) {
      setShowPopover(false);
      return;
    }
    
    setHoveredIteration(iteration);
    setPopoverType('iteration');
    fetchExploreLog(iteration);
    
    const rect = e.currentTarget.getBoundingClientRect();
    const popoverWidth = 500;
    
    let left = rect.left - popoverWidth - 16;
    let top = rect.top;
    
    if (left < 10) {
      left = rect.right + 16;
    }
    if (left + popoverWidth > window.innerWidth) {
      left = Math.max(10, window.innerWidth - popoverWidth - 20);
    }
    
    const popoverHeight = 350;
    if (top + popoverHeight > window.innerHeight) {
      top = Math.max(10, window.innerHeight - popoverHeight - 20);
    }
    
    setPopoverCoords({ top, left });
  };

  const handleIterationMouseLeave = () => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowPopover(false);
      setHoveredIteration(null);
      setPopoverType(null);
    }, 200);
  };

  const handlePopoverMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  };

  const handlePopoverMouseLeave = () => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowPopover(false);
      setHoveredRowId(null);
      setHoveredIteration(null);
      setPopoverType(null);
    }, 200);
  };

  // Parsing lines to assign vibrant modern aesthetic text coloring
  const colorizeLogLine = (line: string) => {
    const lower = line.toLowerCase();
    let color = 'var(--text-primary)';
    let fontWeight = 'normal';
    
    if (lower.includes('error') || lower.includes('exception') || lower.includes('failed') || lower.includes('traceback')) {
      color = 'var(--status-failed)';
      fontWeight = 'bold';
    } else if (lower.includes('warning') || lower.includes('warn')) {
      color = 'var(--status-pending)';
    } else if (lower.includes('success') || lower.includes('completed') || lower.includes('successfully') || lower.includes('finished')) {
      color = 'var(--status-completed)';
    } else if (lower.includes('running') || lower.includes('start') || lower.includes('trigger') || lower.includes('launching')) {
      color = 'var(--accent-cyan)';
    }
    
    return { color, fontWeight };
  };


  const updateColumnsFromData = (db: any[]) => {
    if (db && db.length > 0) {
      // Exclude reserved columns from quick editable list but keep them for reference
      const allCols = Object.keys(db[0]);
      // Sort columns: user parameters first, then reserved _zx_ columns at the end
      const userCols = allCols.filter(c => !c.startsWith('_zx_'));
      const zxCols = allCols.filter(c => c.startsWith('_zx_'));
      setColumns([...userCols, ...zxCols]);
    }
  };

  // Fetch data
  const fetchData = async () => {
    if (!activeProject) return;
    try {
      const db = await apiCall('/api/database');
      setData(db);
      updateColumnsFromData(db);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchData();
    // Poll data during running state
    let interval: any;
    if (running) {
      interval = setInterval(fetchData, 1500);
    }
    return () => clearInterval(interval);
  }, [activeProject, running]);

  // Save changes back to DB
  const saveChanges = async (updatedData: any[]) => {
    try {
      await apiCall('/api/database/update', 'POST', { rows: updatedData });
      setData(updatedData);
    } catch (err) {
      console.error('Failed to save cell edit', err);
    }
  };

  const handleCellClick = (rowIdx: number, colKey: string, val: any) => {
    if (running) return; // Locked during run
    if (colKey.startsWith('_zx_')) return; // Can't edit system columns
    
    // Lock edits for completed rows
    const row = data[rowIdx];
    if (row && row._zx_status === 'completed') return;

    setEditingCell({ rowIdx, colKey });
    setEditValue(val !== null && val !== undefined ? String(val) : '');
  };

  const handleCellSave = () => {
    if (!editingCell) return;
    const { rowIdx, colKey } = editingCell;
    const updated = [...data];
    
    // Parse to number if numeric
    const isNum = !isNaN(Number(editValue)) && editValue.trim() !== '';
    updated[rowIdx][colKey] = isNum ? Number(editValue) : editValue;
    
    saveChanges(updated);
    setEditingCell(null);
  };

  const handleAddRow = () => {
    if (running) return;
    
    // Create new row with base column defaults
    const newRow: any = {};
    const nextId = data.length > 0 ? Math.max(...data.map(r => r._zx_row_id)) + 1 : 0;
    columns.forEach(col => {
      if (col === '_zx_row_id') {
        newRow[col] = nextId;
      } else if (col === '_zx_status') {
        newRow[col] = 'pending';
      } else if (col === '_zx_iteration') {
        newRow[col] = 0;
      } else if (col.startsWith('_zx_')) {
        newRow[col] = '';
      } else {
        newRow[col] = 0.0; // Default float
      }
    });

    const updated = [...data, newRow];
    saveChanges(updated);
  };

  const handleDelete = () => {
    if (running || data.length === 0) return;
    
    const isDeletingAll = selectedRows.length === 0 || selectedRows.length === data.length;
    
    if (isDeletingAll) {
      if (!window.confirm("Are you sure you want to delete all rows in the table? This cannot be undone.")) {
        return;
      }
      setSelectedRows([]);
      saveChanges([]);
    } else {
      const updated = data
        .filter(r => !selectedRows.includes(r._zx_row_id));
      
      setSelectedRows([]);
      saveChanges(updated);
    }
  };

  const handleCheckboxToggle = (rowId: number, e: React.MouseEvent) => {
    if (e.shiftKey && selectedRows.length > 0) {
      // Range selection
      const lastSelected = selectedRows[selectedRows.length - 1];
      const lastIdx = data.findIndex(r => r._zx_row_id === lastSelected);
      const clickIdx = data.findIndex(r => r._zx_row_id === rowId);
      if (lastIdx !== -1 && clickIdx !== -1) {
        const start = Math.min(lastIdx, clickIdx);
        const end = Math.max(lastIdx, clickIdx);
        const range: number[] = [];
        for (let i = start; i <= end; i++) {
          range.push(data[i]._zx_row_id);
        }
        setSelectedRows(Array.from(new Set([...selectedRows, ...range])));
      }
    } else {
      if (selectedRows.includes(rowId)) {
        setSelectedRows(selectedRows.filter(id => id !== rowId));
      } else {
        setSelectedRows([...selectedRows, rowId]);
      }
    }
  };

  const handleSelectAll = () => {
    if (selectedRows.length === data.length) {
      setSelectedRows([]);
    } else {
      setSelectedRows(data.map(r => r._zx_row_id));
    }
  };

  const handleTriggerInitialize = async () => {
    if (running) return;
    try {
      const res = await apiCall('/api/database/initialize', 'POST');
      setData(res);
      updateColumnsFromData(res);
    } catch (err) {
      alert('Initialization Hook failed! Check hook scripts.');
    }
  };

  const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/database/import`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        body: formData
      });
      if (response.ok) {
        const db = await response.json();
        setData(db);
        updateColumnsFromData(db);
        alert('CSV imported successfully!');
      } else {
        alert('Failed importing CSV');
      }
    } catch (err) {
      console.error(err);
    }
  };

  const triggerExecution = async (isDryRun: boolean, targetRowIds?: number[]) => {
    if (!activeProject) return;
    try {
      const selected = targetRowIds || (selectedRows.length > 0 ? selectedRows : data.map(r => r._zx_row_id));
      
      const hooksList = [];
      if (execPreprocess) hooksList.push('preprocessing');
      if (execLaunch) hooksList.push('launching');
      if (execExtract) hooksList.push('extracting');
      if (execExplore) hooksList.push('exploring');

      setRunning(true);

      await apiCall('/api/run/start', 'POST', {
        row_ids: selected,
        hooks: hooksList,
        dry_run: isDryRun,
        force: forceRerun
      });
    } catch (err) {
      console.error('Failed triggering run', err);
      setRunning(false);
    }
  };

  const triggerStop = async () => {
    try {
      await apiCall('/api/run/stop', 'POST');
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="d-flex flex-column h-100 gap-3" style={{ animation: 'slideUp 0.3s ease-out' }}>
      
      {/* GRID CONTROLS HEADER */}
      <div className="card p-3 mb-1 d-flex flex-row flex-wrap align-items-center justify-content-between gap-3 shadow-sm">
        
        {/* Left Actions: Data Manipulation */}
        <div className="d-flex align-items-center gap-2">
          <button 
            onClick={handleAddRow}
            className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" 
            disabled={running} 
            title="Insert a new row to grid"
          >
            <Plus size={14} /> Add Row
          </button>
          
          <button 
            onClick={handleDelete}
            className="btn btn-sm btn-outline-danger d-flex align-items-center gap-1" 
            disabled={running || data.length === 0}
            title={selectedRows.length > 0 ? "Delete selected rows" : "Delete all rows"}
          >
            <Trash2 size={14} /> 
            Delete
          </button>

          <div style={{ height: '20px', width: '1px', background: 'var(--border-color)', margin: '0 4px' }} />

          <button 
            onClick={handleTriggerInitialize}
            className="btn btn-sm btn-outline-warning d-flex align-items-center gap-1" 
            disabled={running}
            title="Procedurally generate rows via initialize.py"
          >
            <RefreshCw size={14} /> Init Hook
          </button>

          <button 
            onClick={() => fileInputRef.current?.click()}
            className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" 
            disabled={running}
            title="Import custom parameter CSV file"
          >
            <FileInput size={14} /> Import CSV
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleImportCSV} 
            accept=".csv" 
            style={{ display: 'none' }} 
          />
        </div>

        {/* Middle Checkboxes: Hook Selection */}
        <div className="d-flex align-items-center gap-3 px-3 py-2 bg-dark bg-opacity-25 rounded border border-secondary" style={{ fontSize: '13px' }}>
          <span className="text-secondary fw-semibold me-1">HOOK STAGES:</span>
          <div className="form-check form-check-inline mb-0">
            <input className="form-check-input" type="checkbox" id="preprocess-stage" checked={execPreprocess} onChange={() => setExecPreprocess(!execPreprocess)} disabled={running} style={{ cursor: 'pointer' }} />
            <label className="form-check-label text-light" htmlFor="preprocess-stage" style={{ cursor: 'pointer' }}>Preprocess</label>
          </div>
          <div className="form-check form-check-inline mb-0">
            <input className="form-check-input" type="checkbox" id="launch-stage" checked={execLaunch} onChange={() => setExecLaunch(!execLaunch)} disabled={running} style={{ cursor: 'pointer' }} />
            <label className="form-check-label text-light" htmlFor="launch-stage" style={{ cursor: 'pointer' }}>Launch</label>
          </div>
          <div className="form-check form-check-inline mb-0">
            <input className="form-check-input" type="checkbox" id="extract-stage" checked={execExtract} onChange={() => setExecExtract(!execExtract)} disabled={running} style={{ cursor: 'pointer' }} />
            <label className="form-check-label text-light" htmlFor="extract-stage" style={{ cursor: 'pointer' }}>Extract</label>
          </div>
          <div className="form-check form-check-inline mb-0">
            <input className="form-check-input" type="checkbox" id="explore-stage" checked={execExplore} onChange={() => setExecExplore(!execExplore)} disabled={running} style={{ cursor: 'pointer' }} />
            <label className="form-check-label text-light" htmlFor="explore-stage" style={{ cursor: 'pointer' }}>Explore Loop</label>
          </div>
        </div>

        {/* Right Actions: Execution Triggers */}
        <div className="d-flex align-items-center gap-2">
          <div className="form-check me-2 mb-0">
            <input className="form-check-input" type="checkbox" id="force-rerun" checked={forceRerun} onChange={() => setForceRerun(!forceRerun)} disabled={running} style={{ cursor: 'pointer' }} />
            <label className="form-check-label text-secondary small" htmlFor="force-rerun" style={{ cursor: 'pointer' }}>Force Re-run</label>
          </div>

          <span 
            title={running ? "Dry run disabled while loop is active" : (selectedRows.length === 0 ? "Select rows to run" : "Dry run chosen hooks without changing state")}
            className="d-inline-block"
          >
            <button 
              onClick={() => triggerExecution(true)}
              className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1" 
              disabled={running || selectedRows.length === 0}
            >
              <HelpCircle size={14} /> Dry Run
            </button>
          </span>

          {running ? (
            <button 
              onClick={triggerStop}
              className="btn btn-sm btn-danger d-flex align-items-center gap-1 px-3" 
            >
              <Square size={14} fill="#fff" /> Stop Loop
            </button>
          ) : (
            <span 
              title={selectedRows.length === 0 ? "Select rows to run" : ""}
              className="d-inline-block"
            >
              <button 
                onClick={() => triggerExecution(false)}
                className="btn btn-sm btn-primary d-flex align-items-center gap-1 px-3 text-white" 
                disabled={selectedRows.length === 0}
              >
                <Play size={14} fill="#fff" /> Start Run
              </button>
            </span>
          )}
        </div>

      </div>

      {/* PARAMETERS TABLE GRID */}
      <div className="glass-panel" style={{ flexGrow: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {data.length === 0 ? (
          <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', gap: '12px', padding: '40px' }}>
            <ShieldAlert size={48} style={{ color: 'var(--status-pending)' }} />
            <span style={{ fontSize: '16px', fontWeight: 500 }}>No Parametric Data Loaded</span>
            <span style={{ fontSize: '13px', textAlign: 'center', maxWidth: '320px' }}>
              Import a CSV parameter file or click **Init Hook** to procedurally create initial exploration vectors.
            </span>
          </div>
        ) : (
          <div style={{ overflow: 'auto', flexGrow: 1 }}>
            <table className="table table-hover table-striped align-middle mb-0 text-left" style={{ fontSize: '13px' }}>
              <thead>
                <tr className="table-dark" style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                  <th style={{ width: '48px', textAlign: 'center', padding: '12px' }}>
                    <input 
                      type="checkbox" 
                      className="form-check-input"
                      checked={selectedRows.length === data.length}
                      onChange={handleSelectAll}
                    />
                  </th>
                  {columns.map(col => (
                    <th 
                      key={col} 
                      style={{ 
                        padding: '12px 16px', 
                        color: col.startsWith('_zx_') ? 'var(--accent-purple)' : 'var(--text-primary)',
                        fontFamily: col.startsWith('_zx_') ? 'var(--font-sans)' : 'var(--font-mono)',
                        fontWeight: 600,
                        borderRight: '1px solid var(--border-color)'
                      }}
                    >
                      {col.replace('_zx_', '')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, rowIdx) => {
                  const isRowSelected = selectedRows.includes(row._zx_row_id);
                  const status = row._zx_status || 'pending';
                  
                  return (
                    <tr 
                      key={row._zx_row_id} 
                      className={isRowSelected ? 'table-primary bg-opacity-10' : ''}
                      style={{ 
                        transition: 'background 0.2s',
                        cursor: 'context-menu'
                      }}
                      onContextMenu={(e) => handleRowContextMenu(e, row._zx_row_id)}
                    >
                      <td style={{ textAlign: 'center', borderRight: '1px solid var(--border-color)', padding: '8px' }}>
                        <input 
                          type="checkbox" 
                          className="form-check-input"
                          checked={isRowSelected}
                          onClick={(e) => handleCheckboxToggle(row._zx_row_id, e)}
                          onChange={() => {}}
                        />
                      </td>
                      
                      {columns.map(col => {
                        const cellVal = row[col];
                        const isSystem = col.startsWith('_zx_');
                        const isEditing = editingCell?.rowIdx === rowIdx && editingCell?.colKey === col;
                        
                        return (
                           <td 
                            key={col} 
                            onClick={() => handleCellClick(rowIdx, col, cellVal)}
                            style={{ 
                              padding: '8px 16px', 
                              fontFamily: isSystem ? 'var(--font-sans)' : 'var(--font-mono)',
                              color: isSystem ? 'var(--text-secondary)' : 'var(--text-primary)',
                              borderRight: '1px solid var(--border-color)',
                              cursor: (running || isSystem || status === 'completed') ? 'default' : 'double-click'
                            }}
                          >
                            {isEditing ? (
                              <input 
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={handleCellSave}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleCellSave();
                                  if (e.key === 'Escape') setEditingCell(null);
                                }}
                                autoFocus
                                className="form-control form-control-sm py-0 px-2"
                                style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--accent-cyan)' }}
                              />
                            ) : (
                              col === '_zx_status' ? (
                                <span 
                                  className={`badge ${
                                    status === 'completed' ? 'bg-success' : 
                                    status === 'running' ? 'bg-info text-dark' : 
                                    status === 'failed' ? 'bg-danger' : 
                                    'bg-warning text-dark'
                                  } text-uppercase font-monospace`} 
                                  style={{ 
                                    fontSize: '11px', 
                                    padding: '4px 8px', 
                                    borderRadius: '12px',
                                    cursor: 'help'
                                  }}
                                  onMouseEnter={(e) => handleStatusMouseEnter(e, row._zx_row_id)}
                                  onMouseLeave={handleStatusMouseLeave}
                                >
                                  {status}
                                </span>
                              ) : col === '_zx_iteration' ? (
                                <span 
                                  style={{ 
                                    cursor: cellVal > 0 ? 'help' : 'default',
                                    textDecoration: cellVal > 0 ? 'underline dotted var(--accent-cyan)' : 'none',
                                    color: cellVal > 0 ? 'var(--accent-cyan)' : 'inherit',
                                    fontWeight: cellVal > 0 ? 'bold' : 'normal'
                                  }}
                                  onMouseEnter={(e) => handleIterationMouseEnter(e, Number(cellVal))}
                                  onMouseLeave={handleIterationMouseLeave}
                                >
                                  {cellVal}
                                </span>
                              ) : col === '_zx_error' && cellVal ? (
                                <span style={{ color: 'var(--status-failed)', fontSize: '11px', display: 'block', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cellVal}>
                                  {cellVal}
                                </span>
                              ) : (
                                cellVal !== null && cellVal !== undefined ? String(cellVal) : ''
                              )
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dynamic Hover Popover for logs */}
      {showPopover && (hoveredRowId !== null || hoveredIteration !== null) && (
        <div 
          className="glass-panel animate-slide-up"
          onMouseEnter={handlePopoverMouseEnter}
          onMouseLeave={handlePopoverMouseLeave}
          style={{
            position: 'fixed',
            top: popoverCoords?.top ?? 0,
            left: popoverCoords?.left ?? 0,
            width: '500px',
            maxHeight: '350px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.6)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            background: 'var(--bg-secondary)',
            padding: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
            <span style={{ fontSize: '12px', fontWeight: 'bold', color: 'var(--accent-cyan)' }}>
              {popoverType === 'iteration' 
                ? `explore_${hoveredIteration}.log (Iteration ${hoveredIteration})`
                : `zx_hook.log (Row ${hoveredRowId})`}
            </span>
            {popoverType === 'status' && data.find(r => r._zx_row_id === hoveredRowId)?._zx_status === 'running' && (
              <span className="d-flex align-items-center gap-1 small text-info" style={{ fontSize: '10px' }}>
                <span className="spinner-border spinner-border-sm animate-pulse" role="status" style={{ width: '8px', height: '8px', borderWidth: '1px' }}></span>
                Live tailing
              </span>
            )}
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              Hover to scroll
            </span>
          </div>
          
          <div 
            style={{ 
              flexGrow: 1, 
              overflow: 'auto', 
              background: 'var(--bg-primary)', 
              padding: '8px', 
              borderRadius: '4px', 
              border: '1px solid var(--border-color)' 
            }}
          >
            {loadingLog && !logContent ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '12px', padding: '12px' }}>
                <div className="spinner" />
                <span>Loading log...</span>
              </div>
            ) : logContent ? (
              <pre style={{ margin: 0, fontSize: '11px', fontFamily: 'var(--font-mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--text-primary)' }}>
                {logContent.split('\n').map((line, idx) => {
                  const styles = colorizeLogLine(line);
                  return (
                    <div key={idx} style={{ color: styles.color, fontWeight: styles.fontWeight as any }}>
                      {line}
                    </div>
                  );
                })}
              </pre>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '12px', padding: '12px' }}>
                No log entries found.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div 
          className="context-menu"
          style={{
            top: contextMenu.y,
            left: contextMenu.x
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <div 
            className="context-menu-item"
            onClick={() => {
              triggerExecution(false, [contextMenu.rowId]);
              setContextMenu(null);
            }}
          >
            <Play size={14} style={{ color: 'var(--accent-cyan)' }} fill="var(--accent-cyan)" />
            <span>Start Run</span>
          </div>
          <div 
            className="context-menu-item"
            onClick={async () => {
              const rowId = contextMenu.rowId;
              setContextMenu(null);
              try {
                const res = await window.zxAPI.runZmon(activeProject, rowId, theme);
                if (res.status === 'error') {
                  alert(`Failed to start zmon: ${res.message}`);
                }
              } catch (err: any) {
                alert(`Error starting zmon: ${err.message || err}`);
              }
            }}
          >
            <Monitor size={14} style={{ color: 'var(--accent-purple)' }} />
            <span>Run zmon</span>
          </div>
        </div>
      )}

    </div>
  );
}
