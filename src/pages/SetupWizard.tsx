import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { tauriInvoke } from '../hooks/useTauriCommand';

interface SetupWizardProps {
  onComplete: () => void;
}

/**
 * First-launch wizard: lets the user pick a library root folder,
 * then calls `init_library` on the backend (Errata CR-2 / E1-2).
 */
export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelectFolder = async () => {
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: 'ライブラリフォルダを選択',
      });
      if (result) {
        setSelectedPath(result as string);
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const handleInit = async () => {
    if (!selectedPath) return;
    setLoading(true);
    setError(null);
    try {
      await tauriInvoke('init_library', { libraryPath: selectedPath });
      onComplete();
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 24,
        background: 'var(--bg-primary)',
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 600 }}>ArchiveViewer セットアップ</h1>
      <p style={{ color: 'var(--text-secondary)', maxWidth: 420, textAlign: 'center' }}>
        漫画・コミックが保存されているフォルダを選択してください。
        選択したフォルダ配下のアーカイブが自動的にライブラリに登録されます。
      </p>

      <button
        onClick={handleSelectFolder}
        style={{
          padding: '12px 32px',
          background: 'var(--accent)',
          color: '#fff',
          border: 'none',
          borderRadius: 6,
          fontSize: 16,
          cursor: 'pointer',
        }}
      >
        フォルダを選択...
      </button>

      {selectedPath && (
        <div
          style={{
            padding: '10px 20px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            maxWidth: 500,
            wordBreak: 'break-all',
            color: 'var(--text-secondary)',
            fontSize: 14,
          }}
        >
          {selectedPath}
        </div>
      )}

      {error && (
        <p style={{ color: '#e55', fontSize: 14 }}>{error}</p>
      )}

      <button
        onClick={handleInit}
        disabled={!selectedPath || loading}
        style={{
          padding: '12px 48px',
          background: selectedPath ? 'var(--accent)' : 'var(--bg-card)',
          color: selectedPath ? '#fff' : 'var(--text-muted)',
          border: 'none',
          borderRadius: 6,
          fontSize: 16,
          cursor: selectedPath ? 'pointer' : 'not-allowed',
          opacity: loading ? 0.6 : 1,
        }}
      >
        {loading ? '初期化中...' : 'ライブラリを作成'}
      </button>
    </div>
  );
}
