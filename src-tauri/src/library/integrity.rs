use crate::db::queries;
use crate::error::AppError;
use rusqlite::Connection;
use std::fs;
use std::path::Path;

/// 起動時整合性チェック
/// - 消失ファイルはmissing=1にフラグ更新 (HI-18: DELETEではなくフラグ)
/// - 復活ファイルはmissing=0に戻す
pub fn check_integrity(conn: &Connection, library_path: &Path) -> Result<IntegrityReport, AppError> {
    let mut report = IntegrityReport::default();

    // 全アーカイブを取得
    let archives = get_all_archives_with_paths(conn)?;

    for (id, file_path, was_missing) in &archives {
        let full_path = library_path.join(file_path);
        let exists = full_path.exists();

        if !exists && !was_missing {
            // ファイルが消失 → missing=1
            queries::set_archive_missing(conn, id, true)?;
            report.marked_missing += 1;
        } else if exists && *was_missing {
            // ファイルが復活 → missing=0
            queries::set_archive_missing(conn, id, false)?;
            report.restored += 1;
        }
    }

    // temp/ クリーンアップ
    let temp_dir = library_path.join("temp");
    if temp_dir.exists() {
        report.temp_cleaned = cleanup_temp_dir(&temp_dir);
    }

    // 孤立サムネイル削除
    let thumb_dir = library_path.join("thumbnails");
    if thumb_dir.exists() {
        report.orphaned_thumbnails = cleanup_orphaned_thumbnails(conn, &thumb_dir)?;
    }

    Ok(report)
}

/// 全アーカイブのID, file_path, missingを取得
fn get_all_archives_with_paths(conn: &Connection) -> Result<Vec<(String, String, bool)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, file_path, missing FROM archives"
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i32>(2)? != 0,
        ))
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

/// tempディレクトリのクリーンアップ
fn cleanup_temp_dir(temp_dir: &Path) -> usize {
    let mut count = 0;
    if let Ok(entries) = fs::read_dir(temp_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if fs::remove_dir_all(&path).is_ok() {
                    count += 1;
                }
            } else if fs::remove_file(&path).is_ok() {
                count += 1;
            }
        }
    }
    count
}

/// 孤立サムネイル(DBに対応するアーカイブがないサムネイル)を削除
fn cleanup_orphaned_thumbnails(conn: &Connection, thumb_dir: &Path) -> Result<usize, AppError> {
    let mut count = 0;

    // DB内の全アーカイブIDを取得
    let mut stmt = conn.prepare("SELECT id FROM archives")?;
    let ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();

    if let Ok(entries) = fs::read_dir(thumb_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if !ids.contains(&stem.to_string()) {
                    if fs::remove_file(&path).is_ok() {
                        count += 1;
                    }
                }
            }
        }
    }

    Ok(count)
}

/// 整合性チェックレポート
#[derive(Debug, Default)]
pub struct IntegrityReport {
    pub marked_missing: usize,
    pub restored: usize,
    pub temp_cleaned: usize,
    pub orphaned_thumbnails: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;
    use crate::db::models::Archive;
    use crate::db::queries;
    use tempfile::TempDir;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    fn make_test_archive(id: &str, file_path: &str) -> Archive {
        Archive {
            id: id.to_string(),
            title: "Test".to_string(),
            file_name: "test.cbz".to_string(),
            file_path: file_path.to_string(),
            file_size: 1024,
            page_count: 10,
            format: "cbz".to_string(),
            thumbnail_path: None,
            rank: 0,
            memo: String::new(),
            is_read: false,
            last_read_page: 0,
            missing: false,
            created_at: "2026-01-01T00:00:00+00:00".to_string(),
            updated_at: "2026-01-01T00:00:00+00:00".to_string(),
        }
    }

    #[test]
    fn test_mark_missing_file() {
        let conn = setup_db();
        let tmp = TempDir::new().unwrap();
        let library_path = tmp.path();

        // アーカイブを登録するが、実ファイルは作らない
        let archive = make_test_archive("a1", "archives/a1/test.cbz");
        queries::insert_archive(&conn, &archive).unwrap();

        let report = check_integrity(&conn, library_path).unwrap();

        assert_eq!(report.marked_missing, 1);

        // DBでmissing=trueになっていることを確認
        let retrieved = queries::get_archive_by_id(&conn, "a1").unwrap();
        assert!(retrieved.missing);
    }

    #[test]
    fn test_restore_missing_file() {
        let conn = setup_db();
        let tmp = TempDir::new().unwrap();
        let library_path = tmp.path();

        // missing=trueのアーカイブを登録
        let mut archive = make_test_archive("a1", "archives/a1/test.cbz");
        archive.missing = true;
        queries::insert_archive(&conn, &archive).unwrap();

        // 実ファイルを作成
        let file_dir = library_path.join("archives").join("a1");
        fs::create_dir_all(&file_dir).unwrap();
        fs::write(file_dir.join("test.cbz"), b"dummy").unwrap();

        let report = check_integrity(&conn, library_path).unwrap();

        assert_eq!(report.restored, 1);

        // DBでmissing=falseに戻っていることを確認
        let retrieved = queries::get_archive_by_id(&conn, "a1").unwrap();
        assert!(!retrieved.missing);
    }

    #[test]
    fn test_no_change_for_existing_file() {
        let conn = setup_db();
        let tmp = TempDir::new().unwrap();
        let library_path = tmp.path();

        // 実ファイルを作成してアーカイブを登録
        let file_dir = library_path.join("archives").join("a1");
        fs::create_dir_all(&file_dir).unwrap();
        fs::write(file_dir.join("test.cbz"), b"dummy").unwrap();

        let archive = make_test_archive("a1", "archives/a1/test.cbz");
        queries::insert_archive(&conn, &archive).unwrap();

        let report = check_integrity(&conn, library_path).unwrap();

        assert_eq!(report.marked_missing, 0);
        assert_eq!(report.restored, 0);
    }

    #[test]
    fn test_cleanup_temp_dir() {
        let tmp = TempDir::new().unwrap();
        let temp_dir = tmp.path().join("temp");
        fs::create_dir_all(&temp_dir).unwrap();

        // tempディレクトリ内にファイルとサブディレクトリを作成
        fs::write(temp_dir.join("file1.tmp"), b"data").unwrap();
        let sub = temp_dir.join("subdir");
        fs::create_dir_all(&sub).unwrap();
        fs::write(sub.join("file2.tmp"), b"data").unwrap();

        let count = super::cleanup_temp_dir(&temp_dir);
        assert_eq!(count, 2); // file1.tmp + subdir
    }

    #[test]
    fn test_cleanup_orphaned_thumbnails() {
        let conn = setup_db();
        let tmp = TempDir::new().unwrap();

        // アーカイブを1つだけ登録
        let archive = make_test_archive("a1", "archives/a1/test.cbz");
        queries::insert_archive(&conn, &archive).unwrap();

        // サムネイルを2つ作成 (a1は対応あり、orphanは対応なし)
        let thumb_dir = tmp.path().join("thumbnails");
        fs::create_dir_all(&thumb_dir).unwrap();
        fs::write(thumb_dir.join("a1.jpg"), b"thumb").unwrap();
        fs::write(thumb_dir.join("orphan.jpg"), b"thumb").unwrap();

        let count = super::cleanup_orphaned_thumbnails(&conn, &thumb_dir).unwrap();
        assert_eq!(count, 1);

        // a1.jpgは残っている
        assert!(thumb_dir.join("a1.jpg").exists());
        // orphan.jpgは削除されている
        assert!(!thumb_dir.join("orphan.jpg").exists());
    }

    #[test]
    fn test_integrity_check_empty_db() {
        let conn = setup_db();
        let tmp = TempDir::new().unwrap();

        let report = check_integrity(&conn, tmp.path()).unwrap();

        assert_eq!(report.marked_missing, 0);
        assert_eq!(report.restored, 0);
        assert_eq!(report.temp_cleaned, 0);
        assert_eq!(report.orphaned_thumbnails, 0);
    }

    #[test]
    fn test_already_missing_stays_missing() {
        let conn = setup_db();
        let tmp = TempDir::new().unwrap();
        let library_path = tmp.path();

        // 既にmissingのアーカイブ (ファイルなし)
        let mut archive = make_test_archive("a1", "archives/a1/test.cbz");
        archive.missing = true;
        queries::insert_archive(&conn, &archive).unwrap();

        let report = check_integrity(&conn, library_path).unwrap();

        // 既にmissingなので新たにマークされない
        assert_eq!(report.marked_missing, 0);
        assert_eq!(report.restored, 0);
    }
}
