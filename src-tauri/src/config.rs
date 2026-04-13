use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub maximized: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1280,
            height: 800,
            maximized: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewerSettings {
    pub moire_reduction: f32,
}

impl Default for ViewerSettings {
    fn default() -> Self {
        Self {
            moire_reduction: 0.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub library_path: Option<String>,
    #[serde(default)]
    pub window_state: WindowState,
    #[serde(default)]
    pub viewer_settings: ViewerSettings,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            library_path: None,
            window_state: WindowState::default(),
            viewer_settings: ViewerSettings::default(),
        }
    }
}

/// %APPDATA%/ComicViewer/config.json のパスを返す
pub fn config_dir() -> Result<PathBuf, AppError> {
    let appdata = std::env::var("APPDATA")
        .map_err(|_| AppError::FileIO("APPDATA environment variable not found".into()))?;
    Ok(PathBuf::from(appdata).join("ComicViewer"))
}

pub fn config_path() -> Result<PathBuf, AppError> {
    Ok(config_dir()?.join("config.json"))
}

pub fn load_config() -> Result<AppConfig, AppError> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(&path)?;
    serde_json::from_str(&content).map_err(|e| AppError::FileIO(e.to_string()))
}

pub fn save_config(config: &AppConfig) -> Result<(), AppError> {
    let dir = config_dir()?;
    fs::create_dir_all(&dir)?;
    let content =
        serde_json::to_string_pretty(config).map_err(|e| AppError::FileIO(e.to_string()))?;
    fs::write(config_path()?, content)?;
    Ok(())
}

/// ライブラリルートパスを取得する共通関数 (E2-8)
pub fn get_library_root() -> Result<PathBuf, AppError> {
    let config = load_config()?;
    let path = config.library_path.ok_or(AppError::LibraryNotFound)?;
    Ok(PathBuf::from(path))
}

// --- テスト用ヘルパー: 任意のパスでconfig操作 ---

pub fn load_config_from(path: &std::path::Path) -> Result<AppConfig, AppError> {
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let content = fs::read_to_string(path)?;
    serde_json::from_str(&content).map_err(|e| AppError::FileIO(e.to_string()))
}

pub fn save_config_to(config: &AppConfig, path: &std::path::Path) -> Result<(), AppError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content =
        serde_json::to_string_pretty(config).map_err(|e| AppError::FileIO(e.to_string()))?;
    fs::write(path, content)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_default_config() {
        let config = AppConfig::default();
        assert!(config.library_path.is_none());
        assert_eq!(config.window_state.width, 1280);
        assert_eq!(config.window_state.height, 800);
        assert!(!config.window_state.maximized);
    }

    #[test]
    fn test_save_and_load_config() {
        let tmp = TempDir::new().unwrap();
        let config_file = tmp.path().join("config.json");

        let config = AppConfig {
            library_path: Some("D:/MangaLibrary".to_string()),
            window_state: WindowState {
                width: 1920,
                height: 1080,
                maximized: true,
            },
            viewer_settings: ViewerSettings::default(),
        };

        save_config_to(&config, &config_file).unwrap();
        let loaded = load_config_from(&config_file).unwrap();

        assert_eq!(loaded.library_path, Some("D:/MangaLibrary".to_string()));
        assert_eq!(loaded.window_state.width, 1920);
        assert_eq!(loaded.window_state.height, 1080);
        assert!(loaded.window_state.maximized);
    }

    #[test]
    fn test_load_nonexistent_returns_default() {
        let tmp = TempDir::new().unwrap();
        let config_file = tmp.path().join("nonexistent.json");

        let config = load_config_from(&config_file).unwrap();
        assert!(config.library_path.is_none());
    }

    #[test]
    fn test_config_serialization_roundtrip() {
        let config = AppConfig {
            library_path: Some("C:/Comics".to_string()),
            window_state: WindowState::default(),
            viewer_settings: ViewerSettings::default(),
        };

        let json = serde_json::to_string(&config).unwrap();
        let deserialized: AppConfig = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.library_path, Some("C:/Comics".to_string()));
    }

    #[test]
    fn test_config_missing_window_state_uses_default() {
        let json = r#"{"library_path": "D:/Manga"}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.window_state.width, 1280);
        assert_eq!(config.window_state.height, 800);
    }

    #[test]
    fn test_save_creates_parent_directories() {
        let tmp = TempDir::new().unwrap();
        let config_file = tmp.path().join("subdir").join("nested").join("config.json");

        let config = AppConfig::default();
        save_config_to(&config, &config_file).unwrap();

        assert!(config_file.exists());
    }

    #[test]
    fn test_viewer_settings_default() {
        let settings = ViewerSettings::default();
        assert_eq!(settings.moire_reduction, 0.5);
    }

    #[test]
    fn test_config_missing_viewer_settings_uses_default() {
        let json = r#"{"library_path": "D:/Manga"}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.viewer_settings.moire_reduction, 0.5);
    }

    #[test]
    fn test_viewer_settings_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let config_file = tmp.path().join("config.json");
        let config = AppConfig {
            library_path: Some("D:/Manga".to_string()),
            window_state: WindowState::default(),
            viewer_settings: ViewerSettings { moire_reduction: 1.2 },
        };
        save_config_to(&config, &config_file).unwrap();
        let loaded = load_config_from(&config_file).unwrap();
        assert!((loaded.viewer_settings.moire_reduction - 1.2).abs() < f32::EPSILON);
    }
}
