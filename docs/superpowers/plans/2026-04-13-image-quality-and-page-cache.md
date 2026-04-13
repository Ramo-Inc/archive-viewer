# 画像品質改善 + 遅延ページキャッシュ 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ビューアの画像モアレを軽量blurで軽減し、アーカイブページ展開を遅延キャッシュで高速化する

**Architecture:** `SpreadView.tsx` に CSS blur フィルタを追加。Rust 側の `prepare_pages` をキャッシュ対応に改修し、`archives/{id}/pages/` にページを永続展開。`meta.json` でメタデータを管理し、2回目以降はアーカイブ開封をスキップする。

**Tech Stack:** Rust (serde_json, std::fs), TypeScript/React, Tauri 2, CSS filter

---

## ファイル構成

| ファイル | 操作 | 責務 |
|---------|------|------|
| `src-tauri/src/commands/viewer.rs` | 修正 | `prepare_pages` キャッシュ対応、`CachedPageMeta` 型追加 |
| `src-tauri/src/lib.rs` | 修正 | 起動時 temp/ クリーンアップ追加 |
| `src/components/viewer/SpreadView.tsx` | 修正 | blur フィルタ追加 |
| `src/stores/viewerStore.ts` | 修正 | `closeArchive` から `cleanup_temp_pages` 呼び出し削除 |

---

### Task 1: SpreadView に blur フィルタを追加（Plan C）

**Files:**
- Modify: `src/components/viewer/SpreadView.tsx:66-70, 103-107, 137-141, 148-152`

- [ ] **Step 1: 全4箇所の `<img>` style に `filter` を追加**

`src/components/viewer/SpreadView.tsx` — Single モード (line 66-70):
```typescript
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            imageRendering: 'smooth' as const,
            filter: 'blur(0.3px)',
          }}
```

Spread ソロ (line 103-107):
```typescript
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            imageRendering: 'smooth' as const,
            filter: 'blur(0.3px)',
          }}
```

Spread 右ページ (line 137-141):
```typescript
        style={{
          maxWidth: '50%',
          maxHeight: '100%',
          objectFit: 'contain',
          imageRendering: 'smooth' as const,
          filter: 'blur(0.3px)',
        }}
```

Spread 左ページ (line 148-152):
```typescript
          style={{
            maxWidth: '50%',
            maxHeight: '100%',
            objectFit: 'contain',
            imageRendering: 'smooth' as const,
            filter: 'blur(0.3px)',
          }}
```

- [ ] **Step 2: TypeScript 型チェック**

Run: `npx tsc -b --noEmit 2>&1 | grep SpreadView || echo "No SpreadView errors"`
Expected: SpreadView 関連のエラーなし

- [ ] **Step 3: コミット**

```bash
git add src/components/viewer/SpreadView.tsx
git commit -m "feat: add CSS blur filter to viewer images for moire reduction (Plan C)"
```

---

### Task 2: CachedPageMeta 型と キャッシュ読み込みヘルパーを追加

**Files:**
- Modify: `src-tauri/src/commands/viewer.rs:1-9`

- [ ] **Step 1: use 文と CachedPageMeta 型を追加**

`src-tauri/src/commands/viewer.rs` の冒頭を以下に置き換え:

```rust
use crate::archive;
use crate::config;
use crate::db::models::PageInfo;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use crate::imaging::thumbnail;
use serde::{Deserialize, Serialize};
use tauri::State;

/// キャッシュ用メタデータ構造体
#[derive(Serialize, Deserialize)]
struct CachedPageMeta {
    index: usize,
    file_name: String,
    width: u32,
    height: u32,
    is_spread: bool,
}

/// キャッシュからページ情報を読み込む
/// meta.json が存在しパース可能なら Some(Vec<PageInfo>) を返す
fn try_load_cache(pages_dir: &std::path::Path) -> Option<Vec<PageInfo>> {
    let meta_path = pages_dir.join("meta.json");
    let meta_json = std::fs::read_to_string(&meta_path).ok()?;
    let cached: Vec<CachedPageMeta> = serde_json::from_str(&meta_json).ok()?;

    let page_infos = cached
        .into_iter()
        .map(|m| {
            let url = pages_dir
                .join(&m.file_name)
                .to_string_lossy()
                .replace('\\', "/");
            PageInfo {
                index: m.index,
                url,
                width: m.width,
                height: m.height,
                is_spread: m.is_spread,
            }
        })
        .collect();

    Some(page_infos)
}
```

- [ ] **Step 2: Rust 型チェック**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: warning のみ、error なし

- [ ] **Step 3: コミット**

```bash
git add src-tauri/src/commands/viewer.rs
git commit -m "feat: add CachedPageMeta type and cache loader for page cache"
```

---

### Task 3: prepare_pages をキャッシュ対応に改修

**Files:**
- Modify: `src-tauri/src/commands/viewer.rs` — `prepare_pages` 関数全体

- [ ] **Step 1: prepare_pages を書き換え**

`prepare_pages` 関数の本体を以下に置き換え:

```rust
/// ページ準備: キャッシュがあれば即返却、なければ展開してキャッシュ保存
/// CR-1: Zip Slip対策付き (パストラバーサル防止)
#[tauri::command]
pub fn prepare_pages(
    state: State<'_, DbState>,
    archive_id: String,
) -> Result<Vec<PageInfo>, AppError> {
    let library_path = config::get_library_root()?;

    // キャッシュディレクトリ: archives/{archive_id}/pages/
    // DB アクセスせずに archive_id から直接パスを構築（キャッシュヒット時の高速パス）
    let pages_dir = library_path
        .join("archives")
        .join(&archive_id)
        .join("pages");

    // --- キャッシュヒットチェック ---
    if let Some(page_infos) = try_load_cache(&pages_dir) {
        return Ok(page_infos);
    }

    // --- キャッシュミス: DB からアーカイブ情報を取得して展開 ---
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    let archive_record = queries::get_archive_by_id(conn, &archive_id)?;

    // 壊れたキャッシュがあれば削除
    if pages_dir.exists() {
        let _ = std::fs::remove_dir_all(&pages_dir);
    }

    let archive_full_path = library_path.join(&archive_record.file_path);
    let reader = archive::open_archive(
        archive_full_path
            .to_str()
            .ok_or_else(|| AppError::FileIO("無効なパス".to_string()))?,
    )?;

    let pages = reader.list_pages()?;

    std::fs::create_dir_all(&pages_dir)?;

    // canonicalizeでベースパスを確定
    let pages_dir_canonical = pages_dir
        .canonicalize()
        .map_err(|e| AppError::FileIO(format!("キャッシュディレクトリ正規化失敗: {}", e)))?;

    let mut page_infos = Vec::new();
    let mut cached_metas = Vec::new();

    for (idx, page) in pages.iter().enumerate() {
        let page_data = reader.extract_page(&page.name)?;

        // ファイル名のみ取得 (パストラバーサル防止)
        let safe_filename = std::path::Path::new(&page.name)
            .file_name()
            .ok_or_else(|| {
                AppError::Archive(format!("不正なページ名: {}", page.name))
            })?;

        let file_name = format!("{:03}_{}", idx, safe_filename.to_string_lossy());
        let page_path = pages_dir.join(&file_name);

        // Zip Slip対策: canonicalizeでパストラバーサルを検出
        {
            let parent = page_path
                .parent()
                .ok_or_else(|| AppError::FileIO("無効な出力パス".to_string()))?;
            let parent_canonical = parent
                .canonicalize()
                .map_err(|e| AppError::FileIO(format!("パス正規化失敗: {}", e)))?;
            if !parent_canonical.starts_with(&pages_dir_canonical) {
                return Err(AppError::Archive(format!(
                    "パストラバーサル検出: {}",
                    page.name
                )));
            }
        }

        std::fs::write(&page_path, &page_data)?;

        // 画像サイズ取得
        let (width, height) = thumbnail::get_image_dimensions(&page_data)
            .unwrap_or((0, 0));
        let is_spread = thumbnail::is_spread_page(width, height);

        let url = page_path
            .to_string_lossy()
            .replace('\\', "/");

        page_infos.push(PageInfo {
            index: idx,
            url,
            width,
            height,
            is_spread,
        });

        cached_metas.push(CachedPageMeta {
            index: idx,
            file_name,
            width,
            height,
            is_spread,
        });
    }

    // meta.json を最後に書き込み（展開完了の目印）
    let meta_json = serde_json::to_string_pretty(&cached_metas)?;
    std::fs::write(pages_dir.join("meta.json"), meta_json)?;

    Ok(page_infos)
}
```

**変更点の要約:**
- 展開先が `temp/{UUID}/` → `archives/{archive_id}/pages/` に変更
- キャッシュヒット時は `try_load_cache` で即返却（DBロック不要で高速）
- キャッシュミス時のみ DB アクセス → 展開 + `meta.json` 書き込み
- ファイル名プレフィックスが `{idx}_` → `{idx:03}_` に変更（3桁ゼロ埋め、meta.json と一致）
- Zip Slip 保護はそのまま維持
- `use uuid::Uuid;` は不要になったため削除（`uuid` crate は `archive/rar.rs` で使用されるため Cargo.toml からは削除しない）

- [ ] **Step 2: Rust 型チェック**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: warning のみ、error なし

- [ ] **Step 3: コミット**

```bash
git add src-tauri/src/commands/viewer.rs
git commit -m "feat: add lazy page cache to prepare_pages (cache in archives/{id}/pages/)"
```

---

### Task 4: closeArchive から cleanup_temp_pages 呼び出しを削除

**Files:**
- Modify: `src/stores/viewerStore.ts:106-109`

- [ ] **Step 1: closeArchive を修正**

`src/stores/viewerStore.ts` の `closeArchive` を以下に変更:

```typescript
  closeArchive: () => {
    set({ archive: null, currentPage: 0 });
  },
```

`cleanup_temp_pages` の呼び出しを削除する。キャッシュは永続のためクリーンアップ不要。

- [ ] **Step 2: コミット**

```bash
git add src/stores/viewerStore.ts
git commit -m "refactor: remove cleanup_temp_pages from closeArchive (cache is persistent)"
```

---

### Task 5: アプリ起動時に古い temp/ をクリーンアップ

**Files:**
- Modify: `src-tauri/src/lib.rs:31-50`

- [ ] **Step 1: setup() 内に temp クリーンアップを追加**

`src-tauri/src/lib.rs` の `setup()` クロージャ内、整合性チェックの後（line 44 の後）に以下を追加:

```rust
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
```

挿入位置は以下のブロック内:
```rust
                            let _ =
                                library::integrity::check_integrity(conn, &lib_path_buf);
                            // ← ここに挿入
```

- [ ] **Step 2: Rust 型チェック**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: warning のみ、error なし

- [ ] **Step 3: コミット**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: cleanup old temp/ directories on app startup"
```

---

### Task 6: 展開失敗時のキャッシュクリーンアップ

**Files:**
- Modify: `src-tauri/src/commands/viewer.rs` — `prepare_pages` 関数

- [ ] **Step 1: 展開処理をエラー時クリーンアップで包む**

Task 3 で書いた `prepare_pages` の展開処理を `extract_to_cache` ヘルパーに分離し、エラー時に `pages_dir` を削除する。

**置き換え範囲**: `prepare_pages` 関数内の `// 壊れたキャッシュがあれば削除` の行から関数末尾の閉じ `}` まで（`Ok(page_infos)` と関数の閉じ括弧を含む）を、以下のコード全体で置き換える:

```rust
    // --- キャッシュミス: 展開してキャッシュ保存 ---
    // 壊れたキャッシュがあれば削除
    if pages_dir.exists() {
        let _ = std::fs::remove_dir_all(&pages_dir);
    }

    let archive_full_path = library_path.join(&archive_record.file_path);
    let reader = archive::open_archive(
        archive_full_path
            .to_str()
            .ok_or_else(|| AppError::FileIO("無効なパス".to_string()))?,
    )?;

    let pages = reader.list_pages()?;

    std::fs::create_dir_all(&pages_dir)?;

    match extract_to_cache(&pages_dir, &*reader, &pages) {
        Ok(page_infos) => Ok(page_infos),
        Err(e) => {
            // 展開失敗時はキャッシュを削除
            let _ = std::fs::remove_dir_all(&pages_dir);
            Err(e)
        }
    }
}
```

そして `extract_to_cache` ヘルパー関数を `prepare_pages` の後に追加:

```rust
/// アーカイブページをキャッシュディレクトリに展開し、meta.json を書き出す
fn extract_to_cache(
    pages_dir: &std::path::Path,
    reader: &dyn archive::ArchiveReader,
    pages: &[archive::ArchivePageEntry],
) -> Result<Vec<PageInfo>, AppError> {
    let pages_dir_canonical = pages_dir
        .canonicalize()
        .map_err(|e| AppError::FileIO(format!("キャッシュディレクトリ正規化失敗: {}", e)))?;

    let mut page_infos = Vec::new();
    let mut cached_metas = Vec::new();

    for (idx, page) in pages.iter().enumerate() {
        let page_data = reader.extract_page(&page.name)?;

        let safe_filename = std::path::Path::new(&page.name)
            .file_name()
            .ok_or_else(|| {
                AppError::Archive(format!("不正なページ名: {}", page.name))
            })?;

        let file_name = format!("{:03}_{}", idx, safe_filename.to_string_lossy());
        let page_path = pages_dir.join(&file_name);

        // Zip Slip対策
        {
            let parent = page_path
                .parent()
                .ok_or_else(|| AppError::FileIO("無効な出力パス".to_string()))?;
            let parent_canonical = parent
                .canonicalize()
                .map_err(|e| AppError::FileIO(format!("パス正規化失敗: {}", e)))?;
            if !parent_canonical.starts_with(&pages_dir_canonical) {
                return Err(AppError::Archive(format!(
                    "パストラバーサル検出: {}",
                    page.name
                )));
            }
        }

        std::fs::write(&page_path, &page_data)?;

        let (width, height) = thumbnail::get_image_dimensions(&page_data)
            .unwrap_or((0, 0));
        let is_spread = thumbnail::is_spread_page(width, height);

        let url = page_path
            .to_string_lossy()
            .replace('\\', "/");

        page_infos.push(PageInfo {
            index: idx,
            url,
            width,
            height,
            is_spread,
        });

        cached_metas.push(CachedPageMeta {
            index: idx,
            file_name,
            width,
            height,
            is_spread,
        });
    }

    // meta.json を最後に書き込み（展開完了の目印）
    let meta_json = serde_json::to_string_pretty(&cached_metas)?;
    std::fs::write(pages_dir.join("meta.json"), meta_json)?;

    Ok(page_infos)
}
```

- [ ] **Step 2: Rust 型チェック**

Run: `cd src-tauri && cargo check 2>&1 | tail -10`
Expected: warning のみ、error なし

- [ ] **Step 4: コミット**

```bash
git add src-tauri/src/commands/viewer.rs
git commit -m "refactor: extract cache write to helper, add cleanup on extraction failure"
```

---

### Task 7: 動作確認

- [ ] **Step 1: Tauri dev で起動**

Run: `npx tauri dev`

- [ ] **Step 2: 初回閲覧テスト（キャッシュミス）**

1. ライブラリからスクリーントーンのあるマンガを開く
2. 画像が表示されることを確認
3. blur が適用されてモアレが軽減されていることを確認
4. ライブラリのアーカイブディレクトリに `pages/` と `meta.json` が生成されていることを確認

確認コマンド:
```bash
ls "<library_path>/archives/<archive_id>/pages/"
cat "<library_path>/archives/<archive_id>/pages/meta.json" | head -5
```

- [ ] **Step 3: 2回目閲覧テスト（キャッシュヒット）**

1. ビューアを閉じる
2. 同じマンガを再度開く
3. 1回目より明らかに速く表示されることを確認
4. 画像が正常に表示されることを確認

- [ ] **Step 4: アプリ再起動テスト**

1. アプリ全体を閉じる
2. `npx tauri dev` で再起動
3. `temp/` ディレクトリが空になっていることを確認
4. マンガを開いてキャッシュが効いていることを確認（即座に表示）

- [ ] **Step 5: 全変更をコミット（未コミットの変更がある場合）**

```bash
git add -A
git commit -m "feat: image quality improvement (blur) and lazy page cache"
```
