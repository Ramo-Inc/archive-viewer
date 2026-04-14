import { useMemo, useCallback, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../stores/libraryStore';
import { dragState } from '../../stores/dragState';
import RankStars from '../common/RankStars';
import type { ArchiveSummary } from '../../types';

interface ArchiveCardProps {
  archive: ArchiveSummary;
  libraryPath: string;
  onDoubleClick?: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, archiveId: string) => void;
}

/**
 * ArchiveCard -- Thumbnail card for a single archive.
 * Uses <img> tag (not backgroundImage). Shows title and rank stars.
 * Selection border, tabIndex={0} and aria-label for accessibility.
 */
export default function ArchiveCard({ archive, libraryPath, onDoubleClick, onContextMenu }: ArchiveCardProps) {
  const selectedArchiveIds = useLibraryStore((s) => s.selectedArchiveIds);
  const selectArchive = useLibraryStore((s) => s.selectArchive);

  const isSelected = selectedArchiveIds.has(archive.id);
  const [imgError, setImgError] = useState(false);

  const thumbnailUrl = useMemo(() => {
    if (!archive.thumbnail_path) return null;
    const thumb = archive.thumbnail_path;
    if (thumb.startsWith('http') || thumb.startsWith('data:')) return thumb;
    const absolutePath = `${libraryPath}/${thumb}`;
    return convertFileSrc(absolutePath);
  }, [archive.thumbnail_path, libraryPath]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      selectArchive(archive.id, e.ctrlKey || e.metaKey);
    },
    [archive.id, selectArchive],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (onDoubleClick) onDoubleClick(archive.id);
      } else if (e.key === ' ') {
        e.preventDefault();
        selectArchive(archive.id, e.ctrlKey || e.metaKey);
      }
    },
    [archive.id, selectArchive, onDoubleClick],
  );

  const handleDoubleClick = useCallback(() => {
    if (onDoubleClick) onDoubleClick(archive.id);
  }, [archive.id, onDoubleClick]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (onContextMenu) onContextMenu(e, archive.id);
    },
    [archive.id, onContextMenu],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // left click only
      const ids = selectedArchiveIds.has(archive.id)
        ? Array.from(selectedArchiveIds)
        : [archive.id];
      dragState.start(ids);
      document.body.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      const cleanup = () => {
        dragState.end();
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mouseup', cleanup);
      };
      document.addEventListener('mouseup', cleanup);
    },
    [archive.id, selectedArchiveIds],
  );

  return (
    <div
      tabIndex={0}
      role="button"
      aria-label={`${archive.title} - ${archive.rank}星`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      style={{
        background: 'var(--bg-card)',
        borderRadius: 6,
        overflow: 'hidden',
        cursor: 'pointer',
        border: isSelected
          ? '2px solid var(--border-selected)'
          : '2px solid transparent',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        display: 'flex',
        flexDirection: 'column',
        outline: 'none',
      }}
      onFocus={(e) => {
        if (!isSelected) e.currentTarget.style.borderColor = 'var(--accent)';
      }}
      onBlur={(e) => {
        if (!isSelected) e.currentTarget.style.borderColor = 'transparent';
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'none';
      }}
    >
      {/* Thumbnail */}
      <div
        style={{
          width: '100%',
          aspectRatio: '3 / 4',
          background: 'var(--bg-secondary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        {thumbnailUrl && !imgError ? (
          <img
            src={thumbnailUrl}
            alt={archive.title}
            loading="lazy"
            draggable={false}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <span style={{ fontSize: 36, color: 'var(--text-dim)' }}>📄</span>
        )}
      </div>

      {/* Info */}
      <div style={{ padding: '6px 8px' }}>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
            marginBottom: 4,
          }}
          title={archive.title}
        >
          {archive.title}
        </div>
        <RankStars value={archive.rank} size={12} readOnly />
      </div>
    </div>
  );
}
