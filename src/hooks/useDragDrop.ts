import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { tauriInvoke } from './useTauriCommand';
import { useLibraryStore } from '../stores/libraryStore';
import { useToastStore } from '../stores/toastStore';

// ============================================================
// External file drag-and-drop handler
//
// Listens for Tauri's native drag-drop event, filters for
// supported archive formats (ZIP/CBZ/CBR), resolves the target
// folder via elementFromPoint + data-folder-id, and invokes the
// backend import command with a 500ms debounce.
// ============================================================

const SUPPORTED_EXTENSIONS = ['.zip', '.cbz', '.cbr'];
const DEBOUNCE_MS = 500;

function isSupportedFile(path: string): boolean {
  const lower = path.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function useDragDrop() {
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const unlisten = listen<{ paths: string[]; position: { x: number; y: number } }>(
      'tauri://drag-drop',
      (event) => {
        // Clear any pending debounce
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
        }

        debounceTimer.current = setTimeout(() => {
          handleDrop(event.payload);
        }, DEBOUNCE_MS);
      },
    );

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      unlisten.then((fn) => fn());
    };
  }, []);
}

async function handleDrop(payload: {
  paths: string[];
  position: { x: number; y: number };
}) {
  const { paths, position } = payload;
  const addToast = useToastStore.getState().addToast;
  const fetchArchives = useLibraryStore.getState().fetchArchives;

  // Filter for supported archive files only
  const archivePaths = paths.filter(isSupportedFile);

  if (archivePaths.length === 0) {
    addToast('サポートされていないファイル形式です。ZIP/CBZ/CBRファイルをドロップしてください。', 'error');
    return;
  }

  // Determine target folder via elementFromPoint + data-folder-id
  let folderId: number | null = null;
  const element = document.elementFromPoint(position.x, position.y);
  if (element) {
    const folderEl = (element as HTMLElement).closest('[data-folder-id]');
    if (folderEl) {
      const raw = folderEl.getAttribute('data-folder-id');
      if (raw !== null) {
        folderId = parseInt(raw, 10);
        if (isNaN(folderId)) folderId = null;
      }
    }
  }

  try {
    await tauriInvoke('import_dropped_files', {
      paths: archivePaths,
      folderId,
    });
    addToast(`${archivePaths.length}件のファイルをインポートしました`, 'success');
    await fetchArchives();
  } catch (e) {
    addToast(`インポートに失敗しました: ${String(e)}`, 'error');
  }
}
