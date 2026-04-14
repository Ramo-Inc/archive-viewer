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
  selectArchive: (id: string, multi?: boolean) => void;
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
  filter: { ...DEFAULT_FILTER },
  loading: false,
  error: null,

  // --- actions ---

  setFilter: (patch) => {
    set((s) => ({ filter: { ...s.filter, ...patch } }));
    // Re-fetch with updated filter
    get().fetchArchives();
  },

  resetFilter: () => {
    set({ filter: { ...DEFAULT_FILTER } });
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

  selectArchive: (id, multi = false) => {
    set((s) => {
      const next = multi ? new Set(s.selectedArchiveIds) : new Set<string>();
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { selectedArchiveIds: next };
    });
  },

  clearSelection: () => set({ selectedArchiveIds: new Set() }),
}));
