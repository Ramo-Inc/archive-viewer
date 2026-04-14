import { create } from 'zustand';

interface ImportStoreState {
  active: boolean;
  current: number;
  total: number;
  setProgress: (current: number, total: number) => void;
  reset: () => void;
}

export const useImportStore = create<ImportStoreState>((set) => ({
  active: false,
  current: 0,
  total: 0,

  setProgress: (current, total) =>
    set({ active: true, current, total }),

  reset: () =>
    set({ active: false, current: 0, total: 0 }),
}));
