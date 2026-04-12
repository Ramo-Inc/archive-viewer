import React, { useState, useEffect, useCallback } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { useLibraryStore } from '../../stores/libraryStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import ArchiveCard from './ArchiveCard';

interface ArchiveGridProps {
  onOpenViewer: (archiveId: number) => void;
}

/**
 * ArchiveGrid -- Virtualized CSS Grid of archive thumbnail cards.
 * Uses react-virtuoso VirtuosoGrid with components prop + CSS Grid (Errata CR-10).
 * Shows empty state when no archives (Errata M-14).
 */
export default function ArchiveGrid({ onOpenViewer }: ArchiveGridProps) {
  const archives = useLibraryStore((s) => s.archives);
  const loading = useLibraryStore((s) => s.loading);

  // Grid size from TopBar via custom event
  const [gridSize, setGridSize] = useState(180);
  const [libraryPath, setLibraryPath] = useState('');

  // Listen for grid size changes from TopBar
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<number>).detail;
      setGridSize(detail);
    };
    window.addEventListener('grid-size-change', handler);
    return () => window.removeEventListener('grid-size-change', handler);
  }, []);

  // Fetch library path for thumbnail URL construction
  useEffect(() => {
    tauriInvoke<string | null>('get_library_path').then((path) => {
      if (path) setLibraryPath(path);
    }).catch(() => {
      // Silently ignore if command not available
    });
  }, []);

  const handleDoubleClick = useCallback(
    (archiveId: number) => {
      onOpenViewer(archiveId);
    },
    [onOpenViewer],
  );

  // Empty state (Errata M-14)
  if (!loading && archives.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim)',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 48 }}>📁</span>
        <p style={{ fontSize: 14 }}>ファイルをD&Dして追加</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          ZIP、CBZ、RAR、CBR形式に対応
        </p>
      </div>
    );
  }

  // Loading state
  if (loading && archives.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
        }}
      >
        読み込み中...
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: 'hidden' }}>
      <VirtuosoGrid
        totalCount={archives.length}
        overscan={200}
        style={{ height: '100%' }}
        components={{
          List: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
            ({ style, children, ...props }, ref) => (
              <div
                ref={ref}
                {...props}
                style={{
                  ...style,
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))`,
                  gap: 8,
                  padding: 10,
                }}
              >
                {children}
              </div>
            ),
          ),
          Item: ({ children, ...props }) => <div {...props}>{children}</div>,
        }}
        itemContent={(index) => (
          <ArchiveCard
            archive={archives[index]}
            libraryPath={libraryPath}
            onDoubleClick={handleDoubleClick}
          />
        )}
      />
    </div>
  );
}
