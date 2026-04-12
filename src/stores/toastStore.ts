import { create } from 'zustand';

// ============================================================
// Toast notification store (Errata HI-12)
// Simple fire-and-forget notifications with auto-dismiss.
// ============================================================

export interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success' | 'info';
}

interface ToastState {
  toasts: Toast[];
  addToast: (message: string, type?: 'error' | 'success' | 'info') => void;
  removeToast: (id: string) => void;
}

let nextId = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (message, type = 'info') => {
    const id = `toast-${++nextId}-${Date.now()}`;
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
