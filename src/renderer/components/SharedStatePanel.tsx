import React, { useState, useEffect } from 'react';
import { Save, Plus, Trash2, Sliders, ToggleLeft, ToggleRight, Loader2, CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react';

interface SharedStatePanelProps {
  activeProject: string;
  apiCall: (endpoint: string, method?: string, body?: any) => Promise<any>;
}

export default function SharedStatePanel({ activeProject, apiCall }: SharedStatePanelProps) {
  const [stateData, setStateData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [isModified, setIsModified] = useState<boolean>(false);

  // New Custom Parameter Form
  const [newKey, setNewKey] = useState<string>('');
  const [newType, setNewType] = useState<'string' | 'number' | 'boolean'>('string');
  const [newValue, setNewValue] = useState<string>('');

  const fetchState = async () => {
    if (!activeProject) return;
    setLoading(true);
    setSaveStatus('idle');
    try {
      const data = await apiCall('/api/state');
      setStateData(data || {});
      setIsModified(false);
    } catch (err) {
      console.error('Failed fetching shared state', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, [activeProject]);

  const handleValueChange = (key: string, val: any) => {
    setStateData(prev => ({
      ...prev,
      [key]: val
    }));
    setIsModified(true);
    setSaveStatus('idle');
  };

  const handleDeleteKey = (key: string) => {
    const updated = { ...stateData };
    delete updated[key];
    setStateData(updated);
    setIsModified(true);
    setSaveStatus('idle');
  };

  const handleAddParameter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;

    let parsedVal: any = newValue;
    if (newType === 'number') {
      parsedVal = parseFloat(newValue) || 0;
    } else if (newType === 'boolean') {
      parsedVal = newValue.toLowerCase() === 'true';
    }

    setStateData(prev => ({
      ...prev,
      [newKey.trim()]: parsedVal
    }));
    setNewKey('');
    setNewValue('');
    setIsModified(true);
    setSaveStatus('idle');
  };

  const handleSave = async () => {
    if (!activeProject) return;
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await apiCall('/api/state/update', 'POST', {
        updates: stateData
      });
      if (res.status === 'success') {
        setStateData(res.state || stateData);
        setSaveStatus('saved');
        setIsModified(false);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error('Failed to save state parameters', err);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  if (!activeProject) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center h-100 text-secondary p-5">
        <Sliders size={48} className="mb-3 text-muted animate-pulse" />
        <h4 className="fw-semibold">No Project Opened</h4>
        <p className="small text-muted">Open or create a zX workspace first to inspect and update its shared state.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center h-100 text-secondary gap-3">
        <Loader2 size={32} className="text-primary spinner" />
        <span>Loading shared state parameters...</span>
      </div>
    );
  }

  // Core parameters
  const maxIterations = stateData['max_iterations'] !== undefined ? stateData['max_iterations'] : 5;
  const useSlurm = !!stateData['use_slurm'];
  const slurmPollInterval = stateData['slurm_poll_interval'] !== undefined ? stateData['slurm_poll_interval'] : 30;

  // Custom parameters exclude system/core ones
  const customKeys = Object.keys(stateData).filter(
    k => !['max_iterations', 'current_iteration', 'use_slurm', 'slurm_poll_interval'].includes(k)
  );

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', height: '100%', gap: '20px', padding: '24px', overflow: 'hidden', animation: 'slideUp 0.3s ease-out' }}>
      {/* LEFT: MAIN FORM CONTROL CONFIG */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', paddingRight: '4px' }}>
        
        {/* HEADER & SAVING STATUS */}
        <div className="d-flex align-items-center justify-content-between">
          <div>
            <h2 className="h4 text-white fw-bold mb-1">Shared Global State</h2>
            <p className="text-secondary small mb-0">Shared runtime configuration variables passed dynamically to all execution and explore hooks.</p>
          </div>
          <div className="d-flex align-items-center gap-3">
            {saveStatus === 'saved' && (
              <span className="badge bg-success d-flex align-items-center gap-1 py-2 px-3 rounded-pill" style={{ fontSize: '11px' }}>
                <CheckCircle2 size={12} /> State Synced & Saved
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="badge bg-danger d-flex align-items-center gap-1 py-2 px-3 rounded-pill" style={{ fontSize: '11px' }}>
                <AlertCircle size={12} /> Failed to Sync State
              </span>
            )}
            {isModified && saveStatus === 'idle' && (
              <span className="text-warning small fw-semibold font-monospace" style={{ fontSize: '11px' }}>
                ● Unsaved Local Changes
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn btn-sm btn-cyan px-4 py-2"
            >
              {saving ? (
                <>
                  <Loader2 size={14} className="spinner" /> Saving...
                </>
              ) : (
                <>
                  <Save size={14} /> Save Configuration
                </>
              )}
            </button>
          </div>
        </div>

        {/* CORE PARAMETERS SECTION */}
        <div className="card p-4 shadow-sm border border-secondary bg-dark bg-opacity-10 d-flex flex-column gap-3">
          <h3 className="h6 text-white text-uppercase fw-bold border-bottom border-secondary pb-2 mb-2 d-flex align-items-center gap-2">
            <Sliders size={14} className="text-primary" /> Core Optimization Loop Parameters
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            {/* MAX ITERATIONS CARD */}
            <div className="glass-panel p-3 d-flex flex-column justify-content-between gap-2" style={{ border: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.02)' }}>
              <div>
                <span className="fw-semibold text-white d-flex align-items-center gap-2 mb-1" style={{ fontSize: '14px' }}>
                  Max Exploration Iterations
                </span>
                <span className="small text-muted lh-sm d-block" style={{ fontSize: '11px' }}>
                  Maximum optimization loops before automatic explore termination.
                </span>
              </div>
              <input
                type="number"
                min="0"
                value={maxIterations}
                onChange={(e) => handleValueChange('max_iterations', parseInt(e.target.value) || 0)}
                className="form-control form-control-sm mt-2 w-100"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
              />
            </div>

            {/* SLURM TOGGLE CARD */}
            <div className="glass-panel p-3 d-flex flex-column justify-content-between gap-2" style={{ border: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.02)' }}>
              <div>
                <span className="fw-semibold text-white d-flex align-items-center justify-content-between w-100" style={{ fontSize: '14px' }}>
                  Distributed Slurm Queue
                  <button 
                    onClick={() => handleValueChange('use_slurm', !useSlurm)}
                    className="p-0 border-0 bg-transparent text-primary"
                    style={{ cursor: 'pointer' }}
                  >
                    {useSlurm ? (
                      <ToggleRight size={28} className="text-primary" style={{ color: 'var(--accent-cyan)' }} />
                    ) : (
                      <ToggleLeft size={28} className="text-secondary" />
                    )}
                  </button>
                </span>
                <span className="small text-muted lh-sm d-block" style={{ fontSize: '11px' }}>
                  Toggles between sequential local executions and remote Slurm submission.
                </span>
              </div>
              
              {/* Poll interval (conditional) */}
              <div style={{ visibility: useSlurm ? 'visible' : 'hidden', opacity: useSlurm ? 1 : 0, transition: 'all 0.3s ease' }}>
                <label className="text-secondary mb-1" style={{ fontSize: '11px' }}>Poll Queue Interval (seconds)</label>
                <input
                  type="number"
                  min="5"
                  value={slurmPollInterval}
                  onChange={(e) => handleValueChange('slurm_poll_interval', parseInt(e.target.value) || 30)}
                  className="form-control form-control-sm w-100"
                  style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* CUSTOM RUNTIME STATE PARAMETERS */}
        <div className="card p-4 shadow-sm border border-secondary bg-dark bg-opacity-10 d-flex flex-column gap-3">
          <h3 className="h6 text-white text-uppercase fw-bold border-bottom border-secondary pb-2 mb-2 d-flex align-items-center gap-2">
            <Plus size={14} className="text-primary" /> Custom Project Hook Parameters
          </h3>

          {customKeys.length === 0 ? (
            <div className="text-center py-4 text-secondary small bg-dark bg-opacity-20 rounded border border-dashed border-secondary">
              No custom shared variables currently configured. Use the panel on the right to append custom settings!
            </div>
          ) : (
            <div className="table-responsive rounded border border-secondary" style={{ overflow: 'hidden' }}>
              <table className="table table-dark mb-0" style={{ background: 'transparent' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <th className="small text-secondary fw-semibold border-secondary py-2" style={{ width: '40%' }}>Parameter Name</th>
                    <th className="small text-secondary fw-semibold border-secondary py-2" style={{ width: '20%' }}>Type</th>
                    <th className="small text-secondary fw-semibold border-secondary py-2" style={{ width: '30%' }}>Value</th>
                    <th className="small text-secondary fw-semibold border-secondary py-2 text-center" style={{ width: '10%' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {customKeys.map(key => {
                    const val = stateData[key];
                    const type = typeof val;
                    return (
                      <tr key={key} className="align-middle border-secondary" style={{ background: 'transparent' }}>
                        <td className="fw-semibold text-white py-2" style={{ fontSize: '13px' }}>{key}</td>
                        <td className="py-2">
                          <span className="badge" style={{ fontSize: '10px', textTransform: 'uppercase', background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)' }}>
                            {type}
                          </span>
                        </td>
                        <td className="py-2">
                          {type === 'boolean' ? (
                            <button
                              onClick={() => handleValueChange(key, !val)}
                              className="p-0 border-0 bg-transparent"
                              style={{ cursor: 'pointer' }}
                            >
                              {val ? (
                                <ToggleRight size={24} className="text-primary" style={{ color: 'var(--accent-cyan)' }} />
                              ) : (
                                <ToggleLeft size={24} className="text-secondary" />
                              )}
                            </button>
                          ) : type === 'number' ? (
                            <input
                              type="number"
                              value={val}
                              onChange={(e) => handleValueChange(key, parseFloat(e.target.value) || 0)}
                              className="form-control form-control-sm py-1 font-monospace"
                              style={{ height: '28px', fontSize: '12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
                            />
                          ) : (
                            <input
                              type="text"
                              value={val}
                              onChange={(e) => handleValueChange(key, e.target.value)}
                              className="form-control form-control-sm py-1 font-monospace"
                              style={{ height: '28px', fontSize: '12px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
                            />
                          )}
                        </td>
                        <td className="py-2 text-center">
                          <button
                            onClick={() => handleDeleteKey(key)}
                            className="btn btn-sm btn-link text-danger p-0 d-inline-flex justify-content-center align-items-center"
                            style={{ width: '28px', height: '28px', background: 'transparent', border: 'none' }}
                            title="Remove parameter"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT SIDEBAR: ADD PARAMETER DRAWER */}
      <div className="card p-4 shadow-sm border border-secondary bg-dark bg-opacity-25 d-flex flex-column gap-3" style={{ height: '100%', overflowY: 'auto' }}>
        <h3 className="h6 text-white text-uppercase fw-bold border-bottom border-secondary pb-2 mb-2 d-flex align-items-center gap-2">
          <Plus size={15} style={{ color: 'var(--accent-cyan)' }} /> Add Shared Variable
        </h3>
        
        <form onSubmit={handleAddParameter} className="d-flex flex-column gap-3">
          <div>
            <label className="form-label text-secondary mb-1" style={{ fontSize: '12px' }}>Parameter Key Name</label>
            <input
              type="text"
              placeholder="e.g. optimizer_rate"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="form-control form-control-sm w-100"
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
            />
          </div>

          <div>
            <label className="form-label text-secondary mb-1" style={{ fontSize: '12px' }}>Variable Type</label>
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as any)}
              className="form-select form-select-sm w-100"
              style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
            >
              <option value="string">String (Text)</option>
              <option value="number">Number (Float/Int)</option>
              <option value="boolean">Boolean (True/False)</option>
            </select>
          </div>

          <div>
            <label className="form-label text-secondary mb-1" style={{ fontSize: '12px' }}>Initial Value</label>
            {newType === 'boolean' ? (
              <select
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="form-select form-select-sm w-100"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
              >
                <option value="">Select true/false...</option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            ) : (
              <input
                type={newType === 'number' ? 'number' : 'text'}
                placeholder={newType === 'number' ? 'e.g. 0.05' : 'e.g. standard_mode'}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="form-control form-control-sm w-100"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}
              />
            )}
          </div>

          <button
            type="submit"
            disabled={!newKey.trim() || !newValue}
            className="btn btn-sm btn-cyan w-100 justify-content-center py-2 mt-2"
          >
            <Plus size={14} /> Add Parameter
          </button>
        </form>

        {/* CONTEXTUAL HOOK GUIDANCE */}
        <div className="glass-panel p-3 mt-auto" style={{ border: '1px solid var(--border-color)', background: 'rgba(255, 255, 255, 0.01)', borderRadius: '8px' }}>
          <span className="fw-semibold text-white d-flex align-items-center gap-1 mb-1" style={{ fontSize: '12px' }}>
            <HelpCircle size={14} className="text-secondary" /> Procedural Integration
          </span>
          <p className="text-muted lh-sm mb-0" style={{ fontSize: '11px', textAlign: 'justify' }}>
            These state variables are procedurally passed into all hooks under the <code>state</code> dictionary (e.g. <code>state["max_iterations"]</code>). Edit <code>state.py</code> to validate or perform side-effects when they are modified.
          </p>
        </div>
      </div>
    </div>
  );
}
