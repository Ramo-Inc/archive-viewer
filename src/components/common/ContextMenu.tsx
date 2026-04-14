import { useEffect, useRef, useState } from 'react';

// ============================================================
// Context menu (right-click menu)
//
// Rendered at a fixed position. Closes when clicking outside
// or pressing Escape. Items support hover highlight and
// optional separators.
// ============================================================

export interface MenuItem {
  label: string;
  onClick: () => void;
  separator?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Adjust position to stay within viewport
  const [adjustedPos, setAdjustedPos] = useState({ x, y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = x + rect.width > window.innerWidth ? window.innerWidth - rect.width - 4 : x;
    const ny = y + rect.height > window.innerHeight ? window.innerHeight - rect.height - 4 : y;
    setAdjustedPos({ x: Math.max(0, nx), y: Math.max(0, ny) });
  }, [x, y]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    // Use setTimeout to avoid the current right-click event immediately closing the menu
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
      document.addEventListener('keydown', handleKey);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: adjustedPos.x,
        top: adjustedPos.y,
        zIndex: 9000,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: 6,
        padding: '4px 0',
        minWidth: 160,
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }}
    >
      {items.map((item, i) => (
        <div key={i}>
          {item.separator && i > 0 && (
            <div
              style={{
                height: 1,
                background: 'var(--border-color)',
                margin: '4px 8px',
              }}
            />
          )}
          <div
            style={{
              padding: '6px 16px',
              fontSize: 13,
              cursor: 'pointer',
              color: 'var(--text-primary)',
              background: hoveredIndex === i ? 'var(--bg-hover)' : 'transparent',
              transition: 'background 0.1s',
            }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}
