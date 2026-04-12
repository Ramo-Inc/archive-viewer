import { useMemo, useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../stores/libraryStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import RankStars from '../common/RankStars';

interface DetailPanelProps {
  onOpenViewer: (archiveId: number) => void;
}

/**
 * DetailPanel -- Right panel showing details for the selected archive(s).
 * Single selection: cover image, title, rank stars, file info, tags, memo, "Read" button.
 * Multi selection: "N items selected" summary.
 */
export default function DetailPanel({ onOpenViewer }: DetailPanelProps) {
  const archives = useLibraryStore((s) => s.archives);
  const selectedArchiveIds = useLibraryStore((s) => s.selectedArchiveIds);
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);

  const [libraryPath, setLibraryPath] = useState('');
  const [memo, setMemo] = useState('');

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

  // Sync memo state when selection changes
  useEffect(() => {
    // Reset memo when selection changes - memo would come from archive detail
    setMemo('');
  }, [selectedArchive?.id]);

  const thumbnailUrl = useMemo(() => {
    if (!selectedArchive?.thumbnail) return null;
    const thumb = selectedArchive.thumbnail;
    if (thumb.startsWith('http') || thumb.startsWith('data:')) return thumb;
    const absolutePath = `${libraryPath}/${thumb}`;
    return convertFileSrc(absolutePath);
  }, [selectedArchive?.thumbnail, libraryPath]);

  const handleRatingChange = useCallback(
    async (newRating: number) => {
      if (!selectedArchive) return;
      try {
        await tauriInvoke('update_archive', {
          id: selectedArchive.id,
          update: { rating: newRating },
        });
        fetchArchives();
      } catch (e) {
        console.error('Failed to update rating:', e);
      }
    },
    [selectedArchive, fetchArchives],
  );

  const handleFavoriteToggle = useCallback(async () => {
    if (!selectedArchive) return;
    try {
      await tauriInvoke('update_archive', {
        id: selectedArchive.id,
        update: { favorite: !selectedArchive.favorite },
      });
      fetchArchives();
    } catch (e) {
      console.error('Failed to toggle favorite:', e);
    }
  }, [selectedArchive, fetchArchives]);

  const handleOpenViewer = useCallback(() => {
    if (selectedArchive) onOpenViewer(selectedArchive.id);
  }, [selectedArchive, onOpenViewer]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    try {
      return new Date(dateStr).toLocaleDateString('ja-JP');
    } catch {
      return dateStr;
    }
  };

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
        <span style={{ fontSize: 32 }}>📚</span>
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
          value={selectedArchive.rating}
          onChange={handleRatingChange}
          size={18}
        />
        <button
          onClick={handleFavoriteToggle}
          title={selectedArchive.favorite ? 'お気に入り解除' : 'お気に入り追加'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 18,
            color: selectedArchive.favorite ? '#e55' : 'var(--text-dim)',
            padding: 0,
            lineHeight: 1,
          }}
        >
          {selectedArchive.favorite ? '❤️' : '🤍'}
        </button>
      </div>

      {/* File info */}
      <div style={labelStyle}>ページ数</div>
      <div style={valueStyle}>{selectedArchive.page_count}ページ</div>

      <div style={labelStyle}>パス</div>
      <div
        style={{
          ...valueStyle,
          fontSize: 11,
          wordBreak: 'break-all',
          color: 'var(--text-dim)',
        }}
      >
        {selectedArchive.path}
      </div>

      <div style={labelStyle}>追加日</div>
      <div style={valueStyle}>{formatDate(selectedArchive.created_at)}</div>

      <div style={labelStyle}>最終閲覧</div>
      <div style={valueStyle}>{formatDate(selectedArchive.last_read_at)}</div>

      <div style={labelStyle}>閲覧回数</div>
      <div style={valueStyle}>{selectedArchive.read_count}回</div>

      {/* Tags */}
      {selectedArchive.tags.length > 0 && (
        <>
          <div style={labelStyle}>タグ</div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 4,
              marginBottom: 12,
            }}
          >
            {selectedArchive.tags.map((tag) => (
              <span
                key={tag.id}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                  background: tag.color ? `${tag.color}33` : 'var(--bg-card)',
                  color: tag.color ?? 'var(--text-secondary)',
                  border: `1px solid ${tag.color ?? 'var(--border-color)'}`,
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        </>
      )}

      {/* Memo */}
      <div style={labelStyle}>メモ</div>
      <textarea
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder="メモを入力..."
        style={{
          width: '100%',
          minHeight: 80,
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: 4,
          padding: 8,
          fontSize: 12,
          color: 'var(--text-primary)',
          resize: 'vertical',
          outline: 'none',
          fontFamily: 'inherit',
          marginBottom: 12,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-color)';
        }}
      />

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
