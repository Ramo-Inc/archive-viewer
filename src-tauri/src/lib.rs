pub mod archive;
pub mod commands;
pub mod config;
pub mod db;
pub mod error;
pub mod imaging;
pub mod library;

use db::DbState;
use tauri::{Manager, State};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DbState::empty())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // 開発時はDevToolsを自動で開く
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            // config読み込み → ライブラリパスがあればDB初期化 + 整合性チェック
            if let Ok(cfg) = config::load_config() {
                if let Some(ref lib_path) = cfg.library_path {
                    let db_path =
                        std::path::PathBuf::from(lib_path).join("comicviewer.db");
                    if let Some(db_path_str) = db_path.to_str() {
                        let state: State<'_, DbState> = app.state::<DbState>();
                        let _ = state.init(db_path_str);
                    }
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // library commands
            commands::library::init_library,
            commands::library::get_library_path,
            commands::library::get_folders,
            commands::library::create_folder,
            commands::library::rename_folder,
            commands::library::delete_folder,
            commands::library::get_tags,
            commands::library::create_tag,
            commands::library::delete_tag,
            commands::library::set_archive_tags,
            commands::library::move_archives_to_folder,
            commands::library::get_smart_folders,
            commands::library::create_smart_folder,
            commands::library::update_smart_folder,
            commands::library::delete_smart_folder,
            // archive commands
            commands::archive::import_archives,
            commands::archive::get_archives,
            commands::archive::get_archive_detail,
            commands::archive::update_archive,
            commands::archive::delete_archives,
            commands::archive::search_archives,
            // viewer commands
            commands::viewer::prepare_pages,
            commands::viewer::save_read_position,
            // drag_drop commands
            commands::drag_drop::import_dropped_files,
            commands::drag_drop::handle_internal_drag,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
