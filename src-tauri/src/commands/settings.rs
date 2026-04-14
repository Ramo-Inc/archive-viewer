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
        .start_file("comicviewer.db", db_options)
        .map_err(|e| AppError::FileIO(format!("ZIP書き込み失敗: {}", e)))?;
    let mut db_file = File::open(&temp_db_path)?;
    io::copy(&mut db_file, &mut zip_writer)?;

    let _ = app.emit(
        "backup-progress",
        BackupProgress {
            current: 1,
            total,
            file_name: "comicviewer.db".to_string(),
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
