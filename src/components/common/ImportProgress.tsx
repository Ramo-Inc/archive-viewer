import { useImportStore } from '../../stores/importStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';

export default function ImportProgress() {
  const active = useImportStore((s) => s.active);
  const current = useImportStore((s) => s.current);
  const total = useImportStore((s) => s.total);

  if (!active) return null;

  const percent = total > 0 ? (current / total) * 100 : 0;

  const handleCancel = () => {
    tauriInvoke('cancel_import').catch(() => {});
  };

  return (
    <div
      style={{
        height: 48,
        flexShrink: 0,
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
      }}
    >
      {/* Spinner */}
      <div
        style={{
          width: 18,
          height: 18,
          border: '2px solid var(--text-dim)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />

      {/* Text */}
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {current} / {total} インポート中...
      </span>

      {/* Progress bar */}
      <div
        style={{
          flex: 1,
          height: 6,
          background: 'var(--bg-tertiary)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: 'var(--accent)',
            borderRadius: 3,
            transition: 'width 0.2s ease',
          }}
        />
      </div>

      {/* Cancel button */}
      <button
        onClick={handleCancel}
        style={{
          fontSize: 12,
          padding: '4px 12px',
          borderRadius: 4,
          border: '1px solid var(--border-color)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        キャンセル
      </button>
    </div>
  );
}
