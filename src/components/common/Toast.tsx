import { useEffect, useRef } from 'react';
import { useToastStore, type Toast as ToastData } from '../../stores/toastStore';

// ============================================================
// Toast notification UI
// Rendered at bottom-right, auto-dismisses after 3 seconds,
// multiple toasts stack vertically.
// ============================================================

const TOAST_DURATION = 3000;

const typeStyles: Record<ToastData['type'], { bg: string; border: string }> = {
  error: { bg: '#4a1a1a', border: '#aa3333' },
  success: { bg: '#1a3a1a', border: '#33aa33' },
  info: { bg: '#1a1a3a', border: '#6a6aaa' },
};

function ToastItem({ toast }: { toast: ToastData }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      removeToast(toast.id);
    }, TOAST_DURATION);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, removeToast]);

  const { bg, border } = typeStyles[toast.type];

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        padding: '10px 16px',
        color: 'var(--text-primary)',
        fontSize: 13,
        lineHeight: 1.4,
        maxWidth: 360,
        wordBreak: 'break-word',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
      }}
      onClick={() => removeToast(toast.id)}
      title="クリックで閉じる"
    >
      <span style={{ flex: 1 }}>{toast.message}</span>
      <span
        style={{
          fontSize: 16,
          lineHeight: 1,
          opacity: 0.6,
          flexShrink: 0,
        }}
      >
        &times;
      </span>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'auto',
      }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}
