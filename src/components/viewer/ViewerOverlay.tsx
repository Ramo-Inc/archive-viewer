import { useState, useCallback, useRef, useEffect } from 'react';
import ViewerTopBar from './ViewerTopBar';
import PageSlider from './PageSlider';
import SpreadView from './SpreadView';
import type { PageInfo } from '../../types';

// ============================================================
// ViewerOverlay — master container that manages hover UI state
// for the top bar and page slider, plus renders the spread view.
// ============================================================

interface ViewerOverlayProps {
  pages: PageInfo[];
  currentPage: number;
  totalPages: number;
  title: string;
  viewMode: 'spread' | 'single';
  isUIVisible: boolean;
  onBack: () => void;
  onToggleViewMode: () => void;
  onPageChange: (page: number) => void;
  onNext: () => void;
  onPrev: () => void;
  moireReduction: number;
  onMoireChange: (value: number) => void;
  onMoireCommit: (value: number) => void;
}

/** Threshold in pixels from the edge of the screen. */
const EDGE_THRESHOLD = 60;
/** Delay before fading out (ms). */
const FADE_OUT_DELAY = 1500;

export default function ViewerOverlay({
  pages,
  currentPage,
  totalPages,
  title,
  viewMode,
  isUIVisible,
  onBack,
  onToggleViewMode,
  onPageChange,
  onNext,
  onPrev,
  moireReduction,
  onMoireChange,
  onMoireCommit,
}: ViewerOverlayProps) {
  const [showTopBar, setShowTopBar] = useState(false);
  const [showSlider, setShowSlider] = useState(false);

  const topBarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sliderTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (topBarTimer.current) clearTimeout(topBarTimer.current);
      if (sliderTimer.current) clearTimeout(sliderTimer.current);
    };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const { clientY } = e;
      const windowHeight = window.innerHeight;

      // --- Top bar ---
      if (clientY <= EDGE_THRESHOLD) {
        if (topBarTimer.current) {
          clearTimeout(topBarTimer.current);
          topBarTimer.current = null;
        }
        setShowTopBar(true);
      } else {
        if (!topBarTimer.current) {
          topBarTimer.current = setTimeout(() => {
            setShowTopBar(false);
            topBarTimer.current = null;
          }, FADE_OUT_DELAY);
        }
      }

      // --- Slider ---
      if (clientY >= windowHeight - EDGE_THRESHOLD) {
        if (sliderTimer.current) {
          clearTimeout(sliderTimer.current);
          sliderTimer.current = null;
        }
        setShowSlider(true);
      } else {
        if (!sliderTimer.current) {
          sliderTimer.current = setTimeout(() => {
            setShowSlider(false);
            sliderTimer.current = null;
          }, FADE_OUT_DELAY);
        }
      }
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    // Start fade-out timers when mouse leaves the container
    if (!topBarTimer.current) {
      topBarTimer.current = setTimeout(() => {
        setShowTopBar(false);
        topBarTimer.current = null;
      }, FADE_OUT_DELAY);
    }
    if (!sliderTimer.current) {
      sliderTimer.current = setTimeout(() => {
        setShowSlider(false);
        sliderTimer.current = null;
      }, FADE_OUT_DELAY);
    }
  }, []);

  const topBarVisible = isUIVisible || showTopBar;
  const sliderVisible = isUIVisible || showSlider;

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'relative',
        flex: 1,
        display: 'flex',
        overflow: 'hidden',
        background: '#000',
      }}
    >
      {/* Page display */}
      <SpreadView
        pages={pages}
        currentPage={currentPage}
        viewMode={viewMode}
      />

      {/* Top bar overlay */}
      <ViewerTopBar
        title={title}
        currentPage={currentPage}
        totalPages={totalPages}
        viewMode={viewMode}
        onBack={onBack}
        onToggleViewMode={onToggleViewMode}
        visible={topBarVisible}
        moireReduction={moireReduction}
        onMoireChange={onMoireChange}
        onMoireCommit={onMoireCommit}
      />

      {/* Bottom slider overlay */}
      <PageSlider
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={onPageChange}
        onNext={onNext}
        onPrev={onPrev}
        visible={sliderVisible}
      />
    </div>
  );
}
