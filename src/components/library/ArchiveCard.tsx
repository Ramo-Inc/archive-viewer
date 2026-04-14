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

      const startX = e.clientX;
      const startY = e.clientY;
      const ids = selectedArchiveIds.has(archive.id)
        ? Array.from(selectedArchiveIds)
        : [archive.id];
      const cardEl = e.currentTarget as HTMLElement;

      let dragStarted = false;
      let highlightedEl: HTMLElement | null = null;

      // Find the nearest element with data-folder-id under the given coords.
      const getFolderEl = (x: number, y: number): HTMLElement | null => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        return (el as HTMLElement).closest('[data-folder-id]') as HTMLElement | null;
      };

      const handleMouseMove = (me: MouseEvent) => {
        if (!dragStarted) {
          // Require at least 5px of movement before treating as drag
          if (Math.hypot(me.clientX - startX, me.clientY - startY) < 5) return;
          dragStarted = true;
          dragState.start(ids);
          document.body.style.cursor = 'grabbing';
          document.body.style.userSelect = 'none';
          cardEl.style.opacity = '0.5';
        }

        // Highlight the folder element under the cursor via outline (non-destructive)
        const newEl = getFolderEl(me.clientX, me.clientY);
        if (newEl === highlightedEl) return;
        if (highlightedEl) {
          highlightedEl.style.outline = '';
          highlightedEl.style.outlineOffset = '';
        }
        if (newEl) {
          newEl.style.outline = '2px solid var(--accent)';
          newEl.style.outlineOffset = '-2px';
        }
        highlightedEl = newEl;
      };

      const cleanup = (ue: MouseEvent) => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', cleanup);
        cardEl.style.opacity = '';
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        if (highlightedEl) {
          highlightedEl.style.outline = '';
          highlightedEl.style.outlineOffset = '';
          highlightedEl = null;
        }
        if (dragStarted) {
          const targetEl = getFolderEl(ue.clientX, ue.clientY);
          if (targetEl) {
            const folderId = targetEl.getAttribute('data-folder-id');
            if (folderId) {
              dragState.drop(folderId);
              return;
            }
          }
          dragState.end();
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
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
