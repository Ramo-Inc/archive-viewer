use crate::archive;
use crate::config;
use crate::db::models::PageInfo;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use crate::imaging::thumbnail;
use tauri::State;
use uuid::Uuid;

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
    let session_id = Uuid::new_v4().to_string();
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
