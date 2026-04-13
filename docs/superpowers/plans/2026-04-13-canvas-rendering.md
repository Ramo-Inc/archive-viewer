# Canvas ベース画像レンダリング 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SpreadView の `<img>` を `<canvas>` ベースの CanvasPage コンポーネントに置き換え、表示ピクセルサイズに事前リサイズして 1:1 描画することでスクリーントーンのモアレを根本的に解消する。同時にモアレスライダーを削除する。

**Architecture:** 新規 `CanvasPage` コンポーネントが ResizeObserver で親コンテナサイズを監視し、`drawImage` + `imageSmoothingQuality: 'high'` で整数ピクセルサイズに描画。SpreadView は `<img>` を `<CanvasPage>` に置換。モアレスライダー関連のコード（ViewerTopBar, ViewerOverlay, ViewerPage, viewerStore）を削除。

**Tech Stack:** React 19, Canvas API, ResizeObserver, TypeScript

---

## ファイル構成

| ファイル | 操作 | 責務 |
|---------|------|------|
| `src/components/viewer/CanvasPage.tsx` | 新規 | canvas ベースのページ表示（リサイズ監視 + drawImage 描画） |
| `src/components/viewer/SpreadView.tsx` | 修正 | `<img>` → `<CanvasPage>` 置換、pageStyle/blur/moireReduction 削除 |
| `src/stores/viewerStore.ts` | 修正 | moireReduction state/actions 削除 |
| `src/components/viewer/ViewerTopBar.tsx` | 修正 | スライダー UI と関連 props 削除 |
| `src/components/viewer/ViewerOverlay.tsx` | 修正 | moireReduction props パススルー削除 |
| `src/pages/ViewerPage.tsx` | 修正 | moireReduction store 参照と loadSettings 削除 |

---

### Task 1: CanvasPage コンポーネントの作成

**Files:**
- Create: `src/components/viewer/CanvasPage.tsx`

- [ ] **Step 1: CanvasPage コンポーネントを作成**

`src/components/viewer/CanvasPage.tsx` を以下の内容で作成:

```typescript
import { useRef, useEffect, useCallback } from 'react';

// ============================================================
// CanvasPage — renders an image via <canvas> drawImage at exact
// display pixel dimensions, bypassing browser img scaling.
// This eliminates moiré artifacts on screentone patterns.
// ============================================================

interface CanvasPageProps {
  src: string;
  alt: string;
  naturalWidth: number;
  naturalHeight: number;
  maxWidthRatio: number; // 1.0 (single/solo) or 0.5 (spread)
}

export default function CanvasPage({
  src,
  alt,
  naturalWidth,
  naturalHeight,
  maxWidthRatio,
}: CanvasPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const currentSrcRef = useRef<string>('');

  // Draw image to canvas at exact integer pixel dimensions
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const img = imgRef.current;
    if (!canvas || !container || !img || !img.complete || naturalWidth === 0 || naturalHeight === 0) {
      return;
    }

    const containerWidth = container.clientWidth * maxWidthRatio;
    const containerHeight = container.clientHeight;
    if (containerWidth <= 0 || containerHeight <= 0) return;

    // objectFit: contain equivalent — fit to container preserving aspect ratio
    const scaleX = containerWidth / naturalWidth;
    const scaleY = containerHeight / naturalHeight;
    const scale = Math.min(scaleX, scaleY);

    const displayWidth = Math.floor(naturalWidth * scale);
    const displayHeight = Math.floor(naturalHeight * scale);

    if (displayWidth <= 0 || displayHeight <= 0) return;

    // Only resize canvas buffer if dimensions changed
    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
  }, [naturalWidth, naturalHeight, maxWidthRatio]);

  // Load image and draw when src changes
  useEffect(() => {
    if (!src || src === currentSrcRef.current) return;
    currentSrcRef.current = src;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgRef.current = img;
      draw();
    };
    img.onerror = () => {
      // Clear canvas on error
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          canvas.width = 200;
          canvas.height = 40;
          ctx.fillStyle = '#666';
          ctx.font = '12px sans-serif';
          ctx.fillText('画像を読み込めません', 10, 25);
        }
      }
    };
    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, draw]);

  // Redraw on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      draw();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [draw]);

  // Redraw when maxWidthRatio changes (spread ↔ single toggle)
  useEffect(() => {
    draw();
  }, [draw]);

  return (
    <div
      ref={containerRef}
      style={{
        flex: maxWidthRatio === 0.5 ? 1 : undefined,
        maxWidth: maxWidthRatio === 1.0 ? '100%' : '50%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={alt}
        style={{ display: 'block' }}
      />
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 型チェック**

Run: `npx tsc -b --noEmit 2>&1 | grep CanvasPage || echo "No CanvasPage errors"`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/components/viewer/CanvasPage.tsx
git commit -m "feat: add CanvasPage component for moire-free image rendering"
```

---

### Task 2: SpreadView を CanvasPage に切り替え

**Files:**
- Modify: `src/components/viewer/SpreadView.tsx`

- [ ] **Step 1: SpreadView を書き換え**

`src/components/viewer/SpreadView.tsx` の全内容を以下に置き換え:

```typescript
import { convertFileSrc } from '@tauri-apps/api/core';
import type { PageInfo } from '../../types';
import CanvasPage from './CanvasPage';

// ============================================================
// SpreadView — displays one or two pages depending on viewMode
// Handles: cover page solo, is_spread solo, RTL ordering,
// and single-page mode (Errata HI-8, M-10).
// Uses CanvasPage for moire-free rendering via canvas drawImage.
// ============================================================

interface SpreadViewProps {
  pages: PageInfo[];
  currentPage: number;
  viewMode: 'spread' | 'single';
}

/**
 * Build the page image URL from a PageInfo.
 */
function pageUrl(page: PageInfo): string {
  const raw = page.url || '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  return convertFileSrc(raw);
}

export default function SpreadView({ pages, currentPage, viewMode }: SpreadViewProps) {
  if (pages.length === 0) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-dim)',
        }}
      >
        No pages
      </div>
    );
  }

  const currentPageInfo = pages[currentPage];
  if (!currentPageInfo) return null;

  // --- Single page mode (Errata HI-8) ---
  if (viewMode === 'single') {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <CanvasPage
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          naturalWidth={currentPageInfo.width}
          naturalHeight={currentPageInfo.height}
          maxWidthRatio={1.0}
        />
      </div>
    );
  }

  // --- Spread (two-page) mode ---
  const isCover = currentPage === 0;
  const isSpread = currentPageInfo.is_spread;
  const isLastAlone =
    currentPage === pages.length - 1 ||
    (currentPage + 1 < pages.length && pages[currentPage + 1].is_spread);

  const showSolo = isCover || isSpread || isLastAlone;

  if (showSolo) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <CanvasPage
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          naturalWidth={currentPageInfo.width}
          naturalHeight={currentPageInfo.height}
          maxWidthRatio={1.0}
        />
      </div>
    );
  }

  // Two-page spread — RTL ordering (Errata M-10)
  const leftPage = pages[currentPage + 1];
  const rightPage = currentPageInfo;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        direction: 'rtl',
        overflow: 'hidden',
        gap: 0,
      }}
    >
      <CanvasPage
        src={pageUrl(rightPage)}
        alt={`Page ${currentPage + 1}`}
        naturalWidth={rightPage.width}
        naturalHeight={rightPage.height}
        maxWidthRatio={0.5}
      />
      {leftPage && (
        <CanvasPage
          src={pageUrl(leftPage)}
          alt={`Page ${currentPage + 2}`}
          naturalWidth={leftPage.width}
          naturalHeight={leftPage.height}
          maxWidthRatio={0.5}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript 型チェック**

Run: `npx tsc -b --noEmit 2>&1 | grep -E "SpreadView|CanvasPage" || echo "No errors"`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/components/viewer/SpreadView.tsx
git commit -m "feat: replace <img> with CanvasPage for moire-free rendering"
```

---

### Task 3: モアレスライダーを viewerStore から削除

**Files:**
- Modify: `src/stores/viewerStore.ts`

- [ ] **Step 1: moireReduction 関連を全て削除**

`src/stores/viewerStore.ts` を修正:

**import 文** (line 2) — `ViewerSettings` を削除:
```typescript
import type { ArchiveDetail, PageInfo, ViewerArchive } from '../types';
```

**ViewerState interface** から削除 (line 29-30):
- `moireReduction: number;` の行を削除

**actions** から削除 (line 42-44):
- `setMoireReduction: (value: number) => void;`
- `saveMoireReduction: (value: number) => void;`
- `loadSettings: () => Promise<void>;`

**初期値** から削除 (line 90):
- `moireReduction: 0.5,`

**アクション実装** から削除 (line 144-159):
- `setMoireReduction` 実装
- `saveMoireReduction` 実装
- `loadSettings` 実装

- [ ] **Step 2: コミット**

```bash
git add src/stores/viewerStore.ts
git commit -m "refactor: remove moireReduction state/actions from viewerStore"
```

---

### Task 4: ViewerTopBar からスライダー UI を削除

**Files:**
- Modify: `src/components/viewer/ViewerTopBar.tsx`

- [ ] **Step 1: スライダー props と UI を削除**

`ViewerTopBarProps` interface を元に戻す (line 6-17):

```typescript
interface ViewerTopBarProps {
  title: string;
  currentPage: number;
  totalPages: number;
  viewMode: 'spread' | 'single';
  onBack: () => void;
  onToggleViewMode: () => void;
  visible: boolean;
}
```

関数シグネチャを元に戻す (line 19-30):

```typescript
export default function ViewerTopBar({
  title,
  currentPage,
  totalPages,
  viewMode,
  onBack,
  onToggleViewMode,
  visible,
}: ViewerTopBarProps) {
```

`{/* Moire reduction slider */}` の `<div>` ブロック全体 (line 81-115) を削除。タイトル `</span>` の直後から見開きトグル `<button>` の直前までの div を丸ごと削除。

- [ ] **Step 2: コミット**

```bash
git add src/components/viewer/ViewerTopBar.tsx
git commit -m "refactor: remove moire reduction slider from ViewerTopBar"
```

---

### Task 5: ViewerOverlay と ViewerPage から moireReduction を削除

**Files:**
- Modify: `src/components/viewer/ViewerOverlay.tsx`
- Modify: `src/pages/ViewerPage.tsx`

- [ ] **Step 1: ViewerOverlay から moireReduction props を削除**

`ViewerOverlayProps` interface (line 12-27) から以下3行を削除:
```typescript
  moireReduction: number;
  onMoireChange: (value: number) => void;
  onMoireCommit: (value: number) => void;
```

関数パラメータの destructuring (line 34-49) から以下3行を削除:
```typescript
  moireReduction,
  onMoireChange,
  onMoireCommit,
```

`<ViewerTopBar>` の props (line 143-154) から以下3行を削除:
```typescript
        moireReduction={moireReduction}
        onMoireChange={onMoireChange}
        onMoireCommit={onMoireCommit}
```

- [ ] **Step 2: ViewerPage から moireReduction store 参照を削除**

`src/pages/ViewerPage.tsx` から以下4行の store selectors を削除 (line 48-51):
```typescript
  const moireReduction = useViewerStore((s) => s.moireReduction);
  const setMoireReduction = useViewerStore((s) => s.setMoireReduction);
  const saveMoireReduction = useViewerStore((s) => s.saveMoireReduction);
  const loadSettings = useViewerStore((s) => s.loadSettings);
```

初期ロード useEffect (line 57-66) から `loadSettings()` 呼び出しと依存配列の `loadSettings` を削除。元に戻す:
```typescript
  useEffect(() => {
    if (archiveId) {
      openArchive(archiveId);
    }
    return () => {
      closeArchive();
    };
  }, [archiveId, openArchive, closeArchive]);
```

`<ViewerOverlay>` の props (line 207-222) から以下3行を削除:
```typescript
        moireReduction={moireReduction}
        onMoireChange={setMoireReduction}
        onMoireCommit={saveMoireReduction}
```

- [ ] **Step 3: TypeScript 型チェック**

Run: `npx tsc -b --noEmit 2>&1 | head -20`
Expected: Viewer 関連のエラーなし

- [ ] **Step 4: コミット**

```bash
git add src/components/viewer/ViewerOverlay.tsx src/pages/ViewerPage.tsx
git commit -m "refactor: remove moire slider wiring from ViewerOverlay and ViewerPage"
```

---

### Task 6: 動作確認

- [ ] **Step 1: Tauri dev で起動**

Run: `npx tauri dev`

- [ ] **Step 2: Canvas レンダリング確認**

1. ライブラリからスクリーントーンのあるマンガを開く
2. ページが canvas で表示されていることを確認（DevTools で `<canvas>` 要素が存在）
3. スクリーントーンのモアレが軽減されていることを確認
4. TopBar にスライダーが表示されていないことを確認

- [ ] **Step 3: 表示モード切替確認**

1. 見開きモード → 単ページモード → 見開きモードと切り替え
2. 各モードで画像が正常に描画されることを確認
3. 見開き時、RTL 順序が正しいことを確認

- [ ] **Step 4: ウィンドウリサイズ確認**

1. ウィンドウサイズを変更
2. canvas が自動的にリサイズされ、画像が再描画されることを確認
3. リサイズ中にちらつきや空白が発生しないことを確認

- [ ] **Step 5: ページ送り確認**

1. 矢印キーまたはクリックでページを送る
2. 新しいページが正常に canvas に描画されることを確認
3. 表紙ページ、見開きページ、最終ページが正しく solo 表示されることを確認
