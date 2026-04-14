import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { tauriInvoke } from './useTauriCommand';
import { useLibraryStore } from '../stores/libraryStore';
import { useImportStore } from '../stores/importStore';
import { useToastStore } from '../stores/toastStore';

const SUPPORTED_EXTENSIONS = ['.zip', '.cbz', '.cbr', '.rar'];
const DEBOUNCE_MS = 500;

function isSupportedFile(path: string): boolean {
  const lower = path.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function useDragDrop() {
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const unlisteners = Promise.all([
      // ドロップイベント
      listen<{ paths: string[]; position: { x: number; y: number } }>(
        'tauri://drag-drop',
        (event) => {
          if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
          }
          debounceTimer.current = setTimeout(() => {
            handleDrop(event.payload);
          }, DEBOUNCE_MS);
        },
      ),

      // インポート進捗イベント
      listen<{ current: number; total: number; file_name: string }>(
        'import-progress',
        (event) => {
          const { current, total } = event.payload;
          useImportStore.getState().setProgress(current, total);
        },
      ),

      // インポート完了イベント
      listen<{ imported: number; total: number; cancelled: boolean; errors: string[] }>(
        'import-complete',
        (event) => {
          const { imported, total, cancelled, errors } = event.payload;
          useImportStore.getState().reset();

          const addToast = useToastStore.getState().addToast;
          if (cancelled && imported === 0) {
            addToast('インポートをキャンセルしました', 'info');
          } else if (cancelled) {
            addToast(`${imported}件インポート済み（キャンセル）`, 'info');
          } else if (errors.length === 0) {
            addToast(`${imported}件のファイルをインポートしました`, 'success');
          } else if (imported > 0) {
            addToast(`${imported}/${total}件インポート完了（${errors.length}件失敗）`, 'error');
          } else {
            addToast('インポートに失敗しました', 'error');
          }

          useLibraryStore.getState().fetchArchives();
        },
      ),
    ]);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      unlisteners.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);
}

async function handleDrop(payload: {
  paths: string[];
  position: { x: number; y: number };
}) {
  const { paths, position } = payload;
  const addToast = useToastStore.getState().addToast;

  // インポート中なら拒否
  if (useImportStore.getState().active) {
    addToast('インポート処理中です。完了後に再度お試しください。', 'info');
    return;
  }

  const archivePaths = paths.filter(isSupportedFile);

  if (archivePaths.length === 0) {
    addToast('サポートされていないファイル形式です。ZIP/CBZ/CBRファイルをドロップしてください。', 'error');
    return;
  }

  // ドロップ先フォルダを判定
  let folderId: string | null = null;
  const element = document.elementFromPoint(position.x, position.y);
  if (element) {
    const folderEl = (element as HTMLElement).closest('[data-folder-id]');
    if (folderEl) {
      const raw = folderEl.getAttribute('data-folder-id');
      if (raw !== null && !raw.startsWith('smart-')) {
        folderId = raw;
      }
    }
  }

  try {
    // プログレスバーを即座に表示 (バックエンドからの最初のイベント前)
    useImportStore.getState().setProgress(0, archivePaths.length);

    // バックエンドはスレッドをspawnして即座にOKを返す
    // 進捗はimport-progress/import-completeイベントで受信
    await tauriInvoke('import_dropped_files', {
      filePaths: archivePaths,
      folderId,
    });
  } catch (e) {
    useImportStore.getState().reset();
    addToast(`インポート開始に失敗しました: ${String(e)}`, 'error');
  }
}
