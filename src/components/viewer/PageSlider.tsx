// ============================================================
// PageSlider — hover-triggered bottom slider for page nav.
// Provides prev/next buttons, a range slider, and page display.
// ============================================================

interface PageSliderProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onNext: () => void;
  onPrev: () => void;
  visible: boolean;
}

export default function PageSlider({
  currentPage,
  totalPages,
  onPageChange,
  onNext,
  onPrev,
  visible,
}: PageSliderProps) {
  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onPageChange(Number(e.target.value));
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: 56,
        background: 'rgba(18, 18, 42, 0.92)',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        zIndex: 100,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? 'auto' : 'none',
        transition: 'opacity 0.25s ease',
      }}
    >
      <button
        onClick={onPrev}
        aria-label="前のページ"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 18,
          padding: '4px 8px',
          lineHeight: 1,
        }}
      >
        &#9664;
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(totalPages - 1, 0)}
        value={currentPage}
        onChange={handleSliderChange}
        aria-label="ページスライダー"
        style={{
          flex: 1,
          accentColor: 'var(--accent)',
          cursor: 'pointer',
        }}
      />

      <button
        onClick={onNext}
        aria-label="次のページ"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: 18,
          padding: '4px 8px',
          lineHeight: 1,
        }}
      >
        &#9654;
      </button>

      <span
        style={{
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          fontSize: 12,
          minWidth: 60,
          textAlign: 'center',
        }}
      >
        {currentPage + 1} / {totalPages}
      </span>
    </div>
  );
}
