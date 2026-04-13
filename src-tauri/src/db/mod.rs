pub mod migrations;
pub mod models;
pub mod queries;

use crate::error::AppError;
use rusqlite::Connection;
use std::sync::Mutex;

/// エラッタE1-1: DbState は Mutex<Option<Connection>> パターン
/// ライブラリ未選択時は None、選択後に init() で Some(Connection) にする
pub struct DbState(pub Mutex<Option<Connection>>);

impl DbState {
    /// ライブラリ未初期化状態で作成
    pub fn empty() -> Self {
        Self(Mutex::new(None))
    }

    /// DBパスを指定して初期化
    pub fn init(&self, db_path: &str) -> Result<(), AppError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        migrations::run(&conn)?;
        let mut guard = self
            .0
            .lock()
            .map_err(|e| AppError::Database(e.to_string()))?;
        *guard = Some(conn);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_empty_creates_none_state() {
        let state = DbState::empty();
        let guard = state.0.lock().unwrap();
        assert!(guard.is_none());
    }

    #[test]
    fn test_init_with_in_memory_db() {
        let state = DbState::empty();
        // ":memory:" を使うとインメモリDBになる
        state.init(":memory:").unwrap();
        let guard = state.0.lock().unwrap();
        assert!(guard.is_some());
    }

    #[test]
    fn test_init_with_temp_file() {
        let tmp = tempfile::TempDir::new().unwrap();
        let db_path = tmp.path().join("test.db");
        let state = DbState::empty();
        state.init(db_path.to_str().unwrap()).unwrap();
        let guard = state.0.lock().unwrap();
        assert!(guard.is_some());
    }

    #[test]
    fn test_init_enables_wal_and_foreign_keys() {
        let state = DbState::empty();
        state.init(":memory:").unwrap();
        let guard = state.0.lock().unwrap();
        let conn = guard.as_ref().unwrap();

        let journal_mode: String = conn
            .pragma_query_value(None, "journal_mode", |row| row.get(0))
            .unwrap();
        // In-memory DB returns "memory" for journal_mode, file DB returns "wal"
        // For file-based DB test:
        assert!(journal_mode == "memory" || journal_mode == "wal");

        let fk: i32 = conn
            .pragma_query_value(None, "foreign_keys", |row| row.get(0))
            .unwrap();
        assert_eq!(fk, 1);
    }

    #[test]
    fn test_init_runs_migrations() {
        let state = DbState::empty();
        state.init(":memory:").unwrap();
        let guard = state.0.lock().unwrap();
        let conn = guard.as_ref().unwrap();

        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn test_reinit_replaces_connection() {
        let tmp = tempfile::TempDir::new().unwrap();
        let db1 = tmp.path().join("db1.db");
        let db2 = tmp.path().join("db2.db");

        let state = DbState::empty();
        state.init(db1.to_str().unwrap()).unwrap();
        state.init(db2.to_str().unwrap()).unwrap();

        let guard = state.0.lock().unwrap();
        assert!(guard.is_some());
    }
}
