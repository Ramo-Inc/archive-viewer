# 3問題修正設計書

調査レポート `reviews/2026-04-13-three-issues-investigation.md` に基づく修正設計。

## 修正対象

1. 起動が重い → 起動時整合性チェックを削除
2. NeeViewより画質が劣る → devicePixelRatio 対応 + Rust Lanczos3 事前リサイズ
3. 見開き2ページが分離 → CanvasPage のレイアウト修正

---

## 修正1: 起動パフォーマンス改善

### 根本原因

`lib.rs` の `setup()` 内で `check_integrity()` を同期実行している。

### 精査結果: 毎回起動時に実行する必要がない

| 処理 | 必要性 | 理由 |
|------|--------|------|
| ファイル存在チェック (全アーカイブ) | **不要** | ファイルが消えるのは稀。開こうとした時にエラーで十分 |
| temp/ クリーンアップ | **完全に死コード** | ページキャッシュ導入後、temp/ には何も書き込まれない |
| 孤立サムネイル削除 | **不要** | `delete_archives` がサムネイルも削除する。孤立発生はバグの場合のみ |

### 修正方針

`setup()` から**整合性チェック全体と temp クリーンアップを削除**する。バックグラウンドスレッド化ではなく、単純削除。

### 変更内容

`src-tauri/src/lib.rs` の `setup()` 内、DB 初期化成功後のブロック（line 39-60）を削除:

```rust
// 削除する範囲:
                            // 起動時整合性チェック
                            let lib_path_buf = std::path::PathBuf::from(lib_path);
                            if let Ok(guard) = state.0.lock() {
                                if let Some(ref conn) = *guard {
                                    let _ =
                                        library::integrity::check_integrity(conn, &lib_path_buf);

                                    // 起動時に古い temp/ ディレクトリをクリーンアップ
                                    let temp_dir = lib_path_buf.join("temp");
                                    // ... (全体)
                                }
                            }
```

DB 初期化 (`state.init()`) の後は何もせず `Ok(())` を返す。

**将来**: ファイル存在チェックが必要になった場合、「ライブラリスキャン」機能として手動実行にする。

---

## 修正2: 画質改善 — devicePixelRatio 対応 + Rust Lanczos3

### 根本原因

1. **devicePixelRatio 未対応**: canvas バッファサイズが CSS ピクセルで設定され、高 DPI ディスプレイでブラウザがアップスケール → ぼやける
2. **Canvas bicubic < NeeView Lanczos3**: Canvas API の `imageSmoothingQuality: 'high'` は bicubic 止まり

### 修正方針

**2段階アプローチ:**

#### 段階A: CanvasPage の devicePixelRatio 対応

`CanvasPage.tsx` の `draw()` を修正:

```typescript
const draw = useCallback(() => {
  const canvas = canvasRef.current;
  const container = containerRef.current;
  const img = imgRef.current;
  if (!canvas || !container || !img || !img.complete || naturalWidth === 0 || naturalHeight === 0) {
    return;
  }

  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  if (containerW <= 0 || containerH <= 0) return;

  // objectFit: contain 相当
  const scaleX = containerW / naturalWidth;
  const scaleY = containerH / naturalHeight;
  const scale = Math.min(scaleX, scaleY);

  const displayWidth = Math.floor(naturalWidth * scale);
  const displayHeight = Math.floor(naturalHeight * scale);
  if (displayWidth <= 0 || displayHeight <= 0) return;

  // devicePixelRatio 対応: 物理ピクセル数でバッファを確保
  const dpr = window.devicePixelRatio || 1;
  const bufferWidth = Math.floor(displayWidth * dpr);
  const bufferHeight = Math.floor(displayHeight * dpr);

  if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
    canvas.width = bufferWidth;
    canvas.height = bufferHeight;
  }

  // CSS表示サイズを明示設定
  canvas.style.width = displayWidth + 'px';
  canvas.style.height = displayHeight + 'px';

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, bufferWidth, bufferHeight);
}, [naturalWidth, naturalHeight]);
```

`draw()` の依存配列から `maxWidthRatio` を削除（CSS レイアウトに委ねる）。

#### 段階B: Rust Lanczos3 事前リサイズ（NeeView と同等品質）

`prepare_pages` にフロントエンドから `target_height` を渡し、キャッシュ展開時に `image` crate の `FilterType::Lanczos3` で表示サイズに事前リサイズする。

**Rust 側変更:**

`src-tauri/src/commands/viewer.rs` — `prepare_pages` に `target_height: Option<u32>` 引数を追加:

```rust
#[tauri::command]
pub fn prepare_pages(
    state: State<'_, DbState>,
    archive_id: String,
    target_height: Option<u32>,
) -> Result<Vec<PageInfo>, AppError> {
```

`extract_to_cache` に `target_height` を伝搬し、ページ書き出し時にリサイズ:

```rust
// extract_to_cache 内、std::fs::write の前:
let page_data = if let Some(th) = target_height {
    if height > th {
        // Lanczos3 で表示高さに事前リサイズ
        resize_page_data(&original_data, width, height, th)?
    } else {
        original_data  // 元画像が表示サイズより小さければそのまま
    }
} else {
    original_data
};
```

リサイズヘルパー関数:

```rust
fn resize_page_data(data: &[u8], width: u32, height: u32, target_height: u32) -> Result<Vec<u8>, AppError> {
    let img = image::load_from_memory(data)
        .map_err(|e| AppError::FileIO(format!("画像デコード失敗: {}", e)))?;
    let scale = target_height as f64 / height as f64;
    let target_width = (width as f64 * scale).round() as u32;
    let resized = img.resize_exact(target_width, target_height, image::imageops::FilterType::Lanczos3);
    let mut buf = Vec::new();
    resized.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .map_err(|e| AppError::FileIO(format!("画像エンコード失敗: {}", e)))?;
    Ok(buf)
}
```

**フロントエンド側変更:**

`viewerStore.ts` — `openArchive` で `window.innerHeight * devicePixelRatio` を `target_height` として渡す:

```typescript
const pages = await tauriInvoke<PageInfo[]>('prepare_pages', {
  archiveId: archiveIdStr,
  targetHeight: Math.floor(window.innerHeight * (window.devicePixelRatio || 1)),
});
```

**キャッシュの扱い:**
- `target_height` はキャッシュキーの一部にはしない（同じ `meta.json` を使用）
- 理由: ウィンドウ高さが変わるたびにキャッシュが無効化されると、キャッシュの意味がなくなる
- キャッシュヒット時は `target_height` を無視し、キャッシュ済み画像をそのまま返す
- キャッシュ画像が表示サイズより大きい場合は CanvasPage が縮小描画（品質劣化なし）
- キャッシュ画像が表示サイズより小さい場合は拡大になるが、将来のキャッシュ再生成で対応

**CachedPageMeta の拡張:**
- `original_width` / `original_height` フィールドを追加し、元画像サイズを保存
- `is_spread` 判定は元画像サイズで行う（リサイズ後サイズだと丸め誤差で判定が変わる可能性）
- 将来のキャッシュ再生成判定に元サイズが必要

**resize_page_data の仕様:**
- `target_height >= height` の場合はリサイズせず元データをそのまま返す（アップスケール防止）
- `resize_exact` ではなく `resize` を使用（アスペクト比を自動維持）
- 元画像が JPEG の場合は JPEG(quality=95) で、PNG の場合は PNG で再エンコード（ファイルサイズ最適化）

**missing フラグの遅延検出:**
- `prepare_pages` でアーカイブファイルが存在しない場合、`set_archive_missing(conn, id, true)` でフラグ更新してからエラー返却

**DPI 変更検出:**
- CanvasPage に `matchMedia` リスナーを追加し、`devicePixelRatio` 変更（マルチモニター移動）時に再描画

**CanvasPage への影響:**
- Rust が表示サイズにリサイズ済みの画像を返すため、canvas の `drawImage` はほぼ 1:1 描画になる
- bicubic vs Lanczos の差は無視できるレベルになる（大幅な縮小は Rust 側で完了済み）
- DPI 対応は引き続き必要（物理ピクセルへの微調整が残る）

---

## 修正3: 見開きレイアウト修正

### 根本原因

CanvasPage のコンテナ div に `width` が未指定で、canvas コンテンツサイズに縮小している。

### 修正内容

`CanvasPage.tsx` のコンテナ div CSS:

```typescript
<div
  ref={containerRef}
  style={{
    flex: 1,                    // 常に flex: 1 で親空間を均等分割
    maxWidth: maxWidthRatio === 1.0 ? '100%' : '50%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  }}
>
```

- `flex: 1` を常に設定（条件分岐削除）→ コンテナが親空間を埋める
- `overflow: 'hidden'` 追加
- canvas に `style.width`/`style.height` が設定される（修正2の段階A で対応済み）→ canvas が適切なサイズで表示

---

## 修正の効果

| 問題 | 修正内容 | 期待効果 |
|------|---------|---------|
| 起動が重い | 整合性チェックを `setup()` から完全削除 | ウィンドウ即座に表示 |
| 画質が低い(DPI) | devicePixelRatio 対応 | 高DPIで鮮明な描画 |
| 画質が低い(アルゴリズム) | Rust Lanczos3 事前リサイズ | NeeView と同等品質 |
| 見開き分離 | flex: 1 常時 + canvas CSS サイズ明示 | 2ページが隙間なく並ぶ |

## 変更ファイル一覧

| ファイル | 操作 | 内容 |
|---------|------|------|
| `src-tauri/src/lib.rs` | 修正 | 整合性チェック + temp クリーンアップを削除 |
| `src/components/viewer/CanvasPage.tsx` | 修正 | DPI対応、CSS サイズ設定、flex: 1 常時化 |
| `src-tauri/src/commands/viewer.rs` | 修正 | `prepare_pages` に `target_height` 引数追加、Lanczos3 リサイズ |
| `src/stores/viewerStore.ts` | 修正 | `openArchive` で `targetHeight` を渡す |

## スコープ外

- アンシャープマスク（NeeView の UnsharpMask — 将来検討）
- ファイル存在チェックの手動スキャン機能（将来検討）
- target_height 変化時のキャッシュ再生成の最適化（将来検討）
