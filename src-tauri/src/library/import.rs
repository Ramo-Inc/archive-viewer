use crate::archive;
use crate::archive::common::detect_format;
use crate::db::models::Archive;
use crate::db::queries;
use crate::error::AppError;
use crate::imaging::thumbnail;
use chrono::Utc;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// prepare_importの結果を保持する構造体
/// Mutexロック不要の純粋なデータ構造 (CR-9)
pub struct PreparedImport {
    pub archive_id: String,
    pub title: String,
    pub file_name: String,
    pub dest_path: PathBuf,
    pub thumbnail_path: Option<PathBuf>,
    pub file_size: i64,
    pub page_count: i32,
    pub format: String,
}

/// Phase 1: ファイルコピー・サムネイル生成 (Mutexロック不要) (CR-8, CR-9)
pub fn prepare_import(
    file_path: &Path,
    library_path: &Path,
) -> Result<PreparedImport, AppError> {
    // ファイル存在確認
    if !file_path.exists() {
        return Err(AppError::FileIO(format!(
            "ファイルが見つかりません: {}",
            file_path.display()
        )));
    }

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| AppError::Validation("無効なファイル名".to_string()))?
        .to_string();

    let title = file_path
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or(&file_name)
        .to_string();

    let format = detect_format(&file_name).to_string();
    if format == "unknown" {
        return Err(AppError::Validation(format!(
            "未対応のファイル形式: {}",
            file_name
        )));
    }

    // コピー前にソースファイルを検証 (早期失敗・リソースリーク防止)
    let src_path_str = file_path.to_str().ok_or_else(|| {
        AppError::Validation("ファイルパスを文字列に変換できません".to_string())
    })?;
    let reader = archive::open_archive(src_path_str)?;
    let page_count = reader.page_count()? as i32;

    // ソースから最初のページを取得 (サムネイル用)
    let first_page_data = reader.extract_first_page().ok();

    let archive_id = Uuid::new_v4().to_string();

    // ライブラリ内にアーカイブディレクトリを作成
    let archive_dir = library_path.join("archives").join(&archive_id);
    fs::create_dir_all(&archive_dir)?;

    // ファイルをコピー
    let dest_path = archive_dir.join(&file_name);
    fs::copy(file_path, &dest_path).map_err(|e| {
        let _ = fs::remove_dir_all(&archive_dir);
        AppError::FileIO(e.to_string())
    })?;

    let file_size = fs::metadata(&dest_path)?.len() as i64;

    // サムネイル生成 (ソースから取得済みのデータを使用)
    let thumbnail_path = match first_page_data {
        Some(data) => {
            let thumb_dir = library_path.join("thumbnails");
            let thumb_path = thumb_dir.join(format!("{}.jpg", archive_id));
            match thumbnail::generate_thumbnail(&data, &thumb_path) {
                Ok(()) => Some(thumb_path),
                Err(_) => None, // サムネイル生成失敗は致命的ではない
            }
        }
        None => None,
    };

    Ok(PreparedImport {
        archive_id,
        title,
        file_name,
        dest_path,
        thumbnail_path,
        file_size,
        page_count,
        format,
    })
}

/// Phase 2: DBへのコミット (SQLiteトランザクション使用)
pub fn commit_import(
    conn: &Connection,
    prepared: &PreparedImport,
    folder_id: Option<&str>,
) -> Result<Archive, AppError> {
    let now = Utc::now().to_rfc3339();

    // 相対パスで保存 (library_pathからの相対)
    let relative_path = format!("archives/{}/{}", prepared.archive_id, prepared.file_name);
    let thumbnail_rel = prepared.thumbnail_path.as_ref().map(|_| {
        format!("thumbnails/{}.jpg", prepared.archive_id)
    });

    let archive = Archive {
        id: prepared.archive_id.clone(),
        title: prepared.title.clone(),
        file_name: prepared.file_name.clone(),
        file_path: relative_path,
        file_size: prepared.file_size,
        page_count: prepared.page_count,
        format: prepared.format.clone(),
        thumbnail_path: thumbnail_rel,
        rank: 0,
        memo: String::new(),
        is_read: false,
        last_read_page: 0,
        missing: false,
        created_at: now.clone(),
        updated_at: now,
    };

    // トランザクション内で実行
    conn.execute_batch("BEGIN;")?;

    match (|| -> Result<(), AppError> {
        queries::insert_archive(conn, &archive)?;

        // フォルダに関連付け
        if let Some(fid) = folder_id {
            queries::move_archives_to_folder(conn, &[archive.id.clone()], fid)?;
        }

        Ok(())
    })() {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(archive)
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            // HI-13: エラー時はコピー済みファイル+サムネイルをクリーンアップ
            cleanup_prepared(&prepared);
            Err(e)
        }
    }
}

/// PreparedImportのファイルをクリーンアップ (HI-13)
fn cleanup_prepared(prepared: &PreparedImport) {
    // コピーしたアーカイブファイルを削除
    if let Some(parent) = prepared.dest_path.parent() {
        let _ = fs::remove_dir_all(parent);
    }
    // サムネイルを削除
    if let Some(ref thumb) = prepared.thumbnail_path {
        let _ = fs::remove_file(thumb);
    }
}

/// バッチインポート
pub fn import_files(
    conn: &Connection,
    file_paths: &[PathBuf],
    library_path: &Path,
    folder_id: Option<&str>,
) -> Result<Vec<Archive>, AppError> {
    let mut results = Vec::new();

    for file_path in file_paths {
        // prepare段階はロック不要
        let prepared = prepare_import(file_path, library_path)?;
        // commit段階でDBアクセス
        let archive = commit_import(conn, &prepared, folder_id)?;
        results.push(archive);
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use tempfile::TempDir;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    fn create_test_zip(dir: &Path, name: &str) -> PathBuf {
        use std::io::Write;

        let zip_path = dir.join(name);
        let file = fs::File::create(&zip_path).unwrap();
        let mut zip_writer = zip::ZipWriter::new(file);

        // 小さなPNG画像を作成
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
    fn test_prepare_import_success() {
        let tmp = TempDir::new().unwrap();
        let source_dir = tmp.path().join("source");
        let library_dir = tmp.path().join("library");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();

        let zip_path = create_test_zip(&source_dir, "test_comic.cbz");

        let prepared = prepare_import(&zip_path, &library_dir).unwrap();

        assert_eq!(prepared.file_name, "test_comic.cbz");
        assert_eq!(prepared.title, "test_comic");
        assert_eq!(prepared.format, "zip");
        assert_eq!(prepared.page_count, 2);
        assert!(prepared.dest_path.exists());
        assert!(prepared.file_size > 0);
    }

    #[test]
    fn test_prepare_import_nonexistent_file() {
        let tmp = TempDir::new().unwrap();
        let result = prepare_import(
            Path::new("/nonexistent/file.cbz"),
            tmp.path(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_prepare_import_unsupported_format() {
        let tmp = TempDir::new().unwrap();
        let bad_file = tmp.path().join("file.7z");
        fs::write(&bad_file, b"dummy").unwrap();

        let result = prepare_import(&bad_file, tmp.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_commit_import_success() {
        let tmp = TempDir::new().unwrap();
        let source_dir = tmp.path().join("source");
        let library_dir = tmp.path().join("library");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();

        let zip_path = create_test_zip(&source_dir, "test_comic.cbz");
        let prepared = prepare_import(&zip_path, &library_dir).unwrap();

        let conn = setup_db();
        let archive = commit_import(&conn, &prepared, None).unwrap();

        assert_eq!(archive.title, "test_comic");
        assert_eq!(archive.page_count, 2);
        assert!(!archive.missing);

        // DBに保存されていることを確認
        let retrieved = queries::get_archive_by_id(&conn, &archive.id).unwrap();
        assert_eq!(retrieved.title, "test_comic");
    }

    #[test]
    fn test_commit_import_with_folder() {
        let tmp = TempDir::new().unwrap();
        let source_dir = tmp.path().join("source");
        let library_dir = tmp.path().join("library");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();

        let zip_path = create_test_zip(&source_dir, "test_comic.cbz");
        let prepared = prepare_import(&zip_path, &library_dir).unwrap();

        let conn = setup_db();
        let folder = queries::create_folder(&conn, "MyFolder", None).unwrap();
        let archive = commit_import(&conn, &prepared, Some(&folder.id)).unwrap();

        // フォルダに関連付けられていることを確認
        let folders = queries::get_folders_for_archive(&conn, &archive.id).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].id, folder.id);
    }

    #[test]
    fn test_import_files_batch() {
        let tmp = TempDir::new().unwrap();
        let source_dir = tmp.path().join("source");
        let library_dir = tmp.path().join("library");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();

        let zip1 = create_test_zip(&source_dir, "comic1.cbz");
        let zip2 = create_test_zip(&source_dir, "comic2.cbz");

        let conn = setup_db();
        let results = import_files(
            &conn,
            &[zip1, zip2],
            &library_dir,
            None,
        )
        .unwrap();

        assert_eq!(results.len(), 2);

        let summaries = queries::get_archive_summaries(&conn).unwrap();
        assert_eq!(summaries.len(), 2);
    }

    #[test]
    fn test_prepare_import_generates_thumbnail() {
        let tmp = TempDir::new().unwrap();
        let source_dir = tmp.path().join("source");
        let library_dir = tmp.path().join("library");
        fs::create_dir_all(&source_dir).unwrap();
        fs::create_dir_all(&library_dir).unwrap();

        let zip_path = create_test_zip(&source_dir, "test_comic.cbz");
        let prepared = prepare_import(&zip_path, &library_dir).unwrap();

        assert!(prepared.thumbnail_path.is_some());
        assert!(prepared.thumbnail_path.as_ref().unwrap().exists());
    }
}
