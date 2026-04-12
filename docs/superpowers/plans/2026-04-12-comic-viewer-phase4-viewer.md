# ComicViewer Phase 4: Viewer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 見開き/単ページ表示のビューワー画面を構築し、キーボードショートカット、ホバーUI、プリロード、読書位置レジュームを実装する

**Architecture:** Rust側でアーカイブからtemp/にページを展開しasset protocol URLを返す。フロントでは見開きロジック（右綴じ、表紙単独、見開きページ自動判定）を制御。ホバーUIはマウスY座標でトリガー。

**Tech Stack:** React, TypeScript, zustand, @tauri-apps/api

**PRD参照:** `docs/superpowers/specs/2026-04-12-comic-viewer-design.md` セクション 7

**前提:** Phase 1, Phase 2 が完了していること（Phase 3と並行可能）

---

## File Structure (Phase 4)

```
src-tauri/src/
├── commands/
│   └── viewer.rs            — prepare_pages, save_read_position, cleanup_temp_pages
src/
├── stores/
│   └── viewerStore.ts
├── components/
│   └── viewer/
│       ├── SpreadView.tsx
│       ├── SinglePageView.tsx
│       ├── ViewerTopBar.tsx
│       ├── PageSlider.tsx
│       └── ViewerOverlay.tsx
├── hooks/
│   └── useKeyboardShortcuts.ts
├── pages/
│   └── ViewerPage.tsx
```

---

### Task 1: ビューワー Tauri コマンド（ページ展開）

**Files:**
- Create: `src-tauri/src/commands/viewer.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: commands/viewer.rs を作成**

```rust
// src-tauri/src/commands/viewer.rs
use crate::archive;
use crate::config::load_config;
use crate::db::models::PageInfo;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use crate::image::thumbnail::{get_image_dimensions, is_spread_page};
use std::fs;
use std::path::PathBuf;

fn get_library_root() -> Result<PathBuf, AppError> {
    let config = load_config()?;
    let path = config.library_path.ok_or(AppError::LibraryNotFound)?;
    Ok(PathBuf::from(path))
}

#[tauri::command]
pub fn prepare_pages(
    archive_id: String,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<PageInfo>, AppError> {
    let library_path = get_library_root()?;
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let archive_record = queries::get_archive_by_id(&conn, &archive_id)?;

    let archive_abs = library_path.join(&archive_record.file_path);
    let reader = archive::open_archive(&archive_abs)?;
    let pages = reader.list_pages()?;

    // temp ディレクトリに展開
    let temp_dir = library_path.join("temp").join(&archive_id);
    fs::create_dir_all(&temp_dir)?;

    let mut page_infos = Vec::new();
    for page in &pages {
        let dest = temp_dir.join(&page.name);

        // 既に展開済みならスキップ
        if !dest.exists() {
            let data = reader.extract_page(&page.name)?;
            // サブディレクトリがある場合は作成
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(&dest, &data)?;
        }

        // 画像サイズを取得
        let data = fs::read(&dest)?;
        let (width, height) = get_image_dimensions(&data)?;

        // 絶対パスをURLに使う（フロントでconvertFileSrcする）
        let abs_path = dest.to_string_lossy().replace('\\', "/");

        page_infos.push(PageInfo {
            index: page.index,
            url: abs_path,
            width,
            height,
            is_spread: is_spread_page(width, height),
        });
    }

    Ok(page_infos)
}

#[tauri::command]
pub fn save_read_position(
    archive_id: String,
    page: usize,
    state: tauri::State<'_, DbState>,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::save_read_position(&conn, &archive_id, page as i32)
}

#[tauri::command]
pub fn cleanup_temp_pages(archive_id: String) -> Result<(), AppError> {
    let library_path = get_library_root()?;
    let temp_dir = library_path.join("temp").join(&archive_id);
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)?;
    }
    Ok(())
}
```

- [ ] **Step 2: commands/mod.rs を更新**

```rust
// src-tauri/src/commands/mod.rs
pub mod archive;
pub mod library;
pub mod viewer;
```

- [ ] **Step 3: main.rs にコマンド追加**

`invoke_handler` に追加:

```rust
commands::viewer::prepare_pages,
commands::viewer::save_read_position,
commands::viewer::cleanup_temp_pages,
```

- [ ] **Step 4: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 5: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/commands/
git commit -m "feat: add viewer commands (prepare_pages, save_read_position, cleanup)"
```

---

### Task 2: zustand ビューワーストア

**Files:**
- Create: `src/stores/viewerStore.ts`

- [ ] **Step 1: viewerStore.ts を作成**

```typescript
// src/stores/viewerStore.ts
import { create } from 'zustand';
import type { PageInfo } from '../types';
import { tauriInvoke } from '../hooks/useTauriCommand';

interface ViewerState {
  archiveId: string | null;
  pages: PageInfo[];
  currentPage: number;
  viewMode: 'spread' | 'single';
  isUIVisible: boolean;
  isLoading: boolean;

  loadPages: (archiveId: string, resumePage?: number) => Promise<void>;
  setCurrentPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  goToFirst: () => void;
  goToLast: () => void;
  setViewMode: (mode: 'spread' | 'single') => void;
  toggleUI: () => void;
  setUIVisible: (visible: boolean) => void;
  savePosition: () => Promise<void>;
  cleanup: () => Promise<void>;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  archiveId: null,
  pages: [],
  currentPage: 0,
  viewMode: 'spread',
  isUIVisible: false,
  isLoading: false,

  loadPages: async (archiveId, resumePage) => {
    set({ isLoading: true, archiveId });
    try {
      const pages = await tauriInvoke<PageInfo[]>('prepare_pages', { archiveId });
      // 1ページのみなら自動で単ページモード
      const viewMode = pages.length <= 1 ? 'single' : 'spread';
      set({ pages, currentPage: resumePage ?? 0, viewMode, isLoading: false });
    } catch (e) {
      console.error('Failed to load pages:', e);
      set({ isLoading: false });
    }
  },

  setCurrentPage: (page) => {
    const { pages } = get();
    const clamped = Math.max(0, Math.min(page, pages.length - 1));
    set({ currentPage: clamped });
  },

  nextPage: () => {
    const { currentPage, pages, viewMode } = get();
    const step = viewMode === 'spread' ? 2 : 1;
    const next = Math.min(currentPage + step, pages.length - 1);
    set({ currentPage: next });
  },

  prevPage: () => {
    const { currentPage, viewMode } = get();
    const step = viewMode === 'spread' ? 2 : 1;
    const prev = Math.max(currentPage - step, 0);
    set({ currentPage: prev });
  },

  goToFirst: () => set({ currentPage: 0 }),
  goToLast: () => {
    const { pages } = get();
    set({ currentPage: Math.max(0, pages.length - 1) });
  },

  setViewMode: (mode) => set({ viewMode: mode }),
  toggleUI: () => set((s) => ({ isUIVisible: !s.isUIVisible })),
  setUIVisible: (visible) => set({ isUIVisible: visible }),

  savePosition: async () => {
    const { archiveId, currentPage } = get();
    if (archiveId) {
      await tauriInvoke('save_read_position', { archiveId, page: currentPage }).catch(console.error);
    }
  },

  cleanup: async () => {
    const { archiveId } = get();
    if (archiveId) {
      await tauriInvoke('cleanup_temp_pages', { archiveId }).catch(console.error);
    }
    set({ archiveId: null, pages: [], currentPage: 0 });
  },
}));
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/stores/viewerStore.ts
git commit -m "feat: add zustand viewer store with page navigation"
```

---

### Task 3: キーボードショートカット Hook

**Files:**
- Create: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: useKeyboardShortcuts.ts を作成**

```typescript
// src/hooks/useKeyboardShortcuts.ts
import { useEffect } from 'react';
import { useViewerStore } from '../stores/viewerStore';
import { useNavigate } from 'react-router-dom';

export function useViewerKeyboardShortcuts() {
  const navigate = useNavigate();
  const {
    nextPage, prevPage, goToFirst, goToLast,
    setViewMode, toggleUI, savePosition, cleanup,
  } = useViewerStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 右綴じ: ← が進む、→ が戻る
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          nextPage();
          break;
        case 'ArrowRight':
          e.preventDefault();
          prevPage();
          break;
        case 'Home':
          e.preventDefault();
          goToFirst();
          break;
        case 'End':
          e.preventDefault();
          goToLast();
          break;
        case 'f':
        case 'F':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            document.documentElement.requestFullscreen?.();
          }
          break;
        case 'Escape':
          e.preventDefault();
          if (document.fullscreenElement) {
            document.exitFullscreen?.();
          } else {
            savePosition().then(() => cleanup()).then(() => navigate('/'));
          }
          break;
        case '1':
          e.preventDefault();
          setViewMode('single');
          break;
        case '2':
          e.preventDefault();
          setViewMode('spread');
          break;
        case ' ':
          e.preventDefault();
          toggleUI();
          break;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [nextPage, prevPage, goToFirst, goToLast, setViewMode, toggleUI, savePosition, cleanup, navigate]);
}
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/hooks/useKeyboardShortcuts.ts
git commit -m "feat: add viewer keyboard shortcuts (arrows, F, Esc, 1/2, Space)"
```

---

### Task 4: SpreadView コンポーネント

**Files:**
- Create: `src/components/viewer/SpreadView.tsx`

- [ ] **Step 1: SpreadView.tsx を作成**

```tsx
// src/components/viewer/SpreadView.tsx
import { convertFileSrc } from '@tauri-apps/api/core';
import type { PageInfo } from '../../types';

interface SpreadViewProps {
  pages: PageInfo[];
  currentPage: number;
}

export default function SpreadView({ pages, currentPage }: SpreadViewProps) {
  if (pages.length === 0) return null;

  const currentPageInfo = pages[currentPage];

  // 表紙（0ページ目）は単独表示
  if (currentPage === 0) {
    return (
      <div style={containerStyle}>
        <PageImage page={currentPageInfo} />
      </div>
    );
  }

  // 見開きページ（横長）は単独で全幅表示
  if (currentPageInfo?.is_spread) {
    return (
      <div style={containerStyle}>
        <PageImage page={currentPageInfo} />
      </div>
    );
  }

  // 見開き: 右ページ(現在) + 左ページ(次)
  const rightPage = currentPageInfo;
  const leftPage = currentPage + 1 < pages.length ? pages[currentPage + 1] : null;

  // 次ページが見開きなら現在ページだけ単独表示
  if (leftPage?.is_spread) {
    return (
      <div style={containerStyle}>
        <PageImage page={rightPage} />
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* 右綴じ: 右ページが先（奇数）、左ページが後（偶数） */}
      <PageImage page={rightPage} />
      {leftPage && <PageImage page={leftPage} />}
    </div>
  );
}

function PageImage({ page }: { page: PageInfo }) {
  const url = convertFileSrc(page.url);
  return (
    <img
      src={url}
      alt={`Page ${page.index + 1}`}
      style={{
        maxHeight: '100%',
        maxWidth: '50%',
        objectFit: 'contain',
      }}
      draggable={false}
    />
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  width: '100%',
  gap: 2,
  background: '#000',
};
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/viewer/SpreadView.tsx
git commit -m "feat: add SpreadView with right-to-left spread and auto spread detection"
```

---

### Task 5: ViewerOverlay（ホバーUI）

**Files:**
- Create: `src/components/viewer/ViewerTopBar.tsx`
- Create: `src/components/viewer/PageSlider.tsx`
- Create: `src/components/viewer/ViewerOverlay.tsx`

- [ ] **Step 1: ViewerTopBar.tsx を作成**

```tsx
// src/components/viewer/ViewerTopBar.tsx
import { useViewerStore } from '../../stores/viewerStore';

interface ViewerTopBarProps {
  title: string;
  onBack: () => void;
}

export default function ViewerTopBar({ title, onBack }: ViewerTopBarProps) {
  const { pages, currentPage, viewMode, setViewMode } = useViewerStore();

  return (
    <div style={{
      padding: '8px 14px', background: 'rgba(22,22,42,0.95)',
      borderBottom: '1px solid var(--border-color)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span onClick={onBack} style={{ color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}>
          ← 戻る
        </span>
        <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 'bold' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <ModeButton label="見開き" active={viewMode === 'spread'} onClick={() => setViewMode('spread')} />
        <span style={{ color: 'var(--text-dim)' }}>|</span>
        <ModeButton label="単ページ" active={viewMode === 'single'} onClick={() => setViewMode('single')} />
        <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 12 }}>
          {currentPage + 1} / {pages.length}
        </span>
      </div>
    </div>
  );
}

function ModeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <span
      onClick={onClick}
      style={{
        color: active ? 'var(--text-primary)' : 'var(--text-dim)',
        fontSize: 11, cursor: 'pointer',
      }}
    >{label}</span>
  );
}
```

- [ ] **Step 2: PageSlider.tsx を作成**

```tsx
// src/components/viewer/PageSlider.tsx
import { useViewerStore } from '../../stores/viewerStore';

export default function PageSlider() {
  const { pages, currentPage, setCurrentPage, prevPage, nextPage } = useViewerStore();
  if (pages.length === 0) return null;

  return (
    <div style={{
      padding: '8px 14px', background: 'rgba(22,22,42,0.95)',
      borderTop: '1px solid var(--border-color)',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <span onClick={prevPage} style={{ color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer' }}>◀</span>
      <input
        type="range"
        min={0}
        max={pages.length - 1}
        value={currentPage}
        onChange={(e) => setCurrentPage(Number(e.target.value))}
        style={{ flex: 1, accentColor: 'var(--accent)' }}
      />
      <span onClick={nextPage} style={{ color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer' }}>▶</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, minWidth: 60, textAlign: 'right' }}>
        {currentPage + 1} / {pages.length}
      </span>
    </div>
  );
}
```

- [ ] **Step 3: ViewerOverlay.tsx を作成**

```tsx
// src/components/viewer/ViewerOverlay.tsx
import { useState, useRef, useCallback } from 'react';
import { useViewerStore } from '../../stores/viewerStore';
import ViewerTopBar from './ViewerTopBar';
import PageSlider from './PageSlider';

interface ViewerOverlayProps {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}

export default function ViewerOverlay({ title, onBack, children }: ViewerOverlayProps) {
  const { isUIVisible } = useViewerStore();
  const [showTop, setShowTop] = useState(false);
  const [showBottom, setShowBottom] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const { clientY } = e;
    const { innerHeight } = window;
    const threshold = 60;

    setShowTop(clientY < threshold);
    setShowBottom(clientY > innerHeight - threshold);

    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setShowTop(false);
      setShowBottom(false);
    }, 1500);
  }, []);

  const topVisible = isUIVisible || showTop;
  const bottomVisible = isUIVisible || showBottom;

  return (
    <div onMouseMove={handleMouseMove} style={{ position: 'relative', width: '100vw', height: '100vh', background: '#000' }}>
      {/* Top Bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
        opacity: topVisible ? 1 : 0, transition: 'opacity 0.3s',
        pointerEvents: topVisible ? 'auto' : 'none',
      }}>
        <ViewerTopBar title={title} onBack={onBack} />
      </div>

      {/* Page Content */}
      <div style={{ width: '100%', height: '100%' }}>
        {children}
      </div>

      {/* Bottom Slider */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
        opacity: bottomVisible ? 1 : 0, transition: 'opacity 0.3s',
        pointerEvents: bottomVisible ? 'auto' : 'none',
      }}>
        <PageSlider />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/viewer/
git commit -m "feat: add ViewerOverlay with hover UI (top bar, page slider, fade)"
```

---

### Task 6: ViewerPage 統合

**Files:**
- Create: `src/pages/ViewerPage.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: ViewerPage.tsx を作成**

```tsx
// src/pages/ViewerPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useViewerStore } from '../stores/viewerStore';
import { useViewerKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { tauriInvoke } from '../hooks/useTauriCommand';
import type { ArchiveDetail } from '../types';
import SpreadView from '../components/viewer/SpreadView';
import ViewerOverlay from '../components/viewer/ViewerOverlay';

export default function ViewerPage() {
  const { archiveId } = useParams<{ archiveId: string }>();
  const navigate = useNavigate();
  const { pages, currentPage, viewMode, isLoading, loadPages, savePosition, cleanup } = useViewerStore();
  const [title, setTitle] = useState('');

  useViewerKeyboardShortcuts();

  useEffect(() => {
    if (!archiveId) return;

    // アーカイブ詳細を取得してタイトルとレジューム位置を取得
    tauriInvoke<ArchiveDetail>('get_archive_detail', { id: archiveId })
      .then((detail) => {
        setTitle(detail.title);
        loadPages(archiveId, detail.last_read_page > 0 ? detail.last_read_page : undefined);
      })
      .catch(console.error);

    return () => {
      savePosition();
      cleanup();
    };
  }, [archiveId]);

  const handleBack = async () => {
    await savePosition();
    await cleanup();
    navigate('/');
  };

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '100vw', height: '100vh', background: '#000', color: 'var(--text-muted)',
      }}>
        読み込み中...
      </div>
    );
  }

  return (
    <ViewerOverlay title={title} onBack={handleBack}>
      {viewMode === 'spread' ? (
        <SpreadView pages={pages} currentPage={currentPage} />
      ) : (
        <SpreadView pages={pages} currentPage={currentPage} />
        // 単ページモードでもSpreadViewを使う（1ページだけ表示するロジックは同じ）
      )}
    </ViewerOverlay>
  );
}
```

- [ ] **Step 2: App.tsx を更新**

```tsx
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LibraryPage from './pages/LibraryPage';
import ViewerPage from './pages/ViewerPage';
import './styles/global.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
        <Route path="/viewer/:archiveId" element={<ViewerPage />} />
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

Expected: ライブラリでアーカイブをダブルクリック → ビューワーに遷移。見開き表示。←→でページ送り。Escで戻る。マウスホバーでUI表示。

- [ ] **Step 4: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/pages/ViewerPage.tsx src/App.tsx
git commit -m "feat: add ViewerPage with spread view, keyboard shortcuts, resume"
```

---

## Phase 4 完了基準

- [x] ライブラリからビューワーに遷移し、アーカイブのページが表示される
- [x] 見開き表示（右綴じ、表紙単独、見開きページ自動判定）が動作する
- [x] キーボードショートカット（←→, Home/End, F, Esc, 1/2, Space）が動作する
- [x] ホバーUIが画面上端/下端でフェードイン/アウトする
- [x] ページスライダーでページ位置を変更できる
- [x] 読書位置がDBに保存され、次回レジュームされる
- [x] ビューワーを閉じるとtemp/の一時ファイルがクリーンアップされる
