import { useState, useRef, useEffect, useCallback } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import type { SortField, SortOrder } from '../../types';

const SORT_OPTIONS: { label: string; value: SortField }[] = [
  { label: '名前', value: 'title' },
  { label: '追加日', value: 'created_at' },
  { label: 'ランク', value: 'rating' },
  { label: 'ページ数', value: 'page_count' },
];

/**
 * TopBar -- Eagle-style toolbar with sort, filter, grid size, and search.
 * Search uses a 300ms debounce (Errata M-11).
 * Tag filter dropdown (Errata M-7).
 */
export default function TopBar() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const tags = useLibraryStore((s) => s.tags);
  const archives = useLibraryStore((s) => s.archives);
  const loading = useLibraryStore((s) => s.loading);
  const totalCount = useLibraryStore((s) => s.totalCount);

  // Grid size (local state, propagated via custom event or parent prop if needed)
  const [gridSize, setGridSize] = useState(180);

  // Search debounce
  const [searchText, setSearchText] = useState(filter.search_query ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tag dropdown open state
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // Sort dropdown open state
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  // Rank filter dropdown
  const [rankDropdownOpen, setRankDropdownOpen] = useState(false);
  const rankDropdownRef = useRef<HTMLDivElement>(null);

  // Debounced search (300ms, Errata M-11)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (searchText !== (filter.search_query ?? '')) {
        setFilter({ search_query: searchText || undefined });
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false);
      }
      if (rankDropdownRef.current && !rankDropdownRef.current.contains(e.target as Node)) {
        setRankDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Emit grid size changes via custom event so ArchiveGrid can listen
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('grid-size-change', { detail: gridSize }));
  }, [gridSize]);

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.value === filter.sort_by)?.label ?? '名前';

  const handleSortSelect = useCallback(
    (field: SortField) => {
      setFilter({ sort_by: field });
      setSortDropdownOpen(false);
    },
    [setFilter],
  );

  const toggleSortOrder = useCallback(() => {
    const next: SortOrder = filter.sort_order === 'asc' ? 'desc' : 'asc';
    setFilter({ sort_order: next });
  }, [filter.sort_order, setFilter]);

  const handleTagToggle = useCallback(
    (tagId: number) => {
      const current = filter.tag_ids ?? [];
      const next = current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId];
      setFilter({ tag_ids: next.length > 0 ? next : undefined });
    },
    [filter.tag_ids, setFilter],
  );

  const handleRankFilter = useCallback(
    (rank: number) => {
      setFilter({ rating_min: rank === (filter.rating_min ?? 0) ? undefined : rank });
      setRankDropdownOpen(false);
    },
    [filter.rating_min, setFilter],
  );

  const dropdownMenuStyle: React.CSSProperties = {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 4,
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: 4,
    padding: '4px 0',
    zIndex: 1000,
    minWidth: 140,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  };

  const dropdownItemStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    fontSize: 13,
    cursor: 'pointer',
    background: active ? 'var(--bg-hover)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
    whiteSpace: 'nowrap',
  });

  const buttonStyle: React.CSSProperties = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-secondary)',
    borderRadius: 4,
    padding: '4px 10px',
    fontSize: 13,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  };

  return (
    <div
      style={{
        height: 44,
        background: 'var(--bg-tertiary)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 8,
        flexShrink: 0,
      }}
    >
      {/* Sort dropdown */}
      <div ref={sortDropdownRef} style={{ position: 'relative' }}>
        <button
          style={buttonStyle}
          onClick={() => setSortDropdownOpen(!sortDropdownOpen)}
        >
          並び: {currentSortLabel} ▾
        </button>
        {sortDropdownOpen && (
          <div style={dropdownMenuStyle}>
            {SORT_OPTIONS.map((opt) => (
              <div
                key={opt.value}
                style={dropdownItemStyle(filter.sort_by === opt.value)}
                onClick={() => handleSortSelect(opt.value)}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = 'var(--bg-hover)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background =
                    filter.sort_by === opt.value ? 'var(--bg-hover)' : 'transparent')
                }
              >
                {opt.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sort order toggle */}
      <button style={buttonStyle} onClick={toggleSortOrder} title="昇順/降順を切り替え">
        {filter.sort_order === 'asc' ? '↑' : '↓'}
      </button>

      {/* Tag filter dropdown (Errata M-7) */}
      <div ref={tagDropdownRef} style={{ position: 'relative' }}>
        <button
          style={{
            ...buttonStyle,
            color: (filter.tag_ids?.length ?? 0) > 0 ? 'var(--accent)' : buttonStyle.color,
          }}
          onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
        >
          タグ {(filter.tag_ids?.length ?? 0) > 0 ? `(${filter.tag_ids!.length})` : ''} ▾
        </button>
        {tagDropdownOpen && (
          <div style={{ ...dropdownMenuStyle, maxHeight: 240, overflowY: 'auto' }}>
            {tags.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-dim)' }}>
                タグなし
              </div>
            )}
            {tags.map((tag) => {
              const active = (filter.tag_ids ?? []).includes(tag.id);
              return (
                <div
                  key={tag.id}
                  style={{
                    ...dropdownItemStyle(active),
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                  onClick={() => handleTagToggle(tag.id)}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = 'var(--bg-hover)')
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = active ? 'var(--bg-hover)' : 'transparent')
                  }
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 2,
                      background: tag.color ?? 'var(--accent)',
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ flex: 1 }}>{tag.name}</span>
                  {active && <span>✓</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Rank filter */}
      <div ref={rankDropdownRef} style={{ position: 'relative' }}>
        <button
          style={{
            ...buttonStyle,
            color: filter.rating_min ? 'var(--star-color)' : buttonStyle.color,
          }}
          onClick={() => setRankDropdownOpen(!rankDropdownOpen)}
        >
          ★ {filter.rating_min ? `${filter.rating_min}+` : ''} ▾
        </button>
        {rankDropdownOpen && (
          <div style={dropdownMenuStyle}>
            {[0, 1, 2, 3, 4, 5].map((rank) => (
              <div
                key={rank}
                style={dropdownItemStyle(filter.rating_min === rank || (!filter.rating_min && rank === 0))}
                onClick={() => handleRankFilter(rank)}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = 'var(--bg-hover)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = 'transparent')
                }
              >
                {rank === 0 ? 'すべて' : '★'.repeat(rank) + ' 以上'}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Count display */}
      <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>
        {loading ? '読み込み中...' : `${archives.length} / ${totalCount} 件`}
      </span>

      {/* Grid size slider */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          color: 'var(--text-muted)',
        }}
      >
        <span style={{ fontSize: 11 }}>▦</span>
        <input
          type="range"
          min={120}
          max={320}
          step={10}
          value={gridSize}
          onChange={(e) => setGridSize(Number(e.target.value))}
          style={{ width: 80, accentColor: 'var(--accent)' }}
        />
      </label>

      {/* Search box (300ms debounce, Errata M-11) */}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder="検索..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          style={{
            width: 180,
            height: 28,
            background: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            borderRadius: 4,
            padding: '0 8px 0 28px',
            fontSize: 13,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
        <span
          style={{
            position: 'absolute',
            left: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 13,
            color: 'var(--text-dim)',
            pointerEvents: 'none',
          }}
        >
          🔍
        </span>
      </div>
    </div>
  );
}
