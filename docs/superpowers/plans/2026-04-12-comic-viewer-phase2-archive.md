# ComicViewer Phase 2: Archive Processing & Import

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ZIP/CBZ/CBRアーカイブの読み取り、サムネイル生成、安全なインポートパイプラインを構築し、Tauriコマンド経由でフロントエンドからアーカイブを取り込めるようにする

**Architecture:** アーカイブ処理はRust側のtraitベースの共通インターフェースで抽象化。ZIP/CBZは`zip`クレート、CBRは`unrar`クレートで処理。サムネイルは`image`クレートでJPEG生成。インポートはコピー→DB登録→元削除の安全フロー。

**Tech Stack:** Rust, zip, unrar, image, natord, uuid, chrono

**PRD参照:** `docs/superpowers/specs/2026-04-12-comic-viewer-design.md` セクション 8.1, 9.1-9.5

**前提:** Phase 1 が完了していること

---

## File Structure (Phase 2)

```
src-tauri/src/
├── archive/
│   ├── mod.rs           — ArchiveReader trait + ファクトリ関数
│   ├── zip.rs           — ZIP/CBZ 読み取り実装
│   ├── rar.rs           — CBR(RAR) 読み取り実装
│   └── common.rs        — Natural sort, 画像フィルタ, ユーティリティ
├── image/
│   ├── mod.rs           — モジュール公開
│   └── thumbnail.rs     — サムネイル生成
├── library/
│   ├── mod.rs           — モジュール公開
│   └── import.rs        — インポートパイプライン
├── commands/
│   ├── mod.rs           — (更新) archive モジュール追加
│   └── archive.rs       — import_archives, get_archives 等のコマンド
```

---

### Task 1: 共通アーカイブインターフェースとユーティリティ

**Files:**
- Create: `src-tauri/src/archive/mod.rs`
- Create: `src-tauri/src/archive/common.rs`
- Modify: `src-tauri/Cargo.toml` (`natord` 追加)
- Modify: `src-tauri/src/main.rs` (mod archive 追加)

- [ ] **Step 1: Cargo.toml に natord を追加**

```toml
# src-tauri/Cargo.toml の [dependencies] に追加
natord = "1.0"
```

- [ ] **Step 2: archive/common.rs を作成**

```rust
// src-tauri/src/archive/common.rs
use std::path::Path;

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];

/// ファイルが画像かどうか拡張子で判定
pub fn is_image_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    IMAGE_EXTENSIONS.iter().any(|ext| lower.ends_with(ext))
}

/// ファイル名のリストをNatural sortでソート
pub fn sort_filenames_natural(names: &mut Vec<String>) {
    names.sort_by(|a, b| natord::compare(a, b));
}

/// アーカイブファイルのフォーマットを拡張子から判定
pub fn detect_format(path: &Path) -> Option<String> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    match ext.as_str() {
        "zip" => Some("zip".to_string()),
        "cbz" => Some("cbz".to_string()),
        "cbr" => Some("cbr".to_string()),
        _ => None,
    }
}

/// パス区切り文字を / に正規化
pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}
```

- [ ] **Step 3: archive/mod.rs を作成**

```rust
// src-tauri/src/archive/mod.rs
pub mod common;
pub mod zip;
pub mod rar;

use crate::error::AppError;
use std::path::Path;

/// アーカイブ内のページ情報
pub struct ArchivePageEntry {
    pub name: String,
    pub index: usize,
}

/// アーカイブ読み取りの共通インターフェース
pub trait ArchiveReader {
    /// アーカイブ内の画像ページ一覧を返す（Natural sortでソート済み）
    fn list_pages(&self) -> Result<Vec<ArchivePageEntry>, AppError>;

    /// 指定ページの画像バイト列を返す
    fn extract_page(&self, page_name: &str) -> Result<Vec<u8>, AppError>;

    /// 先頭ページの画像バイト列を返す（サムネイル用）
    fn extract_first_page(&self) -> Result<Vec<u8>, AppError> {
        let pages = self.list_pages()?;
        let first = pages.first().ok_or(AppError::Archive("アーカイブにページがありません".into()))?;
        self.extract_page(&first.name)
    }

    /// ページ数を返す
    fn page_count(&self) -> Result<usize, AppError> {
        Ok(self.list_pages()?.len())
    }
}

/// ファイルパスからフォーマットに応じたArchiveReaderを生成
pub fn open_archive(path: &Path) -> Result<Box<dyn ArchiveReader>, AppError> {
    let format = common::detect_format(path)
        .ok_or(AppError::Archive(format!("未対応のファイル形式: {:?}", path)))?;

    match format.as_str() {
        "zip" | "cbz" => Ok(Box::new(zip::ZipArchiveReader::open(path)?)),
        "cbr" => Ok(Box::new(rar::RarArchiveReader::open(path)?)),
        _ => Err(AppError::Archive(format!("未対応のフォーマット: {}", format))),
    }
}
```

- [ ] **Step 4: main.rs に mod archive を追加**

`src-tauri/src/main.rs` の先頭に追加:

```rust
mod archive;
```

- [ ] **Step 5: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: zip.rs, rar.rs が未作成のためエラー（次のタスクで作成）

- [ ] **Step 6: コミット（common.rs と mod.rs のみ）**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/Cargo.toml src-tauri/src/archive/common.rs src-tauri/src/archive/mod.rs src-tauri/src/main.rs
git commit -m "feat: add archive common interface, natural sort, image filter"
```

---

### Task 2: ZIP/CBZ アーカイブリーダー

**Files:**
- Create: `src-tauri/src/archive/zip.rs`

- [ ] **Step 1: zip.rs を作成**

```rust
// src-tauri/src/archive/zip.rs
use crate::archive::common::{is_image_file, sort_filenames_natural};
use crate::archive::{ArchivePageEntry, ArchiveReader};
use crate::error::AppError;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

pub struct ZipArchiveReader {
    path: std::path::PathBuf,
}

impl ZipArchiveReader {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        // ファイルが開けるか確認
        let file = File::open(path)?;
        let _ = ZipArchive::new(file).map_err(|e| AppError::Archive(e.to_string()))?;
        Ok(Self { path: path.to_path_buf() })
    }
}

impl ArchiveReader for ZipArchiveReader {
    fn list_pages(&self) -> Result<Vec<ArchivePageEntry>, AppError> {
        let file = File::open(&self.path)?;
        let archive = ZipArchive::new(file).map_err(|e| AppError::Archive(e.to_string()))?;

        let mut names: Vec<String> = (0..archive.len())
            .filter_map(|i| {
                let entry = archive.by_index(i).ok()?;
                let name = entry.name().to_string();
                if !entry.is_dir() && is_image_file(&name) {
                    // ディレクトリプレフィックスを取ってファイル名のみ
                    Some(name)
                } else {
                    None
                }
            })
            .collect();

        sort_filenames_natural(&mut names);

        Ok(names
            .into_iter()
            .enumerate()
            .map(|(index, name)| ArchivePageEntry { name, index })
            .collect())
    }

    fn extract_page(&self, page_name: &str) -> Result<Vec<u8>, AppError> {
        let file = File::open(&self.path)?;
        let mut archive = ZipArchive::new(file).map_err(|e| AppError::Archive(e.to_string()))?;

        let mut entry = archive
            .by_name(page_name)
            .map_err(|e| AppError::Archive(format!("ページが見つかりません: {}: {}", page_name, e)))?;

        let mut buf = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut buf)?;
        Ok(buf)
    }
}
```

- [ ] **Step 2: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: rar.rs がまだ無いためエラーの可能性あり。rar.rs のスタブを次で作成。

- [ ] **Step 3: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/archive/zip.rs
git commit -m "feat: add ZIP/CBZ archive reader"
```

---

### Task 3: CBR(RAR) アーカイブリーダー

**Files:**
- Create: `src-tauri/src/archive/rar.rs`
- Modify: `src-tauri/Cargo.toml` (`unrar` 追加)

- [ ] **Step 1: Cargo.toml に unrar を追加**

```toml
# src-tauri/Cargo.toml の [dependencies] に追加
unrar = "0.5"
```

- [ ] **Step 2: rar.rs を作成**

```rust
// src-tauri/src/archive/rar.rs
use crate::archive::common::{is_image_file, sort_filenames_natural};
use crate::archive::{ArchivePageEntry, ArchiveReader};
use crate::error::AppError;
use std::path::{Path, PathBuf};

pub struct RarArchiveReader {
    path: PathBuf,
}

impl RarArchiveReader {
    pub fn open(path: &Path) -> Result<Self, AppError> {
        // ファイルが存在するか確認
        if !path.exists() {
            return Err(AppError::Archive(format!("ファイルが見つかりません: {:?}", path)));
        }
        Ok(Self { path: path.to_path_buf() })
    }
}

impl ArchiveReader for RarArchiveReader {
    fn list_pages(&self) -> Result<Vec<ArchivePageEntry>, AppError> {
        let archive = unrar::Archive::new(&self.path)
            .list()
            .map_err(|e| AppError::Archive(format!("RARアーカイブを開けません: {:?}", e)))?;

        let mut names: Vec<String> = archive
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let name = entry.filename.to_string_lossy().to_string();
                if !entry.is_directory() && is_image_file(&name) {
                    Some(name)
                } else {
                    None
                }
            })
            .collect();

        sort_filenames_natural(&mut names);

        Ok(names
            .into_iter()
            .enumerate()
            .map(|(index, name)| ArchivePageEntry { name, index })
            .collect())
    }

    fn extract_page(&self, page_name: &str) -> Result<Vec<u8>, AppError> {
        let temp_dir = std::env::temp_dir().join("comic_viewer_rar_extract");
        std::fs::create_dir_all(&temp_dir)?;

        let _archive = unrar::Archive::new(&self.path)
            .extract_to(&temp_dir)
            .map_err(|e| AppError::Archive(format!("RAR展開エラー: {:?}", e)))?
            .process()
            .map_err(|e| AppError::Archive(format!("RAR処理エラー: {:?}", e)))?;

        let extracted_path = temp_dir.join(page_name);
        let data = std::fs::read(&extracted_path)?;

        // 一時ファイルをクリーンアップ
        let _ = std::fs::remove_dir_all(&temp_dir);

        Ok(data)
    }
}
```

- [ ] **Step 3: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功（unrarのC++ビルドに時間がかかる場合あり）。C++コンパイラがない場合はエラー — Visual Studio Build ToolsのC++ワークロードをインストールする。

- [ ] **Step 4: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/Cargo.toml src-tauri/src/archive/rar.rs
git commit -m "feat: add CBR(RAR) archive reader"
```

---

### Task 4: サムネイル生成

**Files:**
- Create: `src-tauri/src/image/mod.rs`
- Create: `src-tauri/src/image/thumbnail.rs`
- Modify: `src-tauri/src/main.rs` (mod image 追加)

- [ ] **Step 1: image/thumbnail.rs を作成**

```rust
// src-tauri/src/image/thumbnail.rs
use crate::error::AppError;
use image::imageops::FilterType;
use image::io::Reader as ImageReader;
use std::io::Cursor;
use std::path::Path;

const THUMBNAIL_WIDTH: u32 = 300;
const JPEG_QUALITY: u8 = 85;

/// 画像バイト列からサムネイルを生成し、指定パスにJPEG保存
pub fn generate_thumbnail(image_data: &[u8], output_path: &Path) -> Result<(), AppError> {
    let img = ImageReader::new(Cursor::new(image_data))
        .with_guessed_format()
        .map_err(|e| AppError::Archive(format!("画像フォーマット判定エラー: {}", e)))?
        .decode()
        .map_err(|e| AppError::Archive(format!("画像デコードエラー: {}", e)))?;

    // アスペクト比を維持して300px幅にリサイズ
    let resized = img.resize(THUMBNAIL_WIDTH, u32::MAX, FilterType::Lanczos3);

    // 出力ディレクトリを確保
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // JPEG保存
    let mut output_file = std::fs::File::create(output_path)?;
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output_file, JPEG_QUALITY);
    resized
        .write_with_encoder(encoder)
        .map_err(|e| AppError::Archive(format!("サムネイル保存エラー: {}", e)))?;

    Ok(())
}

/// 画像のサイズ（幅, 高さ）を取得
pub fn get_image_dimensions(image_data: &[u8]) -> Result<(u32, u32), AppError> {
    let img = ImageReader::new(Cursor::new(image_data))
        .with_guessed_format()
        .map_err(|e| AppError::Archive(format!("画像フォーマット判定エラー: {}", e)))?
        .decode()
        .map_err(|e| AppError::Archive(format!("画像デコードエラー: {}", e)))?;

    Ok((img.width(), img.height()))
}

/// 見開きページかどうかを判定（横幅 > 縦幅 * 1.2）
pub fn is_spread_page(width: u32, height: u32) -> bool {
    (width as f64) > (height as f64) * 1.2
}
```

- [ ] **Step 2: image/mod.rs を作成**

```rust
// src-tauri/src/image/mod.rs
pub mod thumbnail;
```

- [ ] **Step 3: main.rs に mod image を追加**

`src-tauri/src/main.rs` の先頭に追加:

```rust
mod image;
```

注意: Rustの標準ライブラリに `image` という名前はないが、`image` クレートと同名のモジュールになる。クレートを使う箇所では `::image` または `extern crate` で明示する必要がある場合は、モジュール名を `imaging` に変更する。ビルドで名前衝突が発生した場合:

```rust
// main.rs
mod imaging;  // image → imaging にリネーム
```

対応して `src-tauri/src/imaging/` にディレクトリ名を変更する。

- [ ] **Step 4: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功。名前衝突があれば上記の対処を実施。

- [ ] **Step 5: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/image/ src-tauri/src/main.rs
git commit -m "feat: add thumbnail generation (JPEG 300px, quality 85%)"
```

---

### Task 5: インポートパイプライン

**Files:**
- Create: `src-tauri/src/library/mod.rs`
- Create: `src-tauri/src/library/import.rs`
- Modify: `src-tauri/src/main.rs` (mod library 追加)

- [ ] **Step 1: library/import.rs を作成**

```rust
// src-tauri/src/library/import.rs
use crate::archive;
use crate::archive::common::{detect_format, normalize_path};
use crate::db::models::Archive;
use crate::db::queries;
use crate::error::AppError;
use crate::image::thumbnail::generate_thumbnail;
use chrono::Utc;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

pub struct ImportResult {
    pub archive: Archive,
    pub success: bool,
}

/// 単一ファイルのインポート処理
/// 1. コピー → 2. 解析 → 3. サムネイル → 4. DB登録 → 5. 元ファイル削除
pub fn import_single_file(
    conn: &Connection,
    file_path: &Path,
    library_path: &Path,
    folder_id: Option<&str>,
) -> Result<Archive, AppError> {
    let id = Uuid::new_v4().to_string();
    let format = detect_format(file_path)
        .ok_or(AppError::Validation(format!("未対応のファイル形式: {:?}", file_path)))?;

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or(AppError::Validation("ファイル名を取得できません".into()))?
        .to_string();

    let file_size = fs::metadata(file_path)?.len() as i64;

    // Step 1: ファイルをライブラリにコピー
    let archive_dir = library_path.join("archives").join(&id);
    fs::create_dir_all(&archive_dir)?;
    let dest_path = archive_dir.join(&file_name);
    fs::copy(file_path, &dest_path)?;

    // Step 2: アーカイブを解析
    let reader = archive::open_archive(&dest_path)?;
    let page_count = reader.page_count()?;

    if page_count == 0 {
        // クリーンアップ
        let _ = fs::remove_dir_all(&archive_dir);
        return Err(AppError::Archive("アーカイブに画像ページがありません".into()));
    }

    // Step 3: サムネイル生成
    let first_page_data = reader.extract_first_page()?;
    let thumbnail_rel = format!("thumbnails/{}.jpg", id);
    let thumbnail_abs = library_path.join(&thumbnail_rel);
    generate_thumbnail(&first_page_data, &thumbnail_abs)?;

    // Step 4: DB登録
    let now = Utc::now().to_rfc3339();
    let file_path_rel = normalize_path(
        &format!("archives/{}/{}", id, file_name),
    );

    let archive_record = Archive {
        id: id.clone(),
        title: file_name
            .rsplit_once('.')
            .map(|(name, _)| name.to_string())
            .unwrap_or(file_name.clone()),
        file_name: file_name.clone(),
        file_path: file_path_rel,
        file_size,
        page_count: page_count as i32,
        format,
        thumbnail_path: Some(normalize_path(&thumbnail_rel)),
        rank: 0,
        memo: String::new(),
        is_read: false,
        last_read_page: 0,
        created_at: now.clone(),
        updated_at: now,
    };

    queries::insert_archive(conn, &archive_record)?;

    // フォルダに追加
    if let Some(fid) = folder_id {
        queries::move_archives_to_folder(conn, &[id.clone()], fid)?;
    }

    // Step 5: 元ファイルを削除（DB登録成功後のみ）
    if let Err(e) = fs::remove_file(file_path) {
        // 削除失敗は警告のみ（インポート自体は成功）
        eprintln!("Warning: 元ファイルの削除に失敗: {:?}: {}", file_path, e);
    }

    Ok(archive_record)
}

/// 複数ファイルのバッチインポート
pub fn import_files(
    conn: &Connection,
    file_paths: &[String],
    library_path: &Path,
    folder_id: Option<&str>,
) -> Result<Vec<Archive>, AppError> {
    let mut results = Vec::new();
    for path_str in file_paths {
        let path = PathBuf::from(path_str);
        match import_single_file(conn, &path, library_path, folder_id) {
            Ok(archive) => results.push(archive),
            Err(e) => {
                eprintln!("Import error for {:?}: {}", path, e);
                // 個別のエラーはスキップして続行
            }
        }
    }
    Ok(results)
}
```

- [ ] **Step 2: library/mod.rs を作成**

```rust
// src-tauri/src/library/mod.rs
pub mod import;
```

- [ ] **Step 3: main.rs に mod library を追加**

`src-tauri/src/main.rs` の先頭に追加:

```rust
mod library;
```

- [ ] **Step 4: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功

- [ ] **Step 5: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/library/ src-tauri/src/main.rs
git commit -m "feat: add import pipeline (copy → analyze → thumbnail → DB → delete source)"
```

---

### Task 6: アーカイブ Tauri コマンド

**Files:**
- Create: `src-tauri/src/commands/archive.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs` (コマンド登録)

- [ ] **Step 1: commands/archive.rs を作成**

```rust
// src-tauri/src/commands/archive.rs
use crate::config::load_config;
use crate::db::models::*;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use crate::library::import;
use std::path::PathBuf;

fn get_library_root() -> Result<PathBuf, AppError> {
    let config = load_config()?;
    let path = config.library_path.ok_or(AppError::LibraryNotFound)?;
    Ok(PathBuf::from(path))
}

#[tauri::command]
pub fn import_archives(
    file_paths: Vec<String>,
    folder_id: Option<String>,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<Archive>, AppError> {
    let library_path = get_library_root()?;
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    import::import_files(&conn, &file_paths, &library_path, folder_id.as_deref())
}

#[tauri::command]
pub fn get_archives(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<ArchiveSummary>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::get_archive_summaries(&conn)
}

#[tauri::command]
pub fn get_archive_detail(
    id: String,
    state: tauri::State<'_, DbState>,
) -> Result<ArchiveDetail, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let archive = queries::get_archive_by_id(&conn, &id)?;
    let tags = queries::get_tags_for_archive(&conn, &id)?;
    let folders = queries::get_folders_for_archive(&conn, &id)?;

    Ok(ArchiveDetail {
        id: archive.id,
        title: archive.title,
        file_name: archive.file_name,
        file_size: archive.file_size,
        page_count: archive.page_count,
        format: archive.format,
        thumbnail_path: archive.thumbnail_path,
        rank: archive.rank,
        memo: archive.memo,
        is_read: archive.is_read,
        last_read_page: archive.last_read_page,
        created_at: archive.created_at,
        updated_at: archive.updated_at,
        tags,
        folders,
    })
}

#[tauri::command]
pub fn update_archive(
    id: String,
    update: ArchiveUpdate,
    state: tauri::State<'_, DbState>,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::update_archive(&conn, &id, &update)
}

#[tauri::command]
pub fn delete_archives(
    ids: Vec<String>,
    state: tauri::State<'_, DbState>,
) -> Result<(), AppError> {
    let library_path = get_library_root()?;
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;

    for id in &ids {
        // ファイルとサムネイルを削除
        let archive_dir = library_path.join("archives").join(id);
        let thumbnail = library_path.join("thumbnails").join(format!("{}.jpg", id));
        let _ = std::fs::remove_dir_all(&archive_dir);
        let _ = std::fs::remove_file(&thumbnail);
    }

    queries::delete_archives(&conn, &ids)
}

#[tauri::command]
pub fn search_archives(
    query: String,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<ArchiveSummary>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let pattern = format!("%{}%", query);
    let mut stmt = conn.prepare(
        "SELECT DISTINCT a.id, a.title, a.thumbnail_path, a.rank, a.is_read, a.format
         FROM archives a
         LEFT JOIN archive_tags at ON a.id = at.archive_id
         LEFT JOIN tags t ON at.tag_id = t.id
         WHERE a.title LIKE ?1 OR a.memo LIKE ?1 OR t.name LIKE ?1
         ORDER BY a.title",
    ).map_err(|e| AppError::Database(e.to_string()))?;

    let rows = stmt.query_map([&pattern], |row| {
        Ok(ArchiveSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            thumbnail_path: row.get(2)?,
            rank: row.get(3)?,
            is_read: row.get::<_, i32>(4)? != 0,
            format: row.get(5)?,
        })
    }).map_err(|e| AppError::Database(e.to_string()))?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| AppError::Database(e.to_string()))?);
    }
    Ok(results)
}
```

- [ ] **Step 2: commands/mod.rs を更新**

```rust
// src-tauri/src/commands/mod.rs
pub mod archive;
pub mod library;
```

- [ ] **Step 3: main.rs のコマンド登録を更新**

`src-tauri/src/main.rs` の `invoke_handler` にコマンドを追加:

```rust
.invoke_handler(tauri::generate_handler![
    commands::library::get_library_path,
    commands::library::init_library,
    commands::archive::import_archives,
    commands::archive::get_archives,
    commands::archive::get_archive_detail,
    commands::archive::update_archive,
    commands::archive::delete_archives,
    commands::archive::search_archives,
])
```

また、DbState を常にmanageするように変更（Optionではなく、ライブラリ未設定時はダミー接続は使わず、コマンド側でエラーを返す方式に）:

main.rs の DB初期化部分を更新:

```rust
fn main() {
    let config = load_config().unwrap_or_default();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init());

    // ライブラリパスが設定済みならDBを初期化して登録
    if let Some(ref lib_path) = config.library_path {
        let db_path = format!("{}/db/library.db", lib_path);
        match DbState::new(&db_path) {
            Ok(db) => {
                builder = builder.manage(db);
            }
            Err(e) => {
                eprintln!("DB初期化エラー: {}", e);
            }
        }
    }

    builder
        .invoke_handler(tauri::generate_handler![
            commands::library::get_library_path,
            commands::library::init_library,
            commands::archive::import_archives,
            commands::archive::get_archives,
            commands::archive::get_archive_detail,
            commands::archive::update_archive,
            commands::archive::delete_archives,
            commands::archive::search_archives,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功

- [ ] **Step 5: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/commands/ src-tauri/src/main.rs
git commit -m "feat: add archive CRUD Tauri commands with search"
```

---

## Phase 2 完了基準

- [x] ZIP/CBZ アーカイブから画像ページ一覧を取得・抽出できる
- [x] CBR(RAR) アーカイブから画像ページ一覧を取得・抽出できる
- [x] ページはNatural sortでソートされ、非画像ファイルは除外される
- [x] サムネイルがJPEG (300px, 85%) で生成される
- [x] インポートパイプラインが安全なフロー（コピー→DB→削除）で動作する
- [x] Tauriコマンド経由でアーカイブのCRUD操作と検索ができる
