# 3問題の根本原因調査レポート

調査日: 2026-04-13

## 問題1: 起動が重い

### 根本原因

**Tauri setup() 内の同期ブロッキング処理**が主因。

`src-tauri/src/lib.rs:32-59` の `setup()` クロージャ内で、以下の重い処理が**アプリ起動をブロック**する:

1. **整合性チェック** (`lib.rs:44` → `integrity.rs:10-44`)
   - `get_all_archives_with_paths()` で全アーカイブをDBから取得
   - 各アーカイブのファイル存在を `Path::exists()` で確認 — **O(n) のファイルI/O**
   - 孤立サムネイルのスキャン (`integrity.rs:84-107`) — ディレクトリ全走査
   - 100件のアーカイブなら 100回のファイル存在チェック

2. **temp/ クリーンアップ** (`lib.rs:47-59`)
   - temp ディレクトリ配下を全走査して削除

3. **フロントエンド初回ロード** (`App.tsx:19-34`)
   - `get_library_path` の結果を待ってからルーティング開始
   - LibraryPage マウント時に4つの並列データフェッチ (`LibraryPage.tsx:27-30`)

### 原理

Tauri の `setup()` は同期的にアプリ起動をブロックする。この中でファイルI/Oを大量に行うと、ウィンドウが表示されるまでの時間が直接遅延する。整合性チェックは「全ファイルが存在するか」を毎回確認しており、ライブラリが大きくなるほど線形に遅くなる。

### 影響度: 高

---

## 問題2: NeeViewより画質が劣る

### 根本原因

**3つの技術的欠陥**が画質低下を引き起こしている。

#### 欠陥A: `devicePixelRatio` 未対応（最も深刻）

`CanvasPage.tsx:47-55`:
```typescript
const displayWidth = Math.floor(naturalWidth * scale);
const displayHeight = Math.floor(naturalHeight * scale);
canvas.width = displayWidth;    // CSSピクセル数をそのまま使用
canvas.height = displayHeight;
```

**問題**: Windows のディスプレイスケーリング（125%, 150%等）で `devicePixelRatio` が 1.0 以外の場合:
- canvas のバッファサイズが CSSピクセル数で設定される（例: 1000px）
- しかし物理ディスプレイは 1250px や 1500px の物理ピクセルを持つ
- ブラウザが canvas を物理ピクセルに合わせて**アップスケール**する
- **結果: 通常の `<img>` より悪い品質**になる（`<img>` は DPI を自動処理する）

これは canvas レンダリングにおける最も基本的かつ致命的なバグ。

**正しい処理**:
```typescript
const dpr = window.devicePixelRatio || 1;
canvas.width = displayWidth * dpr;      // 物理ピクセル数
canvas.height = displayHeight * dpr;
canvas.style.width = displayWidth + 'px';  // CSS表示サイズ
canvas.style.height = displayHeight + 'px';
ctx.scale(dpr, dpr);  // 描画座標系を物理ピクセルに合わせる
```

#### 欠陥B: Canvas の imageSmoothingQuality: 'high' は bicubic 止まり

`CanvasPage.tsx:61-62`:
```typescript
ctx.imageSmoothingQuality = 'high';
ctx.drawImage(img, 0, 0, displayWidth, displayHeight);
```

Chromium の `imageSmoothingQuality: 'high'` は **bicubic 補間**（4x4 近傍）を使用する。一方 NeeView は:
- **Lanczos3**（6x6 近傍）または **Spline36**（6x6 近傍） — bicubic より大きなサンプリング窓
- リサイズ後に**アンシャープマスク**で鮮明さを回復

bicubic は一般写真には十分だが、スクリーントーンの2-4ピクセル周期のドットパターンには不十分。Lanczos3 はより広い範囲をサンプリングするため、周期パターンの再現精度が高い。

#### 欠陥C: canvas に CSS width/height が未設定

`CanvasPage.tsx:129-134`:
```tsx
<canvas ref={canvasRef} style={{ display: 'block' }} />
```

canvas に CSS の `width`/`height` が明示されていないため、canvas のバッファサイズがそのまま CSS サイズになる。これが欠陥A（DPI問題）と組み合わさり、品質がさらに劣化する。

### 原理

Canvas 2D Context の `drawImage()` は以下の制約を持つ:
1. canvas.width/height（バッファサイズ）と CSS の表示サイズが異なる場合、ブラウザが追加のスケーリングを行う
2. `imageSmoothingQuality` は最高でも bicubic（Chromium 実装）であり、Lanczos 等の高品質フィルタは利用不可
3. `devicePixelRatio` の処理はプログラマの責任であり、自動処理されない

NeeView が優れている理由:
1. WPF のネイティブレンダリングは DPI を自動処理
2. 独自の Lanczos3/Spline36 リサイズフィルタを使用（bicubic より高品質）
3. アンシャープマスクでリサイズによるソフト化を補正

### 影響度: 高（特にDPI問題は致命的）

---

## 問題3: 見開き2ページが分離して表示される

### 根本原因

**CanvasPage のコンテナ div が canvas のコンテンツサイズに縮小**し、親の50%幅を埋めない。

#### 旧 `<img>` 方式（正常に動作していた）

```tsx
<img style={{ maxWidth: '50%', maxHeight: '100%', objectFit: 'contain' }} />
```

- `<img>` は `maxWidth: 50%` で親幅の最大50%まで伸びる
- `objectFit: contain` でアスペクト比を維持しつつ空間を埋める
- 2つの `<img>` が隣接して隙間なく配置される

#### 新 CanvasPage 方式（分離する）

`CanvasPage.tsx:118-127`:
```tsx
<div style={{
  maxWidth: maxWidthRatio === 1.0 ? '100%' : '50%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}}>
  <canvas style={{ display: 'block' }} />  // CSSサイズ未指定
</div>
```

**問題の連鎖**:
1. コンテナ div は `maxWidth: '50%'` だが、**`width` が未指定**
2. `width` が未指定のため、コンテナは子要素（canvas）のコンテンツサイズに縮小する
3. canvas は CSS サイズが未指定のため、`canvas.width`/`canvas.height` のバッファサイズ（例: 385px）がそのまま表示サイズになる
4. コンテナは canvas の 385px に縮小する（親の 50% = 960px ではなく）
5. 親の `justifyContent: 'center'` により、2つの縮小したコンテナが中央に寄せられる
6. **結果: 2ページの間に空白が生じ、見開きにならない**

### 原理

`<img>` と `<canvas>` の CSS レイアウト動作の根本的な違い:

| 特性 | `<img>` | `<canvas>` |
|------|---------|-----------|
| `objectFit` | サポート | **非サポート** |
| `maxWidth: 50%` | 画像が最大50%まで伸びる | canvas は伸びない（バッファサイズ固定） |
| 自然サイズ | 画像の元サイズ | `canvas.width/height` 属性 |
| アスペクト比維持 | `objectFit` で自動 | 手動計算が必要 |

canvas は `objectFit: contain` をサポートしないため、**コンテナの flex レイアウトに依存して配置される**。canvas に CSS `width`/`height` を明示的に設定しない限り、canvas はバッファサイズで表示され、コンテナを埋めない。

### 影響度: 高（基本的なレイアウト崩壊）

---

## まとめ

| 問題 | 根本原因 | 原理 |
|------|---------|------|
| 起動が重い | setup() 内の同期整合性チェック（全ファイルI/O） | Tauri setup はウィンドウ表示をブロックする |
| NeeViewより画質低い | (A) devicePixelRatio 未対応 (B) bicubic < Lanczos3 (C) canvas CSS未設定 | Canvas は DPI 自動処理しない。bicubic は Lanczos より低品質 |
| 見開き分離 | canvas に CSS width/height が未設定でコンテナが縮小 | canvas は objectFit 非対応。CSS サイズ明示が必須 |

3問題のうち、問題2(A) と問題3 は **CanvasPage の canvas に CSS width/height を設定し、devicePixelRatio を考慮する**ことで同時に解決可能。問題2(B) は Canvas API の限界であり、ブラウザ上では Lanczos 相当は実現困難（pica.js 等の JS ライブラリを使わない限り）。
