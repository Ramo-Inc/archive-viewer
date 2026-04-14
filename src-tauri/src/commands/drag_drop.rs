use crate::config;
use crate::db::models::*;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use crate::library::import;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};

/// インポート状態管理 (Tauri managed state)
pub struct ImportState {
    pub cancel: AtomicBool,
    pub running: AtomicBool,
}

#[derive(Clone, Serialize)]
struct ImportProgress {
    current: usize,
    total: usize,
    file_name: String,
}

#[derive(Clone, Serialize)]
struct ImportComplete {
    imported: usize,
    total: usize,
    cancelled: bool,
    errors: Vec<String>,
}

/// ドロップされたファイルをインポート (非同期・進捗イベント付き)
#[tauri::command]
pub fn import_dropped_files(
    app: AppHandle,
    file_paths: Vec<String>,
    folder_id: Option<String>,
) -> Result<(), AppError> {
    let library_path = config::get_library_root()?;

    // 既にインポート中なら拒否
    let import_state = app.state::<ImportState>();
    if import_state.running.load(Ordering::Relaxed) {
        return Err(AppError::Validation("インポート処理中です".to_string()));
    }

    // フラグをリセット・起動
    import_state.cancel.store(false, Ordering::Relaxed);
    import_state.running.store(true, Ordering::Relaxed);

    std::thread::spawn(move || {
        let paths: Vec<PathBuf> = file_paths.iter().map(PathBuf::from).collect();
        let total = paths.len();
        let mut imported = 0usize;
        let mut errors: Vec<String> = Vec::new();
        let mut cancelled = false;

        for (i, file_path) in paths.iter().enumerate() {
            // キャンセルチェック
            if app.state::<ImportState>().cancel.load(Ordering::Relaxed) {
                cancelled = true;
                break;
            }

            // 進捗イベント送信
            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            let _ = app.emit("import-progress", ImportProgress {
                current: i + 1,
                total,
                file_name: file_name.clone(),
            });

            // ファイルをインポート (エラーは記録して続行)
            let result: Result<(), AppError> = (|| {
                let prepared = import::prepare_import(file_path, &library_path)?;
                let db_state = app.state::<DbState>();
                let guard = db_state.0.lock()
                    .map_err(|e| AppError::Database(e.to_string()))?;
                let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
                import::commit_import(conn, &prepared, folder_id.as_deref())?;
                Ok(())
            })();

            match result {
                Ok(()) => imported += 1,
                Err(e) => errors.push(format!("{}: {}", file_name, e)),
            }
        }

        // runningフラグをリセット
        app.state::<ImportState>().running.store(false, Ordering::Relaxed);

        // 完了イベント送信
        let _ = app.emit("import-complete", ImportComplete {
            imported,
            total,
            cancelled,
            errors,
        });
    });

    Ok(())
}

/// 内部ドラッグ操作のハンドル (アーカイブをフォルダ/タグに移動)
#[tauri::command]
pub fn handle_internal_drag(
    state: State<'_, DbState>,
    archive_ids: Vec<String>,
    target: DragTarget,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;

    match target {
        DragTarget::Folder(folder_id) => {
            // True move: remove from all current folders, then add to target.
            for archive_id in &archive_ids {
                queries::remove_archive_from_all_folders(conn, archive_id)?;
            }
            queries::move_archives_to_folder(conn, &archive_ids, &folder_id)?;
        }
        DragTarget::Tag(tag_id) => {
            // 各アーカイブにタグを追加 (既存タグを保持)
            for archive_id in &archive_ids {
                let existing_tags = queries::get_tags_for_archive(conn, archive_id)?;
                let mut tag_ids: Vec<String> = existing_tags.iter().map(|t| t.id.clone()).collect();
                if !tag_ids.contains(&tag_id) {
                    tag_ids.push(tag_id.clone());
                }
                queries::set_archive_tags(conn, archive_id, &tag_ids)?;
            }
        }
        DragTarget::SmartFolder(_) => {
            // スマートフォルダはルールベースなのでドラッグ操作なし
            return Err(AppError::Validation(
                "スマートフォルダへの直接ドラッグはできません".to_string(),
            ));
        }
    }

    Ok(())
}

/// インポートをキャンセル
#[tauri::command]
pub fn cancel_import(state: State<'_, ImportState>) -> Result<(), crate::error::AppError> {
    state.cancel.store(true, Ordering::Relaxed);
    Ok(())
}
