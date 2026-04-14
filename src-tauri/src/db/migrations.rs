use crate::error::AppError;
use rusqlite::Connection;

pub fn run(conn: &Connection) -> Result<(), AppError> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 1 {
        migrate_v1(conn)?;
    }
    if version < 2 {
        migrate_v2(conn)?;
    }

    Ok(())
}

/// エラッタE1-3: トランザクション内でマイグレーション実行
/// エラッタE1-4: archives テーブルに missing カラム追加
fn migrate_v1(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("BEGIN;")?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS archives (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            file_name TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            page_count INTEGER NOT NULL,
            format TEXT NOT NULL,
            thumbnail_path TEXT,
            rank INTEGER DEFAULT 0,
            memo TEXT DEFAULT '',
            is_read INTEGER DEFAULT 0,
            last_read_page INTEGER DEFAULT 0,
            missing INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_archives_title ON archives(title);
        CREATE INDEX IF NOT EXISTS idx_archives_rank ON archives(rank);
        CREATE INDEX IF NOT EXISTS idx_archives_created_at ON archives(created_at);

        CREATE TABLE IF NOT EXISTS folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            parent_id TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS archive_folders (
            archive_id TEXT NOT NULL,
            folder_id TEXT NOT NULL,
            PRIMARY KEY (archive_id, folder_id),
            FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE,
            FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tags (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS archive_tags (
            archive_id TEXT NOT NULL,
            tag_id TEXT NOT NULL,
            PRIMARY KEY (archive_id, tag_id),
            FOREIGN KEY (archive_id) REFERENCES archives(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS smart_folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            conditions TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        ",
    )?;
    conn.execute_batch("PRAGMA user_version = 1; COMMIT;")?;

    Ok(())
}

fn migrate_v2(conn: &Connection) -> Result<(), AppError> {
    let has_column = conn
        .prepare("SELECT parent_id FROM smart_folders LIMIT 0")
        .is_ok();
    if !has_column {
        conn.execute_batch(
            "ALTER TABLE smart_folders ADD COLUMN parent_id TEXT REFERENCES smart_folders(id) ON DELETE SET NULL;",
        )?;
    }
    conn.execute_batch("PRAGMA user_version = 2;")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        conn
    }

    #[test]
    fn test_initial_version_is_zero() {
        let conn = setup_db();
        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 0);
    }

    #[test]
    fn test_migration_v1_sets_version() {
        let conn = setup_db();
        run(&conn).unwrap();
        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn test_archives_table_exists() {
        let conn = setup_db();
        run(&conn).unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='archives'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_archives_table_has_missing_column() {
        let conn = setup_db();
        run(&conn).unwrap();
        // Insert a row to verify the missing column exists and defaults to 0
        conn.execute(
            "INSERT INTO archives (id, title, file_name, file_path, file_size, page_count, format, created_at, updated_at)
             VALUES ('test', 'Test', 'test.cbz', 'path', 1024, 10, 'cbz', '2026-01-01', '2026-01-01')",
            [],
        ).unwrap();
        let missing: i32 = conn
            .query_row("SELECT missing FROM archives WHERE id='test'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(missing, 0);
    }

    #[test]
    fn test_folders_table_exists() {
        let conn = setup_db();
        run(&conn).unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='folders'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_archive_folders_table_exists() {
        let conn = setup_db();
        run(&conn).unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='archive_folders'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_tags_table_exists() {
        let conn = setup_db();
        run(&conn).unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='tags'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_archive_tags_table_exists() {
        let conn = setup_db();
        run(&conn).unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='archive_tags'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_smart_folders_table_exists() {
        let conn = setup_db();
        run(&conn).unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='smart_folders'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_settings_table_exists() {
        let conn = setup_db();
        run(&conn).unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='settings'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_migration_is_idempotent() {
        let conn = setup_db();
        run(&conn).unwrap();
        // Running again should not fail
        run(&conn).unwrap();
        let version: i32 = conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);
    }

    #[test]
    fn test_indexes_created() {
        let conn = setup_db();
        run(&conn).unwrap();

        let index_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name LIKE 'idx_archives_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(index_count, 3); // title, rank, created_at
    }

    #[test]
    fn test_foreign_key_cascade_delete_archive_folders() {
        let conn = setup_db();
        run(&conn).unwrap();

        // Insert archive and folder
        conn.execute(
            "INSERT INTO archives (id, title, file_name, file_path, file_size, page_count, format, created_at, updated_at)
             VALUES ('a1', 'Test', 'test.cbz', 'path', 1024, 10, 'cbz', '2026-01-01', '2026-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO folders (id, name, created_at) VALUES ('f1', 'Folder1', '2026-01-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO archive_folders (archive_id, folder_id) VALUES ('a1', 'f1')",
            [],
        )
        .unwrap();

        // Delete archive - should cascade
        conn.execute("DELETE FROM archives WHERE id='a1'", [])
            .unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM archive_folders WHERE archive_id='a1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_smart_folders_has_parent_id_column() {
        let conn = setup_db();
        run(&conn).unwrap();
        conn.execute(
            "INSERT INTO smart_folders (id, name, conditions, sort_order, parent_id, created_at)
             VALUES ('sf1', 'Test', '{\"match\":\"all\",\"rules\":[]}', 0, NULL, '2026-01-01')",
            [],
        ).unwrap();
        let parent_id: Option<String> = conn
            .query_row("SELECT parent_id FROM smart_folders WHERE id='sf1'", [], |row| row.get(0))
            .unwrap();
        assert!(parent_id.is_none());
    }

    #[test]
    fn test_smart_folder_parent_id_foreign_key() {
        let conn = setup_db();
        run(&conn).unwrap();
        conn.execute(
            "INSERT INTO smart_folders (id, name, conditions, sort_order, created_at)
             VALUES ('sf-parent', 'Parent', '{\"match\":\"all\",\"rules\":[]}', 0, '2026-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO smart_folders (id, name, conditions, sort_order, parent_id, created_at)
             VALUES ('sf-child', 'Child', '{\"match\":\"all\",\"rules\":[]}', 0, 'sf-parent', '2026-01-01')",
            [],
        ).unwrap();
        let parent_id: Option<String> = conn
            .query_row("SELECT parent_id FROM smart_folders WHERE id='sf-child'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(parent_id, Some("sf-parent".to_string()));
    }

    #[test]
    fn test_foreign_key_cascade_delete_archive_tags() {
        let conn = setup_db();
        run(&conn).unwrap();

        conn.execute(
            "INSERT INTO archives (id, title, file_name, file_path, file_size, page_count, format, created_at, updated_at)
             VALUES ('a1', 'Test', 'test.cbz', 'path', 1024, 10, 'cbz', '2026-01-01', '2026-01-01')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO tags (id, name) VALUES ('t1', 'Action')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO archive_tags (archive_id, tag_id) VALUES ('a1', 't1')",
            [],
        )
        .unwrap();

        // Delete archive - should cascade
        conn.execute("DELETE FROM archives WHERE id='a1'", [])
            .unwrap();
        let count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM archive_tags WHERE archive_id='a1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
}
