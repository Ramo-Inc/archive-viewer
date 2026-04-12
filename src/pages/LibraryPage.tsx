import { useEffect } from 'react';
import { useLibraryStore } from '../stores/libraryStore';

/**
 * LibraryPage — 3-pane layout shell.
 * Left : Folder tree + tag list  (Phase 3)
 * Center: Archive grid / list     (Phase 3)
 * Right : Detail / metadata panel (Phase 3)
 *
 * This placeholder wires up the initial data fetch and renders the layout skeleton.
 */
export default function LibraryPage() {
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);
  const fetchFolders = useLibraryStore((s) => s.fetchFolders);
  const fetchTags = useLibraryStore((s) => s.fetchTags);
  const loading = useLibraryStore((s) => s.loading);
  const archives = useLibraryStore((s) => s.archives);

  useEffect(() => {
    fetchFolders();
    fetchTags();
    fetchArchives();
  }, [fetchArchives, fetchFolders, fetchTags]);

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Left pane — Folder tree / tags */}
      <aside
        style={{
          width: 240,
          minWidth: 240,
          background: 'var(--bg-secondary)',
          borderRight: '1px solid var(--border-color)',
          padding: 12,
          overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>
          フォルダ
        </h2>
        {/* FolderTree component will go here in Phase 3 */}
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          (Phase 3 で実装)
        </div>
      </aside>

      {/* Center pane — Archive grid */}
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Toolbar placeholder */}
        <div
          style={{
            height: 48,
            background: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            fontSize: 14,
            color: 'var(--text-secondary)',
          }}
        >
          {loading ? '読み込み中...' : `${archives.length} 件のアーカイブ`}
        </div>

        {/* Grid area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-dim)',
          }}
        >
          {/* ArchiveGrid component will go here in Phase 3 */}
          (Phase 3 で実装)
        </div>
      </main>

      {/* Right pane — Detail panel */}
      <aside
        style={{
          width: 280,
          minWidth: 280,
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-color)',
          padding: 12,
          overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 8 }}>
          詳細
        </h2>
        {/* DetailPanel component will go here in Phase 3 */}
        <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>
          (Phase 3 で実装)
        </div>
      </aside>
    </div>
  );
}
