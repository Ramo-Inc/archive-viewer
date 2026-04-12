import { useMemo, useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../stores/libraryStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import RankStars from '../common/RankStars';

interface DetailPanelProps {
  onOpenViewer: (archiveId: string) => void;
}

/**
 * DetailPanel -- Right panel showing details for the selected archive(s).
 * Single selection: cover image, title, rank stars, file info, "Read" button.
 * Multi selection: "N items selected" summary.
 */
export default function DetailPanel({ onOpenViewer }: DetailPanelProps) {
  const archives = useLibraryStore((s) => s.archives);
  const selectedArchiveIds = useLibraryStore((s) => s.selectedArchiveIds);
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);

  const [libraryPath, setLibraryPath] = useState('');

  // Fetch library path for thumbnail URL construction
  useEffect(() => {
    tauriInvoke<string | null>('get_library_path').then((path) => {
      if (path) setLibraryPath(path);
    }).catch(() => {});
  }, []);

  const selectedIds = useMemo(() => Array.from(selectedArchiveIds), [selectedArchiveIds]);
  const selectedArchive = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    return archives.find((a) => a.id === selectedIds[0]) ?? null;
  }, [selectedIds, archives]);

  const thumbnailUrl = useMemo(() => {
    if (!selectedArchive?.thumbnail_path) return null;
    const thumb = selectedArchive.thumbnail_path;
    if (thumb.startsWith('http') || thumb.startsWith('data:')) return thumb;
    const absolutePath = `${libraryPath}/${thumb}`;
    return convertFileSrc(absolutePath);
  }, [selectedArchive?.thumbnail_path, libraryPath]);

  const handleRankChange = useCallback(
    async (newRank: number) => {
      if (!selectedArchive) return;
      try {
        await tauriInvoke('update_archive', {
          id: selectedArchive.id,
          update: { rank: newRank },
        });
        fetchArchives();
      } catch (e) {
        console.error('Failed to update rank:', e);
      }
    },
    [selectedArchive, fetchArchives],
  );

  const handleOpenViewer = useCallback(() => {
    if (selectedArchive) onOpenViewer(selectedArchive.id);
  }, [selectedArchive, onOpenViewer]);

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--text-dim)',
    marginBottom: 2,
  };

  const valueStyle: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--text-secondary)',
    marginBottom: 10,
  };

  // No selection
  if (selectedIds.length === 0) {
    return (
      <aside
        style={{
          width: 280,
          minWidth: 280,
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-color)',
          padding: 16,
          overflowY: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>
          アーカイブを選択してください
        </p>
      </aside>
    );
  }

  // Multiple selection
  if (selectedIds.length > 1) {
    return (
      <aside
        style={{
          width: 280,
          minWidth: 280,
          background: 'var(--bg-secondary)',
          borderLeft: '1px solid var(--border-color)',
          padding: 16,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
          {selectedIds.length}件選択中
        </p>
      </aside>
    );
  }

  // Single selection
  if (!selectedArchive) return null;

  return (
    <aside
      style={{
        width: 280,
        minWidth: 280,
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
        padding: 12,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Cover image */}
      <div
        style={{
          width: '100%',
          aspectRatio: '3 / 4',
          background: 'var(--bg-card)',
          borderRadius: 6,
          overflow: 'hidden',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={selectedArchive.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{ fontSize: 48, color: 'var(--text-dim)' }}>📄</span>
        )}
      </div>

      {/* Title */}
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: 8,
          lineHeight: 1.4,
          wordBreak: 'break-word',
        }}
      >
        {selectedArchive.title}
      </h3>

      {/* Rating */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <RankStars
          value={selectedArchive.rank}
          onChange={handleRankChange}
          size={18}
        />
      </div>

      {/* File info */}
      <div style={labelStyle}>形式</div>
      <div style={valueStyle}>{selectedArchive.format.toUpperCase()}</div>

      <div style={labelStyle}>状態</div>
      <div style={valueStyle}>
        {selectedArchive.is_read ? '既読' : '未読'}
        {selectedArchive.missing && ' (ファイル見つかりません)'}
      </div>

      {/* Open viewer button */}
      <button
        onClick={handleOpenViewer}
        style={{
          width: '100%',
          padding: '10px 0',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
          transition: 'background 0.15s',
          marginTop: 'auto',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--accent-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'var(--accent)';
        }}
      >
        読む
      </button>
    </aside>
  );
}
