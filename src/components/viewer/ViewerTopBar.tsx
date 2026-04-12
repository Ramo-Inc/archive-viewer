// ============================================================
// ViewerTopBar — hover-triggered top bar with back button,
// title, view-mode toggle, and page counter.
// ============================================================

interface ViewerTopBarProps {
  title: string;
  currentPage: number;
  totalPages: number;
  viewMode: 'spread' | 'single';
  onBack: () => void;
  onToggleViewMode: () => void;
  visible: boolean;
}

export default function ViewerTopBar({
  title,
  currentPage,
  totalPages,
  viewMode,
  onBack,
  onToggleViewMode,
  visible,
}: ViewerTopBarProps) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 48,
        background: 'rgba(18, 18, 42, 0.92)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        fontSize: 13,
        zIndex: 100,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.25s ease',
      }}
    >
      <button
        onClick={onBack}
        aria-label="ライブラリに戻る"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 13,
          padding: '4px 8px',
          borderRadius: 4,
        }}
      >
        &larr; 戻る
      </button>

      <span
        style={{
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
          minWidth: 0,
        }}
      >
        {title}
      </span>

      <button
        onClick={onToggleViewMode}
        aria-label={viewMode === 'spread' ? '単ページ表示に切替' : '見開き表示に切替'}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 12,
          padding: '4px 10px',
          borderRadius: 4,
        }}
      >
        {viewMode === 'spread' ? '単ページ' : '見開き'}
      </button>

      <span
        style={{
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          fontSize: 12,
        }}
      >
        {currentPage + 1} / {totalPages}
      </span>
    </div>
  );
}
