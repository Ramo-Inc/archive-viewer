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
 *
 * The Rust backend sends `url` (e.g. "asset://localhost/...") while
 * the TS PageInfo type declares `filename`. We handle both fields
 * so the component works regardless of which name the backend uses.
 * If neither looks like a URL we use convertFileSrc to create one.
 */
function pageUrl(page: PageInfo): string {
  // The backend's PageInfo.url may arrive as an extra field not in the TS type
  const raw =
    page.filename ||
    (page as unknown as Record<string, string>).url ||
    '';
  // If it already looks like a protocol URL, use as-is
  if (raw.startsWith('asset://') || raw.startsWith('http')) {
    return raw;
  }
  // Convert a local file path to a Tauri asset URL
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
        <img
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
          }}
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
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
          }}
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
        style={{
          maxWidth: '50%',
          maxHeight: '100%',
          objectFit: 'contain',
        }}
        draggable={false}
      />
      {leftPage && (
        <img
          src={pageUrl(leftPage)}
          alt={`Page ${currentPage + 2}`}
          style={{
            maxWidth: '50%',
            maxHeight: '100%',
            objectFit: 'contain',
          }}
          draggable={false}
        />
      )}
    </div>
  );
}
