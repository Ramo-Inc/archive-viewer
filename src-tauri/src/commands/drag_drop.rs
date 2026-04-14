use crate::config;
use crate::db::models::*;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use crate::library::import;
use std::path::PathBuf;
use tauri::State;

/// ドロップされたファイルをインポート
#[tauri::command]
pub fn import_dropped_files(
    state: State<'_, DbState>,
    file_paths: Vec<String>,
    folder_id: Option<String>,
) -> Result<Vec<Archive>, AppError> {
    let library_path = config::get_library_root()?;
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;

    let paths: Vec<PathBuf> = file_paths.iter().map(PathBuf::from).collect();
    import::import_files(conn, &paths, &library_path, folder_id.as_deref())
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
