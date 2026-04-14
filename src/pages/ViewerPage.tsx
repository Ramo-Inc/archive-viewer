import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useViewerStore } from '../stores/viewerStore';
import { tauriInvoke } from '../hooks/useTauriCommand';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import ViewerOverlay from '../components/viewer/ViewerOverlay';

// ============================================================
// ViewerPage — full comic/manga reader.
// Loads archive, resumes last read position, provides keyboard
// shortcuts, and manages save-on-exit.
// Errata HI-7: no async calls from useEffect cleanup — all
// navigation goes through handleBack.
// ============================================================

/**
 * Save the current reading position to the backend.
 * Silently catches errors since the backend command may not
 * be registered yet.
 */
async function savePosition(archiveId: string, page: number): Promise<void> {
  try {
    await tauriInvoke('save_read_position', {
      archiveId,
      page,
    });
  } catch {
    // Command may not be wired up yet — fail silently
    console.warn('[ViewerPage] save_read_position not available');
  }
}

export default function ViewerPage() {
  const { archiveId } = useParams<{ archiveId: string }>();
  const navigate = useNavigate();

  const openArchive = useViewerStore((s) => s.openArchive);
  const closeArchive = useViewerStore((s) => s.closeArchive);
  const archive = useViewerStore((s) => s.archive);
  const currentPage = useViewerStore((s) => s.currentPage);
  const loading = useViewerStore((s) => s.loading);
  const error = useViewerStore((s) => s.error);
  const viewMode = useViewerStore((s) => s.viewMode);
  const setViewMode = useViewerStore((s) => s.setViewMode);
  const nextPage = useViewerStore((s) => s.nextPage);
  const prevPage = useViewerStore((s) => s.prevPage);
  const goToPage = useViewerStore((s) => s.goToPage);

  // UI visibility toggle (for Space key)
  const [isUIVisible, setIsUIVisible] = useState(false);

  // --- Initial load ---
  useEffect(() => {
    if (archiveId) {
      openArchive(archiveId);
    }
    return () => {
      closeArchive();
    };
  }, [archiveId, openArchive, closeArchive]);

  // --- Resume from last read page ---
  // The archive.last_read_at or similar field could carry the position.
  // The backend ArchiveDetail includes last_read_page; the frontend
  // ArchiveDetail type doesn't expose it, but the JSON from Tauri will
  // carry it.  We use a type assertion to read it.
  useEffect(() => {
    if (archive && currentPage === 0) {
      const detail = archive as unknown as Record<string, unknown>;
      const lastReadPage = detail.last_read_page;
      if (typeof lastReadPage === 'number' && lastReadPage > 0) {
        goToPage(lastReadPage);
      }
    }
    // Only run when archive changes (just loaded)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive?.id]);

  // --- Handle back: save position, cleanup, navigate ---
  const handleBack = useCallback(async () => {
    if (archive && archiveId) {
      await savePosition(archiveId, currentPage);
    }
    closeArchive();
    navigate('/');
  }, [archive, archiveId, currentPage, closeArchive, navigate]);

  // --- Toggle UI visibility ---
  const toggleUI = useCallback(() => {
    setIsUIVisible((prev) => !prev);
  }, []);

  // --- Toggle view mode ---
  const handleToggleViewMode = useCallback(() => {
    setViewMode(viewMode === 'spread' ? 'single' : 'spread');
  }, [viewMode, setViewMode]);

  // --- Keyboard shortcuts ---
  useKeyboardShortcuts({
    onBack: handleBack,
    onToggleUI: toggleUI,
  });

  // --- Loading state ---
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

  // --- Error state ---
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

  // --- No archive / empty pages ---
  if (!archive || archive.pages.length === 0) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          background: '#000',
          color: 'var(--text-dim)',
        }}
      >
        <p>ページが見つかりません</p>
        <button
          onClick={handleBack}
          aria-label="ライブラリに戻る"
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

  // --- Main viewer ---
  const effectiveViewMode = viewMode;

  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#000',
      }}
    >
      <ViewerOverlay
        pages={archive.pages}
        currentPage={currentPage}
        totalPages={archive.pages.length}
        title={archive.title}
        viewMode={effectiveViewMode}
        isUIVisible={isUIVisible}
        onBack={handleBack}
        onToggleViewMode={handleToggleViewMode}
        onPageChange={goToPage}
        onNext={nextPage}
        onPrev={prevPage}
      />
    </div>
  );
}
