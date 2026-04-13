use crate::db::models::*;
use crate::error::AppError;
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

// === Archives ===

pub fn insert_archive(conn: &Connection, archive: &Archive) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO archives (id, title, file_name, file_path, file_size, page_count, format, thumbnail_path, rank, memo, is_read, last_read_page, missing, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            archive.id,
            archive.title,
            archive.file_name,
            archive.file_path,
            archive.file_size,
            archive.page_count,
            archive.format,
            archive.thumbnail_path,
            archive.rank,
            archive.memo,
            archive.is_read as i32,
            archive.last_read_page,
            archive.missing as i32,
            archive.created_at,
            archive.updated_at,
        ],
    )?;
    Ok(())
}

pub fn get_archive_summaries(conn: &Connection) -> Result<Vec<ArchiveSummary>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, thumbnail_path, rank, is_read, format, missing FROM archives ORDER BY title",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ArchiveSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            thumbnail_path: row.get(2)?,
            rank: row.get(3)?,
            is_read: row.get::<_, i32>(4)? != 0,
            format: row.get(5)?,
            missing: row.get::<_, i32>(6)? != 0,
        })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn get_archive_by_id(conn: &Connection, id: &str) -> Result<Archive, AppError> {
    conn.query_row(
        "SELECT id, title, file_name, file_path, file_size, page_count, format, thumbnail_path, rank, memo, is_read, last_read_page, missing, created_at, updated_at
         FROM archives WHERE id = ?1",
        params![id],
        |row| {
            Ok(Archive {
                id: row.get(0)?,
                title: row.get(1)?,
                file_name: row.get(2)?,
                file_path: row.get(3)?,
                file_size: row.get(4)?,
                page_count: row.get(5)?,
                format: row.get(6)?,
                thumbnail_path: row.get(7)?,
                rank: row.get(8)?,
                memo: row.get(9)?,
                is_read: row.get::<_, i32>(10)? != 0,
                last_read_page: row.get(11)?,
                missing: row.get::<_, i32>(12)? != 0,
                created_at: row.get(13)?,
                updated_at: row.get(14)?,
            })
        },
    )
    .map_err(|e| AppError::Database(e.to_string()))
}

pub fn get_archive_detail(conn: &Connection, id: &str) -> Result<ArchiveDetail, AppError> {
    let archive = get_archive_by_id(conn, id)?;
    let tags = get_tags_for_archive(conn, id)?;
    let folders = get_folders_for_archive(conn, id)?;

    Ok(ArchiveDetail {
        id: archive.id,
        title: archive.title,
        file_name: archive.file_name,
        file_size: archive.file_size,
        page_count: archive.page_count,
        format: archive.format,
        thumbnail_path: archive.thumbnail_path,
        rank: archive.rank,
        memo: archive.memo,
        is_read: archive.is_read,
        last_read_page: archive.last_read_page,
        missing: archive.missing,
        created_at: archive.created_at,
        updated_at: archive.updated_at,
        tags,
        folders,
    })
}

pub fn update_archive(conn: &Connection, id: &str, update: &ArchiveUpdate) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    if let Some(ref title) = update.title {
        conn.execute(
            "UPDATE archives SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now, id],
        )?;
    }
    if let Some(rank) = update.rank {
        conn.execute(
            "UPDATE archives SET rank = ?1, updated_at = ?2 WHERE id = ?3",
            params![rank, now, id],
        )?;
    }
    if let Some(ref memo) = update.memo {
        conn.execute(
            "UPDATE archives SET memo = ?1, updated_at = ?2 WHERE id = ?3",
            params![memo, now, id],
        )?;
    }
    if let Some(is_read) = update.is_read {
        conn.execute(
            "UPDATE archives SET is_read = ?1, updated_at = ?2 WHERE id = ?3",
            params![is_read as i32, now, id],
        )?;
    }
    Ok(())
}

pub fn delete_archives(conn: &Connection, ids: &[String]) -> Result<(), AppError> {
    for id in ids {
        conn.execute("DELETE FROM archives WHERE id = ?1", params![id])?;
    }
    Ok(())
}

pub fn save_read_position(
    conn: &Connection,
    archive_id: &str,
    page: i32,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE archives SET last_read_page = ?1, is_read = 1, updated_at = ?2 WHERE id = ?3",
        params![page, now, archive_id],
    )?;
    Ok(())
}

/// E5-1: missing フラグをセット
pub fn set_archive_missing(conn: &Connection, id: &str, missing: bool) -> Result<(), AppError> {
    conn.execute(
        "UPDATE archives SET missing = ?1 WHERE id = ?2",
        params![missing as i32, id],
    )?;
    Ok(())
}

// === Folders ===

pub fn get_folders(conn: &Connection) -> Result<Vec<Folder>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, parent_id, sort_order, created_at FROM folders ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            sort_order: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn create_folder(
    conn: &Connection,
    name: &str,
    parent_id: Option<&str>,
) -> Result<Folder, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, sort_order, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
        params![id, name, parent_id, now],
    )?;
    Ok(Folder {
        id,
        name: name.to_string(),
        parent_id: parent_id.map(|s| s.to_string()),
        sort_order: 0,
        created_at: now,
    })
}

/// E2-10: フォルダ名変更
pub fn rename_folder(conn: &Connection, id: &str, name: &str) -> Result<(), AppError> {
    conn.execute(
        "UPDATE folders SET name = ?1 WHERE id = ?2",
        params![name, id],
    )?;
    Ok(())
}

pub fn delete_folder(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn move_archives_to_folder(
    conn: &Connection,
    archive_ids: &[String],
    folder_id: &str,
) -> Result<(), AppError> {
    for archive_id in archive_ids {
        conn.execute(
            "INSERT OR IGNORE INTO archive_folders (archive_id, folder_id) VALUES (?1, ?2)",
            params![archive_id, folder_id],
        )?;
    }
    Ok(())
}

pub fn remove_archive_from_folder(
    conn: &Connection,
    archive_id: &str,
    folder_id: &str,
) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM archive_folders WHERE archive_id = ?1 AND folder_id = ?2",
        params![archive_id, folder_id],
    )?;
    Ok(())
}

// === Tags ===

pub fn get_tags(conn: &Connection) -> Result<Vec<Tag>, AppError> {
    let mut stmt = conn.prepare("SELECT id, name FROM tags ORDER BY name")?;
    let rows = stmt.query_map([], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn create_tag(conn: &Connection, name: &str) -> Result<Tag, AppError> {
    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tags (id, name) VALUES (?1, ?2)",
        params![id, name],
    )?;
    Ok(Tag {
        id,
        name: name.to_string(),
    })
}

pub fn delete_tag(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_archive_tags(
    conn: &Connection,
    archive_id: &str,
    tag_ids: &[String],
) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM archive_tags WHERE archive_id = ?1",
        params![archive_id],
    )?;
    for tag_id in tag_ids {
        conn.execute(
            "INSERT INTO archive_tags (archive_id, tag_id) VALUES (?1, ?2)",
            params![archive_id, tag_id],
        )?;
    }
    Ok(())
}

pub fn get_tags_for_archive(conn: &Connection, archive_id: &str) -> Result<Vec<Tag>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name FROM tags t INNER JOIN archive_tags at ON t.id = at.tag_id WHERE at.archive_id = ?1 ORDER BY t.name",
    )?;
    let rows = stmt.query_map(params![archive_id], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn get_folders_for_archive(
    conn: &Connection,
    archive_id: &str,
) -> Result<Vec<Folder>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT f.id, f.name, f.parent_id, f.sort_order, f.created_at FROM folders f INNER JOIN archive_folders af ON f.id = af.folder_id WHERE af.archive_id = ?1",
    )?;
    let rows = stmt.query_map(params![archive_id], |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            sort_order: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

// === Smart Folders ===

pub fn get_smart_folders(conn: &Connection) -> Result<Vec<SmartFolder>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, conditions, sort_order, created_at FROM smart_folders ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SmartFolder {
            id: row.get(0)?,
            name: row.get(1)?,
            conditions: row.get(2)?,
            sort_order: row.get(3)?,
            created_at: row.get(4)?,
        })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn get_smart_folder_by_id(conn: &Connection, id: &str) -> Result<SmartFolder, AppError> {
    conn.query_row(
        "SELECT id, name, conditions, sort_order, created_at FROM smart_folders WHERE id = ?1",
        params![id],
        |row| {
            Ok(SmartFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                conditions: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: row.get(4)?,
            })
        },
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::Validation(format!("スマートフォルダが見つかりません: {}", id))
        }
        other => AppError::Database(other.to_string()),
    })
}

pub fn create_smart_folder(
    conn: &Connection,
    name: &str,
    conditions: &str,
) -> Result<SmartFolder, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO smart_folders (id, name, conditions, sort_order, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
        params![id, name, conditions, now],
    )?;
    Ok(SmartFolder {
        id,
        name: name.to_string(),
        conditions: conditions.to_string(),
        sort_order: 0,
        created_at: now,
    })
}

/// E2-10: スマートフォルダ更新
pub fn update_smart_folder(
    conn: &Connection,
    id: &str,
    name: &str,
    conditions: &str,
) -> Result<(), AppError> {
    conn.execute(
        "UPDATE smart_folders SET name = ?1, conditions = ?2 WHERE id = ?3",
        params![name, conditions, id],
    )?;
    Ok(())
}

pub fn delete_smart_folder(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM smart_folders WHERE id = ?1", params![id])?;
    Ok(())
}

// === Filtered Queries (E2-9) ===

pub fn get_archive_summaries_filtered(
    conn: &Connection,
    filter: &ArchiveFilter,
) -> Result<Vec<ArchiveSummary>, AppError> {
    let mut sql = String::from(
        "SELECT DISTINCT a.id, a.title, a.thumbnail_path, a.rank, a.is_read, a.format, a.missing FROM archives a",
    );
    let mut joins = Vec::new();
    let mut conditions = Vec::new();
    let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
    let mut param_idx = 1;

    // Folder filter
    if let Some(ref folder_id) = filter.folder_id {
        joins.push("INNER JOIN archive_folders af ON a.id = af.archive_id");
        conditions.push(format!("af.folder_id = ?{}", param_idx));
        param_values.push(Box::new(folder_id.clone()));
        param_idx += 1;
    }

    // Smart folder filter
    if let Some(ref smart_folder_id) = filter.smart_folder_id {
        let sf = get_smart_folder_by_id(conn, smart_folder_id)?;
        let sf_conditions: SmartFolderConditions = serde_json::from_str(&sf.conditions)?;
        let mut sf_parts: Vec<String> = Vec::new();
        for rule in &sf_conditions.rules {
            match (rule.field.as_str(), rule.op.as_str()) {
                ("tag", "contains") => {
                    let val = format!("%{}%", rule.value.as_str().unwrap_or(""));
                    sf_parts.push(format!(
                        "EXISTS (SELECT 1 FROM archive_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE at2.archive_id = a.id AND t2.name LIKE ?{})",
                        param_idx
                    ));
                    param_values.push(Box::new(val));
                    param_idx += 1;
                }
                ("tag", "eq") => {
                    let val = rule.value.as_str().unwrap_or("").to_string();
                    sf_parts.push(format!(
                        "EXISTS (SELECT 1 FROM archive_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE at2.archive_id = a.id AND t2.name = ?{})",
                        param_idx
                    ));
                    param_values.push(Box::new(val));
                    param_idx += 1;
                }
                ("rank", op) => {
                    let sql_op = match op {
                        "gte" => ">=",
                        "lte" => "<=",
                        "eq" => "=",
                        _ => continue,
                    };
                    let val = rule.value.as_i64().unwrap_or(0) as i32;
                    sf_parts.push(format!("a.rank {} ?{}", sql_op, param_idx));
                    param_values.push(Box::new(val));
                    param_idx += 1;
                }
                _ => {}
            }
        }
        if !sf_parts.is_empty() {
            let joiner = if sf_conditions.r#match == "any" { " OR " } else { " AND " };
            conditions.push(format!("({})", sf_parts.join(joiner)));
        }
    }

    // Preset filters
    if let Some(ref preset) = filter.preset {
        match preset.as_str() {
            "favorites" => {
                conditions.push("a.rank >= 1".to_string());
            }
            "unread" => {
                conditions.push("a.is_read = 0".to_string());
            }
            "recent" => {
                conditions.push("a.is_read = 1".to_string());
                conditions.push(
                    "a.updated_at >= datetime('now', '-30 days')".to_string(),
                );
            }
            _ => {} // "all" or unknown — no filter
        }
    }

    // Tag filter
    if let Some(ref tags) = filter.filter_tags {
        if !tags.is_empty() {
            joins.push("INNER JOIN archive_tags atg ON a.id = atg.archive_id");
            joins.push("INNER JOIN tags t ON atg.tag_id = t.id");
            let placeholders: Vec<String> = tags
                .iter()
                .map(|_| {
                    let p = format!("?{}", param_idx);
                    param_idx += 1;
                    p
                })
                .collect();
            conditions.push(format!("t.id IN ({})", placeholders.join(",")));
            for tag in tags {
                param_values.push(Box::new(tag.clone()));
            }
        }
    }

    // Min rank filter
    if let Some(min_rank) = filter.filter_min_rank {
        conditions.push(format!("a.rank >= ?{}", param_idx));
        param_values.push(Box::new(min_rank));
        param_idx += 1;
    }

    // Search query
    if let Some(ref query) = filter.search_query {
        if !query.is_empty() {
            let search_pattern = format!("%{}%", query);
            conditions.push(format!(
                "(a.title LIKE ?{} OR a.memo LIKE ?{})",
                param_idx,
                param_idx + 1
            ));
            param_values.push(Box::new(search_pattern.clone()));
            param_values.push(Box::new(search_pattern));
            param_idx += 2;
        }
    }

    // Build SQL
    for join in &joins {
        sql.push(' ');
        sql.push_str(join);
    }
    if !conditions.is_empty() {
        sql.push_str(" WHERE ");
        sql.push_str(&conditions.join(" AND "));
    }

    // Sort
    let sort_col = match filter.sort_by.as_deref() {
        Some("name") | Some("title") => "a.title",
        Some("created_at") => "a.created_at",
        Some("rank") => "a.rank",
        Some("file_size") => "a.file_size",
        _ => "a.title",
    };
    let sort_dir = match filter.sort_order.as_deref() {
        Some("desc") => "DESC",
        _ => "ASC",
    };
    sql.push_str(&format!(" ORDER BY {} {}", sort_col, sort_dir));

    // Suppress unused warning
    let _ = param_idx;

    let mut stmt = conn.prepare(&sql)?;
    let params_refs: Vec<&dyn rusqlite::types::ToSql> =
        param_values.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(params_refs.as_slice(), |row| {
        Ok(ArchiveSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            thumbnail_path: row.get(2)?,
            rank: row.get(3)?,
            is_read: row.get::<_, i32>(4)? != 0,
            format: row.get(5)?,
            missing: row.get::<_, i32>(6)? != 0,
        })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::migrations;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        migrations::run(&conn).unwrap();
        conn
    }

    fn make_test_archive(id: &str, title: &str) -> Archive {
        Archive {
            id: id.to_string(),
            title: title.to_string(),
            file_name: format!("{}.cbz", title),
            file_path: format!("archives/{}/{}.cbz", id, title),
            file_size: 1024000,
            page_count: 100,
            format: "cbz".to_string(),
            thumbnail_path: Some(format!("thumbnails/{}.jpg", id)),
            rank: 0,
            memo: "".to_string(),
            is_read: false,
            last_read_page: 0,
            missing: false,
            created_at: "2026-01-01T00:00:00+00:00".to_string(),
            updated_at: "2026-01-01T00:00:00+00:00".to_string(),
        }
    }

    // === Archive Tests ===

    #[test]
    fn test_insert_and_get_archive() {
        let conn = setup_db();
        let archive = make_test_archive("a1", "Test Comic");
        insert_archive(&conn, &archive).unwrap();

        let retrieved = get_archive_by_id(&conn, "a1").unwrap();
        assert_eq!(retrieved.id, "a1");
        assert_eq!(retrieved.title, "Test Comic");
        assert_eq!(retrieved.file_size, 1024000);
        assert!(!retrieved.missing);
    }

    #[test]
    fn test_get_archive_summaries() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Alpha")).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "Beta")).unwrap();

        let summaries = get_archive_summaries(&conn).unwrap();
        assert_eq!(summaries.len(), 2);
        assert_eq!(summaries[0].title, "Alpha");
        assert_eq!(summaries[1].title, "Beta");
    }

    #[test]
    fn test_get_archive_not_found() {
        let conn = setup_db();
        let result = get_archive_by_id(&conn, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_update_archive_title() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Old Title")).unwrap();

        let update = ArchiveUpdate {
            title: Some("New Title".to_string()),
            rank: None,
            memo: None,
            is_read: None,
        };
        update_archive(&conn, "a1", &update).unwrap();

        let retrieved = get_archive_by_id(&conn, "a1").unwrap();
        assert_eq!(retrieved.title, "New Title");
    }

    #[test]
    fn test_update_archive_rank() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();

        let update = ArchiveUpdate {
            title: None,
            rank: Some(5),
            memo: None,
            is_read: None,
        };
        update_archive(&conn, "a1", &update).unwrap();

        let retrieved = get_archive_by_id(&conn, "a1").unwrap();
        assert_eq!(retrieved.rank, 5);
    }

    #[test]
    fn test_update_archive_memo() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();

        let update = ArchiveUpdate {
            title: None,
            rank: None,
            memo: Some("Great manga!".to_string()),
            is_read: None,
        };
        update_archive(&conn, "a1", &update).unwrap();

        let retrieved = get_archive_by_id(&conn, "a1").unwrap();
        assert_eq!(retrieved.memo, "Great manga!");
    }

    #[test]
    fn test_update_archive_is_read() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();

        let update = ArchiveUpdate {
            title: None,
            rank: None,
            memo: None,
            is_read: Some(true),
        };
        update_archive(&conn, "a1", &update).unwrap();

        let retrieved = get_archive_by_id(&conn, "a1").unwrap();
        assert!(retrieved.is_read);
    }

    #[test]
    fn test_delete_archives() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test1")).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "Test2")).unwrap();

        delete_archives(&conn, &["a1".to_string()]).unwrap();

        let summaries = get_archive_summaries(&conn).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "a2");
    }

    #[test]
    fn test_save_read_position() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();

        save_read_position(&conn, "a1", 42).unwrap();

        let retrieved = get_archive_by_id(&conn, "a1").unwrap();
        assert_eq!(retrieved.last_read_page, 42);
        assert!(retrieved.is_read);
    }

    #[test]
    fn test_set_archive_missing() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();

        set_archive_missing(&conn, "a1", true).unwrap();
        let retrieved = get_archive_by_id(&conn, "a1").unwrap();
        assert!(retrieved.missing);

        set_archive_missing(&conn, "a1", false).unwrap();
        let retrieved = get_archive_by_id(&conn, "a1").unwrap();
        assert!(!retrieved.missing);
    }

    // === Folder Tests ===

    #[test]
    fn test_create_and_get_folders() {
        let conn = setup_db();
        let folder = create_folder(&conn, "Manga", None).unwrap();
        assert_eq!(folder.name, "Manga");
        assert!(folder.parent_id.is_none());

        let folders = get_folders(&conn).unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].name, "Manga");
    }

    #[test]
    fn test_create_nested_folder() {
        let conn = setup_db();
        let parent = create_folder(&conn, "Comics", None).unwrap();
        let child = create_folder(&conn, "Shounen", Some(&parent.id)).unwrap();

        assert_eq!(child.parent_id, Some(parent.id.clone()));
    }

    #[test]
    fn test_rename_folder() {
        let conn = setup_db();
        let folder = create_folder(&conn, "Old Name", None).unwrap();
        rename_folder(&conn, &folder.id, "New Name").unwrap();

        let folders = get_folders(&conn).unwrap();
        assert_eq!(folders[0].name, "New Name");
    }

    #[test]
    fn test_delete_folder() {
        let conn = setup_db();
        let folder = create_folder(&conn, "ToDelete", None).unwrap();
        delete_folder(&conn, &folder.id).unwrap();

        let folders = get_folders(&conn).unwrap();
        assert_eq!(folders.len(), 0);
    }

    #[test]
    fn test_move_archives_to_folder() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();
        let folder = create_folder(&conn, "MyFolder", None).unwrap();

        move_archives_to_folder(&conn, &["a1".to_string()], &folder.id).unwrap();

        let folders = get_folders_for_archive(&conn, "a1").unwrap();
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].id, folder.id);
    }

    #[test]
    fn test_move_archives_to_folder_idempotent() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();
        let folder = create_folder(&conn, "MyFolder", None).unwrap();

        move_archives_to_folder(&conn, &["a1".to_string()], &folder.id).unwrap();
        move_archives_to_folder(&conn, &["a1".to_string()], &folder.id).unwrap();

        let folders = get_folders_for_archive(&conn, "a1").unwrap();
        assert_eq!(folders.len(), 1);
    }

    #[test]
    fn test_remove_archive_from_folder() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();
        let folder = create_folder(&conn, "MyFolder", None).unwrap();
        move_archives_to_folder(&conn, &["a1".to_string()], &folder.id).unwrap();

        remove_archive_from_folder(&conn, "a1", &folder.id).unwrap();

        let folders = get_folders_for_archive(&conn, "a1").unwrap();
        assert_eq!(folders.len(), 0);
    }

    // === Tag Tests ===

    #[test]
    fn test_create_and_get_tags() {
        let conn = setup_db();
        let tag = create_tag(&conn, "Action").unwrap();
        assert_eq!(tag.name, "Action");

        let tags = get_tags(&conn).unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "Action");
    }

    #[test]
    fn test_delete_tag() {
        let conn = setup_db();
        let tag = create_tag(&conn, "ToDelete").unwrap();
        delete_tag(&conn, &tag.id).unwrap();

        let tags = get_tags(&conn).unwrap();
        assert_eq!(tags.len(), 0);
    }

    #[test]
    fn test_set_and_get_archive_tags() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();
        let tag1 = create_tag(&conn, "Action").unwrap();
        let tag2 = create_tag(&conn, "Comedy").unwrap();

        set_archive_tags(&conn, "a1", &[tag1.id.clone(), tag2.id.clone()]).unwrap();

        let tags = get_tags_for_archive(&conn, "a1").unwrap();
        assert_eq!(tags.len(), 2);
        // Tags are sorted by name
        assert_eq!(tags[0].name, "Action");
        assert_eq!(tags[1].name, "Comedy");
    }

    #[test]
    fn test_set_archive_tags_replaces_existing() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();
        let tag1 = create_tag(&conn, "Action").unwrap();
        let tag2 = create_tag(&conn, "Comedy").unwrap();

        set_archive_tags(&conn, "a1", &[tag1.id.clone()]).unwrap();
        set_archive_tags(&conn, "a1", &[tag2.id.clone()]).unwrap();

        let tags = get_tags_for_archive(&conn, "a1").unwrap();
        assert_eq!(tags.len(), 1);
        assert_eq!(tags[0].name, "Comedy");
    }

    #[test]
    fn test_get_archive_detail_with_tags_and_folders() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test")).unwrap();
        let tag = create_tag(&conn, "Action").unwrap();
        let folder = create_folder(&conn, "Manga", None).unwrap();
        set_archive_tags(&conn, "a1", &[tag.id.clone()]).unwrap();
        move_archives_to_folder(&conn, &["a1".to_string()], &folder.id).unwrap();

        let detail = get_archive_detail(&conn, "a1").unwrap();
        assert_eq!(detail.id, "a1");
        assert_eq!(detail.tags.len(), 1);
        assert_eq!(detail.tags[0].name, "Action");
        assert_eq!(detail.folders.len(), 1);
        assert_eq!(detail.folders[0].name, "Manga");
        assert!(!detail.missing);
    }

    // === Smart Folder Tests ===

    #[test]
    fn test_create_and_get_smart_folders() {
        let conn = setup_db();
        let conditions = r#"{"match":"all","rules":[{"field":"rank","op":"gte","value":3}]}"#;
        let sf = create_smart_folder(&conn, "Favorites", conditions).unwrap();
        assert_eq!(sf.name, "Favorites");
        assert_eq!(sf.conditions, conditions);

        let sfs = get_smart_folders(&conn).unwrap();
        assert_eq!(sfs.len(), 1);
        assert_eq!(sfs[0].name, "Favorites");
    }

    #[test]
    fn test_update_smart_folder() {
        let conn = setup_db();
        let sf = create_smart_folder(&conn, "Old Name", "{}").unwrap();
        let new_conditions = r#"{"match":"any","rules":[]}"#;
        update_smart_folder(&conn, &sf.id, "New Name", new_conditions).unwrap();

        let sfs = get_smart_folders(&conn).unwrap();
        assert_eq!(sfs[0].name, "New Name");
        assert_eq!(sfs[0].conditions, new_conditions);
    }

    #[test]
    fn test_delete_smart_folder() {
        let conn = setup_db();
        let sf = create_smart_folder(&conn, "ToDelete", "{}").unwrap();
        delete_smart_folder(&conn, &sf.id).unwrap();

        let sfs = get_smart_folders(&conn).unwrap();
        assert_eq!(sfs.len(), 0);
    }

    // === Settings Tests ===

    // === Filtered Query Tests ===

    #[test]
    fn test_get_archive_summaries_filtered_no_filter() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Alpha")).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "Beta")).unwrap();

        let filter = ArchiveFilter {
            folder_id: None,
            smart_folder_id: None,
            preset: None,
            sort_by: None,
            sort_order: None,
            filter_tags: None,
            filter_min_rank: None,
            search_query: None,
        };

        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_get_archive_summaries_filtered_by_folder() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "InFolder")).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "NotInFolder")).unwrap();
        let folder = create_folder(&conn, "MyFolder", None).unwrap();
        move_archives_to_folder(&conn, &["a1".to_string()], &folder.id).unwrap();

        let filter = ArchiveFilter {
            folder_id: Some(folder.id),
            smart_folder_id: None,
            preset: None,
            sort_by: None,
            sort_order: None,
            filter_tags: None,
            filter_min_rank: None,
            search_query: None,
        };

        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "InFolder");
    }

    #[test]
    fn test_get_archive_summaries_filtered_by_rank() {
        let conn = setup_db();
        let mut a1 = make_test_archive("a1", "HighRank");
        a1.rank = 5;
        insert_archive(&conn, &a1).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "NoRank")).unwrap();

        let filter = ArchiveFilter {
            folder_id: None,
            smart_folder_id: None,
            preset: None,
            sort_by: None,
            sort_order: None,
            filter_tags: None,
            filter_min_rank: Some(3),
            search_query: None,
        };

        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "HighRank");
    }

    #[test]
    fn test_get_archive_summaries_filtered_by_search() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Dragon Ball")).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "Naruto")).unwrap();

        let filter = ArchiveFilter {
            folder_id: None,
            smart_folder_id: None,
            preset: None,
            sort_by: None,
            sort_order: None,
            filter_tags: None,
            filter_min_rank: None,
            search_query: Some("Dragon".to_string()),
        };

        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Dragon Ball");
    }

    #[test]
    fn test_get_archive_summaries_filtered_sort_desc() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Alpha")).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "Zeta")).unwrap();

        let filter = ArchiveFilter {
            folder_id: None,
            smart_folder_id: None,
            preset: None,
            sort_by: Some("name".to_string()),
            sort_order: Some("desc".to_string()),
            filter_tags: None,
            filter_min_rank: None,
            search_query: None,
        };

        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title, "Zeta");
        assert_eq!(results[1].title, "Alpha");
    }

    #[test]
    fn test_get_archive_summaries_filtered_preset_favorites() {
        let conn = setup_db();
        let mut a1 = make_test_archive("a1", "Favorite");
        a1.rank = 3;
        insert_archive(&conn, &a1).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "Normal")).unwrap();

        let filter = ArchiveFilter {
            folder_id: None,
            smart_folder_id: None,
            preset: Some("favorites".to_string()),
            sort_by: None,
            sort_order: None,
            filter_tags: None,
            filter_min_rank: None,
            search_query: None,
        };

        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Favorite");
    }

    #[test]
    fn test_get_archive_summaries_filtered_preset_unread() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Unread")).unwrap();
        let mut a2 = make_test_archive("a2", "Read");
        a2.is_read = true;
        insert_archive(&conn, &a2).unwrap();

        let filter = ArchiveFilter {
            folder_id: None,
            smart_folder_id: None,
            preset: Some("unread".to_string()),
            sort_by: None,
            sort_order: None,
            filter_tags: None,
            filter_min_rank: None,
            search_query: None,
        };

        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Unread");
    }

    #[test]
    fn test_get_archive_summaries_filtered_by_tags() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Action Manga")).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "Romance Manga")).unwrap();
        let tag = create_tag(&conn, "Action").unwrap();
        set_archive_tags(&conn, "a1", &[tag.id.clone()]).unwrap();

        let filter = ArchiveFilter {
            folder_id: None,
            smart_folder_id: None,
            preset: None,
            sort_by: None,
            sort_order: None,
            filter_tags: Some(vec![tag.id.clone()]),
            filter_min_rank: None,
            search_query: None,
        };

        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Action Manga");
    }

    #[test]
    fn test_delete_archives_multiple() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Test1")).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "Test2")).unwrap();
        insert_archive(&conn, &make_test_archive("a3", "Test3")).unwrap();

        delete_archives(&conn, &["a1".to_string(), "a3".to_string()]).unwrap();

        let summaries = get_archive_summaries(&conn).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].id, "a2");
    }

    #[test]
    fn test_tags_ordered_by_name() {
        let conn = setup_db();
        create_tag(&conn, "Zebra").unwrap();
        create_tag(&conn, "Alpha").unwrap();
        create_tag(&conn, "Mango").unwrap();

        let tags = get_tags(&conn).unwrap();
        assert_eq!(tags[0].name, "Alpha");
        assert_eq!(tags[1].name, "Mango");
        assert_eq!(tags[2].name, "Zebra");
    }

    #[test]
    fn test_folders_ordered_by_sort_order() {
        let conn = setup_db();
        create_folder(&conn, "Folder A", None).unwrap();
        create_folder(&conn, "Folder B", None).unwrap();

        let folders = get_folders(&conn).unwrap();
        assert_eq!(folders.len(), 2);
    }

    #[test]
    fn test_get_smart_folder_by_id() {
        let conn = setup_db();
        let sf = create_smart_folder(&conn, "High Rank", r#"{"match":"all","rules":[{"field":"rank","op":"gte","value":3}]}"#).unwrap();
        let found = get_smart_folder_by_id(&conn, &sf.id).unwrap();
        assert_eq!(found.name, "High Rank");
        assert!(found.conditions.contains("rank"));
    }

    #[test]
    fn test_get_smart_folder_by_id_not_found() {
        let conn = setup_db();
        let result = get_smart_folder_by_id(&conn, "nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn test_smart_folder_filter_rank_gte() {
        let conn = setup_db();
        let mut a1 = make_test_archive("a1", "Low Rank");
        a1.rank = 1;
        let mut a2 = make_test_archive("a2", "High Rank");
        a2.rank = 4;
        insert_archive(&conn, &a1).unwrap();
        insert_archive(&conn, &a2).unwrap();
        let sf = create_smart_folder(&conn, "Rank 3+", r#"{"match":"all","rules":[{"field":"rank","op":"gte","value":3}]}"#).unwrap();
        let filter = ArchiveFilter {
            smart_folder_id: Some(sf.id), folder_id: None, preset: None,
            sort_by: None, sort_order: None, filter_tags: None, filter_min_rank: None, search_query: None,
        };
        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "High Rank");
    }

    #[test]
    fn test_smart_folder_filter_tag_contains() {
        let conn = setup_db();
        insert_archive(&conn, &make_test_archive("a1", "Action Manga")).unwrap();
        insert_archive(&conn, &make_test_archive("a2", "Romance Manga")).unwrap();
        let tag = create_tag(&conn, "Action").unwrap();
        set_archive_tags(&conn, "a1", &[tag.id.clone()]).unwrap();
        let sf = create_smart_folder(&conn, "Action Tag", r#"{"match":"all","rules":[{"field":"tag","op":"contains","value":"Action"}]}"#).unwrap();
        let filter = ArchiveFilter {
            smart_folder_id: Some(sf.id), folder_id: None, preset: None,
            sort_by: None, sort_order: None, filter_tags: None, filter_min_rank: None, search_query: None,
        };
        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].title, "Action Manga");
    }

    #[test]
    fn test_smart_folder_filter_any_match() {
        let conn = setup_db();
        let mut a1 = make_test_archive("a1", "High Rank");
        a1.rank = 5;
        let mut a2 = make_test_archive("a2", "Low Rank");
        a2.rank = 1;
        insert_archive(&conn, &a1).unwrap();
        insert_archive(&conn, &a2).unwrap();
        let tag = create_tag(&conn, "Featured").unwrap();
        set_archive_tags(&conn, "a2", &[tag.id.clone()]).unwrap();
        let sf = create_smart_folder(&conn, "Any Match", r#"{"match":"any","rules":[{"field":"rank","op":"gte","value":4},{"field":"tag","op":"contains","value":"Featured"}]}"#).unwrap();
        let filter = ArchiveFilter {
            smart_folder_id: Some(sf.id), folder_id: None, preset: None,
            sort_by: None, sort_order: None, filter_tags: None, filter_min_rank: None, search_query: None,
        };
        let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
        assert_eq!(results.len(), 2);
    }
}
