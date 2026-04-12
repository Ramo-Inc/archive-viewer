import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

// ============================================================
// Drag-and-drop overlay
//
// Shows a translucent overlay when the user drags files over
// the window. Hides when the drag leaves or a drop occurs.
// ============================================================

export default function DragDropZone() {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const unlisteners = Promise.all([
      listen('tauri://drag-enter', () => {
        setDragging(true);
      }),
      listen('tauri://drag-leave', () => {
        setDragging(false);
      }),
      listen('tauri://drag-drop', () => {
        setDragging(false);
      }),
    ]);

    return () => {
      unlisteners.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);

  if (!dragging) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(106, 106, 170, 0.15)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          border: '3px dashed var(--accent)',
          borderRadius: 16,
          padding: '48px 64px',
          background: 'rgba(14, 14, 26, 0.85)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 48,
            marginBottom: 12,
            opacity: 0.8,
          }}
        >
          +
        </div>
        <div
          style={{
            fontSize: 18,
            color: 'var(--text-primary)',
            fontWeight: 500,
          }}
        >
          ファイルをドロップしてインポート
        </div>
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-muted)',
            marginTop: 8,
          }}
        >
          ZIP / CBZ / CBR
        </div>
      </div>
    </div>
  );
}
