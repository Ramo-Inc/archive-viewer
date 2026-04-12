use crate::config;
use crate::db::models::*;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use crate::library::import;
use std::path::PathBuf;
use tauri::State;

/// アーカイブをインポート
#[tauri::command]
pub fn import_archives(
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

/// アーカイブ一覧を取得 (フィルタ付き)
#[tauri::command]
pub fn get_archives(
    state: State<'_, DbState>,
    filter: ArchiveFilter,
) -> Result<Vec<ArchiveSummary>, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::get_archive_summaries_filtered(conn, &filter)
}

/// アーカイブ詳細を取得
#[tauri::command]
pub fn get_archive_detail(
    state: State<'_, DbState>,
    id: String,
) -> Result<ArchiveDetail, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::get_archive_detail(conn, &id)
}

/// アーカイブを更新
#[tauri::command]
pub fn update_archive(
    state: State<'_, DbState>,
    id: String,
    update: ArchiveUpdate,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::update_archive(conn, &id, &update)
}

/// アーカイブを削除
#[tauri::command]
pub fn delete_archives(
    state: State<'_, DbState>,
    ids: Vec<String>,
) -> Result<(), AppError> {
    let library_path = config::get_library_root()?;
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;

    // ファイルとサムネイルを削除
    for id in &ids {
        if let Ok(archive) = queries::get_archive_by_id(conn, id) {
            let file_full_path = library_path.join(&archive.file_path);
            if let Some(parent) = file_full_path.parent() {
                let _ = std::fs::remove_dir_all(parent);
            }
            if let Some(ref thumb) = archive.thumbnail_path {
                let thumb_full = library_path.join(thumb);
                let _ = std::fs::remove_file(&thumb_full);
            }
        }
    }

    queries::delete_archives(conn, &ids)
}

/// アーカイブを検索
#[tauri::command]
pub fn search_archives(
    state: State<'_, DbState>,
    query: String,
) -> Result<Vec<ArchiveSummary>, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;

    let filter = ArchiveFilter {
        folder_id: None,
        smart_folder_id: None,
        preset: None,
        sort_by: None,
        sort_order: None,
        filter_tags: None,
        filter_min_rank: None,
        search_query: Some(query),
    };

    queries::get_archive_summaries_filtered(conn, &filter)
}
