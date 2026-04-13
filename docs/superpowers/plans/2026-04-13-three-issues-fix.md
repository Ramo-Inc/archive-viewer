# 3問題修正 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 起動時整合性チェック削除で高速起動、devicePixelRatio + Rust Lanczos3 リサイズで NeeView 同等画質、flex: 1 + canvas CSS サイズ設定で見開きレイアウト修正。

**Architecture:** lib.rs の setup() からブロッキング処理を削除。CanvasPage に devicePixelRatio 対応と CSS サイズ明示を追加。prepare_pages に target_height 引数を追加し、extract_to_cache 内で image crate の Lanczos3 フィルタで事前リサイズ。フロントエンドは openArchive で window.innerHeight * dpr を target_height として渡す。

**Tech Stack:** Rust (image crate FilterType::Lanczos3), TypeScript/React (Canvas API, ResizeObserver), Tauri 2

---

## ファイル構成

| ファイル | 操作 | 責務 |
|---------|------|------|
| `src-tauri/src/lib.rs` | 修正 | setup() から整合性チェック + temp クリーンアップ削除 |
| `src-tauri/src/commands/viewer.rs` | 修正 | resize_page_data ヘルパー追加、extract_to_cache に target_height 対応、prepare_pages 引数追加 |
| `src/components/viewer/CanvasPage.tsx` | 修正 | DPI 対応 + CSS サイズ設定 + flex: 1 常時化 |
| `src/stores/viewerStore.ts` | 修正 | openArchive で targetHeight を渡す |

---

### Task 1: setup() から整合性チェックを削除

**Files:**
- Modify: `src-tauri/src/lib.rs:38-60`

- [ ] **Step 1: 整合性チェックと temp クリーンアップのブロックを削除**

`src-tauri/src/lib.rs` の `setup()` 内、`state.init(db_path_str).is_ok()` の if ブロック内容を空にする。

現在のコード (line 38-61):
```rust
                        if state.init(db_path_str).is_ok() {
                            // 起動時整合性チェック
                            let lib_path_buf = std::path::PathBuf::from(lib_path);
                            if let Ok(guard) = state.0.lock() {
                                if let Some(ref conn) = *guard {
                                    let _ =
                                        library::integrity::check_integrity(conn, &lib_path_buf);

                                    // 起動時に古い temp/ ディレクトリをクリーンアップ
                                    let temp_dir = lib_path_buf.join("temp");
                                    if temp_dir.exists() {
                                        if let Ok(entries) = std::fs::read_dir(&temp_dir) {
                                            for entry in entries.flatten() {
                                                let path = entry.path();
                                                if path.is_dir() {
                                                    let _ = std::fs::remove_dir_all(&path);
                                                } else {
                                                    let _ = std::fs::remove_file(&path);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
```

これを以下に置き換え:
```rust
                        let _ = state.init(db_path_str);
```

- [ ] **Step 2: ビルド確認**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: warning のみ、error なし（`library::integrity` の未使用 warning が出る可能性あり）

- [ ] **Step 3: テスト確認**

Run: `cd src-tauri && cargo test 2>&1 | grep "test result"`
Expected: 全テストパス

- [ ] **Step 4: コミット**

```bash
git add src-tauri/src/lib.rs
git commit -m "perf: remove blocking integrity check and temp cleanup from startup"
```

---

### Task 2: resize_page_data ヘルパー関数を追加 (TDD)

**Files:**
- Modify: `src-tauri/src/commands/viewer.rs`

- [ ] **Step 1: テストを先に書く**

`src-tauri/src/commands/viewer.rs` の `#[cfg(test)] mod tests` 内に追加:

```rust
    #[test]
    fn test_resize_page_data_downscale() {
        // 100x150 の PNG を target_height=75 にリサイズ
        let img = image::RgbImage::new(100, 150);
        let mut png_data = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
        image::ImageEncoder::write_image(
            encoder,
            img.as_raw(),
            100,
            150,
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();

        let result = resize_page_data(&png_data, 100, 150, 75);
        assert!(result.is_ok());

        let resized_data = result.unwrap();
        // リサイズ後の画像を読み込んでサイズ確認
        let (w, h) = thumbnail::get_image_dimensions(&resized_data).unwrap();
        assert_eq!(h, 75);
        assert_eq!(w, 50); // 100 * (75/150) = 50
    }

    #[test]
    fn test_resize_page_data_no_upscale() {
        // target_height が元画像より大きい場合は元データをそのまま返す
        let img = image::RgbImage::new(100, 150);
        let mut png_data = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut png_data);
        image::ImageEncoder::write_image(
            encoder,
            img.as_raw(),
            100,
            150,
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();

        let result = resize_page_data(&png_data, 100, 150, 300);
        assert!(result.is_ok());
        let resized = result.unwrap();
        // アップスケールしないので元サイズのまま
        let (w, h) = thumbnail::get_image_dimensions(&resized).unwrap();
        assert_eq!(w, 100);
        assert_eq!(h, 150);
    }
```

- [ ] **Step 2: テスト実行 — コンパイルエラー確認**

Run: `cd src-tauri && cargo test --lib commands::viewer::tests::test_resize_page_data_downscale 2>&1 | tail -5`
Expected: コンパイルエラー（`resize_page_data` 未定義）

- [ ] **Step 3: resize_page_data を実装**

`src-tauri/src/commands/viewer.rs` の `extract_to_cache` 関数の前（line 48 の前）に追加:

```rust
/// 画像データを target_height に Lanczos3 でリサイズして返す
/// target_height >= height の場合はリサイズせず元データを返す（アップスケール防止）
/// 元画像のフォーマットを維持（JPEG→JPEG 95, それ以外→PNG）
fn resize_page_data(data: &[u8], _width: u32, height: u32, target_height: u32) -> Result<Vec<u8>, AppError> {
    if target_height >= height {
        return Ok(data.to_vec());
    }
    let img = image::load_from_memory(data)
        .map_err(|e| AppError::FileIO(format!("画像デコード失敗: {}", e)))?;
    let resized = img.resize(u32::MAX, target_height, image::imageops::FilterType::Lanczos3);
    let mut buf = Vec::new();
    // JPEG ソース（先頭2バイト 0xFF 0xD8）は JPEG で再エンコード、それ以外は PNG
    if data.len() >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
        resized.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Jpeg)
            .map_err(|e| AppError::FileIO(format!("画像エンコード失敗: {}", e)))?;
    } else {
        resized.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
            .map_err(|e| AppError::FileIO(format!("画像エンコード失敗: {}", e)))?;
    }
    Ok(buf)
}
```

- [ ] **Step 4: テスト実行 — 全パス確認**

Run: `cd src-tauri && cargo test --lib commands::viewer::tests::test_resize_page_data -- --nocapture 2>&1 | tail -10`
Expected: 2 テストパス

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/commands/viewer.rs
git commit -m "feat: add resize_page_data helper with Lanczos3 filter (TDD)"
```

---

### Task 3: extract_to_cache と prepare_pages に target_height 対応

**Files:**
- Modify: `src-tauri/src/commands/viewer.rs`

- [ ] **Step 1: extract_to_cache に target_height 引数を追加**

`extract_to_cache` のシグネチャを変更 (line 49):

```rust
fn extract_to_cache(
    pages_dir: &std::path::Path,
    reader: &dyn archive::ArchiveReader,
    pages: &[archive::ArchivePageEntry],
    target_height: Option<u32>,
) -> Result<Vec<PageInfo>, AppError> {
```

展開ループ内 (line 89 `std::fs::write(&page_path, &page_data)?;` の直前) で、リサイズ処理を追加。現在のコード:

```rust
        std::fs::write(&page_path, &page_data)?;

        let (width, height) = thumbnail::get_image_dimensions(&page_data)
            .unwrap_or((0, 0));
```

これを以下に置き換え:

```rust
        // 画像サイズ取得（リサイズ前の元サイズ）
        let (orig_width, orig_height) = thumbnail::get_image_dimensions(&page_data)
            .unwrap_or((0, 0));
        // is_spread は元画像サイズで判定（リサイズ後だと丸め誤差で変わる可能性）
        let is_spread = thumbnail::is_spread_page(orig_width, orig_height);

        // target_height が指定されていて元画像より大きい場合、Lanczos3 でリサイズ
        let final_data = if let Some(th) = target_height {
            if orig_height > th && orig_height > 0 {
                resize_page_data(&page_data, orig_width, orig_height, th)
                    .unwrap_or(page_data)
            } else {
                page_data
            }
        } else {
            page_data
        };

        std::fs::write(&page_path, &final_data)?;

        // リサイズ後の実際のサイズを取得
        let (width, height) = thumbnail::get_image_dimensions(&final_data)
            .unwrap_or((orig_width, orig_height));
```

- [ ] **Step 2: prepare_pages に target_height 引数を追加**

`prepare_pages` のシグネチャを変更 (line 126-129):

```rust
#[tauri::command]
pub fn prepare_pages(
    state: State<'_, DbState>,
    archive_id: String,
    target_height: Option<u32>,
) -> Result<Vec<PageInfo>, AppError> {
```

`extract_to_cache` の呼び出し (line 165) に `target_height` を渡す:

```rust
    match extract_to_cache(&pages_dir, &*reader, &pages, target_height) {
```

`archive::open_archive` の呼び出し前に missing フラグ遅延検出を追加。現在の `let archive_full_path = ...` の後（line 154 付近）に:

```rust
    let archive_full_path = library_path.join(&archive_record.file_path);

    // missing フラグ遅延検出: ファイルが存在しない場合は DB を更新してエラー返却
    if !archive_full_path.exists() {
        let _ = queries::set_archive_missing(conn, &archive_id, true);
        return Err(AppError::FileIO(format!(
            "アーカイブファイルが見つかりません: {}",
            archive_record.file_path
        )));
    }
```

- [ ] **Step 3: 既存テストを修正**

`test_extract_to_cache_creates_pages_and_meta` の `extract_to_cache` 呼び出し (line 373) に `None` を追加:

```rust
        let result = extract_to_cache(&pages_dir, &*reader, &pages, None);
```

- [ ] **Step 4: テスト実行 — 全パス確認**

Run: `cd src-tauri && cargo test --lib commands::viewer::tests -- --nocapture 2>&1 | tail -15`
Expected: 全テストパス

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/commands/viewer.rs
git commit -m "feat: add target_height to prepare_pages for Lanczos3 pre-resize"
```

---

### Task 4: CanvasPage の DPI 対応 + レイアウト修正

**Files:**
- Modify: `src/components/viewer/CanvasPage.tsx`

- [ ] **Step 1: draw() 関数を DPI 対応に書き換え**

`src/components/viewer/CanvasPage.tsx` の `draw` 関数全体 (line 30-64) を以下に置き換え:

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

    // objectFit: contain 相当 — アスペクト比を維持してコンテナに収める
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

    // バッファサイズが変わった場合のみリサイズ
    if (canvas.width !== bufferWidth || canvas.height !== bufferHeight) {
      canvas.width = bufferWidth;
      canvas.height = bufferHeight;
    }

    // CSS表示サイズを明示設定（1:1 で表示するため）
    canvas.style.width = displayWidth + 'px';
    canvas.style.height = displayHeight + 'px';

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // 物理ピクセルサイズで描画
    ctx.drawImage(img, 0, 0, bufferWidth, bufferHeight);
  }, [naturalWidth, naturalHeight]);
```

- [ ] **Step 2: コンテナ div の CSS を修正**

return 文のコンテナ div (line 117-127) を以下に置き換え:

```typescript
  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        maxWidth: maxWidthRatio === 1.0 ? '100%' : '50%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
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
```

変更点:
- `flex: 1` を常に設定（`maxWidthRatio === 0.5` の条件分岐を削除）
- `overflow: 'hidden'` を追加

- [ ] **Step 3: DPI 変更検出の matchMedia リスナーを追加**

既存の ResizeObserver useEffect（line 99-110 付近）の後に追加:

```typescript
  // Redraw on DPI change (e.g., window moved between monitors)
  useEffect(() => {
    const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    const handleChange = () => draw();
    mql.addEventListener('change', handleChange, { once: true });
    return () => mql.removeEventListener('change', handleChange);
  }, [draw]);
```

- [ ] **Step 4: TypeScript 型チェック**

Run: `npx tsc -b --noEmit 2>&1 | grep CanvasPage || echo "No CanvasPage errors"`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/components/viewer/CanvasPage.tsx
git commit -m "fix: add devicePixelRatio support and fix spread layout in CanvasPage"
```

---

### Task 5: viewerStore の openArchive で targetHeight を渡す

**Files:**
- Modify: `src/stores/viewerStore.ts:94-96`

- [ ] **Step 1: prepare_pages の呼び出しに targetHeight を追加**

`src/stores/viewerStore.ts` の `openArchive` 内、`prepare_pages` の呼び出し (line 94-96) を変更:

```typescript
      // 2. Prepare pages (extract with Lanczos3 pre-resize to display height)
      const targetHeight = Math.floor(window.innerHeight * (window.devicePixelRatio || 1));
      const pages = await tauriInvoke<PageInfo[]>('prepare_pages', {
        archiveId: archiveIdStr,
        targetHeight,
      });
```

- [ ] **Step 2: コミット**

```bash
git add src/stores/viewerStore.ts
git commit -m "feat: pass targetHeight to prepare_pages for Lanczos3 pre-resize"
```

---

### Task 6: 動作確認

- [ ] **Step 1: Tauri dev で起動**

Run: `npx tauri dev`

- [ ] **Step 2: 起動速度確認**

アプリが即座にウィンドウを表示することを確認（整合性チェックのブロッキングなし）。

- [ ] **Step 3: 見開き表示確認**

1. マンガを開き、見開きモードにする
2. 2ページが**隙間なく**隣接して表示されることを確認
3. RTL 順序が正しいことを確認

- [ ] **Step 4: 画質確認**

1. スクリーントーンのあるマンガを開く
2. 以前と比較してモアレが軽減されていることを確認
3. 特に高DPIディスプレイ（125%/150%スケーリング）での鮮明さを確認

- [ ] **Step 5: ウィンドウリサイズ確認**

1. ウィンドウサイズを変更
2. canvas が正しくリサイズされること確認
3. 見開きモードでもリサイズ後にレイアウトが維持されることを確認

- [ ] **Step 6: 全テスト実行**

Run: `cd src-tauri && cargo test 2>&1 | tail -10`
Expected: 全テストパス（新規 2 テスト含む）
