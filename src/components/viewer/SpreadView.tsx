import { convertFileSrc } from '@tauri-apps/api/core';
import type { PageInfo } from '../../types';

// ============================================================
// SpreadView — displays one or two pages depending on viewMode
// Handles: cover page solo, is_spread solo, RTL ordering,
// and single-page mode.
// Images are pre-resized by Rust Lanczos3 to display resolution,
// so <img> renders at near-1:1 with no moiré.
// ============================================================

interface SpreadViewProps {
  pages: PageInfo[];
  currentPage: number;
  viewMode: 'spread' | 'single';
}

function pageUrl(page: PageInfo): string {
  const raw = page.url || '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return convertFileSrc(raw);
}

const soloImgStyle: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '100%',
  objectFit: 'contain',
  display: 'block',
};

const spreadImgStyle: React.CSSProperties = {
  maxWidth: '50%',
  maxHeight: '100%',
  objectFit: 'contain',
  display: 'block',
};

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

  // --- Single page mode ---
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
          draggable={false}
          style={soloImgStyle}
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
        <img
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          draggable={false}
          style={soloImgStyle}
        />
      </div>
    );
  }

  // Two-page spread — RTL ordering for manga
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
      }}
    >
      <img
        src={pageUrl(rightPage)}
        alt={`Page ${currentPage + 1}`}
        draggable={false}
        style={spreadImgStyle}
      />
      {leftPage && (
        <img
          src={pageUrl(leftPage)}
          alt={`Page ${currentPage + 2}`}
          draggable={false}
          style={spreadImgStyle}
        />
      )}
    </div>
  );
}
