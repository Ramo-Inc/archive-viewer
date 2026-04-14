import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import { dragState } from '../../stores/dragState';
import ContextMenu, { type MenuItem } from '../common/ContextMenu';
import SmartFolderEditor from './SmartFolderEditor';
import type { Folder, SmartFolder } from '../../types';

// ============================================================
// Sidebar — Left panel with presets, folders, smart folders.
// Now includes: folder CRUD, smart folder CRUD via modals,
// context menus, and drag-drop targets for archive-to-folder.
// ============================================================

// --- Tree building utility ---
interface FolderNode {
  folder: Folder;
  children: FolderNode[];
  depth: number;
}

interface SmartFolderNode {
  smartFolder: SmartFolder;
  children: SmartFolderNode[];
  depth: number;
}

function buildFolderTree(folders: Folder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];

  for (const f of folders) {
    map.set(f.id, { folder: f, children: [], depth: 0 });
  }

  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parent_id && map.has(f.parent_id)) {
      const parent = map.get(f.parent_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepths(nodes: FolderNode[], d: number) {
    for (const n of nodes) {
      n.depth = d;
      setDepths(n.children, d + 1);
    }
  }
  setDepths(roots, 0);

  // Explicit sort: sort_order then name (don't rely on backend order)
  function sortChildren(nodes: FolderNode[]) {
    nodes.sort((a, b) => a.folder.sort_order - b.folder.sort_order || a.folder.name.localeCompare(b.folder.name));
    for (const n of nodes) sortChildren(n.children);
  }
  sortChildren(roots);

  return roots;
}

function buildSmartFolderTree(smartFolders: SmartFolder[]): SmartFolderNode[] {
  const map = new Map<string, SmartFolderNode>();
  const roots: SmartFolderNode[] = [];

  for (const sf of smartFolders) {
    map.set(sf.id, { smartFolder: sf, children: [], depth: 0 });
  }

  for (const sf of smartFolders) {
    const node = map.get(sf.id)!;
    if (sf.parent_id && map.has(sf.parent_id)) {
      const parent = map.get(sf.parent_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepths(nodes: SmartFolderNode[], d: number) {
    for (const n of nodes) {
      n.depth = d;
      setDepths(n.children, d + 1);
    }
  }
  setDepths(roots, 0);

  function sortChildren(nodes: SmartFolderNode[]) {
    nodes.sort((a, b) => a.smartFolder.sort_order - b.smartFolder.sort_order || a.smartFolder.name.localeCompare(b.smartFolder.name));
    for (const n of nodes) sortChildren(n.children);
  }
  sortChildren(roots);

  return roots;
}

interface SidebarItemProps {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  dataFolderId?: string;
}

function SidebarItem({ label, icon, active, onClick, onContextMenu, dataFolderId }: SidebarItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-folder-id={dataFolderId}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 13,
        background: active ? 'var(--bg-hover)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-card)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? 'var(--bg-hover)' : 'transparent';
      }}
    >
      <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  );
}

interface FolderItemProps {
  folder: Folder;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  activeFolderId: string | null | undefined;
  isEditing: boolean;
  onSelect: (id: string | null) => void;
  onToggleExpand: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, folder: Folder) => void;
  onRenameCommit: (id: string, newName: string) => void;
  onRenameCancel: () => void;
}

function FolderItem({
  folder,
  depth,
  hasChildren,
  isExpanded,
  activeFolderId,
  isEditing,
  onSelect,
  onToggleExpand,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
}: FolderItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editName, setEditName] = useState(folder.name);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      setEditName(folder.name);
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing, folder.name]);

  const indent = 12 + depth * 16;

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== folder.name) {
      onRenameCommit(folder.id, trimmed);
    } else {
      onRenameCancel();
    }
  };

  if (isEditing) {
    return (
      <div style={{ padding: '4px 10px', paddingLeft: indent }}>
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') onRenameCancel();
          }}
          style={{
            width: '100%',
            padding: '4px 8px',
            fontSize: 13,
            borderRadius: 4,
            border: '1px solid var(--accent)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-folder-id={folder.id}
      onClick={() => onSelect(folder.id)}
      onContextMenu={(e) => onContextMenu(e, folder)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(folder.id);
        }
      }}
      onMouseEnter={(e) => {
        if (activeFolderId !== folder.id)
          e.currentTarget.style.background = 'var(--bg-card)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background =
          activeFolderId === folder.id ? 'var(--bg-hover)' : 'transparent';
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 10px',
        paddingLeft: indent,
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 13,
        background: activeFolderId === folder.id ? 'var(--bg-hover)' : 'transparent',
        color: activeFolderId === folder.id ? 'var(--text-primary)' : 'var(--text-secondary)',
        transition: 'background 0.15s',
      }}
    >
      <span
        onClick={(e) => { e.stopPropagation(); if (hasChildren) onToggleExpand(folder.id); }}
        style={{ width: 16, fontSize: 10, textAlign: 'center', cursor: hasChildren ? 'pointer' : 'default', color: 'var(--text-dim)', flexShrink: 0, userSelect: 'none' }}
      >
        {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : ''}
      </span>
      <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>📁</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {folder.name}
      </span>
    </div>
  );
}

export default function Sidebar() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const resetFilter = useLibraryStore((s) => s.resetFilter);
  const folders = useLibraryStore((s) => s.folders);
  const smartFolders = useLibraryStore((s) => s.smartFolders);
  const fetchFolders = useLibraryStore((s) => s.fetchFolders);
  const fetchSmartFolders = useLibraryStore((s) => s.fetchSmartFolders);
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);
  const addToast = useToastStore((s) => s.addToast);

  // --- State ---
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [showSmartFolderEditor, setShowSmartFolderEditor] = useState(false);
  const [editingSmartFolder, setEditingSmartFolder] = useState<SmartFolder | undefined>(undefined);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
  const smartFolderTree = useMemo(() => buildSmartFolderTree(smartFolders), [smartFolders]);

  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
  const [expandedSmartFolderIds, setExpandedSmartFolderIds] = useState<Set<string>>(new Set());

  const [creatingSubfolderId, setCreatingSubfolderId] = useState<string | null>(null);
  const [newSubfolderName, setNewSubfolderName] = useState('');
  const [creatingSfSubfolderId, setCreatingSfSubfolderId] = useState<string | null>(null);

  const startRootFolderCreate = useCallback(() => {
    setCreatingFolder(true);
    setNewFolderName('');
    setCreatingSubfolderId(null);
    setNewSubfolderName('');
  }, []);

  const startSubfolderCreate = useCallback((parentId: string) => {
    setCreatingFolder(false);
    setNewFolderName('');
    setCreatingSubfolderId(parentId);
    setNewSubfolderName('');
    setExpandedFolderIds((prev) => new Set([...prev, parentId]));
  }, []);

  const toggleFolderExpand = useCallback((folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  }, []);

  const toggleSmartFolderExpand = useCallback((sfId: string) => {
    setExpandedSmartFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(sfId)) {
        next.delete(sfId);
      } else {
        next.add(sfId);
      }
      return next;
    });
  }, []);

  const newFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creatingFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [creatingFolder]);

  // --- Preset ---
  const isPresetActive = (preset: string) => {
    if (preset === 'all') {
      return !filter.folder_id && !filter.smart_folder_id && !filter.preset;
    }
    return filter.preset === preset;
  };

  const handlePreset = useCallback(
    (preset: string) => {
      if (preset === 'all') {
        resetFilter();
      } else {
        setFilter({ folder_id: undefined, smart_folder_id: undefined, preset });
      }
    },
    [resetFilter, setFilter],
  );

  // --- Folder select ---
  const handleFolderSelect = useCallback(
    (folderId: string | null) => {
      setFilter({ folder_id: folderId, smart_folder_id: undefined, preset: undefined });
    },
    [setFilter],
  );

  // --- Folder create ---
  const handleCreateFolder = useCallback(async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setCreatingFolder(false);
      setNewFolderName('');
      return;
    }
    try {
      await tauriInvoke('create_folder', { name: trimmed, parentId: null });
      await fetchFolders();
      addToast(`フォルダ「${trimmed}」を作成しました`, 'success');
    } catch (e) {
      addToast(`フォルダ作成失敗: ${String(e)}`, 'error');
    }
    setCreatingFolder(false);
    setNewFolderName('');
  }, [newFolderName, fetchFolders, addToast]);

  // --- Subfolder create ---
  const handleCreateSubfolder = useCallback(async () => {
    const trimmed = newSubfolderName.trim();
    if (!trimmed || !creatingSubfolderId) {
      setCreatingSubfolderId(null);
      setNewSubfolderName('');
      return;
    }
    try {
      await tauriInvoke('create_folder', { name: trimmed, parentId: creatingSubfolderId });
      await fetchFolders();
      setExpandedFolderIds((prev) => new Set([...prev, creatingSubfolderId!]));
      addToast(`サブフォルダ「${trimmed}」を作成しました`, 'success');
    } catch (e) {
      addToast(`サブフォルダ作成失敗: ${String(e)}`, 'error');
    }
    setCreatingSubfolderId(null);
    setNewSubfolderName('');
  }, [newSubfolderName, creatingSubfolderId, fetchFolders, addToast]);

  // --- Folder rename ---
  const handleRenameCommit = useCallback(
    async (folderId: string, newName: string) => {
      try {
        await tauriInvoke('rename_folder', { id: folderId, name: newName });
        await fetchFolders();
      } catch (e) {
        addToast(`名前変更失敗: ${String(e)}`, 'error');
      }
      setEditingFolderId(null);
    },
    [fetchFolders, addToast],
  );

  // --- Folder delete ---
  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      try {
        await tauriInvoke('delete_folder', { id: folderId });
        await fetchFolders();
        const currentFolders = useLibraryStore.getState().folders;
        if (filter.folder_id && !currentFolders.find(f => f.id === filter.folder_id)) {
          resetFilter();
        }
        addToast('フォルダを削除しました', 'success');
      } catch (e) {
        addToast(`フォルダ削除失敗: ${String(e)}`, 'error');
      }
    },
    [fetchFolders, filter.folder_id, resetFilter, addToast],
  );

  // --- Folder context menu ---
  const handleFolderContextMenu = useCallback(
    (e: React.MouseEvent, folder: Folder) => {
      e.preventDefault();
      let depth = 0;
      let currentPid = folder.parent_id;
      const folderMap = new Map(folders.map(f => [f.id, f]));
      while (currentPid) {
        depth++;
        const parent = folderMap.get(currentPid);
        currentPid = parent?.parent_id ?? null;
      }
      const items: MenuItem[] = [];
      if (depth < 4) {
        items.push({
          label: 'サブフォルダを作成',
          onClick: () => startSubfolderCreate(folder.id),
        });
      }
      items.push({ label: '名前変更', onClick: () => setEditingFolderId(folder.id) });
      items.push({ label: '削除', onClick: () => handleDeleteFolder(folder.id), separator: true });
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [handleDeleteFolder, folders, startSubfolderCreate],
  );

  // --- Smart folder select ---
  const handleSmartFolderSelect = useCallback(
    (sfId: string) => {
      setFilter({ smart_folder_id: sfId, folder_id: undefined, preset: undefined });
    },
    [setFilter],
  );

  // --- Smart folder delete ---
  const handleDeleteSmartFolder = useCallback(
    async (sfId: string) => {
      try {
        await tauriInvoke('delete_smart_folder', { id: sfId });
        await fetchSmartFolders();
        const currentSfs = useLibraryStore.getState().smartFolders;
        if (filter.smart_folder_id && !currentSfs.find(sf => sf.id === filter.smart_folder_id)) {
          resetFilter();
        }
        addToast('スマートフォルダを削除しました', 'success');
      } catch (e) {
        addToast(`スマートフォルダ削除失敗: ${String(e)}`, 'error');
      }
    },
    [fetchSmartFolders, filter.smart_folder_id, resetFilter, addToast],
  );

  // --- Smart folder context menu ---
  const handleSmartFolderContextMenu = useCallback(
    (e: React.MouseEvent, sf: SmartFolder) => {
      e.preventDefault();
      let depth = 0;
      let currentPid = sf.parent_id;
      const sfMap = new Map(smartFolders.map(s => [s.id, s]));
      while (currentPid) {
        depth++;
        const parent = sfMap.get(currentPid);
        currentPid = parent?.parent_id ?? null;
      }
      const items: MenuItem[] = [];
      if (depth < 4) {
        items.push({
          label: 'サブスマートフォルダを作成',
          onClick: () => {
            setCreatingSfSubfolderId(sf.id);
            setEditingSmartFolder(undefined);
            setShowSmartFolderEditor(true);
            setExpandedSmartFolderIds((prev) => new Set([...prev, sf.id]));
          },
        });
      }
      items.push({
        label: '編集',
        onClick: () => { setEditingSmartFolder(sf); setShowSmartFolderEditor(true); },
      });
      items.push({ label: '削除', onClick: () => handleDeleteSmartFolder(sf.id), separator: true });
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [handleDeleteSmartFolder, smartFolders],
  );

  // --- Archive drop on folders ---
  // Register drop handler in dragState so ArchiveCard's mouseup can trigger it.
  // dragState.drop(folderId) is called when the mouse is released over a folder element.
  useEffect(() => {
    dragState.setDropHandler(async (folderId: string, archiveIds: string[]) => {
      try {
        await tauriInvoke('handle_internal_drag', {
          archiveIds,
          target: { Folder: folderId },
        });
        await fetchArchives();
        addToast(`${archiveIds.length}件をフォルダに移動しました`, 'success');
      } catch (e) {
        addToast(`フォルダ移動失敗: ${String(e)}`, 'error');
      }
    });
    return () => dragState.clearDropHandler();
  }, [fetchArchives, addToast]);

  // --- Styles ---
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: '12px 10px 4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const addButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'var(--text-dim)',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 4px',
    lineHeight: 1,
  };

  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Scrollable content area */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 6px', display: 'flex', flexDirection: 'column' }}>
      {/* Preset filters */}
      <div style={{ ...sectionTitleStyle, justifyContent: 'flex-start' }}>ライブラリ</div>
      <SidebarItem label="すべて" icon="📚" active={isPresetActive('all')} onClick={() => handlePreset('all')} />
      <SidebarItem label="お気に入り" icon="❤️" active={isPresetActive('favorites')} onClick={() => handlePreset('favorites')} />
      <SidebarItem label="未読" icon="📖" active={isPresetActive('unread')} onClick={() => handlePreset('unread')} />
      <SidebarItem label="最近読んだ" icon="🕐" active={isPresetActive('recent')} onClick={() => handlePreset('recent')} />

      {/* Folder section — always visible */}
      <div style={sectionTitleStyle}>
        <span>フォルダ</span>
        <button
          style={addButtonStyle}
          onClick={startRootFolderCreate}
          title="フォルダを作成"
        >
          +
        </button>
      </div>

      {creatingFolder && (
        <div style={{ padding: '4px 10px' }}>
          <input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={handleCreateFolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
            }}
            placeholder="フォルダ名"
            style={{
              width: '100%',
              padding: '4px 8px',
              fontSize: 13,
              borderRadius: 4,
              border: '1px solid var(--accent)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              outline: 'none',
            }}
          />
        </div>
      )}

      {(() => {
        function renderFolderNodes(nodes: FolderNode[]): React.ReactNode {
          return nodes.map((node) => {
            const hasRealChildren = node.children.length > 0;
            const isCreatingChild = creatingSubfolderId === node.folder.id;
            const hasChildren = hasRealChildren || isCreatingChild;
            return (
              <div key={node.folder.id}>
                <FolderItem
                  folder={node.folder}
                  depth={node.depth}
                  hasChildren={hasChildren}
                  isExpanded={expandedFolderIds.has(node.folder.id)}
                  activeFolderId={filter.folder_id}
                  isEditing={editingFolderId === node.folder.id}
                  onSelect={handleFolderSelect}
                  onToggleExpand={toggleFolderExpand}
                  onContextMenu={handleFolderContextMenu}
                  onRenameCommit={handleRenameCommit}
                  onRenameCancel={() => setEditingFolderId(null)}
                />
                {expandedFolderIds.has(node.folder.id) && hasRealChildren && renderFolderNodes(node.children)}
                {isCreatingChild && (
                  <div style={{ padding: '4px 10px', paddingLeft: 12 + (node.depth + 1) * 16 }}>
                    <input
                      autoFocus
                      value={newSubfolderName}
                      onChange={(e) => setNewSubfolderName(e.target.value)}
                      onBlur={handleCreateSubfolder}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateSubfolder();
                        if (e.key === 'Escape') { setCreatingSubfolderId(null); setNewSubfolderName(''); }
                      }}
                      placeholder="サブフォルダ名"
                      style={{
                        width: '100%',
                        padding: '4px 8px',
                        fontSize: 13,
                        borderRadius: 4,
                        border: '1px solid var(--accent)',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        outline: 'none',
                      }}
                    />
                  </div>
                )}
              </div>
            );
          });
        }
        return renderFolderNodes(folderTree);
      })()}

      {/* Smart folder section — always visible */}
      <div style={sectionTitleStyle}>
        <span>スマートフォルダ</span>
        <button
          style={addButtonStyle}
          onClick={() => { setEditingSmartFolder(undefined); setCreatingSfSubfolderId(null); setShowSmartFolderEditor(true); }}
          title="スマートフォルダを作成"
        >
          +
        </button>
      </div>

      {(() => {
        function renderSmartFolderNodes(nodes: SmartFolderNode[]): React.ReactNode {
          return nodes.map((node) => {
            const sf = node.smartFolder;
            const hasChildren = node.children.length > 0;
            const isExpanded = expandedSmartFolderIds.has(sf.id);
            const indent = 12 + node.depth * 16;
            return (
              <div key={sf.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSmartFolderSelect(sf.id)}
                  onContextMenu={(e) => handleSmartFolderContextMenu(e, sf)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSmartFolderSelect(sf.id);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 10px',
                    paddingLeft: indent,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 13,
                    background: filter.smart_folder_id === sf.id ? 'var(--bg-hover)' : 'transparent',
                    color: filter.smart_folder_id === sf.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (filter.smart_folder_id !== sf.id)
                      e.currentTarget.style.background = 'var(--bg-card)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      filter.smart_folder_id === sf.id ? 'var(--bg-hover)' : 'transparent';
                  }}
                >
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasChildren) toggleSmartFolderExpand(sf.id);
                    }}
                    style={{
                      width: 16,
                      fontSize: 10,
                      textAlign: 'center',
                      cursor: hasChildren ? 'pointer' : 'default',
                      color: 'var(--text-dim)',
                      flexShrink: 0,
                      userSelect: 'none',
                    }}
                  >
                    {hasChildren ? (isExpanded ? '\u25BC' : '\u25B6') : ''}
                  </span>
                  <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>🔍</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sf.name}
                  </span>
                </div>
                {isExpanded && hasChildren && renderSmartFolderNodes(node.children)}
              </div>
            );
          });
        }
        return renderSmartFolderNodes(smartFolderTree);
      })()}

      {/* Bottom spacer */}
      <div style={{ flex: 1 }} />
      </div>

      {/* Fixed footer — always visible */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        <div
          onClick={() => setShowSettingsModal(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 6px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--text-dim)',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = 'transparent';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-dim)';
          }}
        >
          <span style={{ fontSize: 15 }}>&#9881;</span>
          <span>設定</span>
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Smart folder editor modal */}
      {showSmartFolderEditor && (
        <SmartFolderEditor
          existing={editingSmartFolder}
          parentId={creatingSfSubfolderId}
          onClose={() => { setShowSmartFolderEditor(false); setCreatingSfSubfolderId(null); }}
        />
      )}
    </aside>
  );
}
