# マンガビューア画像モアレ対策プラン

## 問題

ビューア画面でアーカイブ内の画像を表示する際、スクリーントーン（ハーフトーンドット）が格子状のモアレパターンとして表示される。
原画像の周期的ドットパターンがブラウザの縮小アルゴリズム（Chromium Lanczos 3フィルタ）と干渉し、視覚的アーティファクトが発生している。

**該当ファイル**: `src/components/viewer/SpreadView.tsx`
**現状**: `<img>` 要素に `image-rendering` CSS プロパティが未設定（ブラウザデフォルト `auto`）

---

## Plan A: CSS `image-rendering: smooth`（推奨・最小変更）

### 概要
`<img>` 要素に `image-rendering: smooth` を追加し、ブラウザに高品質な bilinear 補間を明示的に指示する。

### 変更箇所
- `SpreadView.tsx` の全 `<img>` 要素の style に `imageRendering: 'smooth'` を追加

### メリット
- 1行の変更で済む最小侵襲アプローチ
- Chromium のデフォルト Lanczos よりソフトな補間でモアレ軽減
- パフォーマンス影響なし（ブラウザネイティブ処理）

### デメリット
- わずかにソフト（ボケ気味）になる可能性
- スクリーントーンの密度やパターンによっては効果が不十分な場合がある

### 実装難易度
★☆☆☆☆（極めて簡単）

---

## Plan B: Canvas ベース段階的縮小（最高品質）

### 概要
`<img>` を `<canvas>` に置き換え、`imageSmoothingQuality: 'high'` で画像を段階的に半分ずつ縮小（step-down resizing）してから描画する。

### 変更箇所
- `SpreadView.tsx` の `<img>` を `<canvas>` に置換
- 新規ユーティリティ: `src/utils/canvasDownscale.ts` — 段階的縮小ロジック
- ページ切替時に canvas 再描画トリガー

### アルゴリズム
```
元画像 (例: 4000px) → 2000px → 1000px → 表示サイズ
各ステップで drawImage + imageSmoothingQuality: 'high'
```

### メリット
- 最高品質の縮小結果
- ブラウザのデフォルト補間より優れた結果

### デメリット
- 実装が複雑（canvas描画、リサイズ検知、メモリ管理）
- ページ送りのレスポンスに影響（各ページで再計算）
- メモリ使用量増加（中間 canvas バッファ）
- ウィンドウリサイズ時の再計算コスト

### 実装難易度
★★★★☆（複雑）

---

## Plan C: CSS `image-rendering: smooth` + 軽量ブラーフィルタ

### 概要
Plan A に加え、CSS `filter: blur(0.3px)` を適用し、スクリーントーンのドットパターンをさらに平滑化する。

### 変更箇所
- `SpreadView.tsx` の全 `<img>` 要素の style に:
  - `imageRendering: 'smooth'`
  - `filter: 'blur(0.3px)'`

### メリット
- Plan A より更にモアレ軽減効果が高い
- 実装は Plan A とほぼ同等に簡単
- ブラー量を調整可能（0.2px〜0.5px で微調整）

### デメリット
- 画像全体がソフトになる（テキストや線画の鮮明さも低下）
- GPU 合成レイヤーが追加される（filter 使用時）
- ユーザーによっては「ぼやけている」と感じる可能性

### 実装難易度
★★☆☆☆（簡単）

---

## 実装順序

1. **Plan A** を先に試す → モアレが十分に改善されれば完了
2. 不十分なら **Plan C** へ（blur値を微調整）
3. それでも不十分なら **Plan B** へ（最終手段）

## 参考リソース

- [MDN: CSS image-rendering](https://developer.mozilla.org/en-US/docs/Web/CSS/image-rendering)
- [How browsers resize images](https://entropymine.com/resamplescope/notes/browsers/)
- [MDN: imageSmoothingQuality](https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/imageSmoothingQuality)
- [Canvas downscale techniques](https://www.ghinda.net/article/canvas-resize/)
- [Tauri WebView2 DPI issue #1074](https://github.com/tauri-apps/tauri/issues/1074)
