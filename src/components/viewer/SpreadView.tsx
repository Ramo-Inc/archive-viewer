import { convertFileSrc } from '@tauri-apps/api/core';
import type { PageInfo } from '../../types';
import CanvasPage from './CanvasPage';

// ============================================================
// SpreadView — displays one or two pages depending on viewMode
// Handles: cover page solo, is_spread solo, RTL ordering,
// and single-page mode (Errata HI-8, M-10).
// Uses CanvasPage for moire-free rendering via canvas drawImage.
// ============================================================

interface SpreadViewProps {
  pages: PageInfo[];
  currentPage: number;
  viewMode: 'spread' | 'single';
}

/**
 * Build the page image URL from a PageInfo.
 */
function pageUrl(page: PageInfo): string {
  const raw = page.url || '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return convertFileSrc(raw);
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
        <CanvasPage
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          naturalWidth={currentPageInfo.width}
          naturalHeight={currentPageInfo.height}
          maxWidthRatio={1.0}
        />
      </div>
    );
  }

  // --- Spread (two-page) mode ---
  const isCover = currentPage === 0;
  const isSpread = currentPageInfo.is_spread;
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
        <CanvasPage
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          naturalWidth={currentPageInfo.width}
          naturalHeight={currentPageInfo.height}
          maxWidthRatio={1.0}
        />
      </div>
    );
  }

  // Two-page spread — RTL ordering (Errata M-10)
  const leftPage = pages[currentPage + 1];
  const rightPage = currentPageInfo;

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
      <CanvasPage
        src={pageUrl(rightPage)}
        alt={`Page ${currentPage + 1}`}
        naturalWidth={rightPage.width}
        naturalHeight={rightPage.height}
        maxWidthRatio={0.5}
      />
      {leftPage && (
        <CanvasPage
          src={pageUrl(leftPage)}
          alt={`Page ${currentPage + 2}`}
          naturalWidth={leftPage.width}
          naturalHeight={leftPage.height}
          maxWidthRatio={0.5}
        />
      )}
    </div>
  );
}
