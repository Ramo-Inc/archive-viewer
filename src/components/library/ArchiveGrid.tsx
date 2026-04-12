import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import ArchiveCard from './ArchiveCard';
import ContextMenu, { type MenuItem } from '../common/ContextMenu';

interface ArchiveGridProps {
  onOpenViewer: (archiveId: string) => void;
}

// List and Item components defined OUTSIDE the component function
// to prevent recreation on re-render (VirtuosoGrid requirement).
// gridSize is passed via CSS custom property on the wrapper div.
const GridList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, children, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(var(--grid-size, 180px), 1fr))`,
        gap: 8,
        padding: 10,
      }}
    >
      {children}
    </div>
  ),
);
GridList.displayName = 'GridList';

const GridItem = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
  <div {...props}>{children}</div>
);

export default function ArchiveGrid({ onOpenViewer }: ArchiveGridProps) {
  const archives = useLibraryStore((s) => s.archives);
  const loading = useLibraryStore((s) => s.loading);
  const folders = useLibraryStore((s) => s.folders);
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);
  const clearSelection = useLibraryStore((s) => s.clearSelection);
  const addToast = useToastStore((s) => s.addToast);

  const [gridSize, setGridSize] = useState(180);
  const [libraryPath, setLibraryPath] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Update CSS custom property when gridSize changes
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.style.setProperty('--grid-size', `${gridSize}px`);
    }
  }, [gridSize]);

  useEffect(() => {
    const handler = (e: Event) => {
      setGridSize((e as CustomEvent<number>).detail);
    };
    window.addEventListener('grid-size-change', handler);
    return () => window.removeEventListener('grid-size-change', handler);
  }, []);

  useEffect(() => {
    tauriInvoke<string | null>('get_library_path')
      .then((path) => { if (path) setLibraryPath(path); })
      .catch(() => {});
  }, []);

  const handleDoubleClick = useCallback(
    (archiveId: string) => onOpenViewer(archiveId),
    [onOpenViewer],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, archiveId: string) => {
      const items: MenuItem[] = [
        { label: '読む', onClick: () => onOpenViewer(archiveId) },
      ];

      // Add folder items if folders exist
      if (folders.length > 0) {
        for (const folder of folders) {
          items.push({
            label: `→ ${folder.name}`,
            separator: items.length === 1, // separator before first folder
            onClick: async () => {
              try {
                await tauriInvoke('move_archives_to_folder', {
                  archiveIds: [archiveId],
                  folderId: folder.id,
                });
                await fetchArchives();
                addToast(`「${folder.name}」に追加しました`, 'success');
              } catch (err) {
                addToast(`フォルダ追加失敗: ${String(err)}`, 'error');
              }
            },
          });
        }
      }

      items.push({
        label: '削除',
        separator: true,
        onClick: async () => {
          if (!window.confirm('このアーカイブを削除しますか？')) return;
          try {
            await tauriInvoke('delete_archives', { ids: [archiveId] });
            clearSelection();
            await fetchArchives();
            addToast('アーカイブを削除しました', 'success');
          } catch (err) {
            addToast(`削除失敗: ${String(err)}`, 'error');
          }
        },
      });

      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [onOpenViewer, folders, fetchArchives, clearSelection, addToast],
  );

  if (!loading && archives.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', gap: 12 }}>
        <span style={{ fontSize: 48 }}>📁</span>
        <p style={{ fontSize: 14 }}>ファイルをD&Dして追加</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>ZIP、CBZ、RAR、CBR形式に対応</p>
      </div>
    );
  }

  if (loading && archives.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        読み込み中...
      </div>
    );
  }

  return (
    <div ref={wrapperRef} style={{ flex: 1, overflow: 'hidden' }}>
      <VirtuosoGrid
        totalCount={archives.length}
        overscan={200}
        style={{ height: '100%' }}
        components={{ List: GridList, Item: GridItem }}
        itemContent={(index) => (
          <ArchiveCard
            archive={archives[index]}
            libraryPath={libraryPath}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
          />
        )}
      />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
