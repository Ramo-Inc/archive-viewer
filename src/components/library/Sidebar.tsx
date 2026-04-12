import { useState, useCallback, useRef, useEffect } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import ContextMenu, { type MenuItem } from '../common/ContextMenu';
import SmartFolderEditor from './SmartFolderEditor';
import type { Folder, SmartFolder } from '../../types';

// ============================================================
// Sidebar — Left panel with presets, folders, smart folders.
// Now includes: folder CRUD, smart folder CRUD via modals,
// context menus, and drag-drop targets for archive-to-folder.
// ============================================================

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
  activeFolderId: string | null | undefined;
  isEditing: boolean;
  isDropTarget: boolean;
  onSelect: (id: string | null) => void;
  onContextMenu: (e: React.MouseEvent, folder: Folder) => void;
  onRenameCommit: (id: string, newName: string) => void;
  onRenameCancel: () => void;
  onDragOver: (e: React.DragEvent, folderId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, folderId: string) => void;
}

function FolderItem({
  folder,
  activeFolderId,
  isEditing,
  isDropTarget,
  onSelect,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onDragOver,
  onDragLeave,
  onDrop,
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
      <div style={{ padding: '4px 10px' }}>
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
      onDragOver={(e) => onDragOver(e, folder.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, folder.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(folder.id);
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
        background: isDropTarget
          ? 'var(--accent)'
          : activeFolderId === folder.id
            ? 'var(--bg-hover)'
            : 'transparent',
        color: isDropTarget
          ? '#fff'
          : activeFolderId === folder.id
            ? 'var(--text-primary)'
            : 'var(--text-secondary)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!isDropTarget && activeFolderId !== folder.id)
          e.currentTarget.style.background = 'var(--bg-card)';
      }}
      onMouseLeave={(e) => {
        if (!isDropTarget)
          e.currentTarget.style.background =
            activeFolderId === folder.id ? 'var(--bg-hover)' : 'transparent';
      }}
    >
      <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>📁</span>
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
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [showSmartFolderEditor, setShowSmartFolderEditor] = useState(false);
  const [editingSmartFolder, setEditingSmartFolder] = useState<SmartFolder | undefined>(undefined);

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
        if (filter.folder_id === folderId) {
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
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: '名前変更', onClick: () => setEditingFolderId(folder.id) },
          { label: '削除', onClick: () => handleDeleteFolder(folder.id), separator: true },
        ],
      });
    },
    [handleDeleteFolder],
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
        if (filter.smart_folder_id === sfId) {
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
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: '編集',
            onClick: () => {
              setEditingSmartFolder(sf);
              setShowSmartFolderEditor(true);
            },
          },
          { label: '削除', onClick: () => handleDeleteSmartFolder(sf.id), separator: true },
        ],
      });
    },
    [handleDeleteSmartFolder],
  );

  // --- Drag & Drop on folders ---
  const handleFolderDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    if (e.dataTransfer.types.includes('application/x-archive-ids')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetFolderId(folderId);
    }
  }, []);

  const handleFolderDragLeave = useCallback(() => {
    setDropTargetFolderId(null);
  }, []);

  const handleFolderDrop = useCallback(
    async (e: React.DragEvent, folderId: string) => {
      e.preventDefault();
      setDropTargetFolderId(null);
      const data = e.dataTransfer.getData('application/x-archive-ids');
      if (!data) return;
      try {
        const archiveIds: string[] = JSON.parse(data);
        await tauriInvoke('handle_internal_drag', {
          archiveIds,
          target: { Folder: folderId },
        });
        await fetchArchives();
        addToast(`${archiveIds.length}件をフォルダに追加しました`, 'success');
      } catch (e) {
        addToast(`フォルダ追加失敗: ${String(e)}`, 'error');
      }
    },
    [fetchArchives, addToast],
  );

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
        overflowY: 'auto',
        padding: '8px 6px',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
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
          onClick={() => { setCreatingFolder(true); setNewFolderName(''); }}
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

      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          activeFolderId={filter.folder_id}
          isEditing={editingFolderId === folder.id}
          isDropTarget={dropTargetFolderId === folder.id}
          onSelect={handleFolderSelect}
          onContextMenu={handleFolderContextMenu}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={() => setEditingFolderId(null)}
          onDragOver={handleFolderDragOver}
          onDragLeave={handleFolderDragLeave}
          onDrop={handleFolderDrop}
        />
      ))}

      {/* Smart folder section — always visible */}
      <div style={sectionTitleStyle}>
        <span>スマートフォルダ</span>
        <button
          style={addButtonStyle}
          onClick={() => { setEditingSmartFolder(undefined); setShowSmartFolderEditor(true); }}
          title="スマートフォルダを作成"
        >
          +
        </button>
      </div>

      {smartFolders.map((sf) => (
        <SidebarItem
          key={sf.id}
          label={sf.name}
          icon="🔍"
          active={filter.smart_folder_id === sf.id}
          onClick={() => handleSmartFolderSelect(sf.id)}
          onContextMenu={(e) => handleSmartFolderContextMenu(e, sf)}
          dataFolderId={`smart-${sf.id}`}
        />
      ))}

      {/* Bottom spacer */}
      <div style={{ flex: 1 }} />

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
          onClose={() => setShowSmartFolderEditor(false)}
        />
      )}
    </aside>
  );
}
