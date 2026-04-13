import { convertFileSrc } from '@tauri-apps/api/core';
import type { PageInfo } from '../../types';

// ============================================================
// SpreadView — displays one or two pages depending on viewMode
// Handles: cover page solo, is_spread solo, RTL ordering,
// and single-page mode (Errata HI-8, M-10).
// ============================================================

interface SpreadViewProps {
  pages: PageInfo[];
  currentPage: number;
  viewMode: 'spread' | 'single';
}

/**
 * Build the page image URL from a PageInfo.
 * The Rust backend sends a file path — we use convertFileSrc
 * to create the platform-correct asset URL.
 * (Windows: http://asset.localhost/..., macOS/Linux: asset://localhost/...)
 */
function pageUrl(page: PageInfo): string {
  const raw = page.url || '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return convertFileSrc(raw);
}

/** Build shared img style. */
function pageStyle(maxWidth: string): React.CSSProperties {
  return {
    maxWidth,
    maxHeight: '100%',
    objectFit: 'contain',
    imageRendering: 'smooth' as const,
  };
}

export default function SpreadView({ pages, currentPage, viewMode }: SpreadViewProps) {
  if (pages.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim)',
        }}
      >
        No pages
      </div>
    );
  }

  const currentPageInfo = pages[currentPage];
  if (!currentPageInfo) return null;

  // --- Single page mode (Errata HI-8) ---
  if (viewMode === 'single') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          style={pageStyle('100%')}
          draggable={false}
        />
      </div>
    );
  }

  // --- Spread (two-page) mode ---
  // Cover page (index 0) is always shown solo
  const isCover = currentPage === 0;
  // A spread page (double-width) is shown solo
  const isSpread = currentPageInfo.is_spread;
  // Last page alone if odd
  const isLastAlone =
    currentPage === pages.length - 1 ||
    (currentPage + 1 < pages.length && pages[currentPage + 1].is_spread);

  const showSolo = isCover || isSpread || isLastAlone;

  if (showSolo) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          style={pageStyle('100%')}
          draggable={false}
        />
      </div>
    );
  }

  // Two-page spread — RTL ordering (Errata M-10)
  // direction: rtl makes the first child appear on the right side
  const leftPage = pages[currentPage + 1]; // left side = second page (in RTL, visually left)
  const rightPage = currentPageInfo; // right side = current page

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        direction: 'rtl',
        overflow: 'hidden',
        gap: 0,
      }}
    >
      {/* In RTL flow, first child renders on the right */}
      <img
        src={pageUrl(rightPage)}
        alt={`Page ${currentPage + 1}`}
        style={pageStyle('50%')}
        draggable={false}
      />
      {leftPage && (
        <img
          src={pageUrl(leftPage)}
          alt={`Page ${currentPage + 2}`}
          style={pageStyle('50%')}
          draggable={false}
        />
      )}
    </div>
  );
}
