# フォルダ/スマートフォルダ サブディレクトリ対応 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** フォルダとスマートフォルダにExplorerライクなツリー構造（最大3階層）を導入し、スマートフォルダは親の検索条件をAND継承する。

**Architecture:** DBマイグレーションで `smart_folders` に `parent_id` を追加（`folders` は既存）。Rust側で深度バリデーション・再帰削除・条件継承を実装。フロントエンドのSidebarをフラットリストからツリー構造に変更し、展開/折りたたみ・サブフォルダ作成のコンテキストメニューを追加。

**Tech Stack:** Rust (rusqlite, serde_json), React 19, TypeScript, Zustand, Tauri 2 IPC

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src-tauri/src/db/migrations.rs` | V2 migration: smart_folders.parent_id（冪等性あり） |
| Modify | `src-tauri/src/db/mod.rs` | テストのバージョンアサーション更新 |
| Modify | `src-tauri/src/db/models.rs` | SmartFolder に parent_id 追加 |
| Modify | `src-tauri/src/db/queries.rs` | 深度チェック（ガード付き）、再帰削除（トランザクション）、条件継承、ソート順修正、SF CRUD 更新 |
| Modify | `src-tauri/src/commands/library.rs` | create_folder/smart_folder に深度チェック、delete にカスケード |
| Modify | `src/types/index.ts` | SmartFolder に parent_id 追加 |
| Modify | `src/components/library/Sidebar.tsx` | ツリー表示（useMemo）、展開/折りたたみ、サブフォルダ作成、状態排他制御、削除後フィルタリセット |
| Modify | `src/components/library/SmartFolderEditor.tsx` | parentId prop 追加 |

---

### Task 1: DB Migration — smart_folders に parent_id 追加

**Files:**
- Modify: `src-tauri/src/db/migrations.rs:1-14` (version + run function)
- Modify: `src-tauri/src/db/migrations.rs` (新規 migrate_v2 関数追加)

- [ ] **Step 1: Write the failing test for V2 migration**

`src-tauri/src/db/migrations.rs` の `#[cfg(test)] mod tests` ブロック末尾（`test_foreign_key_cascade_delete_archive_tags` テストの後）に追加:

```rust
#[test]
fn test_smart_folders_has_parent_id_column() {
    let conn = setup_db();
    run(&conn).unwrap();
    // Insert a smart folder with parent_id to verify column exists
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test migrations::tests::test_smart_folders_has_parent_id_column -- --nocapture`
Expected: FAIL — smart_folders table has no parent_id column

- [ ] **Step 3: Implement V2 migration**

In `src-tauri/src/db/migrations.rs`:

1. Change `CURRENT_VERSION` from `1` to `2`:

```rust
const CURRENT_VERSION: i32 = 2;
```

2. Add `if version < 2` call in `run()`:

```rust
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
```

3. Add `migrate_v2` function after `migrate_v1` (冪等性あり — カラム存在チェック):

```rust
fn migrate_v2(conn: &Connection) -> Result<(), AppError> {
    // 冪等性: ALTERが成功済みでもuser_versionだけ未更新の場合に対応
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
```

4. Update the existing `test_migration_v1_sets_version` test to expect `2`:

```rust
#[test]
fn test_migration_v1_sets_version() {
    let conn = setup_db();
    run(&conn).unwrap();
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, CURRENT_VERSION);
}
```

5. Update `test_migration_is_idempotent` to expect `2`:

```rust
#[test]
fn test_migration_is_idempotent() {
    let conn = setup_db();
    run(&conn).unwrap();
    run(&conn).unwrap();
    let version: i32 = conn
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 2);
}
```

- [ ] **Step 4: Update `db/mod.rs` test**

`src-tauri/src/db/mod.rs` line 93 の `assert_eq!(version, 1)` を更新:

```rust
assert_eq!(version, 2);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd src-tauri && cargo test migrations::tests -- --nocapture && cd src-tauri && cargo test db::tests -- --nocapture`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/db/migrations.rs src-tauri/src/db/mod.rs
git commit -m "feat: add V2 migration for smart_folders.parent_id (idempotent)"
```

---

### Task 2: Rust Model — SmartFolder に parent_id 追加

**Files:**
- Modify: `src-tauri/src/db/models.rs:88-95` (SmartFolder struct)

- [ ] **Step 1: Write the failing test**

In `src-tauri/src/db/models.rs`, add to `#[cfg(test)] mod tests` block (after `test_smart_folder_serialization`):

```rust
#[test]
fn test_smart_folder_with_parent_id() {
    let sf = SmartFolder {
        id: "sf-child".to_string(),
        name: "Child".to_string(),
        conditions: r#"{"match":"all","rules":[]}"#.to_string(),
        sort_order: 0,
        parent_id: Some("sf-parent".to_string()),
        created_at: "2026-01-01T00:00:00Z".to_string(),
    };
    let json = serde_json::to_string(&sf).unwrap();
    let deserialized: SmartFolder = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.parent_id, Some("sf-parent".to_string()));
}

#[test]
fn test_smart_folder_without_parent_id() {
    let sf = SmartFolder {
        id: "sf-root".to_string(),
        name: "Root".to_string(),
        conditions: r#"{"match":"all","rules":[]}"#.to_string(),
        sort_order: 0,
        parent_id: None,
        created_at: "2026-01-01T00:00:00Z".to_string(),
    };
    let json = serde_json::to_string(&sf).unwrap();
    let deserialized: SmartFolder = serde_json::from_str(&json).unwrap();
    assert!(deserialized.parent_id.is_none());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test models::tests::test_smart_folder_with_parent_id -- --nocapture`
Expected: Compile error — `parent_id` field doesn't exist on SmartFolder

- [ ] **Step 3: Add parent_id to SmartFolder struct**

In `src-tauri/src/db/models.rs`, change SmartFolder (lines 88-95):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub conditions: String,
    pub sort_order: i32,
    pub parent_id: Option<String>,
    pub created_at: String,
}
```

This will break existing code that constructs SmartFolder without `parent_id`. Fix all compilation errors:

1. `src-tauri/src/db/queries.rs` — `get_smart_folders` (line 348), `get_smart_folder_by_id` (line 368), `create_smart_folder` (line 396): Add `parent_id: row.get(N)?` or `parent_id: None` to each SmartFolder construction.

In `get_smart_folders` (line 343-361), change SELECT and mapping:

```rust
pub fn get_smart_folders(conn: &Connection) -> Result<Vec<SmartFolder>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, name, conditions, sort_order, parent_id, created_at FROM smart_folders ORDER BY sort_order",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SmartFolder {
            id: row.get(0)?,
            name: row.get(1)?,
            conditions: row.get(2)?,
            sort_order: row.get(3)?,
            parent_id: row.get(4)?,
            created_at: row.get(5)?,
        })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}
```

In `get_smart_folder_by_id` (line 363-383):

```rust
pub fn get_smart_folder_by_id(conn: &Connection, id: &str) -> Result<SmartFolder, AppError> {
    conn.query_row(
        "SELECT id, name, conditions, sort_order, parent_id, created_at FROM smart_folders WHERE id = ?1",
        params![id],
        |row| {
            Ok(SmartFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                conditions: row.get(2)?,
                sort_order: row.get(3)?,
                parent_id: row.get(4)?,
                created_at: row.get(5)?,
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
```

In `create_smart_folder` (line 385-403) — will be fully updated in Task 3.  
For now, add `parent_id: None`:

```rust
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
        parent_id: None,
        created_at: now,
    })
}
```

Also fix the existing `test_smart_folder_serialization` test in models.rs to include `parent_id: None`:

```rust
#[test]
fn test_smart_folder_serialization() {
    let sf = SmartFolder {
        id: "sf-1".to_string(),
        name: "Favorites".to_string(),
        conditions: r#"{"match":"all","rules":[]}"#.to_string(),
        sort_order: 0,
        parent_id: None,
        created_at: "2026-01-01T00:00:00Z".to_string(),
    };

    let json = serde_json::to_string(&sf).unwrap();
    let deserialized: SmartFolder = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.name, "Favorites");
}
```

- [ ] **Step 4: Run all tests to verify they pass**

Run: `cd src-tauri && cargo test -- --nocapture`
Expected: ALL PASS (including migration tests from Task 1)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/models.rs src-tauri/src/db/queries.rs
git commit -m "feat: add parent_id field to SmartFolder model"
```

---

### Task 3: Rust Queries — 深度チェック・再帰削除・SF作成の parent_id 対応

**Files:**
- Modify: `src-tauri/src/db/queries.rs`

- [ ] **Step 1: Write failing tests for depth check and recursive delete**

In `src-tauri/src/db/queries.rs`, add to `#[cfg(test)] mod tests` block:

```rust
// === Folder depth & recursive delete ===

#[test]
fn test_get_folder_depth_root() {
    let conn = setup_db();
    let root = create_folder(&conn, "Root", None).unwrap();
    assert_eq!(get_folder_depth(&conn, &root.id).unwrap(), 0);
}

#[test]
fn test_get_folder_depth_nested() {
    let conn = setup_db();
    let root = create_folder(&conn, "Root", None).unwrap();
    let child = create_folder(&conn, "Child", Some(&root.id)).unwrap();
    let grandchild = create_folder(&conn, "Grandchild", Some(&child.id)).unwrap();
    assert_eq!(get_folder_depth(&conn, &root.id).unwrap(), 0);
    assert_eq!(get_folder_depth(&conn, &child.id).unwrap(), 1);
    assert_eq!(get_folder_depth(&conn, &grandchild.id).unwrap(), 2);
}

#[test]
fn test_delete_folder_recursive() {
    let conn = setup_db();
    let root = create_folder(&conn, "Root", None).unwrap();
    let child = create_folder(&conn, "Child", Some(&root.id)).unwrap();
    let _grandchild = create_folder(&conn, "Grandchild", Some(&child.id)).unwrap();

    delete_folder_recursive(&conn, &root.id).unwrap();

    let folders = get_folders(&conn).unwrap();
    assert!(folders.is_empty());
}

#[test]
fn test_delete_folder_recursive_preserves_siblings() {
    let conn = setup_db();
    let parent = create_folder(&conn, "Parent", None).unwrap();
    let _child1 = create_folder(&conn, "Child1", Some(&parent.id)).unwrap();
    let sibling = create_folder(&conn, "Sibling", None).unwrap();

    delete_folder_recursive(&conn, &parent.id).unwrap();

    let folders = get_folders(&conn).unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].id, sibling.id);
}

// === Smart folder depth & recursive delete ===

#[test]
fn test_get_smart_folder_depth() {
    let conn = setup_db();
    let root = create_smart_folder_with_parent(&conn, "Root", r#"{"match":"all","rules":[]}"#, None).unwrap();
    let child = create_smart_folder_with_parent(&conn, "Child", r#"{"match":"all","rules":[]}"#, Some(&root.id)).unwrap();
    assert_eq!(get_smart_folder_depth(&conn, &root.id).unwrap(), 0);
    assert_eq!(get_smart_folder_depth(&conn, &child.id).unwrap(), 1);
}

#[test]
fn test_delete_smart_folder_recursive() {
    let conn = setup_db();
    let root = create_smart_folder_with_parent(&conn, "Root", r#"{"match":"all","rules":[]}"#, None).unwrap();
    let _child = create_smart_folder_with_parent(&conn, "Child", r#"{"match":"all","rules":[]}"#, Some(&root.id)).unwrap();

    delete_smart_folder_recursive(&conn, &root.id).unwrap();

    let sfs = get_smart_folders(&conn).unwrap();
    assert!(sfs.is_empty());
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test queries::tests::test_get_folder_depth_root -- --nocapture`
Expected: Compile error — functions don't exist yet

- [ ] **Step 3: Fix sort order and implement depth check, recursive delete, and smart folder with parent_id**

First, fix sort order for sibling consistency. In `src-tauri/src/db/queries.rs`:

Change `get_folders` (line 171) ORDER BY:
```rust
"SELECT id, name, parent_id, sort_order, created_at FROM folders ORDER BY sort_order, name"
```

Change `get_smart_folders` (line 344, after Task 2 update) ORDER BY:
```rust
"SELECT id, name, conditions, sort_order, parent_id, created_at FROM smart_folders ORDER BY sort_order, name"
```

Then add the following functions to `src-tauri/src/db/queries.rs`:

**After `delete_folder` (line 221), add:**

```rust
const MAX_DEPTH_GUARD: i32 = 10;

/// Get the depth of a folder (0 = root, 1 = child, 2 = grandchild)
/// MAX_DEPTH_GUARD で循環参照時の無限ループを防止
pub fn get_folder_depth(conn: &Connection, folder_id: &str) -> Result<i32, AppError> {
    let mut depth = 0;
    let mut current_id = folder_id.to_string();
    loop {
        let parent_id: Option<String> = conn.query_row(
            "SELECT parent_id FROM folders WHERE id = ?1",
            params![current_id],
            |row| row.get(0),
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::Validation(format!("フォルダが見つかりません: {}", current_id))
            }
            other => AppError::Database(other.to_string()),
        })?;
        match parent_id {
            Some(pid) => {
                depth += 1;
                if depth > MAX_DEPTH_GUARD {
                    return Err(AppError::Validation("フォルダ階層が深すぎます（循環参照の可能性）".to_string()));
                }
                current_id = pid;
            }
            None => break,
        }
    }
    Ok(depth)
}

/// Delete a folder and all its descendants recursively (トランザクション付き)
pub fn delete_folder_recursive(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute_batch("BEGIN;")?;
    match delete_folder_recursive_inner(conn, id) {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

fn delete_folder_recursive_inner(conn: &Connection, id: &str) -> Result<(), AppError> {
    let mut stmt = conn.prepare("SELECT id FROM folders WHERE parent_id = ?1")?;
    let child_ids: Vec<String> = stmt
        .query_map(params![id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Database(e.to_string()))?;
    for child_id in &child_ids {
        delete_folder_recursive_inner(conn, child_id)?;
    }
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}
```

**Replace `create_smart_folder` (lines 385-403) and add helpers after `delete_smart_folder` (line 421):**

```rust
pub fn create_smart_folder(
    conn: &Connection,
    name: &str,
    conditions: &str,
) -> Result<SmartFolder, AppError> {
    create_smart_folder_with_parent(conn, name, conditions, None)
}

pub fn create_smart_folder_with_parent(
    conn: &Connection,
    name: &str,
    conditions: &str,
    parent_id: Option<&str>,
) -> Result<SmartFolder, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO smart_folders (id, name, conditions, sort_order, parent_id, created_at) VALUES (?1, ?2, ?3, 0, ?4, ?5)",
        params![id, name, conditions, parent_id, now],
    )?;
    Ok(SmartFolder {
        id,
        name: name.to_string(),
        conditions: conditions.to_string(),
        sort_order: 0,
        parent_id: parent_id.map(|s| s.to_string()),
        created_at: now,
    })
}
```

**After `delete_smart_folder` (line 421), add:**

```rust
/// Get the depth of a smart folder (0 = root, 1 = child, 2 = grandchild)
/// MAX_DEPTH_GUARD で循環参照時の無限ループを防止
pub fn get_smart_folder_depth(conn: &Connection, sf_id: &str) -> Result<i32, AppError> {
    let mut depth = 0;
    let mut current_id = sf_id.to_string();
    loop {
        let parent_id: Option<String> = conn.query_row(
            "SELECT parent_id FROM smart_folders WHERE id = ?1",
            params![current_id],
            |row| row.get(0),
        ).map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::Validation(format!("スマートフォルダが見つかりません: {}", current_id))
            }
            other => AppError::Database(other.to_string()),
        })?;
        match parent_id {
            Some(pid) => {
                depth += 1;
                if depth > MAX_DEPTH_GUARD {
                    return Err(AppError::Validation("スマートフォルダ階層が深すぎます（循環参照の可能性）".to_string()));
                }
                current_id = pid;
            }
            None => break,
        }
    }
    Ok(depth)
}

/// Delete a smart folder and all its descendants recursively (トランザクション付き)
pub fn delete_smart_folder_recursive(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute_batch("BEGIN;")?;
    match delete_smart_folder_recursive_inner(conn, id) {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

fn delete_smart_folder_recursive_inner(conn: &Connection, id: &str) -> Result<(), AppError> {
    let mut stmt = conn.prepare("SELECT id FROM smart_folders WHERE parent_id = ?1")?;
    let child_ids: Vec<String> = stmt
        .query_map(params![id], |row| row.get(0))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| AppError::Database(e.to_string()))?;
    for child_id in &child_ids {
        delete_smart_folder_recursive_inner(conn, child_id)?;
    }
    conn.execute("DELETE FROM smart_folders WHERE id = ?1", params![id])?;
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test queries::tests -- --nocapture`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/queries.rs
git commit -m "feat: add depth check, recursive delete, smart folder parent_id support"
```

---

### Task 4: Rust Queries — スマートフォルダ条件継承

**Files:**
- Modify: `src-tauri/src/db/queries.rs:447-490` (smart folder filter section)

- [ ] **Step 1: Write failing test for condition inheritance**

In `src-tauri/src/db/queries.rs` tests:

```rust
#[test]
fn test_smart_folder_condition_inheritance() {
    let conn = setup_db();

    // Create archives with tags
    let a1 = make_test_archive("a1", "Manga1");
    insert_archive(&conn, &a1).unwrap();
    update_archive(&conn, "a1", &ArchiveUpdate { title: None, rank: Some(4), memo: None, is_read: None }).unwrap();
    let tag = create_tag(&conn, "shounen").unwrap();
    set_archive_tags(&conn, "a1", &[tag.id.clone()]).unwrap();

    let a2 = make_test_archive("a2", "Manga2");
    insert_archive(&conn, &a2).unwrap();
    update_archive(&conn, "a2", &ArchiveUpdate { title: None, rank: Some(2), memo: None, is_read: None }).unwrap();
    set_archive_tags(&conn, "a2", &[tag.id.clone()]).unwrap();

    // Parent: tag contains "shounen"
    let parent = create_smart_folder_with_parent(
        &conn, "Shounen", r#"{"match":"all","rules":[{"field":"tag","op":"contains","value":"shounen"}]}"#, None,
    ).unwrap();

    // Child: rank >= 3 (inherits parent's tag condition)
    let child = create_smart_folder_with_parent(
        &conn, "Shounen High Rank", r#"{"match":"all","rules":[{"field":"rank","op":"gte","value":3}]}"#, Some(&parent.id),
    ).unwrap();

    // Filter by child → should return only a1 (shounen AND rank >= 3)
    let filter = ArchiveFilter {
        smart_folder_id: Some(child.id),
        folder_id: None,
        preset: None,
        sort_by: None,
        sort_order: None,
        filter_tags: None,
        filter_min_rank: None,
        search_query: None,
    };
    let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, "a1");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test queries::tests::test_smart_folder_condition_inheritance -- --nocapture`
Expected: FAIL — child smart folder doesn't inherit parent conditions, returns both archives

- [ ] **Step 3: Implement condition inheritance**

In `src-tauri/src/db/queries.rs`, add a helper function before `get_archive_summaries_filtered`:

```rust
/// Collect conditions from a smart folder and all its ancestors (AND chain)
/// MAX_DEPTH_GUARD で循環参照時の無限ループを防止
fn collect_smart_folder_conditions(
    conn: &Connection,
    sf_id: &str,
) -> Result<Vec<SmartFolderConditions>, AppError> {
    let mut all_conditions = Vec::new();
    let mut current_id = Some(sf_id.to_string());
    let mut guard = 0;
    while let Some(id) = current_id {
        guard += 1;
        if guard > MAX_DEPTH_GUARD {
            return Err(AppError::Validation("スマートフォルダの祖先チェーンが深すぎます".to_string()));
        }
        let sf = get_smart_folder_by_id(conn, &id)?;
        let parsed: SmartFolderConditions = serde_json::from_str(&sf.conditions)?;
        all_conditions.push(parsed);
        current_id = sf.parent_id;
    }
    Ok(all_conditions)
}
```

Then replace the smart folder filter section (lines 447-490) in `get_archive_summaries_filtered`:

```rust
    // Smart folder filter (with condition inheritance)
    if let Some(ref smart_folder_id) = filter.smart_folder_id {
        let all_sf_conditions = collect_smart_folder_conditions(conn, smart_folder_id)?;
        let mut all_sf_parts: Vec<String> = Vec::new();

        for sf_conditions in &all_sf_conditions {
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
                all_sf_parts.push(format!("({})", sf_parts.join(joiner)));
            }
        }
        // All folder-level conditions are ANDed together
        if !all_sf_parts.is_empty() {
            conditions.push(format!("({})", all_sf_parts.join(" AND ")));
        }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test queries::tests -- --nocapture`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/queries.rs
git commit -m "feat: smart folder condition inheritance via ancestor chain"
```

---

### Task 5: Rust Commands — 深度バリデーション・再帰削除・create_smart_folder parent_id

**Files:**
- Modify: `src-tauri/src/commands/library.rs:52-83` (create_folder, delete_folder)
- Modify: `src-tauri/src/commands/library.rs:148-181` (smart folder commands)

- [ ] **Step 1: Update create_folder with depth validation**

In `src-tauri/src/commands/library.rs`, replace `create_folder` (lines 52-60):

```rust
/// フォルダを作成（最大3階層）
#[tauri::command]
pub fn create_folder(
    state: State<'_, DbState>,
    name: String,
    parent_id: Option<String>,
) -> Result<Folder, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    // Depth validation: parent must be at depth < 2 (so new folder is at depth <= 2)
    if let Some(ref pid) = parent_id {
        let parent_depth = queries::get_folder_depth(conn, pid)?;
        if parent_depth >= 2 {
            return Err(AppError::Validation("最大3階層までです".to_string()));
        }
    }
    queries::create_folder(conn, &name, parent_id.as_deref())
}
```

- [ ] **Step 2: Update delete_folder to use recursive delete**

Replace `delete_folder` (lines 76-83):

```rust
/// フォルダを削除（子孫も再帰的に削除）
#[tauri::command]
pub fn delete_folder(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::delete_folder_recursive(conn, &id)
}
```

- [ ] **Step 3: Update create_smart_folder with parent_id and depth validation**

Replace `create_smart_folder` (lines 149-157):

```rust
/// スマートフォルダを作成（最大3階層、parent_id対応）
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
        if parent_depth >= 2 {
            return Err(AppError::Validation("最大3階層までです".to_string()));
        }
    }
    queries::create_smart_folder_with_parent(conn, &name, &conditions, parent_id.as_deref())
}
```

- [ ] **Step 4: Update delete_smart_folder to use recursive delete**

Replace `delete_smart_folder` (lines 174-181):

```rust
/// スマートフォルダを削除（子孫も再帰的に削除）
#[tauri::command]
pub fn delete_smart_folder(
    state: State<'_, DbState>,
    id: String,
) -> Result<(), AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::delete_smart_folder_recursive(conn, &id)
}
```

- [ ] **Step 5: Run all tests**

Run: `cd src-tauri && cargo test -- --nocapture`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/library.rs
git commit -m "feat: depth validation and recursive delete in folder commands"
```

---

### Task 6: Frontend Types — SmartFolder に parent_id 追加

**Files:**
- Modify: `src/types/index.ts:69-76` (SmartFolder interface)

- [ ] **Step 1: Add parent_id to SmartFolder TypeScript type**

In `src/types/index.ts`, change SmartFolder (lines 69-76):

```typescript
/** A smart folder (saved filter). */
export interface SmartFolder {
  id: string;
  name: string;
  conditions: string;
  sort_order: number;
  parent_id: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors (parent_id is optional in usage so existing code won't break — the field is just newly present)

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add parent_id to SmartFolder TypeScript type"
```

---

### Task 7: Frontend Sidebar — ツリー構造レンダリング

**Files:**
- Modify: `src/components/library/Sidebar.tsx`

This is the largest frontend task. The Sidebar currently renders flat lists. We'll add:
1. A tree-building utility
2. Expand/collapse state
3. Tree rendering for both folders and smart folders
4. Indentation per depth level

- [ ] **Step 1: Add tree-building types and utility at module scope**

At the top of `src/components/library/Sidebar.tsx` (after imports, before SidebarItem), add.
Import `useMemo` を既存の `import { useState, useCallback, useRef, useEffect }` に追加:

```typescript
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
```

Then add the tree utilities:

```typescript
// --- Tree building utility ---
interface FolderNode {
  folder: Folder;
  children: FolderNode[];
  depth: number;
}

interface SmartFolderNode {
  smartFolder: SmartFolder;
  children: SmartFolderNode[];
  depth: number;
}

function buildFolderTree(folders: Folder[]): FolderNode[] {
  const map = new Map<string, FolderNode>();
  const roots: FolderNode[] = [];

  for (const f of folders) {
    map.set(f.id, { folder: f, children: [], depth: 0 });
  }

  for (const f of folders) {
    const node = map.get(f.id)!;
    if (f.parent_id && map.has(f.parent_id)) {
      const parent = map.get(f.parent_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Set correct depths recursively
  function setDepths(nodes: FolderNode[], d: number) {
    for (const n of nodes) {
      n.depth = d;
      setDepths(n.children, d + 1);
    }
  }
  setDepths(roots, 0);

  return roots;
}

function buildSmartFolderTree(smartFolders: SmartFolder[]): SmartFolderNode[] {
  const map = new Map<string, SmartFolderNode>();
  const roots: SmartFolderNode[] = [];

  for (const sf of smartFolders) {
    map.set(sf.id, { smartFolder: sf, children: [], depth: 0 });
  }

  for (const sf of smartFolders) {
    const node = map.get(sf.id)!;
    if (sf.parent_id && map.has(sf.parent_id)) {
      const parent = map.get(sf.parent_id)!;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  function setDepths(nodes: SmartFolderNode[], d: number) {
    for (const n of nodes) {
      n.depth = d;
      setDepths(n.children, d + 1);
    }
  }
  setDepths(roots, 0);

  return roots;
}
```

- [ ] **Step 2: Add useMemo tree building and expand/collapse state to Sidebar component**

Inside `export default function Sidebar()`, after the existing state declarations (line 211), add:

```typescript
// Tree building (memoized — only recomputes when folders/smartFolders change)
const folderTree = useMemo(() => buildFolderTree(folders), [folders]);
const smartFolderTree = useMemo(() => buildSmartFolderTree(smartFolders), [smartFolders]);

const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set());
const [expandedSmartFolderIds, setExpandedSmartFolderIds] = useState<Set<string>>(new Set());

const toggleFolderExpand = useCallback((folderId: string) => {
  setExpandedFolderIds((prev) => {
    const next = new Set(prev);
    if (next.has(folderId)) {
      next.delete(folderId);
    } else {
      next.add(folderId);
    }
    return next;
  });
}, []);

const toggleSmartFolderExpand = useCallback((sfId: string) => {
  setExpandedSmartFolderIds((prev) => {
    const next = new Set(prev);
    if (next.has(sfId)) {
      next.delete(sfId);
    } else {
      next.add(sfId);
    }
    return next;
  });
}, []);
```

- [ ] **Step 3: Update FolderItem to support depth indentation and expand toggle**

Replace `FolderItemProps` interface and `FolderItem` component (lines 65-191):

```typescript
interface FolderItemProps {
  folder: Folder;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  activeFolderId: string | null | undefined;
  isEditing: boolean;
  isDropTarget: boolean;
  onSelect: (id: string | null) => void;
  onToggleExpand: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, folder: Folder) => void;
  onRenameCommit: (id: string, newName: string) => void;
  onRenameCancel: () => void;
  onDragOver: (e: React.DragEvent, folderId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, folderId: string) => void;
}

function FolderItem({
  folder,
  depth,
  hasChildren,
  isExpanded,
  activeFolderId,
  isEditing,
  isDropTarget,
  onSelect,
  onToggleExpand,
  onContextMenu,
  onRenameCommit,
  onRenameCancel,
  onDragOver,
  onDragLeave,
  onDrop,
}: FolderItemProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editName, setEditName] = useState(folder.name);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      setEditName(folder.name);
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing, folder.name]);

  const commitRename = () => {
    const trimmed = editName.trim();
    if (trimmed && trimmed !== folder.name) {
      onRenameCommit(folder.id, trimmed);
    } else {
      onRenameCancel();
    }
  };

  const indent = 12 + depth * 16;

  if (isEditing) {
    return (
      <div style={{ padding: '4px 10px', paddingLeft: indent }}>
        <input
          ref={inputRef}
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') onRenameCancel();
          }}
          style={{
            width: '100%',
            padding: '4px 8px',
            fontSize: 13,
            borderRadius: 4,
            border: '1px solid var(--accent)',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-folder-id={folder.id}
      onClick={() => onSelect(folder.id)}
      onContextMenu={(e) => onContextMenu(e, folder)}
      onDragOver={(e) => onDragOver(e, folder.id)}
      onDragLeave={onDragLeave}
      onDrop={(e) => onDrop(e, folder.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(folder.id);
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 10px',
        paddingLeft: indent,
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 13,
        background: isDropTarget
          ? 'var(--accent)'
          : activeFolderId === folder.id
            ? 'var(--bg-hover)'
            : 'transparent',
        color: isDropTarget
          ? '#fff'
          : activeFolderId === folder.id
            ? 'var(--text-primary)'
            : 'var(--text-secondary)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!isDropTarget && activeFolderId !== folder.id)
          e.currentTarget.style.background = 'var(--bg-card)';
      }}
      onMouseLeave={(e) => {
        if (!isDropTarget)
          e.currentTarget.style.background =
            activeFolderId === folder.id ? 'var(--bg-hover)' : 'transparent';
      }}
    >
      {/* Expand toggle */}
      <span
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggleExpand(folder.id);
        }}
        style={{
          width: 16,
          fontSize: 10,
          textAlign: 'center',
          cursor: hasChildren ? 'pointer' : 'default',
          color: 'var(--text-dim)',
          flexShrink: 0,
          userSelect: 'none',
        }}
      >
        {hasChildren ? (isExpanded ? '▼' : '▶') : ''}
      </span>
      <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>📁</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {folder.name}
      </span>
    </div>
  );
}
```

- [ ] **Step 4: Replace flat folder rendering with recursive tree rendering**

In the Sidebar component's JSX, replace the folder list section (lines 477-492):

```typescript
      {/* Folder tree (useMemo済み) */}
      {(() => {
        function renderFolderNodes(nodes: FolderNode[]): React.ReactNode {
          return nodes.map((node) => (
            <div key={node.folder.id}>
              <FolderItem
                folder={node.folder}
                depth={node.depth}
                hasChildren={node.children.length > 0}
                isExpanded={expandedFolderIds.has(node.folder.id)}
                activeFolderId={filter.folder_id}
                isEditing={editingFolderId === node.folder.id}
                isDropTarget={dropTargetFolderId === node.folder.id}
                onSelect={handleFolderSelect}
                onToggleExpand={toggleFolderExpand}
                onContextMenu={handleFolderContextMenu}
                onRenameCommit={handleRenameCommit}
                onRenameCancel={() => setEditingFolderId(null)}
                onDragOver={handleFolderDragOver}
                onDragLeave={handleFolderDragLeave}
                onDrop={handleFolderDrop}
              />
              {expandedFolderIds.has(node.folder.id) && node.children.length > 0 && renderFolderNodes(node.children)}
            </div>
          ));
        }
        return renderFolderNodes(folderTree);
      })()}
```

- [ ] **Step 5: Replace flat smart folder rendering with recursive tree rendering**

Replace the smart folder list section (lines 506-516):

```typescript
      {/* Smart folder tree (useMemo済み) */}
      {(() => {
        function renderSmartFolderNodes(nodes: SmartFolderNode[]): React.ReactNode {
          return nodes.map((node) => {
            const sf = node.smartFolder;
            const hasChildren = node.children.length > 0;
            const isExpanded = expandedSmartFolderIds.has(sf.id);
            const indent = 12 + node.depth * 16;
            return (
              <div key={sf.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSmartFolderSelect(sf.id)}
                  onContextMenu={(e) => handleSmartFolderContextMenu(e, sf)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleSmartFolderSelect(sf.id);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 10px',
                    paddingLeft: indent,
                    borderRadius: 4,
                    cursor: 'pointer',
                    fontSize: 13,
                    background: filter.smart_folder_id === sf.id ? 'var(--bg-hover)' : 'transparent',
                    color: filter.smart_folder_id === sf.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    if (filter.smart_folder_id !== sf.id)
                      e.currentTarget.style.background = 'var(--bg-card)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background =
                      filter.smart_folder_id === sf.id ? 'var(--bg-hover)' : 'transparent';
                  }}
                >
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      if (hasChildren) toggleSmartFolderExpand(sf.id);
                    }}
                    style={{
                      width: 16,
                      fontSize: 10,
                      textAlign: 'center',
                      cursor: hasChildren ? 'pointer' : 'default',
                      color: 'var(--text-dim)',
                      flexShrink: 0,
                      userSelect: 'none',
                    }}
                  >
                    {hasChildren ? (isExpanded ? '▼' : '▶') : ''}
                  </span>
                  <span style={{ fontSize: 14, width: 18, textAlign: 'center', flexShrink: 0 }}>🔍</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sf.name}
                  </span>
                </div>
                {isExpanded && hasChildren && renderSmartFolderNodes(node.children)}
              </div>
            );
          });
        }
        return renderSmartFolderNodes(smartFolderTree);
      })()}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/components/library/Sidebar.tsx
git commit -m "feat: tree rendering with expand/collapse for folders and smart folders"
```

---

### Task 8: Frontend Sidebar — コンテキストメニューにサブフォルダ作成を追加

**Files:**
- Modify: `src/components/library/Sidebar.tsx`

- [ ] **Step 1: Add state for subfolder creation (with mutual exclusion helpers)**

In the Sidebar component, after `newFolderInputRef` (line 213), add:

```typescript
const [creatingSubfolderId, setCreatingSubfolderId] = useState<string | null>(null);
const [newSubfolderName, setNewSubfolderName] = useState('');
const [creatingSfSubfolderId, setCreatingSfSubfolderId] = useState<string | null>(null);

// 状態排他制御: ルート作成とサブフォルダ作成が同時にアクティブにならないようにする
const startRootFolderCreate = useCallback(() => {
  setCreatingFolder(true);
  setNewFolderName('');
  setCreatingSubfolderId(null);
  setNewSubfolderName('');
}, []);

const startSubfolderCreate = useCallback((parentId: string) => {
  setCreatingFolder(false);
  setNewFolderName('');
  setCreatingSubfolderId(parentId);
  setNewSubfolderName('');
  setExpandedFolderIds((prev) => new Set([...prev, parentId]));
}, []);
```

Also update the folder section "+" button (line 444) to use `startRootFolderCreate`:

```typescript
onClick={startRootFolderCreate}
```

And update the smart folder "+" button (line 498-499) to clear `creatingSfSubfolderId`:

```typescript
onClick={() => { setEditingSmartFolder(undefined); setCreatingSfSubfolderId(null); setShowSmartFolderEditor(true); }}
```

- [ ] **Step 2: Add subfolder create handler**

After `handleCreateFolder` callback, add:

```typescript
const handleCreateSubfolder = useCallback(async () => {
  const trimmed = newSubfolderName.trim();
  if (!trimmed || !creatingSubfolderId) {
    setCreatingSubfolderId(null);
    setNewSubfolderName('');
    return;
  }
  try {
    await tauriInvoke('create_folder', { name: trimmed, parentId: creatingSubfolderId });
    await fetchFolders();
    // Auto-expand parent
    setExpandedFolderIds((prev) => new Set([...prev, creatingSubfolderId!]));
    addToast(`サブフォルダ「${trimmed}」を作成しました`, 'success');
  } catch (e) {
    addToast(`サブフォルダ作成失敗: ${String(e)}`, 'error');
  }
  setCreatingSubfolderId(null);
  setNewSubfolderName('');
}, [newSubfolderName, creatingSubfolderId, fetchFolders, addToast]);
```

- [ ] **Step 3: Update folder context menu to include "サブフォルダを作成"**

Replace `handleFolderContextMenu` (lines 299-312). The new version computes depth from the tree and conditionally shows "サブフォルダを作成":

```typescript
const handleFolderContextMenu = useCallback(
  (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    // Compute depth by walking parent_id
    let depth = 0;
    let currentPid = folder.parent_id;
    const folderMap = new Map(folders.map(f => [f.id, f]));
    while (currentPid) {
      depth++;
      const parent = folderMap.get(currentPid);
      currentPid = parent?.parent_id ?? null;
    }

    const items: MenuItem[] = [];
    if (depth < 2) {
      items.push({
        label: 'サブフォルダを作成',
        onClick: () => startSubfolderCreate(folder.id),
      });
    }
    items.push({ label: '名前変更', onClick: () => setEditingFolderId(folder.id) });
    items.push({ label: '削除', onClick: () => handleDeleteFolder(folder.id), separator: true });

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  },
  [handleDeleteFolder, folders],
);
```

- [ ] **Step 4: Add subfolder inline input in folder tree rendering**

In the folder tree rendering section (Task 7 Step 4), modify the `renderFolderNodes` function to add an inline input after the expanded children when `creatingSubfolderId` matches:

```typescript
        function renderFolderNodes(nodes: FolderNode[]): React.ReactNode {
          return nodes.map((node) => (
            <div key={node.folder.id}>
              <FolderItem
                folder={node.folder}
                depth={node.depth}
                hasChildren={node.children.length > 0 || creatingSubfolderId === node.folder.id}
                isExpanded={expandedFolderIds.has(node.folder.id)}
                activeFolderId={filter.folder_id}
                isEditing={editingFolderId === node.folder.id}
                isDropTarget={dropTargetFolderId === node.folder.id}
                onSelect={handleFolderSelect}
                onToggleExpand={toggleFolderExpand}
                onContextMenu={handleFolderContextMenu}
                onRenameCommit={handleRenameCommit}
                onRenameCancel={() => setEditingFolderId(null)}
                onDragOver={handleFolderDragOver}
                onDragLeave={handleFolderDragLeave}
                onDrop={handleFolderDrop}
              />
              {expandedFolderIds.has(node.folder.id) && (
                <>
                  {node.children.length > 0 && renderFolderNodes(node.children)}
                  {creatingSubfolderId === node.folder.id && (
                    <div style={{ padding: '4px 10px', paddingLeft: 12 + (node.depth + 1) * 16 }}>
                      <input
                        autoFocus
                        value={newSubfolderName}
                        onChange={(e) => setNewSubfolderName(e.target.value)}
                        onBlur={handleCreateSubfolder}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleCreateSubfolder();
                          if (e.key === 'Escape') { setCreatingSubfolderId(null); setNewSubfolderName(''); }
                        }}
                        placeholder="サブフォルダ名"
                        style={{
                          width: '100%',
                          padding: '4px 8px',
                          fontSize: 13,
                          borderRadius: 4,
                          border: '1px solid var(--accent)',
                          background: 'var(--bg-tertiary)',
                          color: 'var(--text-primary)',
                          outline: 'none',
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          ));
        }
```

- [ ] **Step 5: Update smart folder context menu to include "サブスマートフォルダを作成"**

Replace `handleSmartFolderContextMenu` (lines 340-359):

```typescript
const handleSmartFolderContextMenu = useCallback(
  (e: React.MouseEvent, sf: SmartFolder) => {
    e.preventDefault();
    let depth = 0;
    let currentPid = sf.parent_id;
    const sfMap = new Map(smartFolders.map(s => [s.id, s]));
    while (currentPid) {
      depth++;
      const parent = sfMap.get(currentPid);
      currentPid = parent?.parent_id ?? null;
    }

    const items: MenuItem[] = [];
    if (depth < 2) {
      items.push({
        label: 'サブスマートフォルダを作成',
        onClick: () => {
          setCreatingSfSubfolderId(sf.id);
          setEditingSmartFolder(undefined);
          setShowSmartFolderEditor(true);
          setExpandedSmartFolderIds((prev) => new Set([...prev, sf.id]));
        },
      });
    }
    items.push({
      label: '編集',
      onClick: () => {
        setEditingSmartFolder(sf);
        setShowSmartFolderEditor(true);
      },
    });
    items.push({ label: '削除', onClick: () => handleDeleteSmartFolder(sf.id), separator: true });

    setContextMenu({ x: e.clientX, y: e.clientY, items });
  },
  [handleDeleteSmartFolder, smartFolders],
);
```

- [ ] **Step 6: Fix handleDeleteFolder/handleDeleteSmartFolder to reset filter when child was selected**

Replace `handleDeleteFolder` (Sidebar.tsx lines 282-296) to check if the active filter's folder still exists after deletion:

```typescript
const handleDeleteFolder = useCallback(
  async (folderId: string) => {
    try {
      await tauriInvoke('delete_folder', { id: folderId });
      await fetchFolders();
      // 削除されたフォルダまたはその子孫が選択中ならフィルタリセット
      const currentFolders = useLibraryStore.getState().folders;
      if (filter.folder_id && !currentFolders.find(f => f.id === filter.folder_id)) {
        resetFilter();
      }
      addToast('フォルダを削除しました', 'success');
    } catch (e) {
      addToast(`フォルダ削除失敗: ${String(e)}`, 'error');
    }
  },
  [fetchFolders, filter.folder_id, resetFilter, addToast],
);
```

Similarly update `handleDeleteSmartFolder`:

```typescript
const handleDeleteSmartFolder = useCallback(
  async (sfId: string) => {
    try {
      await tauriInvoke('delete_smart_folder', { id: sfId });
      await fetchSmartFolders();
      const currentSfs = useLibraryStore.getState().smartFolders;
      if (filter.smart_folder_id && !currentSfs.find(sf => sf.id === filter.smart_folder_id)) {
        resetFilter();
      }
      addToast('スマートフォルダを削除しました', 'success');
    } catch (e) {
      addToast(`スマートフォルダ削除失敗: ${String(e)}`, 'error');
    }
  },
  [fetchSmartFolders, filter.smart_folder_id, resetFilter, addToast],
);
```

- [ ] **Step 7: Pass parentId to SmartFolderEditor**

Update the SmartFolderEditor render at the bottom of Sidebar's JSX:

```typescript
      {showSmartFolderEditor && (
        <SmartFolderEditor
          existing={editingSmartFolder}
          parentId={creatingSfSubfolderId}
          onClose={() => { setShowSmartFolderEditor(false); setCreatingSfSubfolderId(null); }}
        />
      )}
```

- [ ] **Step 8: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: Errors about SmartFolderEditor not accepting `parentId` prop (will fix in Task 9)

- [ ] **Step 9: Commit**

```bash
git add src/components/library/Sidebar.tsx
git commit -m "feat: context menu subfolder creation, state exclusion, filter reset on delete"
```

---

### Task 9: SmartFolderEditor — parentId サポート

**Files:**
- Modify: `src/components/library/SmartFolderEditor.tsx:25-30` (props), `src/components/library/SmartFolderEditor.tsx:128-173` (handleSave)

- [ ] **Step 1: Add parentId to SmartFolderEditorProps**

In `src/components/library/SmartFolderEditor.tsx`, change `SmartFolderEditorProps` (lines 25-30):

```typescript
interface SmartFolderEditorProps {
  /** Pass an existing smart folder to edit, or omit to create new. */
  existing?: SmartFolder;
  /** Parent smart folder ID when creating a sub-smart-folder. */
  parentId?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}
```

- [ ] **Step 2: Update component signature and handleSave**

Add `parentId` to destructured props (line 88):

```typescript
export default function SmartFolderEditor({
  existing,
  parentId,
  onClose,
  onSaved,
}: SmartFolderEditorProps) {
```

In `handleSave`, update the create branch (line 160) to pass `parentId`:

```typescript
      } else {
        await tauriInvoke('create_smart_folder', {
          name: name.trim(),
          conditions,
          parentId: parentId ?? null,
        });
        addToast('スマートフォルダを作成しました', 'success');
      }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/library/SmartFolderEditor.tsx
git commit -m "feat: SmartFolderEditor supports parentId for sub-smart-folders"
```

---

### Task 10: 統合テストと最終確認

**Files:**
- Test: `src-tauri/src/db/queries.rs` (tests section)

- [ ] **Step 1: Write integration tests**

In `src-tauri/src/db/queries.rs` tests:

```rust
#[test]
fn test_create_folder_max_depth_3() {
    let conn = setup_db();
    let root = create_folder(&conn, "Level0", None).unwrap();
    let child = create_folder(&conn, "Level1", Some(&root.id)).unwrap();
    let grandchild = create_folder(&conn, "Level2", Some(&child.id)).unwrap();
    assert_eq!(get_folder_depth(&conn, &grandchild.id).unwrap(), 2);
    assert_eq!(get_folder_depth(&conn, &child.id).unwrap(), 1);
}

#[test]
fn test_smart_folder_3_level_hierarchy() {
    let conn = setup_db();
    let root = create_smart_folder_with_parent(&conn, "L0", r#"{"match":"all","rules":[]}"#, None).unwrap();
    let child = create_smart_folder_with_parent(&conn, "L1", r#"{"match":"all","rules":[]}"#, Some(&root.id)).unwrap();
    let grandchild = create_smart_folder_with_parent(&conn, "L2", r#"{"match":"all","rules":[]}"#, Some(&child.id)).unwrap();
    assert_eq!(get_smart_folder_depth(&conn, &grandchild.id).unwrap(), 2);
}

#[test]
fn test_delete_folder_recursive_with_archives() {
    let conn = setup_db();
    let root = create_folder(&conn, "Root", None).unwrap();
    let child = create_folder(&conn, "Child", Some(&root.id)).unwrap();

    let archive = make_test_archive("a1", "Test");
    insert_archive(&conn, &archive).unwrap();
    move_archives_to_folder(&conn, &["a1".to_string()], &child.id).unwrap();

    delete_folder_recursive(&conn, &root.id).unwrap();

    // Folders gone
    assert!(get_folders(&conn).unwrap().is_empty());
    // Archive still exists (only junction row deleted)
    let a = get_archive_by_id(&conn, "a1").unwrap();
    assert_eq!(a.id, "a1");
}

#[test]
fn test_delete_folder_recursive_preserves_archive_in_other_folder() {
    let conn = setup_db();
    let folder_a = create_folder(&conn, "FolderA", None).unwrap();
    let folder_b = create_folder(&conn, "FolderB", None).unwrap();

    let archive = make_test_archive("a1", "Test");
    insert_archive(&conn, &archive).unwrap();
    move_archives_to_folder(&conn, &["a1".to_string()], &folder_a.id).unwrap();
    move_archives_to_folder(&conn, &["a1".to_string()], &folder_b.id).unwrap();

    delete_folder_recursive(&conn, &folder_a.id).unwrap();

    // Archive still in folder_b
    let folders = get_folders_for_archive(&conn, "a1").unwrap();
    assert_eq!(folders.len(), 1);
    assert_eq!(folders[0].id, folder_b.id);
}

#[test]
fn test_smart_folder_3_level_condition_inheritance() {
    let conn = setup_db();

    let a1 = make_test_archive("a1", "Manga1");
    insert_archive(&conn, &a1).unwrap();
    update_archive(&conn, "a1", &ArchiveUpdate { title: None, rank: Some(5), memo: None, is_read: None }).unwrap();
    let tag = create_tag(&conn, "shounen").unwrap();
    set_archive_tags(&conn, "a1", &[tag.id.clone()]).unwrap();

    let a2 = make_test_archive("a2", "Manga2");
    insert_archive(&conn, &a2).unwrap();
    update_archive(&conn, "a2", &ArchiveUpdate { title: None, rank: Some(5), memo: None, is_read: None }).unwrap();
    // a2 has no tags

    // Grandparent: tag contains "shounen"
    let gp = create_smart_folder_with_parent(
        &conn, "GP", r#"{"match":"all","rules":[{"field":"tag","op":"contains","value":"shounen"}]}"#, None,
    ).unwrap();
    // Parent: rank >= 3
    let parent = create_smart_folder_with_parent(
        &conn, "Parent", r#"{"match":"all","rules":[{"field":"rank","op":"gte","value":3}]}"#, Some(&gp.id),
    ).unwrap();
    // Child: rank <= 5 (should AND all three: tag shounen AND rank >= 3 AND rank <= 5)
    let child = create_smart_folder_with_parent(
        &conn, "Child", r#"{"match":"all","rules":[{"field":"rank","op":"lte","value":5}]}"#, Some(&parent.id),
    ).unwrap();

    let filter = ArchiveFilter {
        smart_folder_id: Some(child.id),
        folder_id: None, preset: None, sort_by: None, sort_order: None,
        filter_tags: None, filter_min_rank: None, search_query: None,
    };
    let results = get_archive_summaries_filtered(&conn, &filter).unwrap();
    // Only a1 matches (has shounen tag + rank 5). a2 has rank 5 but no shounen tag.
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, "a1");
}
```

- [ ] **Step 2: Run all Rust tests**

Run: `cd src-tauri && cargo test -- --nocapture`
Expected: ALL PASS

- [ ] **Step 3: Run frontend type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Start dev server and verify in browser**

Run: `npx tauri dev`

Manual checks:
1. サイドバーのフォルダが▶/▼でツリー表示されること
2. フォルダ右クリック →「サブフォルダを作成」が表示されること
3. サブフォルダ作成後、親フォルダ下にインデント表示されること
4. スマートフォルダも同様にサブフォルダが作成できること
5. 3階層目のフォルダの右クリックに「サブフォルダを作成」が**表示されない**こと
6. 親フォルダを削除すると子孫フォルダも削除されること
7. 子スマートフォルダをクリックすると、親の条件も含めてフィルタが適用されること

- [ ] **Step 5: Commit integration tests**

```bash
git add src-tauri/src/db/queries.rs
git commit -m "test: integration tests for depth limit, recursive delete, hierarchy"
```

- [ ] **Step 6: Final commit tag**

```bash
git tag v0.8.0-subdirectory
```
