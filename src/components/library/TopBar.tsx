import { useState, useRef, useEffect, useCallback } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';

const SORT_OPTIONS: { label: string; value: string }[] = [
  { label: '名前', value: 'title' },
  { label: '追加日', value: 'created_at' },
  { label: 'ランク', value: 'rank' },
];

/**
 * TopBar -- Eagle-style toolbar with sort, filter, grid size, and search.
 * Search uses a 300ms debounce.
 */
export default function TopBar() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const tags = useLibraryStore((s) => s.tags);
  const archives = useLibraryStore((s) => s.archives);
  const loading = useLibraryStore((s) => s.loading);

  const [gridSize, setGridSize] = useState(180);
  const [searchText, setSearchText] = useState(filter.search_query ?? '');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const [rankDropdownOpen, setRankDropdownOpen] = useState(false);
  const rankDropdownRef = useRef<HTMLDivElement>(null);

  // Debounced search (300ms)
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

  // Emit grid size changes via custom event
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('grid-size-change', { detail: gridSize }));
  }, [gridSize]);

  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.value === filter.sort_by)?.label ?? '名前';

  const handleSortSelect = useCallback(
    (field: string) => {
      setFilter({ sort_by: field });
      setSortDropdownOpen(false);
    },
    [setFilter],
  );

  const toggleSortOrder = useCallback(() => {
    const next = filter.sort_order === 'asc' ? 'desc' : 'asc';
    setFilter({ sort_order: next });
  }, [filter.sort_order, setFilter]);

  const handleTagToggle = useCallback(
    (tagId: string) => {
      const current = filter.filter_tags ?? [];
      const next = current.includes(tagId)
        ? current.filter((id) => id !== tagId)
        : [...current, tagId];
      setFilter({ filter_tags: next.length > 0 ? next : undefined });
    },
    [filter.filter_tags, setFilter],
  );

  const handleRankFilter = useCallback(
    (rank: number) => {
      setFilter({ filter_min_rank: rank === (filter.filter_min_rank ?? 0) ? undefined : rank });
      setRankDropdownOpen(false);
    },
    [filter.filter_min_rank, setFilter],
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

      {/* Tag filter dropdown */}
      <div ref={tagDropdownRef} style={{ position: 'relative' }}>
        <button
          style={{
            ...buttonStyle,
            color: (filter.filter_tags?.length ?? 0) > 0 ? 'var(--accent)' : buttonStyle.color,
          }}
          onClick={() => setTagDropdownOpen(!tagDropdownOpen)}
        >
          タグ {(filter.filter_tags?.length ?? 0) > 0 ? `(${filter.filter_tags!.length})` : ''} ▾
        </button>
        {tagDropdownOpen && (
          <div style={{ ...dropdownMenuStyle, maxHeight: 240, overflowY: 'auto' }}>
            {tags.length === 0 && (
              <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-dim)' }}>
                タグなし
              </div>
            )}
            {tags.map((tag) => {
              const active = (filter.filter_tags ?? []).includes(tag.id);
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
            color: filter.filter_min_rank ? 'var(--star-color)' : buttonStyle.color,
          }}
          onClick={() => setRankDropdownOpen(!rankDropdownOpen)}
        >
          ★ {filter.filter_min_rank ? `${filter.filter_min_rank}+` : ''} ▾
        </button>
        {rankDropdownOpen && (
          <div style={dropdownMenuStyle}>
            {[0, 1, 2, 3, 4, 5].map((rank) => (
              <div
                key={rank}
                style={dropdownItemStyle(filter.filter_min_rank === rank || (!filter.filter_min_rank && rank === 0))}
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
        {loading ? '読み込み中...' : `${archives.length} 件`}
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

      {/* Search box (300ms debounce) */}
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
            padding: '0 8px',
            fontSize: 13,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
      </div>
    </div>
  );
}
