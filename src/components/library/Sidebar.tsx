import { useCallback } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import type { Folder } from '../../types';

interface SidebarItemProps {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  dataFolderId?: string;
}

function SidebarItem({ label, icon, active, onClick, dataFolderId }: SidebarItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-folder-id={dataFolderId}
      onClick={onClick}
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
  activeFolderId: number | null | undefined;
  onSelect: (id: number | null) => void;
}

function FolderItem({ folder, depth, activeFolderId, onSelect }: FolderItemProps) {
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        data-folder-id={String(folder.id)}
        onClick={() => onSelect(folder.id)}
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
          paddingLeft: 10 + depth * 16,
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 13,
          background: activeFolderId === folder.id ? 'var(--bg-hover)' : 'transparent',
          color:
            activeFolderId === folder.id ? 'var(--text-primary)' : 'var(--text-secondary)',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (activeFolderId !== folder.id)
            e.currentTarget.style.background = 'var(--bg-card)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background =
            activeFolderId === folder.id ? 'var(--bg-hover)' : 'transparent';
        }}
      >
        <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>📁</span>
        <span
          style={{
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {folder.name}
        </span>
        {folder.archive_count > 0 && (
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {folder.archive_count}
          </span>
        )}
      </div>
      {folder.children?.map((child) => (
        <FolderItem
          key={child.id}
          folder={child}
          depth={depth + 1}
          activeFolderId={activeFolderId}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}

/**
 * Sidebar -- Left side panel with preset filters, folders, and smart folders.
 * Each item has data-folder-id for D&D, tabIndex={0} and onKeyDown (Errata M-20).
 */
export default function Sidebar() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const resetFilter = useLibraryStore((s) => s.resetFilter);
  const folders = useLibraryStore((s) => s.folders);
  const smartFolders = useLibraryStore((s) => s.smartFolders);

  const isPresetActive = (preset: string) => {
    switch (preset) {
      case 'all':
        return (
          !filter.folder_id &&
          !filter.smart_folder_id &&
          !filter.favorite_only &&
          !filter.rating_min
        );
      case 'favorite':
        return filter.favorite_only === true;
      case 'unread':
        return filter.sort_by === 'last_read_at' && !filter.favorite_only;
      case 'recent':
        return filter.sort_by === 'last_read_at' && filter.sort_order === 'desc';
      default:
        return false;
    }
  };

  const handlePreset = useCallback(
    (preset: string) => {
      switch (preset) {
        case 'all':
          resetFilter();
          break;
        case 'favorite':
          setFilter({
            folder_id: undefined,
            smart_folder_id: undefined,
            favorite_only: true,
          });
          break;
        case 'unread':
          // Unread = never read (read_count == 0), handled backend-side via filter
          setFilter({
            folder_id: undefined,
            smart_folder_id: undefined,
            favorite_only: undefined,
            sort_by: 'last_read_at',
            sort_order: 'asc',
          });
          break;
        case 'recent':
          setFilter({
            folder_id: undefined,
            smart_folder_id: undefined,
            favorite_only: undefined,
            sort_by: 'last_read_at',
            sort_order: 'desc',
          });
          break;
      }
    },
    [resetFilter, setFilter],
  );

  const handleFolderSelect = useCallback(
    (folderId: number | null) => {
      setFilter({
        folder_id: folderId,
        smart_folder_id: undefined,
        favorite_only: undefined,
      });
    },
    [setFilter],
  );

  const handleSmartFolderSelect = useCallback(
    (sfId: number) => {
      setFilter({
        smart_folder_id: sfId,
        folder_id: undefined,
        favorite_only: undefined,
      });
    },
    [setFilter],
  );

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: '12px 10px 4px',
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
      <div style={sectionTitleStyle}>ライブラリ</div>
      <SidebarItem
        label="すべて"
        icon="📚"
        active={isPresetActive('all')}
        onClick={() => handlePreset('all')}
      />
      <SidebarItem
        label="お気に入り"
        icon="❤️"
        active={isPresetActive('favorite')}
        onClick={() => handlePreset('favorite')}
      />
      <SidebarItem
        label="未読"
        icon="📖"
        active={isPresetActive('unread')}
        onClick={() => handlePreset('unread')}
      />
      <SidebarItem
        label="最近読んだ"
        icon="🕐"
        active={isPresetActive('recent')}
        onClick={() => handlePreset('recent')}
      />

      {/* Folder tree */}
      {folders.length > 0 && (
        <>
          <div style={sectionTitleStyle}>フォルダ</div>
          {folders.map((folder) => (
            <FolderItem
              key={folder.id}
              folder={folder}
              depth={0}
              activeFolderId={filter.folder_id}
              onSelect={handleFolderSelect}
            />
          ))}
        </>
      )}

      {/* Smart folders */}
      {smartFolders.length > 0 && (
        <>
          <div style={sectionTitleStyle}>スマートフォルダ</div>
          {smartFolders.map((sf) => (
            <SidebarItem
              key={sf.id}
              label={sf.name}
              icon={sf.icon ?? '🔍'}
              active={filter.smart_folder_id === sf.id}
              onClick={() => handleSmartFolderSelect(sf.id)}
              dataFolderId={`smart-${sf.id}`}
            />
          ))}
        </>
      )}

      {/* Bottom spacer */}
      <div style={{ flex: 1 }} />
    </aside>
  );
}
