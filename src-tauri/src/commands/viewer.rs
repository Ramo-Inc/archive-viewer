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

/// ページ準備: アーカイブ内の全ページを一時ディレクトリに展開
/// CR-1: Zip Slip対策付き (パストラバーサル防止)
#[tauri::command]
pub fn prepare_pages(
    state: State<'_, DbState>,
    archive_id: String,
) -> Result<Vec<PageInfo>, AppError> {
    let library_path = config::get_library_root()?;
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;

    let archive_record = queries::get_archive_by_id(conn, &archive_id)?;
    let archive_full_path = library_path.join(&archive_record.file_path);

    let reader = archive::open_archive(
        archive_full_path
            .to_str()
            .ok_or_else(|| AppError::FileIO("無効なパス".to_string()))?,
    )?;

    let pages = reader.list_pages()?;

    // セッション固有の一時ディレクトリを作成
    let session_id = uuid::Uuid::new_v4().to_string();
    let temp_dir = library_path.join("temp").join(&session_id);
    std::fs::create_dir_all(&temp_dir)?;

    // canonicalizeでベースパスを確定
    let temp_dir_canonical = temp_dir
        .canonicalize()
        .map_err(|e| AppError::FileIO(format!("一時ディレクトリ正規化失敗: {}", e)))?;

    let mut page_infos = Vec::new();

    for (idx, page) in pages.iter().enumerate() {
        let page_data = reader.extract_page(&page.name)?;

        // ファイル名のみ取得 (パストラバーサル防止)
        let safe_filename = std::path::Path::new(&page.name)
            .file_name()
            .ok_or_else(|| {
                AppError::Archive(format!("不正なページ名: {}", page.name))
            })?;

        let page_path = temp_dir.join(format!("{}_{}", idx, safe_filename.to_string_lossy()));

        // Zip Slip対策: canonicalizeでパストラバーサルを検出
        // ファイル書き込み前にパスチェック
        {
            // 親ディレクトリまでの存在を確認(ファイル自体はまだない)
            let parent = page_path
                .parent()
                .ok_or_else(|| AppError::FileIO("無効な出力パス".to_string()))?;
            let parent_canonical = parent
                .canonicalize()
                .map_err(|e| AppError::FileIO(format!("パス正規化失敗: {}", e)))?;
            if !parent_canonical.starts_with(&temp_dir_canonical) {
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

        // ファイルパスをそのまま返す (フロントエンドでconvertFileSrcを使用)
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
    }

    Ok(page_infos)
}

/// 読書位置を保存
#[tauri::command]
pub fn save_read_position(
    state: State<'_, DbState>,
    archive_id: String,
    page: i32,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::save_read_position(conn, &archive_id, page)
}

/// 一時ページファイルのクリーンアップ
#[tauri::command]
pub fn cleanup_temp_pages() -> Result<(), AppError> {
    let library_path = config::get_library_root()?;
    let temp_dir = library_path.join("temp");

    if temp_dir.exists() {
        // tempディレクトリ配下を全て削除
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

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_cached_page_meta_roundtrip() {
        let meta = CachedPageMeta {
            index: 0,
            file_name: "000_page001.png".to_string(),
            width: 1200,
            height: 1800,
            is_spread: false,
        };
        let json = serde_json::to_string(&meta).unwrap();
        let deserialized: CachedPageMeta = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.index, 0);
        assert_eq!(deserialized.file_name, "000_page001.png");
        assert_eq!(deserialized.width, 1200);
        assert_eq!(deserialized.height, 1800);
        assert!(!deserialized.is_spread);
    }

    #[test]
    fn test_cached_page_meta_spread() {
        let meta = CachedPageMeta {
            index: 5,
            file_name: "005_spread.jpg".to_string(),
            width: 2400,
            height: 1800,
            is_spread: true,
        };
        let json = serde_json::to_string(&meta).unwrap();
        let deserialized: CachedPageMeta = serde_json::from_str(&json).unwrap();
        assert!(deserialized.is_spread);
        assert_eq!(deserialized.width, 2400);
    }

    #[test]
    fn test_try_load_cache_valid_meta() {
        let tmp = TempDir::new().unwrap();
        let pages_dir = tmp.path().join("pages");
        std::fs::create_dir_all(&pages_dir).unwrap();

        let metas = vec![
            CachedPageMeta {
                index: 0,
                file_name: "000_page001.png".to_string(),
                width: 1200,
                height: 1800,
                is_spread: false,
            },
            CachedPageMeta {
                index: 1,
                file_name: "001_page002.png".to_string(),
                width: 2400,
                height: 1800,
                is_spread: true,
            },
        ];
        let json = serde_json::to_string(&metas).unwrap();
        std::fs::write(pages_dir.join("meta.json"), &json).unwrap();

        let result = try_load_cache(&pages_dir);
        assert!(result.is_some());
        let infos = result.unwrap();
        assert_eq!(infos.len(), 2);
        assert_eq!(infos[0].index, 0);
        assert_eq!(infos[0].width, 1200);
        assert!(!infos[0].is_spread);
        assert!(infos[0].url.contains("000_page001.png"));
        assert_eq!(infos[1].index, 1);
        assert!(infos[1].is_spread);
        assert!(infos[1].url.contains("001_page002.png"));
    }

    #[test]
    fn test_try_load_cache_missing_meta() {
        let tmp = TempDir::new().unwrap();
        let result = try_load_cache(tmp.path());
        assert!(result.is_none());
    }

    #[test]
    fn test_try_load_cache_corrupted_meta() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("meta.json"), "not valid json!!!").unwrap();
        let result = try_load_cache(tmp.path());
        assert!(result.is_none());
    }

    #[test]
    fn test_try_load_cache_empty_array() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("meta.json"), "[]").unwrap();
        let result = try_load_cache(tmp.path());
        assert!(result.is_some());
        assert_eq!(result.unwrap().len(), 0);
    }

    fn create_test_zip(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
        use std::io::Write;
        let zip_path = dir.join(name);
        let file = std::fs::File::create(&zip_path).unwrap();
        let mut zip_writer = zip::ZipWriter::new(file);

        // Create a small PNG image
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

        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip_writer.start_file("page001.png", options).unwrap();
        zip_writer.write_all(&png_data).unwrap();
        zip_writer.start_file("page002.png", options).unwrap();
        zip_writer.write_all(&png_data).unwrap();
        zip_writer.finish().unwrap();
        zip_path
    }

    #[test]
    fn test_extract_to_cache_creates_pages_and_meta() {
        let tmp = TempDir::new().unwrap();
        let zip_path = create_test_zip(tmp.path(), "test.cbz");
        let reader = archive::open_archive(zip_path.to_str().unwrap()).unwrap();
        let pages = reader.list_pages().unwrap();

        let pages_dir = tmp.path().join("pages");
        std::fs::create_dir_all(&pages_dir).unwrap();

        let result = extract_to_cache(&pages_dir, &*reader, &pages);
        assert!(result.is_ok());
        let infos = result.unwrap();

        // Check 2 pages extracted
        assert_eq!(infos.len(), 2);
        assert_eq!(infos[0].index, 0);
        assert_eq!(infos[1].index, 1);
        assert_eq!(infos[0].width, 100);
        assert_eq!(infos[0].height, 150);
        assert!(!infos[0].is_spread);

        // Check meta.json was written
        let meta_path = pages_dir.join("meta.json");
        assert!(meta_path.exists());

        // Check meta.json is valid and can be loaded by try_load_cache
        let cached_result = try_load_cache(&pages_dir);
        assert!(cached_result.is_some());
        let cached_infos = cached_result.unwrap();
        assert_eq!(cached_infos.len(), 2);

        // Check page files exist with 3-digit prefix
        let entries: Vec<_> = std::fs::read_dir(&pages_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".png"))
            .collect();
        assert_eq!(entries.len(), 2);
    }
}
