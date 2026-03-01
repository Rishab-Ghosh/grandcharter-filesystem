'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  fetchNodes,
  fetchSearch,
  createFolder,
  uploadFile,
  renameNode,
  moveNode,
  getDownloadUrl,
  type Node,
  type SearchResult,
} from '@/lib/api';

type BreadcrumbItem = { id: string; name: string };

type ModalKind = 'none' | 'createFolder' | 'rename' | 'move';

export default function Explorer({ workspaceId }: { workspaceId: string }) {
  const [currentParentId, setCurrentParentId] = useState<string | null>(null);
  const [breadcrumbPath, setBreadcrumbPath] = useState<BreadcrumbItem[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>('none');
  const [modalNode, setModalNode] = useState<Node | null>(null);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<'none' | 'root' | string>('none');
  const [uploading, setUploading] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const directoryInputRef = useRef<HTMLInputElement>(null);

  const NODE_DRAG_TYPE = 'application/x-filesystem-node';

  const loadNodes = useCallback(
    async (parentId: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchNodes(workspaceId, parentId);
        setNodes(list);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    },
    [workspaceId]
  );

  useEffect(() => {
    if (debouncedSearch.trim()) {
      setLoading(true);
      setError(null);
      fetchSearch(workspaceId, debouncedSearch)
        .then(setSearchResults)
        .catch((e) => setError(e instanceof Error ? e.message : 'Search failed'))
        .finally(() => setLoading(false));
    } else {
      setSearchResults(null);
      loadNodes(currentParentId);
    }
  }, [workspaceId, debouncedSearch, currentParentId, loadNodes]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const handleFolderClick = (node: Node) => {
    if (node.kind !== 'folder') return;
    setCurrentParentId(node.id);
    setBreadcrumbPath((prev) => [...prev, { id: node.id, name: node.name }]);
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      setCurrentParentId(null);
      setBreadcrumbPath([]);
    } else {
      const item = breadcrumbPath[index];
      if (!item) return;
      setCurrentParentId(item.id);
      setBreadcrumbPath(breadcrumbPath.slice(0, index + 1));
    }
  };

  const handleRefresh = () => {
    if (debouncedSearch.trim()) {
      fetchSearch(workspaceId, debouncedSearch).then(setSearchResults).catch(setError);
    } else {
      loadNodes(currentParentId);
    }
  };

  const handleCreateFolder = async (name: string) => {
    await createFolder(workspaceId, currentParentId, name);
    setModal('none');
    loadNodes(currentParentId);
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadFile(workspaceId, currentParentId, file)
      .then(() => loadNodes(currentParentId))
      .catch((err) => setError(err instanceof Error ? err.message : 'Upload failed'));
    e.target.value = '';
  };

  const handleRename = async (newName: string) => {
    if (!modalNode) return;
    await renameNode(modalNode.id, workspaceId, newName);
    setModal('none');
    setModalNode(null);
    if (debouncedSearch.trim()) {
      fetchSearch(workspaceId, debouncedSearch).then(setSearchResults).catch(setError);
    } else {
      loadNodes(currentParentId);
    }
  };

  const handleMove = async (newParentId: string | null) => {
    if (!modalNode) return;
    await moveNode(modalNode.id, workspaceId, newParentId);
    setModal('none');
    setModalNode(null);
    loadNodes(currentParentId);
  };

  // After move-by-drop in search mode we refresh search and stay in search (no navigation).
  const handleMoveByDrop = async (nodeId: string, newParentId: string | null) => {
    setDropTarget('none');
    try {
      await moveNode(nodeId, workspaceId, newParentId);
      if (debouncedSearch.trim()) {
        fetchSearch(workspaceId, debouncedSearch).then(setSearchResults).catch(setError);
      } else {
        loadNodes(currentParentId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed');
    }
  };

  const handleFileDrop = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        await uploadFile(workspaceId, currentParentId, files[i]);
      }
      loadNodes(currentParentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleSearchFolderClick = (folder: SearchResult) => {
    if (folder.kind !== 'folder') return;
    setSearchQuery('');
    setDebouncedSearch('');
    setSearchResults(null);
    setCurrentParentId(folder.id);
    setBreadcrumbPath([{ id: folder.id, name: folder.name }]);
  };

  const list = searchResults ?? nodes;
  const isSearchMode = searchResults !== null;

  return (
    <div style={{ maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>Files</h1>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            padding: '0.4rem 0.6rem',
            width: 200,
            background: '#1a1a1a',
            border: '1px solid #333',
            borderRadius: 4,
            color: '#e0e0e0',
          }}
        />
        {!isSearchMode && (
          <>
            <button
              type="button"
              onClick={() => setModal('createFolder')}
              style={btnStyle}
            >
              New folder
            </button>
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              style={btnStyle}
            >
              Upload
            </button>
            <button
              type="button"
              onClick={() => directoryInputRef.current?.click()}
              style={btnStyle}
            >
              Upload folder
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleUpload}
            />
            <input
              ref={(el) => {
                directoryInputRef.current = el;
                if (el) el.setAttribute('webkitdirectory', '');
              }}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = e.target.files;
                if (!files?.length) return;
                setUploading(true);
                setError(null);
                Promise.all(
                  Array.from(files).map((file) =>
                    uploadFile(workspaceId, currentParentId, file)
                  )
                )
                  .then(() => loadNodes(currentParentId))
                  .catch((err) =>
                    setError(err instanceof Error ? err.message : 'Upload failed')
                  )
                  .finally(() => setUploading(false));
                e.target.value = '';
              }}
            />
          </>
        )}
        <button type="button" onClick={handleRefresh} style={btnStyle}>
          Refresh
        </button>
      </div>

      {!isSearchMode && (
        <nav style={{ marginBottom: '0.75rem', fontSize: 14 }}>
          <button
            type="button"
            onClick={() => handleBreadcrumbClick(-1)}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(NODE_DRAG_TYPE)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setDropTarget('root');
              }
            }}
            onDragLeave={() => setDropTarget('none')}
            onDrop={(e) => {
              e.preventDefault();
              const nodeId = e.dataTransfer.getData(NODE_DRAG_TYPE);
              if (nodeId) handleMoveByDrop(nodeId, null);
              setDropTarget('none');
            }}
            style={{
              ...linkStyle,
              ...(dropTarget === 'root' ? { outline: '2px solid #7ab', borderRadius: 2 } : {}),
            }}
          >
            Root
          </button>
          {breadcrumbPath.map((item, i) => (
            <span key={item.id}>
              <span style={{ marginRight: '0.25rem', color: '#666' }}>/</span>
              <button
                type="button"
                onClick={() => handleBreadcrumbClick(i)}
                style={linkStyle}
              >
                {item.name}
              </button>
            </span>
          ))}
        </nav>
      )}

      {isSearchMode && (
        <p style={{ marginBottom: '0.75rem', fontSize: 14, color: '#999' }}>
          Search results for &quot;{debouncedSearch}&quot;
        </p>
      )}

      {error && (
        <p style={{ color: '#c44', marginBottom: '0.5rem' }}>{error}</p>
      )}

      {uploading && (
        <p style={{ color: '#888', marginBottom: '0.5rem' }}>Uploading…</p>
      )}

      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files?.length) {
            handleFileDrop(e.dataTransfer.files);
          }
        }}
      >
        {loading ? (
          <p style={{ color: '#888' }}>Loading…</p>
        ) : list.length === 0 ? (
          <p style={{ color: '#888' }}>
            {isSearchMode ? 'No results.' : 'This folder is empty.'}
          </p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #333' }}>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Kind</th>
                <th style={thStyle}>Size</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((node) => {
                const isFolder = node.kind === 'folder';
                const isDropTarget = isFolder && dropTarget === node.id;
                const isDragging = draggedNodeId === node.id;
                return (
                  <tr
                    key={node.id}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(NODE_DRAG_TYPE, node.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDraggedNodeId(node.id);
                    }}
                    onDragEnd={() => {
                      setDraggedNodeId(null);
                      setDropTarget('none');
                    }}
                    onDragOver={
                      isFolder
                        ? (e) => {
                            if (
                              e.dataTransfer.types.includes(NODE_DRAG_TYPE) &&
                              node.id !== draggedNodeId
                            ) {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              setDropTarget(node.id);
                            }
                          }
                        : undefined
                    }
                    onDragLeave={() => {
                      if (dropTarget === node.id) setDropTarget('none');
                    }}
                    onDrop={
                      isFolder
                        ? (e) => {
                            e.preventDefault();
                            const nodeId = e.dataTransfer.getData(NODE_DRAG_TYPE);
                            if (nodeId && nodeId !== node.id) {
                              handleMoveByDrop(nodeId, node.id);
                            }
                            setDropTarget('none');
                          }
                        : undefined
                    }
                    style={{
                      borderBottom: '1px solid #222',
                      ...(isDragging ? { opacity: 0.5 } : {}),
                      ...(isDropTarget ? { outline: '2px solid #7ab', outlineOffset: -2 } : {}),
                    }}
                  >
                <td style={tdStyle}>
                  {isFolder && !isSearchMode ? (
                    <button
                      type="button"
                      onClick={() => handleFolderClick(node as Node)}
                      style={linkStyle}
                    >
                      {node.name}
                    </button>
                  ) : isFolder && isSearchMode ? (
                    <button
                      type="button"
                      onClick={() => handleSearchFolderClick(node)}
                      style={linkStyle}
                    >
                      {node.name}
                    </button>
                  ) : (
                    <span>{node.name}</span>
                  )}
                </td>
                <td style={tdStyle}>{node.kind}</td>
                <td style={tdStyle}>
                  {node.size_bytes != null ? formatSize(Number(node.size_bytes)) : '—'}
                </td>
                <td style={tdStyle}>
                  {node.updated_at
                    ? new Date(node.updated_at).toLocaleString()
                    : '—'}
                </td>
                <td style={tdStyle}>
                  {node.kind === 'file' && (
                    <a
                      href={getDownloadUrl(node.id, workspaceId)}
                      download
                      style={{ ...linkStyle, marginRight: '0.5rem' }}
                    >
                      Download
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setModalNode(node as Node);
                      setModal('rename');
                    }}
                    style={linkStyle}
                  >
                    Rename
                  </button>
                  {!isSearchMode && 'blob_id' in node && (
                    <button
                      type="button"
                      onClick={() => {
                        setModalNode(node as Node);
                        setModal('move');
                      }}
                      style={{ ...linkStyle, marginLeft: '0.25rem' }}
                    >
                      Move
                    </button>
                  )}
                </td>
              </tr>
                );
              })}
          </tbody>
        </table>
        )}
      </div>

      {modal === 'createFolder' && (
        <CreateFolderModal
          onClose={() => setModal('none')}
          onSubmit={handleCreateFolder}
        />
      )}
      {modal === 'rename' && modalNode && (
        <RenameModal
          currentName={modalNode.name}
          onClose={() => {
            setModal('none');
            setModalNode(null);
          }}
          onSubmit={handleRename}
        />
      )}
      {modal === 'move' && modalNode && (
        <MoveModal
          nodes={nodes}
          movingNodeId={modalNode.id}
          onClose={() => {
            setModal('none');
            setModalNode(null);
          }}
          onSubmit={handleMove}
        />
      )}
    </div>
  );
}

function CreateFolderModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>New folder</h3>
        <input
          type="text"
          placeholder="Folder name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
          autoFocus
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" onClick={onClose} style={btnStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => name.trim() && onSubmit(name.trim())}
            style={btnStyle}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameModal({
  currentName,
  onClose,
  onSubmit,
}: {
  currentName: string;
  onClose: () => void;
  onSubmit: (newName: string) => void;
}) {
  const [name, setName] = useState(currentName);
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Rename</h3>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={inputStyle}
          autoFocus
        />
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" onClick={onClose} style={btnStyle}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => name.trim() && onSubmit(name.trim())}
            style={btnStyle}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function MoveModal({
  nodes,
  movingNodeId,
  onClose,
  onSubmit,
}: {
  nodes: Node[];
  movingNodeId: string;
  onClose: () => void;
  onSubmit: (newParentId: string | null) => void;
}) {
  const folders = nodes.filter((n) => n.kind === 'folder' && n.id !== movingNodeId);
  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Move to</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <button
            type="button"
            style={btnStyle}
            onClick={() => onSubmit(null)}
          >
            Root
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              style={btnStyle}
              onClick={() => onSubmit(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} style={{ ...btnStyle, marginTop: '1rem' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const btnStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  background: '#2a2a2a',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#e0e0e0',
  cursor: 'pointer',
  fontSize: 14,
};

const linkStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#7ab',
  cursor: 'pointer',
  padding: 0,
  fontSize: 'inherit',
  textDecoration: 'underline',
};

const thStyle: React.CSSProperties = { padding: '0.5rem 0.25rem', fontWeight: 600, fontSize: 12, color: '#999' };
const tdStyle: React.CSSProperties = { padding: '0.5rem 0.25rem', fontSize: 14 };

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 10,
};

const modalStyle: React.CSSProperties = {
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 8,
  padding: '1.25rem',
  minWidth: 280,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.5rem',
  background: '#0f0f0f',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#e0e0e0',
  fontSize: 14,
};
