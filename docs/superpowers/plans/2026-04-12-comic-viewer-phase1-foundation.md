# ComicViewer Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tauri v2 + React + TypeScript + Rust のプロジェクトスキャフォールド、SQLite DB層、アプリ設定、エラーハンドリングを構築し、空のウィンドウが起動する状態にする

**Architecture:** Tauri v2のバックエンドはRustでDB・ファイル処理を担当、フロントエンドはReact+TypeScriptで純粋なUI層。SQLiteはMutex<Connection>でState管理。アプリ設定は%APPDATA%のconfig.jsonで管理。

**Tech Stack:** Tauri v2, React 18, TypeScript, Rust, rusqlite, thiserror, serde, uuid, chrono

**PRD参照:** `docs/superpowers/specs/2026-04-12-comic-viewer-design.md`

---

## File Structure (Phase 1)

```
comic-viewer/
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   ├── main.rs              — Tauriエントリポイント、State登録
│   │   ├── error.rs             — AppError enum (thiserror + Serialize)
│   │   ├── config.rs            — %APPDATA%/ComicViewer/config.json 管理
│   │   ├── commands/
│   │   │   ├── mod.rs           — コマンドモジュール公開
│   │   │   └── library.rs       — init_library, get_library_path コマンド
│   │   └── db/
│   │       ├── mod.rs           — DbState (Mutex<Connection>)、初期化
│   │       ├── models.rs        — Rust構造体 (Archive, Folder, Tag, etc.)
│   │       ├── migrations.rs    — PRAGMA user_version ベースのマイグレーション
│   │       └── queries.rs       — 基本CRUDクエリ関数
├── src/
│   ├── App.tsx                  — ルーティングのシェル
│   ├── main.tsx                 — Reactエントリポイント
│   ├── types/
│   │   └── index.ts             — TypeScript型定義
│   ├── styles/
│   │   └── global.css           — ダークテーマCSS基盤
│   └── pages/
│       └── LibraryPage.tsx      — 空のプレースホルダー
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

---

### Task 1: Tauri v2 + React プロジェクト初期化

**Files:**
- Create: プロジェクト全体のスキャフォールド

- [ ] **Step 1: Tauriプロジェクトを作成**

```bash
cd d:/Dev/App/ComicViewer
npm create tauri-app@latest . -- --template react-ts --manager npm
```

プロンプトで以下を選択:
- Project name: comic-viewer
- Frontend: React + TypeScript (Vite)

- [ ] **Step 2: 追加のRust依存を追加**

`src-tauri/Cargo.toml` の `[dependencies]` セクションに以下を追加:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
rusqlite = { version = "0.31", features = ["bundled"] }
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }
thiserror = "1"
```

- [ ] **Step 3: npm依存を追加**

```bash
cd d:/Dev/App/ComicViewer
npm install zustand react-router-dom
npm install -D @types/react-router-dom
```

- [ ] **Step 4: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
npm run tauri dev
```

Expected: Tauri のデフォルトウィンドウが起動する

- [ ] **Step 5: git init & コミット**

```bash
cd d:/Dev/App/ComicViewer
git init
echo "node_modules/\ntarget/\ndist/\n.superpowers/" > .gitignore
git add -A
git commit -m "feat: initialize Tauri v2 + React + TypeScript project"
```

---

### Task 2: AppError 定義

**Files:**
- Create: `src-tauri/src/error.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: error.rs を作成**

```rust
// src-tauri/src/error.rs
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
```

- [ ] **Step 2: main.rs に mod error を追加**

```rust
// src-tauri/src/main.rs
mod error;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功

- [ ] **Step 4: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/error.rs src-tauri/src/main.rs
git commit -m "feat: add AppError type with thiserror + Serialize"
```

---

### Task 3: アプリ設定管理 (config.json)

**Files:**
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: config.rs を作成**

```rust
// src-tauri/src/config.rs
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
pub struct AppConfig {
    pub library_path: Option<String>,
    #[serde(default)]
    pub window_state: WindowState,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            library_path: None,
            window_state: WindowState::default(),
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
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| AppError::FileIO(e.to_string()))?;
    fs::write(config_path()?, content)?;
    Ok(())
}
```

- [ ] **Step 2: main.rs に mod config を追加**

```rust
// src-tauri/src/main.rs
mod config;
mod error;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功

- [ ] **Step 4: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/config.rs src-tauri/src/main.rs
git commit -m "feat: add app config management (config.json in APPDATA)"
```

---

### Task 4: DB モデル定義

**Files:**
- Create: `src-tauri/src/db/mod.rs`
- Create: `src-tauri/src/db/models.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: db/models.rs を作成**

```rust
// src-tauri/src/db/models.rs
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Archive {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub file_path: String,
    pub file_size: i64,
    pub page_count: i32,
    pub format: String,
    pub thumbnail_path: Option<String>,
    pub rank: i32,
    pub memo: String,
    pub is_read: bool,
    pub last_read_page: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveSummary {
    pub id: String,
    pub title: String,
    pub thumbnail_path: Option<String>,
    pub rank: i32,
    pub is_read: bool,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveDetail {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub file_size: i64,
    pub page_count: i32,
    pub format: String,
    pub thumbnail_path: Option<String>,
    pub rank: i32,
    pub memo: String,
    pub is_read: bool,
    pub last_read_page: i32,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<Tag>,
    pub folders: Vec<Folder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveUpdate {
    pub title: Option<String>,
    pub rank: Option<i32>,
    pub memo: Option<String>,
    pub is_read: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveFilter {
    pub folder_id: Option<String>,
    pub smart_folder_id: Option<String>,
    pub preset: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub filter_tags: Option<Vec<String>>,
    pub filter_min_rank: Option<i32>,
    pub search_query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub conditions: String,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolderConditions {
    pub r#match: String,
    pub rules: Vec<SmartFolderRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolderRule {
    pub field: String,
    pub op: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageInfo {
    pub index: usize,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub is_spread: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub enum DropTarget {
    Library,
    Folder(String),
}

#[derive(Debug, Clone, Deserialize)]
pub enum DragTarget {
    Folder(String),
    SmartFolder(String),
    Tag(String),
}
```

- [ ] **Step 2: db/mod.rs を作成**

```rust
// src-tauri/src/db/mod.rs
pub mod models;
pub mod migrations;
pub mod queries;

use crate::error::AppError;
use rusqlite::Connection;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

impl DbState {
    pub fn new(db_path: &str) -> Result<Self, AppError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        migrations::run(&conn)?;
        Ok(Self(Mutex::new(conn)))
    }
}
```

- [ ] **Step 3: main.rs を更新**

```rust
// src-tauri/src/main.rs
mod config;
mod db;
mod error;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功（migrations.rs, queries.rs が未作成のためエラーになる場合は Step 5 のあとに確認）

- [ ] **Step 5: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/db/
git commit -m "feat: add DB models and DbState with Mutex<Connection>"
```

---

### Task 5: DB マイグレーション

**Files:**
- Create: `src-tauri/src/db/migrations.rs`

- [ ] **Step 1: migrations.rs を作成**

```rust
// src-tauri/src/db/migrations.rs
use crate::error::AppError;
use rusqlite::Connection;

const CURRENT_VERSION: i32 = 1;

pub fn run(conn: &Connection) -> Result<(), AppError> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

    if version < 1 {
        migrate_v1(conn)?;
    }

    Ok(())
}

fn migrate_v1(conn: &Connection) -> Result<(), AppError> {
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

        PRAGMA user_version = 1;
        ",
    )?;

    Ok(())
}
```

- [ ] **Step 2: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功

- [ ] **Step 3: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/db/migrations.rs
git commit -m "feat: add SQLite migration v1 with all tables and indexes"
```

---

### Task 6: DB クエリ関数

**Files:**
- Create: `src-tauri/src/db/queries.rs`

- [ ] **Step 1: queries.rs を作成（アーカイブ基本CRUD）**

```rust
// src-tauri/src/db/queries.rs
use crate::db::models::*;
use crate::error::AppError;
use chrono::Utc;
use rusqlite::{params, Connection};
use uuid::Uuid;

// === Archives ===

pub fn insert_archive(conn: &Connection, archive: &Archive) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO archives (id, title, file_name, file_path, file_size, page_count, format, thumbnail_path, rank, memo, is_read, last_read_page, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            archive.id, archive.title, archive.file_name, archive.file_path,
            archive.file_size, archive.page_count, archive.format, archive.thumbnail_path,
            archive.rank, archive.memo, archive.is_read as i32, archive.last_read_page,
            archive.created_at, archive.updated_at,
        ],
    )?;
    Ok(())
}

pub fn get_archive_summaries(conn: &Connection) -> Result<Vec<ArchiveSummary>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, thumbnail_path, rank, is_read, format FROM archives ORDER BY title",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(ArchiveSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            thumbnail_path: row.get(2)?,
            rank: row.get(3)?,
            is_read: row.get::<_, i32>(4)? != 0,
            format: row.get(5)?,
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
        "SELECT id, title, file_name, file_path, file_size, page_count, format, thumbnail_path, rank, memo, is_read, last_read_page, created_at, updated_at
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
                created_at: row.get(12)?,
                updated_at: row.get(13)?,
            })
        },
    )
    .map_err(|e| AppError::Database(e.to_string()))
}

pub fn update_archive(conn: &Connection, id: &str, update: &ArchiveUpdate) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    if let Some(ref title) = update.title {
        conn.execute("UPDATE archives SET title = ?1, updated_at = ?2 WHERE id = ?3", params![title, now, id])?;
    }
    if let Some(rank) = update.rank {
        conn.execute("UPDATE archives SET rank = ?1, updated_at = ?2 WHERE id = ?3", params![rank, now, id])?;
    }
    if let Some(ref memo) = update.memo {
        conn.execute("UPDATE archives SET memo = ?1, updated_at = ?2 WHERE id = ?3", params![memo, now, id])?;
    }
    if let Some(is_read) = update.is_read {
        conn.execute("UPDATE archives SET is_read = ?1, updated_at = ?2 WHERE id = ?3", params![is_read as i32, now, id])?;
    }
    Ok(())
}

pub fn delete_archives(conn: &Connection, ids: &[String]) -> Result<(), AppError> {
    for id in ids {
        conn.execute("DELETE FROM archives WHERE id = ?1", params![id])?;
    }
    Ok(())
}

pub fn save_read_position(conn: &Connection, archive_id: &str, page: i32) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE archives SET last_read_page = ?1, is_read = 1, updated_at = ?2 WHERE id = ?3",
        params![page, now, archive_id],
    )?;
    Ok(())
}

// === Folders ===

pub fn get_folders(conn: &Connection) -> Result<Vec<Folder>, AppError> {
    let mut stmt = conn.prepare("SELECT id, name, parent_id, sort_order, created_at FROM folders ORDER BY sort_order")?;
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

pub fn create_folder(conn: &Connection, name: &str, parent_id: Option<&str>) -> Result<Folder, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, sort_order, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
        params![id, name, parent_id, now],
    )?;
    Ok(Folder { id, name: name.to_string(), parent_id: parent_id.map(|s| s.to_string()), sort_order: 0, created_at: now })
}

pub fn delete_folder(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn move_archives_to_folder(conn: &Connection, archive_ids: &[String], folder_id: &str) -> Result<(), AppError> {
    for archive_id in archive_ids {
        conn.execute(
            "INSERT OR IGNORE INTO archive_folders (archive_id, folder_id) VALUES (?1, ?2)",
            params![archive_id, folder_id],
        )?;
    }
    Ok(())
}

// === Tags ===

pub fn get_tags(conn: &Connection) -> Result<Vec<Tag>, AppError> {
    let mut stmt = conn.prepare("SELECT id, name FROM tags ORDER BY name")?;
    let rows = stmt.query_map([], |row| {
        Ok(Tag { id: row.get(0)?, name: row.get(1)? })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn create_tag(conn: &Connection, name: &str) -> Result<Tag, AppError> {
    let id = Uuid::new_v4().to_string();
    conn.execute("INSERT INTO tags (id, name) VALUES (?1, ?2)", params![id, name])?;
    Ok(Tag { id, name: name.to_string() })
}

pub fn delete_tag(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn set_archive_tags(conn: &Connection, archive_id: &str, tag_ids: &[String]) -> Result<(), AppError> {
    conn.execute("DELETE FROM archive_tags WHERE archive_id = ?1", params![archive_id])?;
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
        Ok(Tag { id: row.get(0)?, name: row.get(1)? })
    })?;
    let mut results = Vec::new();
    for row in rows {
        results.push(row?);
    }
    Ok(results)
}

pub fn get_folders_for_archive(conn: &Connection, archive_id: &str) -> Result<Vec<Folder>, AppError> {
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
    let mut stmt = conn.prepare("SELECT id, name, conditions, sort_order, created_at FROM smart_folders ORDER BY sort_order")?;
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

pub fn create_smart_folder(conn: &Connection, name: &str, conditions: &str) -> Result<SmartFolder, AppError> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO smart_folders (id, name, conditions, sort_order, created_at) VALUES (?1, ?2, ?3, 0, ?4)",
        params![id, name, conditions, now],
    )?;
    Ok(SmartFolder { id, name: name.to_string(), conditions: conditions.to_string(), sort_order: 0, created_at: now })
}

pub fn delete_smart_folder(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM smart_folders WHERE id = ?1", params![id])?;
    Ok(())
}

// === Settings ===

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    let result = conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    );
    match result {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Database(e.to_string())),
    }
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}
```

- [ ] **Step 2: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功

- [ ] **Step 3: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/db/queries.rs
git commit -m "feat: add CRUD query functions for all tables"
```

---

### Task 7: ライブラリ初期化コマンド

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/library.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: commands/library.rs を作成**

```rust
// src-tauri/src/commands/library.rs
use crate::config::{load_config, save_config};
use crate::db::DbState;
use crate::error::AppError;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn get_library_path() -> Result<Option<String>, AppError> {
    let config = load_config()?;
    Ok(config.library_path)
}

#[tauri::command]
pub fn init_library(path: String, state: tauri::State<'_, Option<DbState>>) -> Result<(), AppError> {
    let library_path = Path::new(&path);

    // サブディレクトリを作成
    fs::create_dir_all(library_path.join("db"))?;
    fs::create_dir_all(library_path.join("thumbnails"))?;
    fs::create_dir_all(library_path.join("archives"))?;
    fs::create_dir_all(library_path.join("temp"))?;

    // config.json にライブラリパスを保存
    let mut config = load_config()?;
    config.library_path = Some(path.replace('\\', "/"));
    save_config(&config)?;

    Ok(())
}
```

- [ ] **Step 2: commands/mod.rs を作成**

```rust
// src-tauri/src/commands/mod.rs
pub mod library;
```

- [ ] **Step 3: main.rs を更新（コマンド登録 + State管理 + DB初期化）**

```rust
// src-tauri/src/main.rs
mod commands;
mod config;
mod db;
mod error;

use config::load_config;
use db::DbState;

fn main() {
    let config = load_config().unwrap_or_default();

    // ライブラリパスが設定済みならDBを初期化
    let db_state: Option<DbState> = config.library_path.as_ref().and_then(|lib_path| {
        let db_path = format!("{}/db/library.db", lib_path);
        DbState::new(&db_path).ok()
    });

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::library::get_library_path,
            commands::library::init_library,
        ]);

    if let Some(db) = db_state {
        builder = builder.manage(db);
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 4: ビルド確認**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml
```

Expected: コンパイル成功

- [ ] **Step 5: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src-tauri/src/commands/ src-tauri/src/main.rs
git commit -m "feat: add library init command with DB initialization"
```

---

### Task 8: フロントエンド基盤（ダークテーマ + TypeScript型 + 空のライブラリページ）

**Files:**
- Create/Modify: `src/styles/global.css`
- Create: `src/types/index.ts`
- Create: `src/pages/LibraryPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src-tauri/tauri.conf.json` (asset protocol設定)

- [ ] **Step 1: tauri.conf.json の security セクションを更新**

`src-tauri/tauri.conf.json` を開き、`app.security` セクションに以下を設定:

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; img-src 'self' asset: http://asset.localhost; style-src 'self' 'unsafe-inline'",
      "assetProtocol": {
        "enable": true,
        "scope": ["**"]
      }
    }
  }
}
```

- [ ] **Step 2: global.css を作成**

```css
/* src/styles/global.css */
:root {
  --bg-primary: #0e0e1a;
  --bg-secondary: #12122a;
  --bg-tertiary: #16162a;
  --bg-card: #2a2a4a;
  --bg-hover: #3a3a5a;
  --bg-selected: #3a3a5a;
  --border-color: #2a2a3a;
  --border-selected: #6a6aaa;
  --text-primary: #eeeeee;
  --text-secondary: #aaaaaa;
  --text-muted: #888888;
  --text-dim: #666666;
  --accent: #6a6aaa;
  --accent-hover: #8a8acc;
  --star-color: #f5a623;
  --font-family: 'Segoe UI', 'Meiryo', sans-serif;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: var(--font-family);
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
  user-select: none;
}

::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}

::-webkit-scrollbar-thumb {
  background: var(--bg-card);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 3: types/index.ts を作成**

```typescript
// src/types/index.ts
export interface ArchiveSummary {
  id: string;
  title: string;
  thumbnail_path: string | null;
  rank: number;
  is_read: boolean;
  format: string;
}

export interface ArchiveDetail {
  id: string;
  title: string;
  file_name: string;
  file_size: number;
  page_count: number;
  format: string;
  thumbnail_path: string | null;
  rank: number;
  memo: string;
  is_read: boolean;
  last_read_page: number;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  folders: Folder[];
}

export interface ArchiveUpdate {
  title?: string;
  rank?: number;
  memo?: string;
  is_read?: boolean;
}

export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface Tag {
  id: string;
  name: string;
}

export interface SmartFolder {
  id: string;
  name: string;
  conditions: string;
  sort_order: number;
  created_at: string;
}

export interface PageInfo {
  index: number;
  url: string;
  width: number;
  height: number;
  is_spread: boolean;
}
```

- [ ] **Step 4: LibraryPage.tsx を作成（空のプレースホルダー）**

```tsx
// src/pages/LibraryPage.tsx
export default function LibraryPage() {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      color: 'var(--text-muted)',
      fontSize: '16px',
    }}>
      ComicViewer — ファイルをドラッグ&ドロップして追加
    </div>
  );
}
```

- [ ] **Step 5: App.tsx を更新**

```tsx
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LibraryPage from './pages/LibraryPage';
import './styles/global.css';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LibraryPage />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6: main.tsx を更新**

```tsx
// src/main.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 7: 動作確認**

```bash
cd d:/Dev/App/ComicViewer
npm run tauri dev
```

Expected: ダークテーマの背景にプレースホルダーテキストが表示されたウィンドウが起動

- [ ] **Step 8: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/ src-tauri/tauri.conf.json
git commit -m "feat: add dark theme, TypeScript types, and empty library page"
```

---

## Phase 1 完了基準

- [x] Tauri v2 + React + TypeScript プロジェクトがビルド・起動できる
- [x] AppError が定義され、Serialize を実装している
- [x] %APPDATA%/ComicViewer/config.json でライブラリパスを管理
- [x] SQLite DB が PRAGMA user_version ベースのマイグレーションで初期化できる
- [x] 全テーブル（archives, folders, tags, smart_folders, settings 等）の CRUD クエリが実装済み
- [x] DbState (Mutex<Connection>) で Tauri State 管理
- [x] ダークテーマ CSS が適用された空のウィンドウが表示される
- [x] TypeScript 型定義が PRD のデータモデルと一致している
