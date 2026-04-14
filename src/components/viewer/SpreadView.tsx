import type { PageInfo } from '../../types';
import WebGLPage from './WebGLPage';

// ============================================================
// SpreadView — displays one or two pages depending on viewMode.
// Handles: cover page solo, is_spread solo, RTL ordering,
// and single-page mode.
// Images are rendered via WebGL area-averaging shader (Fant)
// matching NeeView's BitmapScalingMode.Fant.
// ============================================================

interface SpreadViewProps {
  pages: PageInfo[];
  currentPage: number;
  viewMode: 'spread' | 'single';
}

const soloStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
};

const spreadRootStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  overflow: 'hidden',
};

const spreadHalfStyle: React.CSSProperties = {
  flex: 1,
  height: '100%',
  minWidth: 0,
  overflow: 'hidden',
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
      <div style={soloStyle}>
        <WebGLPage page={currentPageInfo} />
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
      <div style={soloStyle}>
        <WebGLPage page={currentPageInfo} />
      </div>
    );
  }

  // Two-page spread — LTR flex: left page on left, right page on right
  // Each page is pushed toward the center to eliminate the gap
  const leftPage = pages[currentPage + 1];
  const rightPage = currentPageInfo;

  return (
    <div style={spreadRootStyle}>
      {leftPage && (
        <div style={spreadHalfStyle}>
          <WebGLPage page={leftPage} align="right" />
        </div>
      )}
      <div style={spreadHalfStyle}>
        <WebGLPage page={rightPage} align="left" />
      </div>
    </div>
  );
}
