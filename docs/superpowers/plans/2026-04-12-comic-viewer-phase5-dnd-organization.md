# ComicViewer Phase 5: Drag & Drop, Organization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 外部D&D（ファイルインポート）、内部D&D（フォルダ/タグ分類）、フォルダ/タグ/スマートフォルダの管理UI、右クリックメニュー、起動時整合性チェック、File Watcherを実装し、製品として完成させる

**Architecture:** 外部D&Dは `listen('tauri://drag-drop')` でイベント受信しTauriコマンドに橋渡し。内部D&DはHTML5 Drag APIでサイドバーへのドロップを検出。File Watcherは`notify`クレートでバックグラウンド監視。

**Tech Stack:** React, TypeScript, @tauri-apps/api, notify (Rust)

**PRD参照:** `docs/superpowers/specs/2026-04-12-comic-viewer-design.md` セクション 8, 9.6

**前提:** Phase 1〜4 が完了していること

---

## File Structure (Phase 5)

```
src-tauri/src/
├── commands/
│   └── drag_drop.rs         — import_dropped_files, handle_internal_drag
├── library/
│   ├── watcher.rs           — File Watcher (notify)
│   └── integrity.rs         — 起動時整合性チェック
src/
├── hooks/
│   └── useDragDrop.ts       — D&Dイベントリスナー
├── components/
│   ├── common/
│   │   ├── DragDropZone.tsx  — ドロップゾーンオーバーレイ
│   │   └── ContextMenu.tsx  — 右クリックメニュー
│   ├── library/
│   │   ├── TagEditor.tsx    — タグ編集ダイアログ
│   │   └── SmartFolderEditor.tsx — スマートフォルダ条件設定
```

---

### Task 1: D&D Tauri コマンド

**Files:**
- Create: `src-tauri/src/commands/drag_drop.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: commands/drag_drop.rs を作成**

```rust
// src-tauri/src/commands/drag_drop.rs
use crate::config::load_config;
use crate::db::models::*;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use crate::library::import;
use std::path::PathBuf;

fn get_library_root() -> Result<PathBuf, AppError> {
    let config = load_config()?;
    let path = config.library_path.ok_or(AppError::LibraryNotFound)?;
    Ok(PathBuf::from(path))
}

#[tauri::command]
pub fn import_dropped_files(
    file_paths: Vec<String>,
    target: DropTarget,
    state: tauri::State<'_, DbState>,
) -> Result<Vec<Archive>, AppError> {
    let library_path = get_library_root()?;
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;

    let folder_id = match &target {
        DropTarget::Library => None,
        DropTarget::Folder(id) => Some(id.as_str()),
    };

    import::import_files(&conn, &file_paths, &library_path, folder_id)
}

#[tauri::command]
pub fn handle_internal_drag(
    archive_ids: Vec<String>,
    target: DragTarget,
    state: tauri::State<'_, DbState>,
) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;

    match target {
        DragTarget::Folder(folder_id) => {
            queries::move_archives_to_folder(&conn, &archive_ids, &folder_id)?;
        }
        DragTarget::Tag(tag_id) => {
            for archive_id in &archive_ids {
                let mut existing_tags = queries::get_tags_for_archive(&conn, archive_id)?;
                let tag_ids: Vec<String> = existing_tags.iter().map(|t| t.id.clone()).collect();
                if !tag_ids.contains(&tag_id) {
                    let mut new_ids = tag_ids;
                    new_ids.push(tag_id.clone());
                    queries::set_archive_tags(&conn, archive_id, &new_ids)?;
                }
            }
        }
        DragTarget::SmartFolder(sf_id) => {
            // スマートフォルダの条件からタグ条件のvalueを抽出して付与
            let smart_folders = queries::get_smart_folders(&conn)?;
            let sf = smart_folders.iter().find(|s| s.id == sf_id);
            if let Some(sf) = sf {
                if let Ok(conditions) = serde_json::from_str::<SmartFolderConditions>(&sf.conditions) {
                    let tag_values: Vec<String> = conditions.rules.iter()
                        .filter(|r| r.field == "tag")
                        .filter_map(|r| r.value.as_str().map(|s| s.to_string()))
                        .collect();

                    for tag_name in &tag_values {
                        // タグが存在しなければ作成
                        let all_tags = queries::get_tags(&conn)?;
                        let existing = all_tags.iter().find(|t| &t.name == tag_name);
                        let tag_id = if let Some(t) = existing {
                            t.id.clone()
                        } else {
                            let new_tag = queries::create_tag(&conn, tag_name)?;
                            new_tag.id
                        };

                        // 各アーカイブにタグ付与
                        for archive_id in &archive_ids {
                            let current_tags = queries::get_tags_for_archive(&conn, archive_id)?;
                            let current_ids: Vec<String> = current_tags.iter().map(|t| t.id.clone()).collect();
                            if !current_ids.contains(&tag_id) {
                                let mut new_ids = current_ids;
                                new_ids.push(tag_id.clone());
                                queries::set_archive_tags(&conn, archive_id, &new_ids)?;
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(())
}
```

- [ ] **Step 2: commands/mod.rs を更新**

```rust
// src-tauri/src/commands/mod.rs
pub mod archive;
pub mod drag_drop;
pub mod library;
pub mod viewer;
```

- [ ] **Step 3: main.rs にコマンド追加**

`invoke_handler` に追加:

```rust
commands::drag_drop::import_dropped_files,
commands::drag_drop::handle_internal_drag,
```

- [ ] **Step 4: ビルド確認して コミット**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml && git add src-tauri/src/commands/ src-tauri/src/main.rs && git commit -m "feat: add D&D commands (import_dropped_files, handle_internal_drag)"
```

---

### Task 2: フロントエンド D&D フック

**Files:**
- Create: `src/hooks/useDragDrop.ts`
- Create: `src/components/common/DragDropZone.tsx`

- [ ] **Step 1: useDragDrop.ts を作成**

```typescript
// src/hooks/useDragDrop.ts
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { tauriInvoke } from './useTauriCommand';
import { useLibraryStore } from '../stores/libraryStore';

interface DragDropPayload {
  paths: string[];
  position: { x: number; y: number };
}

export function useDragDrop() {
  const { fetchArchives } = useLibraryStore();
  const lastDropTime = useRef(0);
  const lastDropPaths = useRef<string[]>([]);

  useEffect(() => {
    const unlisten = listen<DragDropPayload>('tauri://drag-drop', async (event) => {
      const { paths, position } = event.payload;

      // デバウンス: 500ms以内の同一パスイベントを無視
      const now = Date.now();
      if (now - lastDropTime.current < 500 &&
          JSON.stringify(paths) === JSON.stringify(lastDropPaths.current)) {
        return;
      }
      lastDropTime.current = now;
      lastDropPaths.current = paths;

      // アーカイブファイルのみフィルタ
      const archiveFiles = paths.filter((p) => {
        const lower = p.toLowerCase();
        return lower.endsWith('.zip') || lower.endsWith('.cbz') || lower.endsWith('.cbr');
      });

      if (archiveFiles.length === 0) return;

      // ドロップ先を判定（positionのY座標でサイドバーのフォルダ要素を検出）
      const folderEl = document.elementFromPoint(position.x, position.y)?.closest('[data-folder-id]');
      const folderId = folderEl?.getAttribute('data-folder-id');

      const target = folderId
        ? { Folder: folderId }
        : 'Library';

      try {
        await tauriInvoke('import_dropped_files', { filePaths: archiveFiles, target });
        fetchArchives();
      } catch (e) {
        console.error('Import error:', e);
      }
    });

    return () => { unlisten.then((fn) => fn()); };
  }, [fetchArchives]);
}
```

- [ ] **Step 2: DragDropZone.tsx を作成**

```tsx
// src/components/common/DragDropZone.tsx
import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

export default function DragDropZone() {
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const enter = listen('tauri://drag-enter', () => setIsDragging(true));
    const leave = listen('tauri://drag-leave', () => setIsDragging(false));
    const drop = listen('tauri://drag-drop', () => setIsDragging(false));

    return () => {
      enter.then((fn) => fn());
      leave.then((fn) => fn());
      drop.then((fn) => fn());
    };
  }, []);

  if (!isDragging) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(106,106,170,0.15)',
      border: '3px dashed var(--accent)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <div style={{
        background: 'rgba(0,0,0,0.7)', padding: '20px 40px', borderRadius: 12,
        color: 'var(--text-primary)', fontSize: 16,
      }}>
        ファイルをドロップしてインポート
      </div>
    </div>
  );
}
```

- [ ] **Step 3: LibraryPage.tsx に D&D を統合**

`src/pages/LibraryPage.tsx` に追加:

```tsx
import { useDragDrop } from '../hooks/useDragDrop';
import DragDropZone from '../components/common/DragDropZone';

// LibraryPage 関数内に:
useDragDrop();

// return 内の最初に追加:
<DragDropZone />
```

- [ ] **Step 4: 動作確認してコミット**

```bash
cd d:/Dev/App/ComicViewer
npm run tauri dev
```

Expected: ZIPファイルをウィンドウにドラッグ→ハイライト表示→ドロップ→グリッドにサムネイル追加

```bash
git add src/hooks/useDragDrop.ts src/components/common/DragDropZone.tsx src/pages/LibraryPage.tsx
git commit -m "feat: add external file drag & drop with drop zone overlay"
```

---

### Task 3: 右クリック コンテキストメニュー

**Files:**
- Create: `src/components/common/ContextMenu.tsx`

- [ ] **Step 1: ContextMenu.tsx を作成**

```tsx
// src/components/common/ContextMenu.tsx
import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  onClick: () => void;
  separator?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left: x, top: y, zIndex: 200,
        background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
        borderRadius: 6, padding: '4px 0', minWidth: 160,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      }}
    >
      {items.map((item, i) => (
        item.separator ? (
          <div key={i} style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }} />
        ) : (
          <div
            key={i}
            onClick={() => { item.onClick(); onClose(); }}
            style={{
              padding: '6px 14px', fontSize: 12, color: 'var(--text-secondary)',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            {item.label}
          </div>
        )
      ))}
    </div>
  );
}
```

- [ ] **Step 2: ArchiveGrid に右クリック統合**

`src/components/library/ArchiveGrid.tsx` の ArchiveCard に `onContextMenu` を追加:

```tsx
// ArchiveCard の onContextMenu をグリッドで処理
onContextMenu={(e) => {
  e.preventDefault();
  // コンテキストメニューの表示をLibraryPageの状態で管理
  handleContextMenu(archive.id, e.clientX, e.clientY);
}}
```

- [ ] **Step 3: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/common/ContextMenu.tsx
git commit -m "feat: add right-click context menu component"
```

---

### Task 4: TagEditor コンポーネント

**Files:**
- Create: `src/components/library/TagEditor.tsx`

- [ ] **Step 1: TagEditor.tsx を作成**

```tsx
// src/components/library/TagEditor.tsx
import { useState } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import type { Tag } from '../../types';

interface TagEditorProps {
  archiveId: string;
  currentTags: Tag[];
  onClose: () => void;
  onSave: () => void;
}

export default function TagEditor({ archiveId, currentTags, onClose, onSave }: TagEditorProps) {
  const { tags: allTags, fetchTags } = useLibraryStore();
  const [selectedIds, setSelectedIds] = useState<string[]>(currentTags.map((t) => t.id));
  const [newTagName, setNewTagName] = useState('');

  const toggleTag = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleAddTag = async () => {
    if (!newTagName.trim()) return;
    try {
      const tag = await tauriInvoke<Tag>('create_tag', { name: newTagName.trim() });
      setSelectedIds((prev) => [...prev, tag.id]);
      setNewTagName('');
      fetchTags();
    } catch (e) {
      console.error('Failed to create tag:', e);
    }
  };

  const handleSave = async () => {
    try {
      await tauriInvoke('set_archive_tags', { archiveId, tagIds: selectedIds });
      onSave();
      onClose();
    } catch (e) {
      console.error('Failed to save tags:', e);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 300,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.5)',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-tertiary)', borderRadius: 8, padding: 16,
        width: 300, maxHeight: 400, overflowY: 'auto',
        border: '1px solid var(--border-color)',
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ color: 'var(--text-primary)', fontSize: 14, marginBottom: 12 }}>タグを編集</div>

        {/* 既存タグ */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
          {allTags.map((tag) => (
            <span
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
              style={{
                padding: '4px 10px', borderRadius: 12, fontSize: 11, cursor: 'pointer',
                background: selectedIds.includes(tag.id) ? 'var(--accent)' : 'var(--bg-card)',
                color: selectedIds.includes(tag.id) ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >{tag.name}</span>
          ))}
        </div>

        {/* 新規タグ */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          <input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
            placeholder="新しいタグ..."
            style={{
              flex: 1, background: 'var(--bg-card)', border: 'none', borderRadius: 4,
              padding: '6px 10px', color: 'var(--text-primary)', fontSize: 12, outline: 'none',
            }}
          />
          <button onClick={handleAddTag} style={{
            background: 'var(--accent)', border: 'none', borderRadius: 4,
            padding: '6px 12px', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer',
          }}>追加</button>
        </div>

        {/* 保存/キャンセル */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            background: 'var(--bg-card)', border: 'none', borderRadius: 4,
            padding: '6px 16px', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
          }}>キャンセル</button>
          <button onClick={handleSave} style={{
            background: 'var(--accent)', border: 'none', borderRadius: 4,
            padding: '6px 16px', color: 'var(--text-primary)', fontSize: 11, cursor: 'pointer',
          }}>保存</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: コミット**

```bash
cd d:/Dev/App/ComicViewer
git add src/components/library/TagEditor.tsx
git commit -m "feat: add TagEditor dialog with create, toggle, and save"
```

---

### Task 5: 起動時整合性チェック

**Files:**
- Create: `src-tauri/src/library/integrity.rs`
- Modify: `src-tauri/src/library/mod.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: integrity.rs を作成**

```rust
// src-tauri/src/library/integrity.rs
use crate::error::AppError;
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;

/// 起動時にDBとファイルシステムの整合性をチェック
pub fn check_integrity(conn: &Connection, library_path: &Path) -> Result<(), AppError> {
    // 1. temp/ をクリーンアップ
    let temp_dir = library_path.join("temp");
    if temp_dir.exists() {
        let _ = fs::remove_dir_all(&temp_dir);
        fs::create_dir_all(&temp_dir)?;
    }

    // 2. archives テーブルの各レコードをチェック
    let mut stmt = conn.prepare("SELECT id, file_path FROM archives")?;
    let rows: Vec<(String, String)> = stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    let mut missing_ids = Vec::new();
    for (id, file_path) in &rows {
        let abs_path = library_path.join(file_path);
        if !abs_path.exists() {
            missing_ids.push(id.clone());
        }
    }

    // 消失ファイルをDBから削除
    for id in &missing_ids {
        eprintln!("Integrity: archive missing, removing from DB: {}", id);
        conn.execute("DELETE FROM archives WHERE id = ?1", params![id])?;
        // サムネイルも削除
        let thumb = library_path.join("thumbnails").join(format!("{}.jpg", id));
        let _ = fs::remove_file(&thumb);
    }

    // 3. 孤立サムネイルのクリーンアップ
    let thumbnails_dir = library_path.join("thumbnails");
    if thumbnails_dir.exists() {
        for entry in fs::read_dir(&thumbnails_dir)? {
            let entry = entry?;
            let fname = entry.file_name().to_string_lossy().to_string();
            if let Some(id) = fname.strip_suffix(".jpg") {
                let exists: bool = conn
                    .query_row(
                        "SELECT COUNT(*) > 0 FROM archives WHERE id = ?1",
                        params![id],
                        |row| row.get(0),
                    )
                    .unwrap_or(false);
                if !exists {
                    let _ = fs::remove_file(entry.path());
                }
            }
        }
    }

    if !missing_ids.is_empty() {
        eprintln!("Integrity: removed {} missing archives", missing_ids.len());
    }

    Ok(())
}
```

- [ ] **Step 2: library/mod.rs を更新**

```rust
// src-tauri/src/library/mod.rs
pub mod import;
pub mod integrity;
```

- [ ] **Step 3: main.rs の DB初期化後に整合性チェックを追加**

main.rs のDB初期化部分を更新:

```rust
if let Some(ref lib_path) = config.library_path {
    let db_path = format!("{}/db/library.db", lib_path);
    match DbState::new(&db_path) {
        Ok(db) => {
            // 起動時整合性チェック
            if let Ok(conn) = db.0.lock() {
                let _ = library::integrity::check_integrity(&conn, &std::path::PathBuf::from(lib_path));
            }
            builder = builder.manage(db);
        }
        Err(e) => {
            eprintln!("DB初期化エラー: {}", e);
        }
    }
}
```

- [ ] **Step 4: ビルド確認してコミット**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml && git add src-tauri/src/library/ src-tauri/src/main.rs && git commit -m "feat: add startup integrity check (temp cleanup, missing files, orphan thumbnails)"
```

---

### Task 6: Folder/Tag CRUD コマンド（フロントエンドから呼べるように）

**Files:**
- Modify: `src-tauri/src/commands/library.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: commands/library.rs にフォルダ/タグ/スマートフォルダのコマンドを追加**

```rust
// src-tauri/src/commands/library.rs に追加

use crate::db::models::*;
use crate::db::queries;
use crate::db::DbState;

#[tauri::command]
pub fn get_folders(state: tauri::State<'_, DbState>) -> Result<Vec<Folder>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::get_folders(&conn)
}

#[tauri::command]
pub fn create_folder(name: String, parent_id: Option<String>, state: tauri::State<'_, DbState>) -> Result<Folder, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::create_folder(&conn, &name, parent_id.as_deref())
}

#[tauri::command]
pub fn delete_folder(id: String, state: tauri::State<'_, DbState>) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::delete_folder(&conn, &id)
}

#[tauri::command]
pub fn get_tags(state: tauri::State<'_, DbState>) -> Result<Vec<Tag>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::get_tags(&conn)
}

#[tauri::command]
pub fn create_tag(name: String, state: tauri::State<'_, DbState>) -> Result<Tag, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::create_tag(&conn, &name)
}

#[tauri::command]
pub fn delete_tag(id: String, state: tauri::State<'_, DbState>) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::delete_tag(&conn, &id)
}

#[tauri::command]
pub fn set_archive_tags(archive_id: String, tag_ids: Vec<String>, state: tauri::State<'_, DbState>) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::set_archive_tags(&conn, &archive_id, &tag_ids)
}

#[tauri::command]
pub fn move_archives_to_folder(archive_ids: Vec<String>, folder_id: String, state: tauri::State<'_, DbState>) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::move_archives_to_folder(&conn, &archive_ids, &folder_id)
}

#[tauri::command]
pub fn get_smart_folders(state: tauri::State<'_, DbState>) -> Result<Vec<SmartFolder>, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::get_smart_folders(&conn)
}

#[tauri::command]
pub fn create_smart_folder(name: String, conditions: String, state: tauri::State<'_, DbState>) -> Result<SmartFolder, AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::create_smart_folder(&conn, &name, &conditions)
}

#[tauri::command]
pub fn delete_smart_folder(id: String, state: tauri::State<'_, DbState>) -> Result<(), AppError> {
    let conn = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    queries::delete_smart_folder(&conn, &id)
}
```

- [ ] **Step 2: main.rs にすべてのコマンドを登録**

```rust
.invoke_handler(tauri::generate_handler![
    commands::library::get_library_path,
    commands::library::init_library,
    commands::library::get_folders,
    commands::library::create_folder,
    commands::library::delete_folder,
    commands::library::get_tags,
    commands::library::create_tag,
    commands::library::delete_tag,
    commands::library::set_archive_tags,
    commands::library::move_archives_to_folder,
    commands::library::get_smart_folders,
    commands::library::create_smart_folder,
    commands::library::delete_smart_folder,
    commands::archive::import_archives,
    commands::archive::get_archives,
    commands::archive::get_archive_detail,
    commands::archive::update_archive,
    commands::archive::delete_archives,
    commands::archive::search_archives,
    commands::viewer::prepare_pages,
    commands::viewer::save_read_position,
    commands::viewer::cleanup_temp_pages,
    commands::drag_drop::import_dropped_files,
    commands::drag_drop::handle_internal_drag,
])
```

- [ ] **Step 3: ビルド確認してコミット**

```bash
cd d:/Dev/App/ComicViewer
cargo build --manifest-path src-tauri/Cargo.toml && git add src-tauri/src/commands/ src-tauri/src/main.rs && git commit -m "feat: register all folder/tag/smart folder CRUD commands"
```

---

## Phase 5 完了基準

- [x] ZIP/CBZ/CBRファイルをウィンドウにD&Dしてインポートできる
- [x] ドロップ時にハイライトオーバーレイが表示される
- [x] グリッドのアイテムを右クリックでコンテキストメニューが出る
- [x] タグ編集ダイアログでタグの追加・削除・保存ができる
- [x] フォルダ/タグ/スマートフォルダのCRUDがTauriコマンド経由で動作する
- [x] 内部D&D（グリッド→サイドバーのフォルダ/タグ）でメタデータが付与される
- [x] 起動時にtemp/クリーンアップ、消失ファイル検出、孤立サムネイル削除が実行される
- [x] 全Tauriコマンドが登録され、フロントエンドから呼び出せる
