import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useViewerStore } from '../stores/viewerStore';

/**
 * ViewerPage — comic/manga reader shell.
 * The actual canvas, page navigation overlay, and sidebar
 * will be implemented in Phase 4.
 */
export default function ViewerPage() {
  const { archiveId } = useParams<{ archiveId: string }>();
  const navigate = useNavigate();

  const openArchive = useViewerStore((s) => s.openArchive);
  const closeArchive = useViewerStore((s) => s.closeArchive);
  const archive = useViewerStore((s) => s.archive);
  const currentPage = useViewerStore((s) => s.currentPage);
  const loading = useViewerStore((s) => s.loading);
  const error = useViewerStore((s) => s.error);
  const nextPage = useViewerStore((s) => s.nextPage);
  const prevPage = useViewerStore((s) => s.prevPage);

  useEffect(() => {
    if (archiveId) {
      openArchive(Number(archiveId));
    }
    return () => {
      closeArchive();
    };
  }, [archiveId, openArchive, closeArchive]);

  const handleBack = () => {
    closeArchive();
    navigate('/');
  };

  if (loading) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-primary)',
          color: 'var(--text-muted)',
        }}
      >
        読み込み中...
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: 'var(--bg-primary)',
        }}
      >
        <p style={{ color: '#e55' }}>エラー: {error}</p>
        <button
          onClick={handleBack}
          style={{
            padding: '8px 24px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          ライブラリに戻る
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#000',
      }}
    >
      {/* Top bar */}
      <div
        style={{
          height: 40,
          background: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 12,
          fontSize: 13,
        }}
      >
        <button
          onClick={handleBack}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          ← 戻る
        </button>
        <span style={{ color: 'var(--text-primary)' }}>
          {archive?.title ?? ''}
        </span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
          {archive
            ? `${currentPage + 1} / ${archive.pages.length}`
            : ''}
        </span>
      </div>

      {/* Canvas area (Phase 4) */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim)',
          position: 'relative',
        }}
      >
        {/* Navigation click zones */}
        <div
          onClick={prevPage}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '30%',
            height: '100%',
            cursor: 'pointer',
          }}
        />
        <div
          onClick={nextPage}
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: '30%',
            height: '100%',
            cursor: 'pointer',
          }}
        />

        {/* Placeholder */}
        (Phase 4 で実装 — ページキャンバス)
      </div>
    </div>
  );
}
