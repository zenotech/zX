import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { LineChart, BarChart2, PieChart, Play, ShieldAlert, Sparkles } from 'lucide-react';

interface VisualizationDashboardProps {
  authToken: string;
  port: number;
  activeProject: string;
  running: boolean;
  apiCall: (endpoint: string, method?: string, body?: any) => Promise<any>;
  theme: 'dark' | 'light';
}

export default function VisualizationDashboard({ 
  authToken, 
  port, 
  activeProject, 
  running, 
  apiCall,
  theme
}: VisualizationDashboardProps) {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [customPlots, setCustomPlots] = useState<Record<string, any>>({});
  const [activeTab, setActiveTab] = useState<'standard' | 'custom'>('standard');
  
  // Standard Chart States
  const [chartType, setChartType] = useState<'scatter' | 'line' | 'histogram'>('scatter');
  const [xAxis, setXAxis] = useState<string>('');
  const [yAxis, setYAxis] = useState<string>('');
  const [colorAxis, setColorAxis] = useState<string>('');
  
  const [loadingCustom, setLoadingCustom] = useState<boolean>(false);
  const [customError, setCustomError] = useState<string>('');

  const fetchDatabaseData = async () => {
    if (!activeProject) return;
    try {
      const db = await apiCall('/api/database');
      setData(db);
      if (db.length > 0) {
        const allCols = Object.keys(db[0]);
        setColumns(allCols);
        
        // Pick default columns for axes if not set
        const userCols = allCols.filter(c => !c.startsWith('_zx_'));
        if (userCols.length > 0) {
          if (!xAxis) setXAxis(userCols[0]);
          if (userCols.length > 1) {
            if (!yAxis) setYAxis(userCols[1]);
          } else {
            if (!yAxis) setYAxis(userCols[0]);
          }
        } else {
          if (!xAxis) setXAxis(allCols[0]);
          if (!yAxis) setYAxis(allCols[0]);
        }
      }
    } catch (err) {
      console.error('Failed fetching data for visualization', err);
    }
  };

  const fetchCustomPlots = async () => {
    if (!activeProject) return;
    setLoadingCustom(true);
    setCustomError('');
    try {
      const res = await apiCall('/api/visualize/custom');
      setCustomPlots(res || {});
    } catch (err: any) {
      setCustomError(err.message || 'Failed loading custom plot hook');
      console.error(err);
    } finally {
      setLoadingCustom(false);
    }
  };

  useEffect(() => {
    fetchDatabaseData();
    if (activeTab === 'custom') {
      fetchCustomPlots();
    }
  }, [activeProject, activeTab]);

  // Refetch database data periodically if the runner is running
  useEffect(() => {
    let interval: any;
    if (running && activeProject) {
      interval = setInterval(() => {
        fetchDatabaseData();
        if (activeTab === 'custom') {
          fetchCustomPlots();
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [running, activeProject, activeTab, xAxis, yAxis]);

  // Generate standard chart data trace
  const getStandardChartTraces = () => {
    if (data.length === 0 || !xAxis) return [];

    const xData = data.map(row => row[xAxis]);
    const yData = yAxis ? data.map(row => row[yAxis]) : [];
    
    // Color axis map
    let markerSettings: any = {
      color: theme === 'light' ? '#0284c7' : '#00f0ff',
      size: 10,
      line: { color: theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)', width: 1 }
    };

    if (colorAxis && data.length > 0) {
      markerSettings = {
        color: data.map(row => row[colorAxis]),
        colorscale: 'Viridis',
        showscale: true,
        size: 12,
        line: { color: theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)', width: 1 }
      };
    }

    if (chartType === 'histogram') {
      return [{
        x: xData,
        type: 'histogram',
        marker: { color: 'rgba(155, 93, 229, 0.7)', line: { color: theme === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)', width: 1 } },
        name: xAxis
      }];
    }

    return [{
      x: xData,
      y: yData,
      mode: chartType === 'scatter' ? 'markers' : 'lines+markers',
      type: 'scatter',
      marker: markerSettings,
      name: `${yAxis} vs ${xAxis}`,
      line: chartType === 'line' ? { color: theme === 'light' ? '#7c3aed' : '#9b5de5', width: 2 } : undefined
    }];
  };

  const getStandardChartLayout = () => {
    const isLight = theme === 'light';
    return {
      autosize: true,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: isLight ? '#0f172a' : '#ffffff', family: 'Outfit, var(--font-sans)' },
      xaxis: {
        title: { text: xAxis, font: { color: isLight ? '#475569' : '#949eb5' } },
        gridcolor: isLight ? '#e2e8f0' : '#1e2130',
        zerolinecolor: isLight ? '#cbd5e1' : '#2a2f42',
        tickfont: { color: isLight ? '#475569' : '#949eb5' }
      },
      yaxis: {
        title: { text: chartType === 'histogram' ? 'Frequency' : yAxis, font: { color: isLight ? '#475569' : '#949eb5' } },
        gridcolor: isLight ? '#e2e8f0' : '#1e2130',
        zerolinecolor: isLight ? '#cbd5e1' : '#2a2f42',
        tickfont: { color: isLight ? '#475569' : '#949eb5' }
      },
      margin: { l: 60, r: 40, t: 40, b: 60 },
      hovermode: 'closest'
    };
  };

  return (
    <div className="d-flex flex-column h-100 gap-3 animate-slide-up" style={{ animation: 'slideUp 0.3s ease-out' }}>
      
      {/* HEADER CONTROL */}
      <div className="card p-3 mb-1 d-flex flex-row flex-wrap align-items-center justify-content-between gap-3 shadow-sm">
        <div>
          <h3 className="h6 text-white mb-0">Visualization Dashboard</h3>
          <p className="text-secondary small mb-0" style={{ fontSize: '11px' }}>Analyze parametric trends and model convergence.</p>
        </div>

        {/* Tab Selection */}
        <div className="d-flex bg-dark bg-opacity-50 border border-secondary rounded p-1">
          <button 
            onClick={() => setActiveTab('standard')}
            className={`btn btn-sm d-flex align-items-center gap-2 border-0 px-3 ${activeTab === 'standard' ? 'btn-primary text-white shadow-sm' : 'btn-link text-secondary text-decoration-none'}`}
            style={{ borderRadius: '4px' }}
          >
            <BarChart2 size={14} /> Standard Charts
          </button>
          <button 
            onClick={() => setActiveTab('custom')}
            className={`btn btn-sm d-flex align-items-center gap-2 border-0 px-3 ${activeTab === 'custom' ? 'btn-primary text-white shadow-sm' : 'btn-link text-secondary text-decoration-none'}`}
            style={{ borderRadius: '4px' }}
          >
            <Sparkles size={14} /> Custom Plots (plot.py)
          </button>
        </div>
      </div>

      {activeTab === 'standard' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', flexGrow: 1, gap: '16px', minHeight: 0 }}>
          
          {/* LEFT SELECTORS COLUMN */}
          <div className="card p-3 shadow-sm d-flex flex-column gap-3" style={{ overflowY: 'auto' }}>
            <div>
              <label className="text-secondary text-uppercase fw-semibold mb-2" style={{ fontSize: '11px', letterSpacing: '0.05em' }}>
                Chart Type
              </label>
              <div className="d-flex flex-column gap-2">
                <button 
                  onClick={() => setChartType('scatter')}
                  className={`btn btn-sm d-flex align-items-center gap-2 justify-content-start text-start ${chartType === 'scatter' ? 'btn-primary text-white' : 'btn-outline-secondary'}`}
                >
                  <PieChart size={14} /> Scatter Plot
                </button>
                <button 
                  onClick={() => setChartType('line')}
                  className={`btn btn-sm d-flex align-items-center gap-2 justify-content-start text-start ${chartType === 'line' ? 'btn-primary text-white' : 'btn-outline-secondary'}`}
                >
                  <LineChart size={14} /> Line Chart
                </button>
                <button 
                  onClick={() => setChartType('histogram')}
                  className={`btn btn-sm d-flex align-items-center gap-2 justify-content-start text-start ${chartType === 'histogram' ? 'btn-primary text-white' : 'btn-outline-secondary'}`}
                >
                  <BarChart2 size={14} /> Histogram
                </button>
              </div>
            </div>

            <div className="d-flex flex-column gap-3">
              <div>
                <label className="form-label text-secondary text-uppercase fw-semibold mb-1" style={{ fontSize: '11px' }}>
                  X Axis Column
                </label>
                <select 
                  value={xAxis} 
                  onChange={(e) => setXAxis(e.target.value)} 
                  className="form-select form-select-sm bg-dark border-secondary text-white"
                >
                  <option value="">-- Choose X --</option>
                  {columns.map(col => <option key={col} value={col}>{col.replace('_zx_', '')}</option>)}
                </select>
              </div>

              {chartType !== 'histogram' && (
                <>
                  <div>
                    <label className="form-label text-secondary text-uppercase fw-semibold mb-1" style={{ fontSize: '11px' }}>
                      Y Axis Column
                    </label>
                    <select 
                      value={yAxis} 
                      onChange={(e) => setYAxis(e.target.value)} 
                      className="form-select form-select-sm bg-dark border-secondary text-white"
                    >
                      <option value="">-- Choose Y --</option>
                      {columns.map(col => <option key={col} value={col}>{col.replace('_zx_', '')}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="form-label text-secondary text-uppercase fw-semibold mb-1" style={{ fontSize: '11px' }}>
                      Marker Color Dimension (Optional)
                    </label>
                    <select 
                      value={colorAxis} 
                      onChange={(e) => setColorAxis(e.target.value)} 
                      className="form-select form-select-sm bg-dark border-secondary text-white"
                    >
                      <option value="">-- Static Cyan --</option>
                      {columns.map(col => <option key={col} value={col}>{col.replace('_zx_', '')}</option>)}
                    </select>
                  </div>
                </>
              )}
            </div>

            {data.length > 0 && (
              <div className="mt-auto bg-primary bg-opacity-10 p-3 rounded border border-primary border-opacity-10 text-primary-emphasis">
                <span className="small fw-semibold d-block mb-1 font-monospace">DASHBOARD SUMMARY</span>
                <span className="small d-block" style={{ fontSize: '12px' }}>Total points parsed: <strong>{data.length}</strong></span>
              </div>
            )}
          </div>

          {/* RIGHT CHART AREA */}
          <div className="card p-3 shadow-sm d-flex flex-column" style={{ minHeight: 0 }}>
            {data.length === 0 ? (
              <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1 text-secondary gap-2">
                <ShieldAlert size={40} className="text-warning" />
                <span>No runs completed yet to visualize.</span>
              </div>
            ) : (
              <div style={{ width: '100%', height: '100%', minHeight: '380px' }}>
                <Plot
                  data={getStandardChartTraces()}
                  layout={getStandardChartLayout() as any}
                  config={{ responsive: true, displaylogo: false }}
                  style={{ width: '100%', height: '100%' }}
                />
              </div>
            )}
          </div>

        </div>
      ) : (
        /* CUSTOM PLOTS (PLOT.PY) GRAPH GRID */
        <div className="card p-4 shadow-sm d-flex flex-column" style={{ flexGrow: 1, overflowY: 'auto' }}>
          
          {/* Header custom trigger */}
          <div className="d-flex justify-content-between align-items-center mb-3">
            <span className="text-white fw-semibold d-flex align-items-center gap-2" style={{ fontSize: '14px' }}>
              <Sparkles size={16} className="text-warning" /> User-defined figures in hooks/plot.py
            </span>
            <button 
              onClick={fetchCustomPlots}
              disabled={loadingCustom || !activeProject}
              className="btn btn-sm btn-outline-primary d-flex align-items-center gap-1 px-3" 
            >
              <Play size={12} /> Refetch Figures
            </button>
          </div>

          {loadingCustom ? (
            <div className="d-flex align-items-center justify-content-center gap-2 flex-grow-1 text-secondary">
              <div className="spinner-border spinner-border-sm text-primary" role="status"></div> Loading Custom Plotly Layouts...
            </div>
          ) : customError ? (
            <div className="alert alert-danger d-flex flex-column align-items-center justify-content-center gap-2 flex-grow-1 p-4 rounded border-danger border-opacity-10">
              <ShieldAlert size={36} />
              <span className="fw-semibold">Plot Hook Execution Error</span>
              <pre className="small text-danger-emphasis bg-dark bg-opacity-25 p-2 rounded border border-danger border-opacity-10 mt-2 font-monospace w-100 text-center" style={{ maxWidth: '480px', whiteSpace: 'pre-wrap' }}>{customError}</pre>
            </div>
          ) : Object.keys(customPlots).length === 0 ? (
            <div className="d-flex flex-column align-items-center justify-content-center gap-2 flex-grow-1 text-secondary">
              <ShieldAlert size={36} className="text-warning" />
              <span className="fw-semibold">No custom figures returned.</span>
              <span className="small text-muted text-center" style={{ maxWidth: '320px' }}>
                Open `hooks/plot.py` and populate the `plot` function to return specialized Plotly JSON maps.
              </span>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: '24px' }}>
              {Object.entries(customPlots).map(([name, fig]) => {
                // Ensure plotly layout matches dark/light aesthetic elegantly
                const isLight = theme === 'light';
                const blendedLayout = {
                  ...fig.layout,
                  autosize: true,
                  paper_bgcolor: 'rgba(0,0,0,0)',
                  plot_bgcolor: 'rgba(0,0,0,0)',
                  font: { color: isLight ? '#0f172a' : '#ffffff', family: 'Outfit, var(--font-sans)', ...(fig.layout?.font || {}) },
                  xaxis: {
                    gridcolor: isLight ? '#e2e8f0' : '#1e2130',
                    zerolinecolor: isLight ? '#cbd5e1' : '#2a2f42',
                    tickfont: { color: isLight ? '#475569' : '#949eb5' },
                    ...(fig.layout?.xaxis || {})
                  },
                  yaxis: {
                    gridcolor: isLight ? '#e2e8f0' : '#1e2130',
                    zerolinecolor: isLight ? '#cbd5e1' : '#2a2f42',
                    tickfont: { color: isLight ? '#475569' : '#949eb5' },
                    ...(fig.layout?.yaxis || {})
                  }
                };

                return (
                  <div key={name} className="card shadow-sm p-3 bg-dark bg-opacity-25 border-secondary" style={{ height: '400px', display: 'flex', flexDirection: 'column' }}>
                    <div className="small fw-bold text-primary border-bottom border-secondary pb-2 mb-2">
                      Figure Name: {name}
                    </div>
                    <div style={{ flexGrow: 1, minHeight: 0 }}>
                      <Plot
                        data={fig.data}
                        layout={blendedLayout as any}
                        config={{ responsive: true, displaylogo: false }}
                        style={{ width: '100%', height: '100%' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </div>
      )}

    </div>
  );
}
