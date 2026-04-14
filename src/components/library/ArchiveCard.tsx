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
      selectArchive(archive.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    },
    [archive.id, selectArchive],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (onDoubleClick) onDoubleClick(archive.id);
      } else if (e.key === ' ') {
        e.preventDefault();
        selectArchive(archive.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
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
      if (!selectedArchiveIds.has(archive.id)) {
        selectArchive(archive.id);
      }
      if (onContextMenu) onContextMenu(e, archive.id);
    },
    [archive.id, selectedArchiveIds, selectArchive, onContextMenu],
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
      let ghostEl: HTMLElement | null = null;

      // Find the nearest element with data-folder-id under the given coords.
      const getFolderEl = (x: number, y: number): HTMLElement | null => {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        return (el as HTMLElement).closest('[data-folder-id]') as HTMLElement | null;
      };

      // Build a small floating thumbnail that follows the cursor.
      const createGhost = (x: number, y: number): HTMLElement => {
        const ghost = document.createElement('div');
        ghost.style.cssText = `position:fixed;left:${x + 14}px;top:${y + 14}px;pointer-events:none;z-index:9999;opacity:0.92;`;

        // Thumbnail card (position:relative for the badge)
        const thumb = document.createElement('div');
        thumb.style.cssText =
          'position:relative;width:72px;height:96px;border-radius:6px;' +
          'overflow:hidden;border:2px solid var(--accent);background:var(--bg-card);' +
          'display:flex;align-items:center;justify-content:center;' +
          'box-shadow:0 4px 20px rgba(0,0,0,0.6);';

        if (thumbnailUrl) {
          const img = document.createElement('img');
          img.src = thumbnailUrl;
          img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
          thumb.appendChild(img);
        } else {
          const icon = document.createElement('span');
          icon.style.cssText = 'font-size:28px;';
          icon.textContent = '📄';
          thumb.appendChild(icon);
        }

        // Badge showing count when multiple archives are dragged
        if (ids.length > 1) {
          const badge = document.createElement('div');
          badge.style.cssText =
            'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
            'background:rgba(0,0,0,0.7);color:#fff;border-radius:12px;' +
            'font-size:16px;font-weight:700;padding:4px 10px;' +
            'min-width:24px;text-align:center;line-height:1.3;';
          badge.textContent = String(ids.length);
          thumb.appendChild(badge);
        }

        ghost.appendChild(thumb);
        document.body.appendChild(ghost);
        return ghost;
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
          ghostEl = createGhost(me.clientX, me.clientY);
        }

        // Move ghost with cursor
        if (ghostEl) {
          ghostEl.style.left = `${me.clientX + 14}px`;
          ghostEl.style.top = `${me.clientY + 14}px`;
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
        if (ghostEl) {
          ghostEl.remove();
          ghostEl = null;
        }
        if (dragStarted) {
          const targetEl = getFolderEl(ue.clientX, ue.clientY);
          if (targetEl) {
            const folderId = targetEl.getAttribute('data-folder-id');
            if (folderId) {
              dragState.drop(folderId);
            } else {
              dragState.end();
            }
          } else {
            dragState.end();
          }
          // Suppress the next click event via capture phase.
          // Self-removes after the click fires or after the current
          // event loop tick (whichever comes first).
          const suppress = (ce: MouseEvent) => {
            ce.stopPropagation();
            ce.preventDefault();
            document.removeEventListener('click', suppress, true);
          };
          document.addEventListener('click', suppress, true);
          setTimeout(() => document.removeEventListener('click', suppress, true), 0);
        }
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', cleanup);
    },
    [archive.id, selectedArchiveIds, thumbnailUrl],
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
