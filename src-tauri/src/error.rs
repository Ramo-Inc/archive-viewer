use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("データベースエラー: {0}")]
    Database(String),
    #[error("ファイルI/Oエラー: {0}")]
    FileIO(String),
    #[error("アーカイブエラー: {0}")]
    Archive(String),
    #[error("バリデーションエラー: {0}")]
    Validation(String),
    #[error("ライブラリが見つかりません")]
    LibraryNotFound,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::FileIO(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_serialize_database_error() {
        let err = AppError::Database("connection failed".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"データベースエラー: connection failed\"");
    }

    #[test]
    fn test_serialize_file_io_error() {
        let err = AppError::FileIO("file not found".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"ファイルI/Oエラー: file not found\"");
    }

    #[test]
    fn test_serialize_archive_error() {
        let err = AppError::Archive("corrupt archive".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"アーカイブエラー: corrupt archive\"");
    }

    #[test]
    fn test_serialize_validation_error() {
        let err = AppError::Validation("invalid input".to_string());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"バリデーションエラー: invalid input\"");
    }

    #[test]
    fn test_serialize_library_not_found() {
        let err = AppError::LibraryNotFound;
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"ライブラリが見つかりません\"");
    }

    #[test]
    fn test_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "missing file");
        let app_err: AppError = io_err.into();
        match app_err {
            AppError::FileIO(msg) => assert!(msg.contains("missing file")),
            _ => panic!("Expected FileIO variant"),
        }
    }

    #[test]
    fn test_from_rusqlite_error() {
        let sqlite_err = rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(1),
            Some("test error".to_string()),
        );
        let app_err: AppError = sqlite_err.into();
        match app_err {
            AppError::Database(msg) => assert!(msg.contains("test error")),
            _ => panic!("Expected Database variant"),
        }
    }

    #[test]
    fn test_display_trait() {
        let err = AppError::Database("test".to_string());
        assert_eq!(format!("{}", err), "データベースエラー: test");
    }
}
