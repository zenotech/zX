import React, { useState, useEffect } from 'react';
import { 
  Folder, File, Trash2, Edit3, ChevronRight, ChevronDown, 
  FolderPlus, FilePlus, RefreshCw, X, Eye, FileText
} from 'lucide-react';
import Editor from '@monaco-editor/react';

interface FileExplorerProps {
  activeProject: string;
  apiCall: (endpoint: string, method?: string, body?: any) => Promise<any>;
  theme: 'dark' | 'light';
}

interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  size?: number;
  children?: FileNode[];
}

export default function FileExplorer({ activeProject, apiCall, theme }: FileExplorerProps) {
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  
  // File Preview state
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loadingContent, setLoadingContent] = useState<boolean>(false);
  
  // Modals/Forms
  const [renamingNode, setRenamingNode] = useState<FileNode | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');

  const fetchTree = async () => {
    if (!activeProject) return;
    setLoading(true);
    try {
      const data = await apiCall('/api/explorer/tree');
      setTree(data || []);
    } catch (err) {
      console.error('Failed fetching explorer tree', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTree();
  }, [activeProject]);

  const toggleExpand = (path: string) => {
    setExpandedDirs(prev => ({ ...prev, [path]: !prev[path] }));
  };

  const handleFileClick = async (node: FileNode) => {
    setSelectedFile(node);
    setLoadingContent(true);
    try {
      const res = await apiCall(`/api/explorer/read?path=${encodeURIComponent(node.path)}`);
      setFileContent(res.content);
    } catch (err) {
      setFileContent('# Failed to read file contents.');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleDelete = async (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete ${node.name}? This action cannot be undone.`)) {
      return;
    }
    try {
      await apiCall('/api/explorer/delete', 'POST', { path: node.path });
      if (selectedFile?.path === node.path) {
        setSelectedFile(null);
        setFileContent('');
      }
      fetchTree();
    } catch (err) {
      alert('Failed to delete item');
    }
  };

  const handleStartRename = (node: FileNode, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingNode(node);
    setRenameValue(node.name);
  };

  const handleSaveRename = async () => {
    if (!renamingNode || !renameValue.trim()) return;
    
    // Construct new path
    const oldParts = renamingNode.path.split('/');
    oldParts[oldParts.length - 1] = renameValue.trim();
    const newPath = oldParts.join('/');
    
    try {
      await apiCall('/api/explorer/rename', 'POST', {
        old_path: renamingNode.path,
        new_path: newPath
      });
      setRenamingNode(null);
      fetchTree();
    } catch (err) {
      alert('Failed to rename item');
    }
  };

  // Determine file language for Monaco Editor syntax styling
  const getFileLanguage = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'py') return 'python';
    if (ext === 'csv') return 'csv';
    if (ext === 'json') return 'json';
    if (ext === 'md') return 'markdown';
    if (ext === 'sh') return 'shell';
    return 'plaintext';
  };

  // Recursive Node Renderer
  const renderNode = (node: FileNode, depth: number = 0) => {
    const isExpanded = !!expandedDirs[node.path];
    const isRenaming = renamingNode?.path === node.path;
    const isSelected = selectedFile?.path === node.path;

    return (
      <div key={node.path} style={{ display: 'flex', flexDirection: 'column' }}>
        
        {/* Node label bar */}
        <div 
          onClick={() => node.isDir ? toggleExpand(node.path) : handleFileClick(node)}
          style={{ 
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 12px',
            paddingLeft: `${depth * 16 + 12}px`,
            fontSize: '13px',
            color: isSelected ? 'var(--accent-cyan)' : 'var(--text-primary)',
            background: isSelected ? 'rgba(212,137,14,0.04)' : 'transparent',
            borderRadius: '4px',
            cursor: 'pointer',
            transition: 'background 0.2s',
            borderLeft: isSelected ? '2px solid var(--accent-cyan)' : '2px solid transparent'
          }}
          className="explorer-node"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexGrow: 1, overflow: 'hidden' }}>
            {node.isDir ? (
              <>
                {isExpanded ? <ChevronDown size={14} style={{ color: 'var(--text-muted)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
                <Folder size={15} style={{ color: 'var(--accent-purple)', flexShrink: 0 }} />
              </>
            ) : (
              <File size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
            )}
            
            {isRenaming ? (
              <input 
                type="text" 
                value={renameValue} 
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleSaveRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveRename();
                  if (e.key === 'Escape') setRenamingNode(null);
                }}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                style={{ height: '20px', padding: '2px 4px', fontSize: '12px', background: 'var(--bg-primary)', border: '1px solid var(--accent-cyan)', color: 'var(--text-primary)', borderRadius: '4px', width: '120px' }}
              />
            ) : (
              <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {node.name}
              </span>
            )}
          </div>

          {/* Inline Action Triggers */}
          {!isRenaming && (
            <div className="node-actions" style={{ display: 'flex', gap: '6px' }}>
              <button 
                onClick={(e) => handleStartRename(node, e)}
                className="btn btn-action" 
                title="Rename item"
                style={{ padding: '2px', background: 'transparent', border: 'none' }}
              >
                <Edit3 size={12} style={{ color: 'var(--text-muted)' }} />
              </button>
              <button 
                onClick={(e) => handleDelete(node, e)}
                className="btn btn-action" 
                title="Delete item"
                style={{ padding: '2px', background: 'transparent', border: 'none' }}
              >
                <Trash2 size={12} style={{ color: 'var(--text-muted)' }} />
              </button>
            </div>
          )}
        </div>

        {/* Children render block */}
        {node.isDir && isExpanded && node.children && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}

      </div>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', height: '100%', gap: '16px', padding: '24px', overflow: 'hidden', animation: 'slideUp 0.3s ease-out' }}>
      
      {/* LEFT SIDEBAR TREE */}
      <div className="card p-3 shadow-sm d-flex flex-column gap-3" style={{ overflowY: 'auto' }}>
        <div className="d-flex justify-content-between align-items-center border-bottom border-secondary pb-2 mb-2">
          <h4 className="text-secondary text-uppercase fw-semibold mb-0" style={{ fontSize: '12px', letterSpacing: '0.05em' }}>
            PROJECT DIRECTORY TREE
          </h4>
          <button 
            onClick={fetchTree}
            className="btn btn-sm btn-outline-secondary p-1 border-0" 
            title="Refresh directory tree"
          >
            <RefreshCw size={13} />
          </button>
        </div>

        {loading && tree.length === 0 ? (
          <div className="d-flex justify-content-center align-items-center gap-2 text-secondary py-4 small">
            <div className="spinner-border spinner-border-sm text-primary" role="status"></div> Loading tree...
          </div>
        ) : tree.length === 0 ? (
          <div className="text-muted small text-center py-4">
            Empty Project Space.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflowY: 'auto' }}>
            {tree.map(node => renderNode(node, 0))}
          </div>
        )}
      </div>

      {/* RIGHT PREVIEW FILE VIEWER */}
      <div className="card shadow-sm d-flex flex-column" style={{ overflow: 'hidden' }}>
        {selectedFile ? (
          <div className="d-flex flex-column h-100">
            
            {/* Preview details bar */}
            <div className="card-header border-bottom border-secondary d-flex justify-content-between align-items-center py-2 px-3 bg-dark bg-opacity-25">
              <div>
                <h3 className="h6 text-white mb-0 d-flex align-items-center gap-2">
                  <FileText size={15} className="text-primary" /> {selectedFile.name}
                </h3>
                <span className="small text-muted font-monospace" style={{ fontSize: '11px' }}>
                  Path: {selectedFile.path} {selectedFile.size !== undefined ? `| Size: ${Math.round(selectedFile.size / 102.4) / 10} KB` : ''}
                </span>
              </div>
              <button 
                onClick={() => setSelectedFile(null)}
                className="btn btn-sm btn-outline-secondary p-1 border-0"
              >
                <X size={16} />
              </button>
            </div>

            {/* Monaco Preview Body */}
            <div style={{ flexGrow: 1, position: 'relative', background: theme === 'light' ? '#ffffff' : '#1a1614' }}>
              {loadingContent ? (
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: theme === 'light' ? 'var(--bg-primary)' : '#0d0e12', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 10, gap: '8px', color: 'var(--text-secondary)' }}>
                  <div className="spinner-border spinner-border-sm text-primary" role="status"></div> Loading file content...
                </div>
              ) : null}
              
              <Editor
                height="100%"
                language={getFileLanguage(selectedFile.name)}
                theme={theme === 'light' ? 'light' : 'vs-dark'}
                value={fileContent}
                options={{
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono',
                  minimap: { enabled: false },
                  automaticLayout: true,
                  readOnly: true,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false
                }}
              />
            </div>

          </div>
        ) : (
          <div className="d-flex flex-column align-items-center justify-content-center flex-grow-1 text-secondary gap-2 p-4">
            <Eye size={44} className="text-secondary" />
            <span className="fw-semibold text-white">No file selected for preview</span>
            <span className="small text-muted text-center" style={{ maxWidth: '280px' }}>
              Double-click any file in the project directory tree on the left to review its contents instantly.
            </span>
          </div>
        )}
      </div>

    </div>
  );
}
