import { useState, useEffect, useCallback, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { save, open, ask } from '@tauri-apps/plugin-dialog';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';

interface BackupProgress {
  current: number;
  total: number;
  file_name: string;
}

interface BackupComplete {
  success: boolean;
  error: string | null;
}

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<BackupProgress | null>(null);
  const addToast = useToastStore((s) => s.addToast);

  // インポートかエクスポートかを追跡
  const wasImporting = useRef(false);
  // onClose を ref で保持し、useEffect の依存配列から除外
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // イベントリスナー
  useEffect(() => {
    const unlisteners = Promise.all([
      listen<BackupProgress>('backup-progress', (event) => {
        setProgress(event.payload);
      }),
      listen<BackupComplete>('backup-complete', (event) => {
        setProcessing(false);
        setProgress(null);
        const { success, error } = event.payload;
        if (success) {
          if (wasImporting.current) {
            const store = useLibraryStore.getState();
            store.resetFilter();
            store.clearSelection();
            store.fetchArchives();
            store.fetchFolders();
            store.fetchTags();
            store.fetchSmartFolders();
            addToast('バックアップを復元しました', 'success');
            onCloseRef.current();
          } else {
            addToast('バックアップをエクスポートしました', 'success');
          }
        } else {
          addToast(error || 'バックアップに失敗しました', 'error');
        }
        wasImporting.current = false;
      }),
    ]);

    return () => {
      unlisteners.then((fns) => fns.forEach((fn) => fn()));
    };
  }, [addToast]);

  const handleExport = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const destPath = await save({
        title: 'バックアップの保存先',
        defaultPath: `archive-viewer-backup-${today}.zip`,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (!destPath) return;

      setProcessing(true);
      wasImporting.current = false;
      await tauriInvoke('export_backup', { destPath });
    } catch (e) {
      setProcessing(false);
      addToast(`エクスポート失敗: ${String(e)}`, 'error');
    }
  }, [addToast]);

  const handleImport = useCallback(async () => {
    try {
      const zipPath = await open({
        title: 'バックアップZIPを選択',
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        multiple: false,
      });
      if (!zipPath) return;

      const destDir = await open({
        title: '復元先フォルダを選択',
        directory: true,
        multiple: false,
      });
      if (!destDir) return;

      const confirmed = await ask('現在のライブラリを切り替えます。よろしいですか？', {
        title: 'バックアップの復元',
        kind: 'warning',
      });
      if (!confirmed) return;

      setProcessing(true);
      wasImporting.current = true;
      await tauriInvoke('import_backup', {
        zipPath: zipPath as string,
        destDir: destDir as string,
      });
    } catch (e) {
      setProcessing(false);
      addToast(`インポート失敗: ${String(e)}`, 'error');
    }
  }, [addToast]);

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 8000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (!processing && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          padding: 24,
          width: 420,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
            設定
          </div>
          {!processing && (
            <div
              onClick={onClose}
              style={{
                cursor: 'pointer',
                fontSize: 18,
                color: 'var(--text-dim)',
                lineHeight: 1,
              }}
            >
              &times;
            </div>
          )}
        </div>

        {/* Backup section */}
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>
          バックアップ
        </div>

        {/* Export card */}
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
            エクスポート
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            ライブラリ全体をZIPで保存
          </div>
          <button
            onClick={handleExport}
            disabled={processing}
            style={{
              alignSelf: 'flex-end',
              padding: '6px 16px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: processing ? 'var(--bg-hover)' : 'var(--accent)',
              color: processing ? 'var(--text-dim)' : '#fff',
              cursor: processing ? 'not-allowed' : 'pointer',
              fontSize: 13,
            }}
          >
            エクスポート
          </button>
        </div>

        {/* Import card */}
        <div
          style={{
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
            インポート
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            バックアップZIPから復元
          </div>
          <button
            onClick={handleImport}
            disabled={processing}
            style={{
              alignSelf: 'flex-end',
              padding: '6px 16px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: processing ? 'var(--bg-hover)' : 'var(--accent)',
              color: processing ? 'var(--text-dim)' : '#fff',
              cursor: processing ? 'not-allowed' : 'pointer',
              fontSize: 13,
            }}
          >
            インポート
          </button>
        </div>

        {/* Progress bar */}
        {processing && progress && (
          <div
            style={{
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: 'var(--bg-hover)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'var(--accent)',
                  borderRadius: 3,
                  transition: 'width 0.2s ease',
                }}
              />
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {progress.current} / {progress.total} — {progress.file_name}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
