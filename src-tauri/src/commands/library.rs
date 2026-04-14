use crate::config;
use crate::db::models::*;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use std::path::PathBuf;
use tauri::State;

/// ライブラリを初期化 (パスを設定してDB作成)
#[tauri::command]
pub fn init_library(
    state: State<'_, DbState>,
    library_path: String,
) -> Result<(), AppError> {
    let path = PathBuf::from(&library_path);
    std::fs::create_dir_all(&path)?;

    // DB初期化
    let db_path = path.join("comicviewer.db");
    state.init(db_path.to_str().unwrap_or(""))?;

    // configに保存
    let mut cfg = config::load_config()?;
    cfg.library_path = Some(library_path);
    config::save_config(&cfg)?;

    // 必要なディレクトリを作成
    std::fs::create_dir_all(path.join("archives"))?;
    std::fs::create_dir_all(path.join("thumbnails"))?;
    std::fs::create_dir_all(path.join("temp"))?;

    Ok(())
}

/// ライブラリパスを取得
#[tauri::command]
pub fn get_library_path() -> Result<Option<String>, AppError> {
    let cfg = config::load_config()?;
    Ok(cfg.library_path)
}

/// フォルダ一覧を取得
#[tauri::command]
pub fn get_folders(state: State<'_, DbState>) -> Result<Vec<Folder>, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::get_folders(conn)
}

/// フォルダを作成
#[tauri::command]
pub fn create_folder(
    state: State<'_, DbState>,
    name: String,
    parent_id: Option<String>,
) -> Result<Folder, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    if let Some(ref pid) = parent_id {
        let parent_depth = queries::get_folder_depth(conn, pid)?;
        if parent_depth >= 4 {
            return Err(AppError::Validation("最大5階層までです".to_string()));
        }
    }
    queries::create_folder(conn, &name, parent_id.as_deref())
}

/// フォルダ名を変更
#[tauri::command]
pub fn rename_folder(
    state: State<'_, DbState>,
    id: String,
    name: String,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::rename_folder(conn, &id, &name)
}

/// フォルダを削除（子フォルダも再帰的に削除）
#[tauri::command]
pub fn delete_folder(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::delete_folder_recursive(conn, &id)
}

/// タグ一覧を取得
#[tauri::command]
pub fn get_tags(state: State<'_, DbState>) -> Result<Vec<Tag>, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::get_tags(conn)
}

/// タグを作成
#[tauri::command]
pub fn create_tag(
    state: State<'_, DbState>,
    name: String,
) -> Result<Tag, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::create_tag(conn, &name)
}

/// タグを削除
#[tauri::command]
pub fn delete_tag(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::delete_tag(conn, &id)
}

/// アーカイブのタグを設定
#[tauri::command]
pub fn set_archive_tags(
    state: State<'_, DbState>,
    archive_id: String,
    tag_ids: Vec<String>,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::set_archive_tags(conn, &archive_id, &tag_ids)
}

/// アーカイブをフォルダに移動
#[tauri::command]
pub fn move_archives_to_folder(
    state: State<'_, DbState>,
    archive_ids: Vec<String>,
    folder_id: String,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::move_archives_to_folder(conn, &archive_ids, &folder_id)
}

/// スマートフォルダ一覧を取得
#[tauri::command]
pub fn get_smart_folders(state: State<'_, DbState>) -> Result<Vec<SmartFolder>, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::get_smart_folders(conn)
}

/// スマートフォルダを作成
#[tauri::command]
pub fn create_smart_folder(
    state: State<'_, DbState>,
    name: String,
    conditions: String,
    parent_id: Option<String>,
) -> Result<SmartFolder, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    if let Some(ref pid) = parent_id {
        let parent_depth = queries::get_smart_folder_depth(conn, pid)?;
        if parent_depth >= 4 {
            return Err(AppError::Validation("最大5階層までです".to_string()));
        }
    }
    queries::create_smart_folder_with_parent(conn, &name, &conditions, parent_id.as_deref())
}

/// スマートフォルダを更新
#[tauri::command]
pub fn update_smart_folder(
    state: State<'_, DbState>,
    id: String,
    name: String,
    conditions: String,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::update_smart_folder(conn, &id, &name, &conditions)
}

/// スマートフォルダを削除（子フォルダも再帰的に削除）
#[tauri::command]
pub fn delete_smart_folder(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::delete_smart_folder_recursive(conn, &id)
}
