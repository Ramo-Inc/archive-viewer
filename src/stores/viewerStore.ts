import { create } from 'zustand';
import type { ArchiveDetail, PageInfo } from '../types';
import { tauriInvoke } from '../hooks/useTauriCommand';

// ============================================================
// Viewer store — page navigation, spread handling, etc.
// nextPage / prevPage honour is_spread, cover page, and
// the current spread (two-page) display mode (Errata E4-3).
// ============================================================

export type ViewMode = 'single' | 'spread' | 'webtoon';
export type PageOrder = 'rtl' | 'ltr';

interface ViewerState {
  // --- data ---
  archive: ArchiveDetail | null;
  currentPage: number;

  // --- settings ---
  viewMode: ViewMode;
  pageOrder: PageOrder;
  /** Whether to show a single page for the first (cover) page in spread mode. */
  coverAlone: boolean;

  // --- UI ---
  loading: boolean;
  error: string | null;
  sidebarOpen: boolean;

  // --- actions ---
  openArchive: (archiveId: number) => Promise<void>;
  closeArchive: () => void;
  goToPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  setViewMode: (mode: ViewMode) => void;
  setPageOrder: (order: PageOrder) => void;
  setCoverAlone: (value: boolean) => void;
  toggleSidebar: () => void;
}

/**
 * How many pages to advance from `current` in `direction`.
 * Takes into account: viewMode, coverAlone, and per-page is_spread.
 */
function computeStep(
  pages: PageInfo[],
  current: number,
  direction: 1 | -1,
  viewMode: ViewMode,
  coverAlone: boolean,
): number {
  // In single or webtoon mode every step is 1
  if (viewMode !== 'spread') return 1;

  // Cover page (index 0) shown alone when coverAlone is true
  if (current === 0 && coverAlone && direction === 1) return 1;

  // If the current page is a spread (double-width), step by 1
  const page = pages[current];
  if (page?.is_spread) return 1;

  // Going forward: check if the *next* page is a spread — if so step 1
  if (direction === 1) {
    const next = pages[current + 1];
    if (!next || next.is_spread) return 1;
    return 2;
  }

  // Going backward: look at previous page
  if (direction === -1) {
    // If we came from the cover-alone page
    if (current === 1 && coverAlone) return 1;
    const prev = pages[current - 1];
    if (!prev) return 1;
    if (prev.is_spread) return 1;
    // Check if two pages back is a spread or cover-alone boundary
    if (current - 2 === 0 && coverAlone) return 1;
    return 2;
  }

  return 1;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  archive: null,
  currentPage: 0,
  viewMode: 'spread',
  pageOrder: 'rtl',
  coverAlone: true,
  loading: false,
  error: null,
  sidebarOpen: false,

  openArchive: async (archiveId) => {
    set({ loading: true, error: null });
    try {
      const archive = await tauriInvoke<ArchiveDetail>('get_archive_detail', {
        archiveId,
      });
      set({ archive, currentPage: 0, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  closeArchive: () => set({ archive: null, currentPage: 0 }),

  goToPage: (page) => {
    const { archive } = get();
    if (!archive) return;
    const clamped = Math.max(0, Math.min(page, archive.pages.length - 1));
    set({ currentPage: clamped });
  },

  nextPage: () => {
    const { archive, currentPage, viewMode, coverAlone } = get();
    if (!archive) return;
    const step = computeStep(
      archive.pages,
      currentPage,
      1,
      viewMode,
      coverAlone,
    );
    const next = Math.min(currentPage + step, archive.pages.length - 1);
    set({ currentPage: next });
  },

  prevPage: () => {
    const { archive, currentPage, viewMode, coverAlone } = get();
    if (!archive) return;
    const step = computeStep(
      archive.pages,
      currentPage,
      -1,
      viewMode,
      coverAlone,
    );
    const prev = Math.max(currentPage - step, 0);
    set({ currentPage: prev });
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  setPageOrder: (order) => set({ pageOrder: order }),
  setCoverAlone: (value) => set({ coverAlone: value }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
