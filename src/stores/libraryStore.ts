import { create } from 'zustand';
import type {
  ArchiveSummary,
  ArchiveFilter,
  Folder,
  Tag,
  SmartFolder,
} from '../types';
import { tauriInvoke } from '../hooks/useTauriCommand';

// ============================================================
// Library store — manages folder tree, tags, archive list, etc.
// Designed with selector pattern: consumers pick individual
// slices via `useLibraryStore(s => s.xyz)` to minimise re-renders.
// ============================================================

interface LibraryState {
  // --- data ---
  folders: Folder[];
  tags: Tag[];
  smartFolders: SmartFolder[];
  archives: ArchiveSummary[];
  selectedArchiveIds: Set<string>;
  /** Anchor for Shift+Click range selection (last plain/Ctrl-clicked id). */
  _anchorId: string | null;
  /** Currently applied filter (sent to backend). */
  filter: ArchiveFilter;

  // --- UI flags ---
  loading: boolean;
  error: string | null;

  // --- actions ---
  setFilter: (patch: Partial<ArchiveFilter>) => void;
  resetFilter: () => void;
  fetchArchives: () => Promise<void>;
  fetchFolders: () => Promise<void>;
  fetchTags: () => Promise<void>;
  fetchSmartFolders: () => Promise<void>;
  selectArchive: (id: string, opts?: { ctrl?: boolean; shift?: boolean }) => void;
  selectAll: () => void;
  clearSelection: () => void;
}

const DEFAULT_FILTER: ArchiveFilter = {
  sort_by: 'title',
  sort_order: 'asc',
};

export const useLibraryStore = create<LibraryState>((set, get) => ({
  // --- initial data ---
  folders: [],
  tags: [],
  smartFolders: [],
  archives: [],
  selectedArchiveIds: new Set(),
  _anchorId: null,
  filter: { ...DEFAULT_FILTER },
  loading: false,
  error: null,

  // --- actions ---

  setFilter: (patch) => {
    set((s) => ({
      filter: { ...s.filter, ...patch },
      selectedArchiveIds: new Set<string>(),
      _anchorId: null,
    }));
    // Re-fetch with updated filter
    get().fetchArchives();
  },

  resetFilter: () => {
    set({
      filter: { ...DEFAULT_FILTER },
      selectedArchiveIds: new Set<string>(),
      _anchorId: null,
    });
    get().fetchArchives();
  },

  fetchArchives: async () => {
    const { filter } = get();
    set({ loading: true, error: null });
    try {
      // Backend returns Vec<ArchiveSummary> directly (not paginated)
      const archives = await tauriInvoke<ArchiveSummary[]>('get_archives', { filter });
      set({ archives, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchFolders: async () => {
    try {
      const folders = await tauriInvoke<Folder[]>('get_folders');
      set({ folders });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchTags: async () => {
    try {
      const tags = await tauriInvoke<Tag[]>('get_tags');
      set({ tags });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchSmartFolders: async () => {
    try {
      const smartFolders = await tauriInvoke<SmartFolder[]>('get_smart_folders');
      set({ smartFolders });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  selectArchive: (id, opts = {}) => {
    const { ctrl = false, shift = false } = opts;

    set((s) => {
      const { archives, _anchorId } = s;

      // --- Shift+Click: range selection ---
      if (shift && _anchorId !== null) {
        const anchorIdx = archives.findIndex((a) => a.id === _anchorId);
        const targetIdx = archives.findIndex((a) => a.id === id);

        // If anchor is no longer in the list, fall through to plain click
        if (anchorIdx === -1) {
          return {
            selectedArchiveIds: new Set([id]),
            _anchorId: id,
          };
        }

        const lo = Math.min(anchorIdx, targetIdx);
        const hi = Math.max(anchorIdx, targetIdx);
        const rangeIds = archives.slice(lo, hi + 1).map((a) => a.id);

        if (ctrl) {
          // Ctrl+Shift: add range to existing selection
          const next = new Set(s.selectedArchiveIds);
          for (const rid of rangeIds) next.add(rid);
          return { selectedArchiveIds: next };
          // anchor unchanged
        }

        // Plain Shift: replace selection with range, keep anchor
        return { selectedArchiveIds: new Set(rangeIds) };
      }

      // --- Ctrl+Click: toggle individual ---
      if (ctrl) {
        const next = new Set(s.selectedArchiveIds);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return { selectedArchiveIds: next, _anchorId: id };
      }

      // --- Plain click: single select ---
      return {
        selectedArchiveIds: new Set([id]),
        _anchorId: id,
      };
    });
  },

  selectAll: () => {
    set((s) => ({
      selectedArchiveIds: new Set(s.archives.map((a) => a.id)),
    }));
  },

  clearSelection: () => set({ selectedArchiveIds: new Set(), _anchorId: null }),
}));
