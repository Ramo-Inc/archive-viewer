# Canvas ベース画像レンダリング 設計書

## 概要

SpreadView の画像表示を `<img>` から `<canvas>` ベースに変更し、NeeView と同様に**表示ピクセルサイズに事前リサイズ**してから 1:1 で描画する。これによりブラウザのスケーリングを完全にバイパスし、スクリーントーンのモアレを根本的に解消する。

## 背景

### 現在の問題

`<img>` + CSS `objectFit: contain` による表示では:
1. ブラウザが非整数ピクセルの表示サイズを計算（例: 1800px → 937.5px）
2. GPU テクスチャスケーリングで縮小 — 周期的ドットパターンと干渉してモアレ発生
3. CSS `filter: blur()` は縮小後の後処理であり、既に発生したモアレを消せない

### NeeView のアプローチ

NeeView（WPF製マンガビューア）は独自の画像リサイズパイプラインを持つ:
- `ImageResizeFilter` で表示サイズに Lanczos / Spline36 等で事前リサイズ
- リサイズ後にオプションでアンシャープマスク
- 1:1 ピクセル比率で描画（WPF のスケーリングなし）

### Canvas ベースの解決策

`<canvas>` の `drawImage()` + `imageSmoothingQuality: 'high'` を使い、画像を**表示ピクセルサイズぴったり**に描画する:
- 表示サイズを整数ピクセルで計算し、canvas をそのサイズに設定
- `drawImage()` で原画像を canvas サイズにリサイズ描画（bicubic 補間）
- canvas は 1:1 で表示 — ブラウザの追加スケーリングなし
- bicubic 補間は Lanczos より ringing アーティファクトが少なく、スクリーントーンの周期パターンに適している

## 設計

### 新規コンポーネント: CanvasPage

`<img>` を置き換える canvas ベースのページ表示コンポーネント。

```typescript
interface CanvasPageProps {
  src: string;
  alt: string;
  naturalWidth: number;   // PageInfo.width
  naturalHeight: number;  // PageInfo.height
  maxWidthRatio: number;  // 1.0 (single/solo) or 0.5 (spread)
}
```

**責務:**
1. 親コンテナのサイズを `ResizeObserver` で監視
2. `maxWidthRatio` と画像アスペクト比から表示ピクセルサイズを整数値で計算
3. `HTMLImageElement` で画像をロード
4. `<canvas>` に `imageSmoothingQuality: 'high'` で `drawImage()`
5. 画像ロード完了またはコンテナリサイズ時に再描画

**表示サイズ計算ロジック（`objectFit: contain` 相当）:**
```
containerWidth = 親要素の幅 × maxWidthRatio
containerHeight = 親要素の高さ

scaleX = containerWidth / naturalWidth
scaleY = containerHeight / naturalHeight
scale = min(scaleX, scaleY)

displayWidth = floor(naturalWidth × scale)
displayHeight = floor(naturalHeight × scale)
```

`floor()` で整数ピクセルに丸めることで、サブピクセルスケーリングを回避する。

### SpreadView の変更

**削除するもの:**
- `pageStyle` ヘルパー関数（blur/imageRendering 関連）
- `useViewerStore` import（moireReduction 用）
- `moireReduction` state 参照
- 全 `<img>` 要素

**追加するもの:**
- `CanvasPage` コンポーネントの使用
- 各 `<img>` を `<CanvasPage>` に置換

置換パターン:
```typescript
// Before:
<img src={pageUrl(page)} style={pageStyle(moireReduction, '100%')} draggable={false} />

// After:
<CanvasPage
  src={pageUrl(page)}
  alt={`Page ${page.index + 1}`}
  naturalWidth={page.width}
  naturalHeight={page.height}
  maxWidthRatio={1.0}  // or 0.5 for spread
/>
```

### モアレスライダーの削除

以下を削除:
- `ViewerTopBar`: `moireReduction`, `onMoireChange`, `onMoireCommit` props とスライダー UI
- `ViewerOverlay`: 同 props のパススルー
- `ViewerPage`: `moireReduction`, `setMoireReduction`, `saveMoireReduction`, `loadSettings` の store 参照
- `viewerStore`: `moireReduction` state と `setMoireReduction`, `saveMoireReduction`, `loadSettings` アクション

**残すもの:**
- `config.rs` の `ViewerSettings` / `viewer_settings`（将来の設定用インフラとして）
- `get_viewer_settings` / `save_viewer_settings` Tauri コマンド（将来の設定用）
- `types/index.ts` の `ViewerSettings` 型（同上）

### パフォーマンス考慮

**再描画のトリガー:**
- ページ切替時（src 変更）: 新画像ロード → 描画
- ウィンドウリサイズ時: ResizeObserver → 再計算 → 再描画
- viewMode 切替時（spread ↔ single）: maxWidthRatio 変更 → 再計算 → 再描画

**最適化:**
- ResizeObserver のコールバックに debounce は不要（ブラウザが自動的にフレーム単位で通知を集約する）
- 画像は `HTMLImageElement` としてメモリに保持し、リサイズ時は `drawImage` の再呼び出しのみ（再ロード不要）
- canvas のバッファサイズ変更（`width`/`height` 属性）はクリア+再描画が必要だが、同じサイズなら skip 可能

### 変更ファイル一覧

| ファイル | 操作 | 内容 |
|---------|------|------|
| `src/components/viewer/CanvasPage.tsx` | 新規 | canvas ベースのページ表示コンポーネント |
| `src/components/viewer/SpreadView.tsx` | 修正 | `<img>` → `<CanvasPage>` 置換、pageStyle/blur 削除 |
| `src/components/viewer/ViewerTopBar.tsx` | 修正 | スライダー UI と関連 props 削除 |
| `src/components/viewer/ViewerOverlay.tsx` | 修正 | moireReduction props パススルー削除 |
| `src/pages/ViewerPage.tsx` | 修正 | moireReduction store 参照と loadSettings 削除 |
| `src/stores/viewerStore.ts` | 修正 | moireReduction state/actions 削除 |

### エラーハンドリング

| ケース | 対応 |
|--------|------|
| 画像ロード失敗 | canvas にフォールバックテキスト表示 |
| naturalWidth/Height が 0 | canvas を非表示にし、ロード後に再描画 |
| ResizeObserver 非対応 | 実質ありえない（Chromium 64+ で対応済み） |

## スコープ外

- アンシャープマスク（NeeView の UnsharpMask 相当 — 将来検討）
- ImageDotKeep（高倍率時のニアレストネイバー — 将来検討）
- ピンチズーム対応
