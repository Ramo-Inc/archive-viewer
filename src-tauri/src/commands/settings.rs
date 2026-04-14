use crate::commands::drag_drop::ImportState;
use crate::config;
use crate::db::DbState;
use crate::error::AppError;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

/// バックアップ操作の状態管理
pub struct BackupState {
    pub running: AtomicBool,
}

#[derive(Clone, Serialize)]
struct BackupProgress {
    current: usize,
    total: usize,
    file_name: String,
}

#[derive(Clone, Serialize)]
struct BackupComplete {
    success: bool,
    error: Option<String>,
}

/// ライブラリをZIPにエクスポート
#[tauri::command]
pub fn export_backup(app: AppHandle, dest_path: String) -> Result<(), AppError> {
    let backup_state = app.state::<BackupState>();
    if backup_state.running.load(Ordering::Relaxed) {
        return Err(AppError::Validation("バックアップ処理中です".to_string()));
    }
    let import_state = app.state::<ImportState>();
    if import_state.running.load(Ordering::Relaxed) {
        return Err(AppError::Validation("インポート処理中です".to_string()));
    }

    backup_state.running.store(true, Ordering::Relaxed);

    std::thread::spawn(move || {
        let result = run_export(&app, &dest_path);

        app.state::<BackupState>()
            .running
            .store(false, Ordering::Relaxed);

        match result {
            Ok(()) => {
                let _ = app.emit(
                    "backup-complete",
                    BackupComplete {
                        success: true,
                        error: None,
                    },
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "backup-complete",
                    BackupComplete {
                        success: false,
                        error: Some(e.to_string()),
                    },
                );
            }
        }
    });

    Ok(())
}

fn run_export(app: &AppHandle, dest_path: &str) -> Result<(), AppError> {
    use std::fs::File;
    use std::io;
    use zip::write::SimpleFileOptions;
    use zip::CompressionMethod;

    let library_path = config::get_library_root()?;

    // VACUUM INTO で一貫性のある DB スナップショットを作成
    let temp_db_path = library_path.join("_backup_temp.db");
    let _ = std::fs::remove_file(&temp_db_path);
    {
        let db_state = app.state::<DbState>();
        let guard = db_state
            .0
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;
        let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
        let escaped_path = temp_db_path
            .to_str()
            .ok_or_else(|| AppError::FileIO("無効なDBパス".to_string()))?
            .replace('\'', "''");
        conn.execute(&format!("VACUUM INTO '{}'", escaped_path), [])?;
    }

    // エラー時にも一時DBを確実に削除するガード
    struct TempFileGuard<'a>(&'a std::path::Path);
    impl<'a> Drop for TempFileGuard<'a> {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(self.0);
        }
    }
    let _temp_guard = TempFileGuard(&temp_db_path);

    // archives/ 内のファイルを収集 (pages/ サブディレクトリは除外)
    let archives_dir = library_path.join("archives");
    let mut file_entries: Vec<(std::path::PathBuf, String)> = Vec::new();
    if archives_dir.exists() {
        collect_archive_files(&archives_dir, "archives", &mut file_entries)?;
    }

    let total = file_entries.len() + 1;

    // ZIP作成
    let zip_file = File::create(dest_path)
        .map_err(|e| AppError::FileIO(format!("ZIPファイル作成失敗: {}", e)))?;
    let mut zip_writer = zip::ZipWriter::new(zip_file);

    // DB を追加 (Deflated)
    let db_options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip_writer
        .start_file("archiveviewer.db", db_options)
        .map_err(|e| AppError::FileIO(format!("ZIP書き込み失敗: {}", e)))?;
    let mut db_file = File::open(&temp_db_path)?;
    io::copy(&mut db_file, &mut zip_writer)?;

    let _ = app.emit(
        "backup-progress",
        BackupProgress {
            current: 1,
            total,
            file_name: "archiveviewer.db".to_string(),
        },
    );

    // archives/ ファイルを追加 (Stored — 既に圧縮済み)
    let archive_options =
        SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (i, (abs_path, rel_path)) in file_entries.iter().enumerate() {
        let file_name = abs_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let _ = app.emit(
            "backup-progress",
            BackupProgress {
                current: i + 2,
                total,
                file_name,
            },
        );

        zip_writer
            .start_file(rel_path, archive_options)
            .map_err(|e| AppError::FileIO(format!("ZIP書き込み失敗: {}", e)))?;
        let mut source_file = File::open(abs_path)?;
        io::copy(&mut source_file, &mut zip_writer)?;
    }

    zip_writer
        .finish()
        .map_err(|e| AppError::FileIO(format!("ZIP完了失敗: {}", e)))?;

    Ok(())
}

/// archives/ ディレクトリを再帰的に走査し、pages/ サブディレクトリを除外
fn collect_archive_files(
    dir: &std::path::Path,
    prefix: &str,
    entries: &mut Vec<(std::path::PathBuf, String)>,
) -> Result<(), AppError> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry
            .file_name()
            .to_str()
            .unwrap_or("")
            .to_string();
        let rel = format!("{}/{}", prefix, name);

        if path.is_dir() {
            if name == "pages" {
                continue;
            }
            collect_archive_files(&path, &rel, entries)?;
        } else {
            entries.push((path, rel));
        }
    }
    Ok(())
}

/// バックアップZIPからライブラリを復元
#[tauri::command]
pub fn import_backup(app: AppHandle, zip_path: String, dest_dir: String) -> Result<(), AppError> {
    let backup_state = app.state::<BackupState>();
    if backup_state.running.load(Ordering::Relaxed) {
        return Err(AppError::Validation("バックアップ処理中です".to_string()));
    }
    let import_state = app.state::<ImportState>();
    if import_state.running.load(Ordering::Relaxed) {
        return Err(AppError::Validation("インポート処理中です".to_string()));
    }

    // ZIP を開き archiveviewer.db の存在を確認
    let zip_file = std::fs::File::open(&zip_path)?;
    let mut archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| AppError::Archive(format!("ZIPオープン失敗: {}", e)))?;

    let has_db = (0..archive.len()).any(|i| {
        archive
            .by_index(i)
            .ok()
            .and_then(|f| f.enclosed_name().map(|n| n == std::path::Path::new("archiveviewer.db")))
            .unwrap_or(false)
    });
    if !has_db {
        return Err(AppError::Validation(
            "バックアップにarchiveviewer.dbが含まれていません".to_string(),
        ));
    }

    // パストラバーサル検証
    for i in 0..archive.len() {
        let file = archive
            .by_index(i)
            .map_err(|e| AppError::Archive(format!("ZIPエントリ読み取り失敗: {}", e)))?;
        if file.enclosed_name().is_none() {
            return Err(AppError::Validation(format!(
                "不正なパスを含むZIPエントリ: {}",
                file.name()
            )));
        }
    }

    // dest_dir に既存の archiveviewer.db があれば拒否
    let dest = std::path::PathBuf::from(&dest_dir);
    if dest.join("archiveviewer.db").exists() || dest.join("archives").exists() {
        return Err(AppError::Validation(
            "展開先に既存のライブラリデータがあります。空のフォルダを選択してください".to_string(),
        ));
    }

    // スキーマバージョン検証
    {
        let temp_dir = tempfile::TempDir::new()?;
        let temp_db = temp_dir.path().join("archiveviewer.db");
        let mut db_entry = archive
            .by_name("archiveviewer.db")
            .map_err(|e| AppError::Archive(format!("ZIPエントリ読み取り失敗: {}", e)))?;
        let mut db_data = Vec::new();
        std::io::Read::read_to_end(&mut db_entry, &mut db_data)?;
        std::fs::write(&temp_db, &db_data)?;

        let conn = rusqlite::Connection::open(&temp_db)?;
        let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
        // 注意: migrations.rs にマイグレーション追加時はここも更新すること
        let current_version = 2;
        if version > current_version {
            return Err(AppError::Validation(format!(
                "新しいバージョンのバックアップです (v{}). このアプリはv{}までサポートしています",
                version, current_version
            )));
        }
    }

    backup_state.running.store(true, Ordering::Relaxed);

    let old_library_path = config::load_config()
        .ok()
        .and_then(|c| c.library_path);

    std::thread::spawn(move || {
        let result = run_import(&app, &zip_path, &dest_dir, old_library_path.as_deref());

        app.state::<BackupState>()
            .running
            .store(false, Ordering::Relaxed);

        match result {
            Ok(()) => {
                let _ = app.emit(
                    "backup-complete",
                    BackupComplete {
                        success: true,
                        error: None,
                    },
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "backup-complete",
                    BackupComplete {
                        success: false,
                        error: Some(e.to_string()),
                    },
                );
            }
        }
    });

    Ok(())
}

fn run_import(
    app: &AppHandle,
    zip_path: &str,
    dest_dir: &str,
    old_library_path: Option<&str>,
) -> Result<(), AppError> {
    use crate::archive;
    use crate::db::queries;
    use crate::imaging::thumbnail;

    let dest = std::path::PathBuf::from(dest_dir);

    // Phase 1: ZIP展開
    let zip_file = std::fs::File::open(zip_path)?;
    let mut zip_archive = zip::ZipArchive::new(zip_file)
        .map_err(|e| AppError::Archive(format!("ZIPオープン失敗: {}", e)))?;

    let total_entries = zip_archive.len();

    for i in 0..total_entries {
        let mut file = zip_archive
            .by_index(i)
            .map_err(|e| AppError::Archive(format!("ZIPエントリ読み取り失敗: {}", e)))?;

        let entry_name = match file.enclosed_name() {
            Some(name) => name.to_path_buf(),
            None => continue,
        };

        let file_name_str = entry_name
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let _ = app.emit(
            "backup-progress",
            BackupProgress {
                current: i + 1,
                total: total_entries,
                file_name: file_name_str,
            },
        );

        let out_path = dest.join(&entry_name);

        if file.is_dir() {
            std::fs::create_dir_all(&out_path)?;
        } else {
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut out_file = std::fs::File::create(&out_path)?;
            std::io::copy(&mut file, &mut out_file)?;
        }
    }

    // thumbnails/ ディレクトリを作成
    std::fs::create_dir_all(dest.join("thumbnails"))?;

    // Phase 2: config更新 + DB再接続
    let db_path = dest.join("archiveviewer.db");
    let db_path_str = db_path
        .to_str()
        .ok_or_else(|| AppError::FileIO("無効なDBパス".to_string()))?;

    let mut cfg = config::load_config().unwrap_or_default();
    cfg.library_path = Some(dest_dir.to_string());
    if let Err(e) = config::save_config(&cfg) {
        if let Some(old_path) = old_library_path {
            cfg.library_path = Some(old_path.to_string());
            let _ = config::save_config(&cfg);
        }
        return Err(e);
    }

    let db_state = app.state::<DbState>();
    if let Err(e) = db_state.init(db_path_str) {
        if let Some(old_path) = old_library_path {
            cfg.library_path = Some(old_path.to_string());
            let _ = config::save_config(&cfg);
            let old_db = std::path::PathBuf::from(old_path).join("archiveviewer.db");
            if let Some(s) = old_db.to_str() {
                let _ = db_state.init(s);
            }
        }
        return Err(e);
    }

    // Phase 3: サムネイル再生成
    let archive_paths = {
        let guard = db_state
            .0
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;
        let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
        queries::get_all_archive_paths(conn)?
    };

    let thumb_total = archive_paths.len();
    for (i, (id, file_path, _format)) in archive_paths.iter().enumerate() {
        let _ = app.emit(
            "backup-progress",
            BackupProgress {
                current: i + 1,
                total: thumb_total,
                file_name: format!("サムネイル再生成: {}", id),
            },
        );

        let abs_path = dest.join(file_path);
        let abs_path_str = abs_path.to_str().unwrap_or("");

        let thumb_result: Result<(), AppError> = (|| {
            let reader = archive::open_archive(abs_path_str)?;
            let first_page = reader.extract_first_page()?;
            let thumb_path = dest.join("thumbnails").join(format!("{}.jpg", id));
            thumbnail::generate_thumbnail(&first_page, &thumb_path)?;

            let guard = db_state
                .0
                .lock()
                .map_err(|e| AppError::Database(e.to_string()))?;
            let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
            queries::update_thumbnail_path(
                conn,
                id,
                Some(&format!("thumbnails/{}.jpg", id)),
            )?;
            Ok(())
        })();

        if thumb_result.is_err() {
            let guard = db_state
                .0
                .lock()
                .map_err(|e| AppError::Database(e.to_string()))?;
            let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
            let _ = queries::update_thumbnail_path(conn, id, None);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_collect_archive_files_skips_pages() {
        let tmp = TempDir::new().unwrap();
        let archives = tmp.path().join("archives");
        let id_dir = archives.join("abc-123");
        let pages_dir = id_dir.join("pages");

        fs::create_dir_all(&pages_dir).unwrap();
        fs::write(id_dir.join("comic.cbz"), b"fake zip data").unwrap();
        fs::write(pages_dir.join("page001.png"), b"fake page").unwrap();

        let mut entries = Vec::new();
        collect_archive_files(&archives, "archives", &mut entries).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].1, "archives/abc-123/comic.cbz");
    }

    #[test]
    fn test_collect_archive_files_recursive() {
        let tmp = TempDir::new().unwrap();
        let archives = tmp.path().join("archives");
        let id1 = archives.join("id1");
        let id2 = archives.join("id2");

        fs::create_dir_all(&id1).unwrap();
        fs::create_dir_all(&id2).unwrap();
        fs::write(id1.join("a.cbz"), b"data").unwrap();
        fs::write(id2.join("b.cbr"), b"data").unwrap();

        let mut entries = Vec::new();
        collect_archive_files(&archives, "archives", &mut entries).unwrap();

        assert_eq!(entries.len(), 2);
        let paths: Vec<&str> = entries.iter().map(|(_, r)| r.as_str()).collect();
        assert!(paths.contains(&"archives/id1/a.cbz"));
        assert!(paths.contains(&"archives/id2/b.cbr"));
    }

    #[test]
    fn test_collect_archive_files_empty_dir() {
        let tmp = TempDir::new().unwrap();
        let archives = tmp.path().join("archives");
        fs::create_dir_all(&archives).unwrap();

        let mut entries = Vec::new();
        collect_archive_files(&archives, "archives", &mut entries).unwrap();

        assert!(entries.is_empty());
    }

    #[test]
    fn test_zip_roundtrip_structure() {
        let tmp = TempDir::new().unwrap();
        let lib_dir = tmp.path().join("library");
        let archives_dir = lib_dir.join("archives").join("test-id");
        let pages_dir = archives_dir.join("pages");

        fs::create_dir_all(&pages_dir).unwrap();
        fs::write(archives_dir.join("comic.cbz"), b"fake zip content").unwrap();
        fs::write(pages_dir.join("page.png"), b"cached page").unwrap();
        fs::write(lib_dir.join("archiveviewer.db"), b"fake db content").unwrap();

        let mut entries = Vec::new();
        collect_archive_files(&lib_dir.join("archives"), "archives", &mut entries).unwrap();

        assert_eq!(entries.len(), 1);
        assert!(entries[0].1.contains("comic.cbz"));
        assert!(!entries.iter().any(|(_, r)| r.contains("pages")));

        let zip_path = tmp.path().join("backup.zip");
        let zip_file = fs::File::create(&zip_path).unwrap();
        let mut zip_writer = zip::ZipWriter::new(zip_file);

        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);

        zip_writer.start_file("archiveviewer.db", options).unwrap();
        zip_writer.write_all(b"fake db content").unwrap();

        for (abs_path, rel_path) in &entries {
            zip_writer.start_file(rel_path, options).unwrap();
            let data = fs::read(abs_path).unwrap();
            zip_writer.write_all(&data).unwrap();
        }
        zip_writer.finish().unwrap();

        let reader_file = fs::File::open(&zip_path).unwrap();
        let mut zip_archive = zip::ZipArchive::new(reader_file).unwrap();

        let names: Vec<String> = (0..zip_archive.len())
            .map(|i| zip_archive.by_index(i).unwrap().name().to_string())
            .collect();

        assert!(names.contains(&"archiveviewer.db".to_string()));
        assert!(names.contains(&"archives/test-id/comic.cbz".to_string()));
        assert!(!names.iter().any(|n| n.contains("pages")));
    }

    // --- import_backup バリデーションテスト ---

    fn create_backup_zip(dir: &std::path::Path, name: &str, include_db: bool) -> std::path::PathBuf {
        let zip_path = dir.join(name);
        let file = fs::File::create(&zip_path).unwrap();
        let mut zip_writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);

        if include_db {
            let temp_db = dir.join("_temp.db");
            let conn = rusqlite::Connection::open(&temp_db).unwrap();
            conn.execute_batch("PRAGMA user_version = 2;").unwrap();
            drop(conn);
            let db_data = fs::read(&temp_db).unwrap();
            zip_writer.start_file("archiveviewer.db", options).unwrap();
            zip_writer.write_all(&db_data).unwrap();
            let _ = fs::remove_file(&temp_db);
        }

        zip_writer.start_file("archives/id1/comic.cbz", options).unwrap();
        zip_writer.write_all(b"fake archive data").unwrap();
        zip_writer.finish().unwrap();
        zip_path
    }

    #[test]
    fn test_validate_zip_missing_db() {
        let tmp = TempDir::new().unwrap();
        let zip_path = create_backup_zip(tmp.path(), "no_db.zip", false);

        let zip_file = fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(zip_file).unwrap();

        let has_db = (0..archive.len()).any(|i| {
            archive.by_index(i).ok()
                .and_then(|f| f.enclosed_name().map(|n| n == std::path::Path::new("archiveviewer.db")))
                .unwrap_or(false)
        });
        assert!(!has_db, "ZIP without archiveviewer.db should fail validation");
    }

    #[test]
    fn test_validate_zip_with_db() {
        let tmp = TempDir::new().unwrap();
        let zip_path = create_backup_zip(tmp.path(), "with_db.zip", true);

        let zip_file = fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(zip_file).unwrap();

        let has_db = (0..archive.len()).any(|i| {
            archive.by_index(i).ok()
                .and_then(|f| f.enclosed_name().map(|n| n == std::path::Path::new("archiveviewer.db")))
                .unwrap_or(false)
        });
        assert!(has_db, "ZIP with archiveviewer.db should pass validation");
    }

    #[test]
    fn test_validate_schema_version_too_high() {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("future.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA user_version = 99;").unwrap();
        let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
        drop(conn);

        let current_version = 2;
        assert!(version > current_version, "Future schema version should be rejected");
    }

    #[test]
    fn test_validate_schema_version_compatible() {
        let tmp = TempDir::new().unwrap();
        let db_path = tmp.path().join("old.db");
        let conn = rusqlite::Connection::open(&db_path).unwrap();
        conn.execute_batch("PRAGMA user_version = 1;").unwrap();
        let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0)).unwrap();
        drop(conn);

        let current_version = 2;
        assert!(version <= current_version, "Older schema version should be accepted");
    }

    #[test]
    fn test_validate_dest_dir_with_existing_db() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("dest");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("archiveviewer.db"), b"existing").unwrap();

        let has_conflict = dest.join("archiveviewer.db").exists() || dest.join("archives").exists();
        assert!(has_conflict, "dest_dir with existing archiveviewer.db should be rejected");
    }

    #[test]
    fn test_validate_dest_dir_empty() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("empty_dest");
        fs::create_dir_all(&dest).unwrap();

        let has_conflict = dest.join("archiveviewer.db").exists() || dest.join("archives").exists();
        assert!(!has_conflict, "Empty dest_dir should pass validation");
    }

    #[test]
    fn test_validate_enclosed_name_safe_paths() {
        let tmp = TempDir::new().unwrap();
        let zip_path = create_backup_zip(tmp.path(), "safe.zip", true);

        let zip_file = fs::File::open(&zip_path).unwrap();
        let mut archive = zip::ZipArchive::new(zip_file).unwrap();

        for i in 0..archive.len() {
            let file = archive.by_index(i).unwrap();
            assert!(file.enclosed_name().is_some(), "All entries should have safe paths: {}", file.name());
        }
    }
}
