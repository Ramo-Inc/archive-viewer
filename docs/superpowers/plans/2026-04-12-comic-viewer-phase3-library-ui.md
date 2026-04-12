# ComicViewer Phase 3: Library UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 3ペインレイアウト（サイドバー + グリッド + 詳細パネル）のライブラリ画面を構築し、サムネイルグリッド表示、フィルタ、ソート、検索、タグ・ランク編集ができるようにする

**Architecture:** zustandでUI状態管理、Tauri invokeでバックエンドと通信。サムネイルはasset protocol + convertFileSrcで配信。グリッドはreact-virtuosoで仮想スクロール。

**Tech Stack:** React 18, TypeScript, zustand, react-virtuoso, @tauri-apps/api

**PRD参照:** `docs/superpowers/specs/2026-04-12-comic-viewer-design.md` セクション 6

**前提:** Phase 1, Phase 2 が完了していること

---

## File Structure (Phase 3)

```
src/
├── stores/
│   └── libraryStore.ts
├── components/
│   ├── library/
│   │   ├── TopBar.tsx
│   │   ├── Sidebar.tsx
│   │   ├── ArchiveGrid.tsx
│   │   ├── ArchiveCard.tsx
│   │   ├── DetailPanel.tsx
│   │   ├── TagEditor.tsx
│   │   └── SmartFolderEditor.tsx
│   └── common/
│       ├── RankStars.tsx
│       └── ContextMenu.tsx
├── hooks/
│   └── useTauriCommand.ts
├── pages/
│   └── LibraryPage.tsx          — (更新) 3ペインレイアウト
```

---

### Task 1: Tauri invoke ラッパーフック

**Files:**
- Create: `src/hooks/useTauriCommand.ts`

- [ ] **Step 1: useTauriCommand.ts を作成**

```typescript
// src/hooks/useTauriCommand.ts
import { invoke } from '@tauri-apps/api/core';

export async function tauriInvoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/hooks/useTauriCommand.ts
git commit -m "feat: add Tauri invoke wrapper hook"
```

---

### Task 2: zustand ライブラリストア

**Files:**
- Create: `src/stores/libraryStore.ts`

- [ ] **Step 1: libraryStore.ts を作成**

```typescript
// src/stores/libraryStore.ts
import { create } from 'zustand';
import type { ArchiveSummary, Folder, Tag, SmartFolder } from '../types';
import { tauriInvoke } from '../hooks/useTauriCommand';

interface LibraryState {
  archives: ArchiveSummary[];
  folders: Folder[];
  smartFolders: SmartFolder[];
  tags: Tag[];

  selectedArchiveIds: string[];
  currentFolderId: string | null;
  currentSmartFolderId: string | null;
  currentPreset: string | null;
  gridSize: number;

  sortBy: 'name' | 'created_at' | 'rank' | 'file_size';
  sortOrder: 'asc' | 'desc';
  filterTags: string[];
  filterMinRank: number;
  searchQuery: string;

  // Actions
  fetchArchives: () => Promise<void>;
  fetchFolders: () => Promise<void>;
  fetchTags: () => Promise<void>;
  fetchSmartFolders: () => Promise<void>;
  setSelectedArchiveIds: (ids: string[]) => void;
  toggleArchiveSelection: (id: string, ctrlKey: boolean) => void;
  setCurrentFolder: (id: string | null) => void;
  setCurrentSmartFolder: (id: string | null) => void;
  setCurrentPreset: (preset: string | null) => void;
  setGridSize: (size: number) => void;
  setSortBy: (sortBy: 'name' | 'created_at' | 'rank' | 'file_size') => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  setSearchQuery: (query: string) => void;
  setFilterMinRank: (rank: number) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  archives: [],
  folders: [],
  smartFolders: [],
  tags: [],
  selectedArchiveIds: [],
  currentFolderId: null,
  currentSmartFolderId: null,
  currentPreset: null,
  gridSize: 160,
  sortBy: 'name',
  sortOrder: 'asc',
  filterTags: [],
  filterMinRank: 0,
  searchQuery: '',

  fetchArchives: async () => {
    try {
      const archives = await tauriInvoke<ArchiveSummary[]>('get_archives');
      set({ archives });
    } catch (e) {
      console.error('Failed to fetch archives:', e);
    }
  },

  fetchFolders: async () => {
    try {
      const folders = await tauriInvoke<Folder[]>('get_folders');
      set({ folders });
    } catch (e) {
      console.error('Failed to fetch folders:', e);
    }
  },

  fetchTags: async () => {
    try {
      const tags = await tauriInvoke<Tag[]>('get_tags');
      set({ tags });
    } catch (e) {
      console.error('Failed to fetch tags:', e);
    }
  },

  fetchSmartFolders: async () => {
    try {
      const smartFolders = await tauriInvoke<SmartFolder[]>('get_smart_folders');
      set({ smartFolders });
    } catch (e) {
      console.error('Failed to fetch smart folders:', e);
    }
  },

  setSelectedArchiveIds: (ids) => set({ selectedArchiveIds: ids }),

  toggleArchiveSelection: (id, ctrlKey) => {
    const { selectedArchiveIds } = get();
    if (ctrlKey) {
      const exists = selectedArchiveIds.includes(id);
      set({
        selectedArchiveIds: exists
          ? selectedArchiveIds.filter((i) => i !== id)
          : [...selectedArchiveIds, id],
      });
    } else {
      set({ selectedArchiveIds: [id] });
    }
  },

  setCurrentFolder: (id) => set({ currentFolderId: id, currentSmartFolderId: null, currentPreset: null }),
  setCurrentSmartFolder: (id) => set({ currentSmartFolderId: id, currentFolderId: null, currentPreset: null }),
  setCurrentPreset: (preset) => set({ currentPreset: preset, currentFolderId: null, currentSmartFolderId: null }),
  setGridSize: (size) => set({ gridSize: size }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSortOrder: (order) => set({ sortOrder: order }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setFilterMinRank: (rank) => set({ filterMinRank: rank }),
}));
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/stores/libraryStore.ts
git commit -m "feat: add zustand library store with all state and actions"
```

---

### Task 3: RankStars 共通コンポーネント

**Files:**
- Create: `src/components/common/RankStars.tsx`

- [ ] **Step 1: RankStars.tsx を作成**

```tsx
// src/components/common/RankStars.tsx
import { useState } from 'react';

interface RankStarsProps {
  rank: number;
  onChange?: (rank: number) => void;
  readonly?: boolean;
  size?: number;
}

export default function RankStars({ rank, onChange, readonly = false, size = 16 }: RankStarsProps) {
  const [hoverRank, setHoverRank] = useState(0);

  return (
    <div style={{ display: 'flex', gap: 2, cursor: readonly ? 'default' : 'pointer' }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span
          key={star}
          style={{
            fontSize: size,
            color: star <= (hoverRank || rank) ? 'var(--star-color)' : 'var(--text-dim)',
            transition: 'color 0.1s',
          }}
          onMouseEnter={() => !readonly && setHoverRank(star)}
          onMouseLeave={() => !readonly && setHoverRank(0)}
          onClick={() => {
            if (!readonly && onChange) {
              onChange(star === rank ? 0 : star);
            }
          }}
        >
          ★
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/common/RankStars.tsx
git commit -m "feat: add RankStars component with hover and click"
```

---

### Task 4: Sidebar コンポーネント

**Files:**
- Create: `src/components/library/Sidebar.tsx`

- [ ] **Step 1: Sidebar.tsx を作成**

```tsx
// src/components/library/Sidebar.tsx
import { useLibraryStore } from '../../stores/libraryStore';

export default function Sidebar() {
  const {
    folders, smartFolders, currentFolderId, currentSmartFolderId, currentPreset,
    setCurrentFolder, setCurrentSmartFolder, setCurrentPreset,
  } = useLibraryStore();

  const presets = [
    { id: 'all', label: 'すべて', icon: '📚' },
    { id: 'favorites', label: 'お気に入り', icon: '⭐' },
    { id: 'unread', label: '未読', icon: '📖' },
    { id: 'recent', label: '最近読んだ', icon: '🕐' },
  ];

  return (
    <div style={{
      width: 180, background: 'var(--bg-secondary)', padding: 10,
      borderRight: '1px solid var(--border-color)', overflowY: 'auto',
      display: 'flex', flexDirection: 'column', flexShrink: 0,
    }}>
      <SectionLabel>ライブラリ</SectionLabel>
      {presets.map((p) => (
        <SidebarItem
          key={p.id}
          label={`${p.icon} ${p.label}`}
          active={currentPreset === p.id || (p.id === 'all' && !currentPreset && !currentFolderId && !currentSmartFolderId)}
          onClick={() => setCurrentPreset(p.id === 'all' ? null : p.id)}
        />
      ))}

      <SectionLabel style={{ marginTop: 14 }}>フォルダ</SectionLabel>
      {folders.map((f) => (
        <SidebarItem
          key={f.id}
          label={`📁 ${f.name}`}
          active={currentFolderId === f.id}
          onClick={() => setCurrentFolder(f.id)}
          data-folder-id={f.id}
        />
      ))}

      <SectionLabel style={{ marginTop: 14 }}>スマートフォルダ</SectionLabel>
      {smartFolders.map((sf) => (
        <SidebarItem
          key={sf.id}
          label={`🔮 ${sf.name}`}
          active={currentSmartFolderId === sf.id}
          onClick={() => setCurrentSmartFolder(sf.id)}
        />
      ))}
    </div>
  );
}

function SectionLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase',
      letterSpacing: 1, marginBottom: 6, ...style,
    }}>
      {children}
    </div>
  );
}

function SidebarItem({ label, active, onClick, ...rest }: {
  label: string; active: boolean; onClick: () => void;
  [key: string]: unknown;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontSize: 12, padding: '5px 8px', marginBottom: 2, cursor: 'pointer',
        background: active ? 'var(--bg-card)' : 'transparent',
        borderRadius: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}
      {...rest}
    >
      {label}
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/library/Sidebar.tsx
git commit -m "feat: add Sidebar with presets, folders, smart folders"
```

---

### Task 5: ArchiveCard コンポーネント

**Files:**
- Create: `src/components/library/ArchiveCard.tsx`

- [ ] **Step 1: ArchiveCard.tsx を作成**

```tsx
// src/components/library/ArchiveCard.tsx
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ArchiveSummary } from '../../types';
import RankStars from '../common/RankStars';

interface ArchiveCardProps {
  archive: ArchiveSummary;
  size: number;
  selected: boolean;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
}

export default function ArchiveCard({ archive, size, selected, onClick, onDoubleClick }: ArchiveCardProps) {
  const thumbnailUrl = archive.thumbnail_path
    ? convertFileSrc(archive.thumbnail_path)
    : undefined;

  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        width: size,
        cursor: 'pointer',
        borderRadius: 6,
        border: selected ? '2px solid var(--border-selected)' : '2px solid transparent',
        background: selected ? 'var(--bg-selected)' : 'var(--bg-card)',
        overflow: 'hidden',
        transition: 'border-color 0.15s',
      }}
    >
      <div style={{
        width: '100%',
        aspectRatio: '2/3',
        background: 'var(--bg-tertiary)',
        backgroundImage: thumbnailUrl ? `url(${thumbnailUrl})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }} />
      <div style={{ padding: '6px 8px' }}>
        <div style={{
          fontSize: 11, color: 'var(--text-secondary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {archive.title}
        </div>
        {archive.rank > 0 && <RankStars rank={archive.rank} readonly size={10} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/library/ArchiveCard.tsx
git commit -m "feat: add ArchiveCard with thumbnail via asset protocol"
```

---

### Task 6: ArchiveGrid（仮想スクロール）

**Files:**
- Create: `src/components/library/ArchiveGrid.tsx`

- [ ] **Step 1: react-virtuoso をインストール**

```bash
cd d:/Dev/App/ComicViewer
npm install react-virtuoso
```

- [ ] **Step 2: ArchiveGrid.tsx を作成**

```tsx
// src/components/library/ArchiveGrid.tsx
import { useMemo, useCallback } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { useLibraryStore } from '../../stores/libraryStore';
import ArchiveCard from './ArchiveCard';

interface ArchiveGridProps {
  onOpenViewer: (archiveId: string) => void;
}

export default function ArchiveGrid({ onOpenViewer }: ArchiveGridProps) {
  const {
    archives, selectedArchiveIds, gridSize,
    toggleArchiveSelection, sortBy, sortOrder,
    filterMinRank, searchQuery,
  } = useLibraryStore();

  const filtered = useMemo(() => {
    let result = [...archives];

    if (filterMinRank > 0) {
      result = result.filter((a) => a.rank >= filterMinRank);
    }

    // ソートはバックエンドで行うが、フロントでも対応
    result.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.title.localeCompare(b.title, 'ja');
      else if (sortBy === 'rank') cmp = a.rank - b.rank;
      return sortOrder === 'desc' ? -cmp : cmp;
    });

    return result;
  }, [archives, filterMinRank, sortBy, sortOrder, searchQuery]);

  const handleClick = useCallback((id: string, e: React.MouseEvent) => {
    toggleArchiveSelection(id, e.ctrlKey || e.metaKey);
  }, [toggleArchiveSelection]);

  return (
    <div style={{ flex: 1, overflow: 'hidden' }}>
      <VirtuosoGrid
        totalCount={filtered.length}
        listClassName="archive-grid-list"
        itemClassName="archive-grid-item"
        style={{ height: '100%' }}
        itemContent={(index) => {
          const archive = filtered[index];
          if (!archive) return null;
          return (
            <ArchiveCard
              archive={archive}
              size={gridSize}
              selected={selectedArchiveIds.includes(archive.id)}
              onClick={(e) => handleClick(archive.id, e)}
              onDoubleClick={() => onOpenViewer(archive.id)}
            />
          );
        }}
      />
      <style>{`
        .archive-grid-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          padding: 10px;
        }
        .archive-grid-item {
          display: flex;
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/library/ArchiveGrid.tsx package.json package-lock.json
git commit -m "feat: add ArchiveGrid with react-virtuoso virtual scroll"
```

---

### Task 7: DetailPanel コンポーネント

**Files:**
- Create: `src/components/library/DetailPanel.tsx`

- [ ] **Step 1: DetailPanel.tsx を作成**

```tsx
// src/components/library/DetailPanel.tsx
import { useEffect, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ArchiveDetail } from '../../types';
import { useLibraryStore } from '../../stores/libraryStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import RankStars from '../common/RankStars';

interface DetailPanelProps {
  onOpenViewer: (archiveId: string) => void;
}

export default function DetailPanel({ onOpenViewer }: DetailPanelProps) {
  const { selectedArchiveIds, fetchArchives } = useLibraryStore();
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [memo, setMemo] = useState('');

  const selectedId = selectedArchiveIds.length === 1 ? selectedArchiveIds[0] : null;

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    tauriInvoke<ArchiveDetail>('get_archive_detail', { id: selectedId })
      .then((d) => { setDetail(d); setMemo(d.memo); })
      .catch(console.error);
  }, [selectedId]);

  if (selectedArchiveIds.length > 1) {
    return (
      <PanelContainer>
        <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40 }}>
          {selectedArchiveIds.length}件選択中
        </div>
      </PanelContainer>
    );
  }

  if (!detail) {
    return (
      <PanelContainer>
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: 40 }}>
          アーカイブを選択してください
        </div>
      </PanelContainer>
    );
  }

  const thumbnailUrl = detail.thumbnail_path ? convertFileSrc(detail.thumbnail_path) : undefined;

  const handleRankChange = async (rank: number) => {
    await tauriInvoke('update_archive', { id: detail.id, update: { rank } });
    setDetail({ ...detail, rank });
    fetchArchives();
  };

  const handleMemoBlur = async () => {
    if (memo !== detail.memo) {
      await tauriInvoke('update_archive', { id: detail.id, update: { memo } });
      setDetail({ ...detail, memo });
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <PanelContainer>
      {thumbnailUrl && (
        <div style={{
          width: '100%', aspectRatio: '2/3', borderRadius: 6,
          backgroundImage: `url(${thumbnailUrl})`, backgroundSize: 'cover',
          backgroundPosition: 'center', marginBottom: 12,
        }} />
      )}

      <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 'bold', marginBottom: 4 }}>
        {detail.title}
      </div>

      <RankStars rank={detail.rank} onChange={handleRankChange} size={16} />

      <InfoSection label="情報">
        <InfoLine icon="📄" text={`${detail.page_count} ページ`} />
        <InfoLine icon="📦" text={detail.file_name} />
        <InfoLine icon="💾" text={formatSize(detail.file_size)} />
        <InfoLine icon="📅" text={new Date(detail.created_at).toLocaleDateString('ja-JP')} />
      </InfoSection>

      <InfoSection label="タグ">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {detail.tags.map((t) => (
            <span key={t.id} style={{
              background: 'var(--bg-card)', color: 'var(--text-secondary)',
              fontSize: 10, padding: '3px 8px', borderRadius: 10,
            }}>{t.name}</span>
          ))}
          {detail.tags.length === 0 && (
            <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>タグなし</span>
          )}
        </div>
      </InfoSection>

      <InfoSection label="メモ">
        <textarea
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onBlur={handleMemoBlur}
          placeholder="メモを入力..."
          style={{
            width: '100%', minHeight: 60, background: 'var(--bg-card)', border: 'none',
            borderRadius: 4, color: 'var(--text-secondary)', fontSize: 11,
            padding: 8, resize: 'vertical', fontFamily: 'inherit',
          }}
        />
      </InfoSection>

      <button
        onClick={() => onOpenViewer(detail.id)}
        style={{
          width: '100%', padding: 8, background: 'var(--accent)',
          color: 'var(--text-primary)', border: 'none', borderRadius: 6,
          fontSize: 12, cursor: 'pointer', marginTop: 8,
        }}
      >
        📖 読む
      </button>
    </PanelContainer>
  );
}

function PanelContainer({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: 220, background: 'var(--bg-secondary)', padding: 14,
      borderLeft: '1px solid var(--border-color)', flexShrink: 0,
      overflowY: 'auto',
    }}>
      {children}
    </div>
  );
}

function InfoSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{
        color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase',
        letterSpacing: 1, marginBottom: 6,
      }}>{label}</div>
      {children}
    </div>
  );
}

function InfoLine({ icon, text }: { icon: string; text: string }) {
  return (
    <div style={{ color: 'var(--text-secondary)', fontSize: 11, marginBottom: 4 }}>
      {icon} {text}
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/library/DetailPanel.tsx
git commit -m "feat: add DetailPanel with rank, tags, memo, and read button"
```

---

### Task 8: TopBar コンポーネント

**Files:**
- Create: `src/components/library/TopBar.tsx`

- [ ] **Step 1: TopBar.tsx を作成**

```tsx
// src/components/library/TopBar.tsx
import { useLibraryStore } from '../../stores/libraryStore';

export default function TopBar() {
  const {
    sortBy, sortOrder, gridSize, searchQuery,
    setSortBy, setSortOrder, setGridSize, setSearchQuery, setFilterMinRank,
    fetchArchives,
  } = useLibraryStore();

  const handleSearch = (query: string) => {
    setSearchQuery(query);
    fetchArchives();
  };

  return (
    <div style={{
      padding: '8px 12px', background: 'var(--bg-tertiary)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0,
    }}>
      {/* ソート */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Label>ソート:</Label>
        <Select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="name">名前順</option>
          <option value="created_at">追加日</option>
          <option value="rank">ランク</option>
          <option value="file_size">サイズ</option>
        </Select>
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          style={{
            background: 'var(--bg-card)', border: 'none', color: 'var(--text-secondary)',
            borderRadius: 4, padding: '4px 6px', cursor: 'pointer', fontSize: 11,
          }}
        >
          {sortOrder === 'asc' ? '▲' : '▼'}
        </button>
      </div>

      <Divider />

      {/* ランクフィルタ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Label>ランク:</Label>
        <Select defaultValue="0" onChange={(e) => setFilterMinRank(Number(e.target.value))}>
          <option value="0">すべて</option>
          <option value="1">★1以上</option>
          <option value="2">★2以上</option>
          <option value="3">★3以上</option>
          <option value="4">★4以上</option>
          <option value="5">★5のみ</option>
        </Select>
      </div>

      <div style={{ flex: 1 }} />

      {/* グリッドサイズ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <Label>サイズ:</Label>
        <input
          type="range"
          min="100"
          max="250"
          value={gridSize}
          onChange={(e) => setGridSize(Number(e.target.value))}
          style={{ width: 80, accentColor: 'var(--accent)' }}
        />
      </div>

      <Divider />

      {/* 検索 */}
      <input
        type="text"
        placeholder="🔍 検索..."
        value={searchQuery}
        onChange={(e) => handleSearch(e.target.value)}
        style={{
          background: 'var(--bg-card)', border: 'none', borderRadius: 4,
          padding: '4px 12px', color: 'var(--text-secondary)', fontSize: 11,
          width: 150, outline: 'none',
        }}
      />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{children}</span>;
}

function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{
        background: 'var(--bg-card)', border: 'none', borderRadius: 4,
        padding: '4px 10px', color: 'var(--text-secondary)', fontSize: 11,
        cursor: 'pointer',
      }}
    >
      {children}
    </select>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 18, background: 'var(--border-color)' }} />;
}
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/library/TopBar.tsx
git commit -m "feat: add TopBar with sort, rank filter, grid size slider, search"
```

---

### Task 9: LibraryPage 統合（3ペインレイアウト）

**Files:**
- Modify: `src/pages/LibraryPage.tsx`

- [ ] **Step 1: LibraryPage.tsx を更新**

```tsx
// src/pages/LibraryPage.tsx
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../stores/libraryStore';
import TopBar from '../components/library/TopBar';
import Sidebar from '../components/library/Sidebar';
import ArchiveGrid from '../components/library/ArchiveGrid';
import DetailPanel from '../components/library/DetailPanel';

export default function LibraryPage() {
  const navigate = useNavigate();
  const { fetchArchives, fetchFolders, fetchTags, fetchSmartFolders } = useLibraryStore();

  useEffect(() => {
    fetchArchives();
    fetchFolders();
    fetchTags();
    fetchSmartFolders();
  }, []);

  const handleOpenViewer = (archiveId: string) => {
    navigate(`/viewer/${archiveId}`);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <ArchiveGrid onOpenViewer={handleOpenViewer} />
        <DetailPanel onOpenViewer={handleOpenViewer} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: App.tsx にビューワーのルート仮登録**

```tsx
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LibraryPage from './pages/LibraryPage';
import './styles/global.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/viewer/:archiveId" element={<div>Viewer (Phase 4)</div>} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 3: 動作確認**

```bash
cd d:/Dev/App/ComicViewer
npm run tauri dev
```

Expected: 3ペインレイアウト（サイドバー + グリッド + 詳細パネル）のダークテーマ画面が表示される

- [ ] **Step 4: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/pages/LibraryPage.tsx src/App.tsx
git commit -m "feat: integrate 3-pane library layout (sidebar + grid + detail)"
```

---

## Phase 3 完了基準

- [x] 3ペインレイアウトが表示される
- [x] サイドバーにプリセットフィルタ（すべて/お気に入り/未読/最近読んだ）、フォルダ、スマートフォルダが表示される
- [x] グリッドにサムネイルカードが仮想スクロールで表示される
- [x] カードクリックで選択、ダブルクリックでビューワーに遷移
- [x] 詳細パネルに選択中アーカイブの情報（表紙、タイトル、ランク、タグ、メモ等）が表示される
- [x] ランクの★クリック編集、メモのテキスト編集が動作する
- [x] トップバーでソート、ランクフィルタ、グリッドサイズ調整、検索が動作する
- [x] zustand で状態管理されている
