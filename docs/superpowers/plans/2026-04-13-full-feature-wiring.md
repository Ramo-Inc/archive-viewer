# Full Feature Wiring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect all 9 disconnected Tauri commands and 3 orphaned React components to make every feature accessible from the UI, plus fix 3 existing backend bugs.

**Architecture:** Wire existing ContextMenu, SmartFolderEditor, and TagEditor components to their parent components via useState toggles. All backend CRUD commands already exist — only trigger UI and one new query function (`get_smart_folder_by_id`) are needed.

**Tech Stack:** Tauri v2, React 19, TypeScript, Zustand, Rust (rusqlite)

**Spec:** `docs/superpowers/specs/2026-04-13-full-feature-wiring.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src-tauri/src/error.rs` | Error types | Add `From<serde_json::Error>` |
| `src-tauri/src/db/queries.rs` | SQL queries | Fix tag filter bug, add `get_smart_folder_by_id`, add smart folder filter |
| `src/hooks/useDragDrop.ts` | External D&D | Add `.rar` extension |
| `src/components/library/Sidebar.tsx` | Left panel | Folder/smart folder CRUD, drop zone, preset bugfix |
| `src/components/library/ArchiveGrid.tsx` | Archive grid | Extract List/Item, add context menu |
| `src/components/library/ArchiveCard.tsx` | Archive card | Add draggable + onContextMenu prop |
| `src/components/library/DetailPanel.tsx` | Right panel | Title/memo/tags editing, read toggle, delete, multi-select ops |
| `src/components/library/TopBar.tsx` | Top toolbar | Add import button |

---

### Task 1: Backend — Fix tag filter bug + add serde_json error conversion

**Files:**
- Modify: `src-tauri/src/error.rs:26-36`
- Modify: `src-tauri/src/db/queries.rs:479`
- Modify: `src-tauri/src/db/queries.rs:1112-1134` (test)

- [ ] **Step 1: Add `From<serde_json::Error>` to AppError**

In `src-tauri/src/error.rs`, add after the `From<std::io::Error>` impl (after line 36):

```rust
impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Validation(e.to_string())
    }
}
```

- [ ] **Step 2: Fix tag filter SQL — change `t.name` to `t.id`**

In `src-tauri/src/db/queries.rs`, line 479, change:

```rust
conditions.push(format!("t.name IN ({})", placeholders.join(",")));
```

to:

```rust
conditions.push(format!("t.id IN ({})", placeholders.join(",")));
```

- [ ] **Step 3: Fix the tag filter test to use tag IDs instead of names**

In `src-tauri/src/db/queries.rs`, replace the `test_get_archive_summaries_filtered_by_tags` test (lines 1112-1134):

```rust
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
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test`
Expected: All tests pass, including the updated tag filter test.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/db/queries.rs
git commit -m "fix: tag filter uses ID instead of name, add serde_json error conversion"
```

---

### Task 2: Backend — Smart folder filter implementation

**Files:**
- Modify: `src-tauri/src/db/queries.rs:427-554` (add smart folder filter block)
- Add new function: `get_smart_folder_by_id` in `src-tauri/src/db/queries.rs`

- [ ] **Step 1: Write the test for `get_smart_folder_by_id`**

Add to the tests module in `src-tauri/src/db/queries.rs`:

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test test_get_smart_folder_by_id`
Expected: FAIL — function `get_smart_folder_by_id` not found.

- [ ] **Step 3: Implement `get_smart_folder_by_id`**

Add in `src-tauri/src/db/queries.rs`, after the `get_smart_folders` function (around line 361):

```rust
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test test_get_smart_folder_by_id`
Expected: Both tests PASS.

- [ ] **Step 5: Write the test for smart folder filtering**

Add to the tests module:

```rust
#[test]
fn test_smart_folder_filter_rank_gte() {
    let conn = setup_db();
    let mut a1 = make_test_archive("a1", "Low Rank");
    a1.rank = 1;
    let mut a2 = make_test_archive("a2", "High Rank");
    a2.rank = 4;
    insert_archive(&conn, &a1).unwrap();
    insert_archive(&conn, &a2).unwrap();

    let sf = create_smart_folder(
        &conn,
        "Rank 3+",
        r#"{"match":"all","rules":[{"field":"rank","op":"gte","value":3}]}"#,
    )
    .unwrap();

    let filter = ArchiveFilter {
        smart_folder_id: Some(sf.id),
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
    assert_eq!(results[0].title, "High Rank");
}

#[test]
fn test_smart_folder_filter_tag_contains() {
    let conn = setup_db();
    insert_archive(&conn, &make_test_archive("a1", "Action Manga")).unwrap();
    insert_archive(&conn, &make_test_archive("a2", "Romance Manga")).unwrap();
    let tag = create_tag(&conn, "Action").unwrap();
    set_archive_tags(&conn, "a1", &[tag.id.clone()]).unwrap();

    let sf = create_smart_folder(
        &conn,
        "Action Tag",
        r#"{"match":"all","rules":[{"field":"tag","op":"contains","value":"Action"}]}"#,
    )
    .unwrap();

    let filter = ArchiveFilter {
        smart_folder_id: Some(sf.id),
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

    // "any" match: rank >= 4 OR tag contains "Featured"
    let sf = create_smart_folder(
        &conn,
        "Any Match",
        r#"{"match":"any","rules":[{"field":"rank","op":"gte","value":4},{"field":"tag","op":"contains","value":"Featured"}]}"#,
    )
    .unwrap();

    let filter = ArchiveFilter {
        smart_folder_id: Some(sf.id),
        folder_id: None,
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
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd src-tauri && cargo test test_smart_folder_filter`
Expected: FAIL — smart_folder_id is not handled in the filter function.

- [ ] **Step 7: Implement the smart folder filter in `get_archive_summaries_filtered`**

In `src-tauri/src/db/queries.rs`, inside `get_archive_summaries_filtered`, add the following block after the folder filter section (after line 445, before the preset filter):

```rust
    // Smart folder filter
    if let Some(ref smart_folder_id) = filter.smart_folder_id {
        let sf = get_smart_folder_by_id(conn, smart_folder_id)?;
        let sf_conditions: crate::db::models::SmartFolderConditions =
            serde_json::from_str(&sf.conditions)?;

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
```

- [ ] **Step 8: Run all tests**

Run: `cd src-tauri && cargo test`
Expected: All tests pass, including the 3 new smart folder filter tests.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/db/queries.rs
git commit -m "feat: implement smart folder filter with get_smart_folder_by_id query"
```

---

### Task 3: Frontend — Fix favorites preset + useDragDrop .rar

**Files:**
- Modify: `src/components/library/Sidebar.tsx:199-200`
- Modify: `src/hooks/useDragDrop.ts:16`

- [ ] **Step 1: Fix favorites preset string in Sidebar**

In `src/components/library/Sidebar.tsx`, change lines 196-201:

```tsx
<SidebarItem
  label="お気に入り"
  icon="❤️"
  active={isPresetActive('favorites')}
  onClick={() => handlePreset('favorites')}
/>
```

Also update `isPresetActive` (line 122-126) — no change needed since it checks `filter.preset === preset`, so passing `'favorites'` will match the backend.

- [ ] **Step 2: Add `.rar` to useDragDrop SUPPORTED_EXTENSIONS**

In `src/hooks/useDragDrop.ts`, line 16, change:

```typescript
const SUPPORTED_EXTENSIONS = ['.zip', '.cbz', '.cbr'];
```

to:

```typescript
const SUPPORTED_EXTENSIONS = ['.zip', '.cbz', '.cbr', '.rar'];
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd d:/Dev/App/ComicViewer && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/library/Sidebar.tsx src/hooks/useDragDrop.ts
git commit -m "fix: favorites preset mismatch, add .rar to drag-drop extensions"
```

---

### Task 4: Frontend — Sidebar folder CRUD + always-show sections

**Files:**
- Modify: `src/components/library/Sidebar.tsx` (major rewrite of folder/smart folder sections)

- [ ] **Step 1: Rewrite Sidebar with folder CRUD, context menu, and always-visible sections**

Replace `src/components/library/Sidebar.tsx` entirely with the following. This is a large change because we're adding 6 new state variables, 3 new imports, inline folder creation, inline rename, context menus, and drop zones:

```tsx
import { useState, useCallback, useRef, useEffect } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import ContextMenu, { type MenuItem } from '../common/ContextMenu';
import SmartFolderEditor from './SmartFolderEditor';
import type { Folder, SmartFolder } from '../../types';

// ============================================================
// Sidebar — Left panel with presets, folders, smart folders.
// Now includes: folder CRUD, smart folder CRUD via modals,
// context menus, and drag-drop targets for archive-to-folder.
// ============================================================

interface SidebarItemProps {
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  dataFolderId?: string;
}

function SidebarItem({ label, icon, active, onClick, onContextMenu, dataFolderId }: SidebarItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-folder-id={dataFolderId}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: 13,
        background: active ? 'var(--bg-hover)' : 'transparent',
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'var(--bg-card)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = active ? 'var(--bg-hover)' : 'transparent';
      }}
    >
      <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>{icon}</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
    </div>
  );
}

interface FolderItemProps {
  folder: Folder;
  activeFolderId: string | null | undefined;
  isEditing: boolean;
  isDropTarget: boolean;
  onSelect: (id: string | null) => void;
  onContextMenu: (e: React.MouseEvent, folder: Folder) => void;
  onRenameCommit: (id: string, newName: string) => void;
  onRenameCancel: () => void;
  onDragOver: (e: React.DragEvent, folderId: string) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent, folderId: string) => void;
}

function FolderItem({
  folder,
  activeFolderId,
  isEditing,
  isDropTarget,
  onSelect,
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

  if (isEditing) {
    return (
      <div style={{ padding: '4px 10px' }}>
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
        gap: 8,
        padding: '6px 10px',
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
      <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>📁</span>
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {folder.name}
      </span>
    </div>
  );
}

export default function Sidebar() {
  const filter = useLibraryStore((s) => s.filter);
  const setFilter = useLibraryStore((s) => s.setFilter);
  const resetFilter = useLibraryStore((s) => s.resetFilter);
  const folders = useLibraryStore((s) => s.folders);
  const smartFolders = useLibraryStore((s) => s.smartFolders);
  const fetchFolders = useLibraryStore((s) => s.fetchFolders);
  const fetchSmartFolders = useLibraryStore((s) => s.fetchSmartFolders);
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);
  const addToast = useToastStore((s) => s.addToast);

  // --- State ---
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [dropTargetFolderId, setDropTargetFolderId] = useState<string | null>(null);
  const [showSmartFolderEditor, setShowSmartFolderEditor] = useState(false);
  const [editingSmartFolder, setEditingSmartFolder] = useState<SmartFolder | undefined>(undefined);

  const newFolderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creatingFolder && newFolderInputRef.current) {
      newFolderInputRef.current.focus();
    }
  }, [creatingFolder]);

  // --- Preset ---
  const isPresetActive = (preset: string) => {
    if (preset === 'all') {
      return !filter.folder_id && !filter.smart_folder_id && !filter.preset;
    }
    return filter.preset === preset;
  };

  const handlePreset = useCallback(
    (preset: string) => {
      if (preset === 'all') {
        resetFilter();
      } else {
        setFilter({ folder_id: undefined, smart_folder_id: undefined, preset });
      }
    },
    [resetFilter, setFilter],
  );

  // --- Folder select ---
  const handleFolderSelect = useCallback(
    (folderId: string | null) => {
      setFilter({ folder_id: folderId, smart_folder_id: undefined, preset: undefined });
    },
    [setFilter],
  );

  // --- Folder create ---
  const handleCreateFolder = useCallback(async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setCreatingFolder(false);
      setNewFolderName('');
      return;
    }
    try {
      await tauriInvoke('create_folder', { name: trimmed, parentId: null });
      await fetchFolders();
      addToast(`フォルダ「${trimmed}」を作成しました`, 'success');
    } catch (e) {
      addToast(`フォルダ作成失敗: ${String(e)}`, 'error');
    }
    setCreatingFolder(false);
    setNewFolderName('');
  }, [newFolderName, fetchFolders, addToast]);

  // --- Folder rename ---
  const handleRenameCommit = useCallback(
    async (folderId: string, newName: string) => {
      try {
        await tauriInvoke('rename_folder', { id: folderId, name: newName });
        await fetchFolders();
      } catch (e) {
        addToast(`名前変更失敗: ${String(e)}`, 'error');
      }
      setEditingFolderId(null);
    },
    [fetchFolders, addToast],
  );

  // --- Folder delete ---
  const handleDeleteFolder = useCallback(
    async (folderId: string) => {
      try {
        await tauriInvoke('delete_folder', { id: folderId });
        await fetchFolders();
        if (filter.folder_id === folderId) {
          resetFilter();
        }
        addToast('フォルダを削除しました', 'success');
      } catch (e) {
        addToast(`フォルダ削除失敗: ${String(e)}`, 'error');
      }
    },
    [fetchFolders, filter.folder_id, resetFilter, addToast],
  );

  // --- Folder context menu ---
  const handleFolderContextMenu = useCallback(
    (e: React.MouseEvent, folder: Folder) => {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: '名前変更', onClick: () => setEditingFolderId(folder.id) },
          { label: '削除', onClick: () => handleDeleteFolder(folder.id), separator: true },
        ],
      });
    },
    [handleDeleteFolder],
  );

  // --- Smart folder select ---
  const handleSmartFolderSelect = useCallback(
    (sfId: string) => {
      setFilter({ smart_folder_id: sfId, folder_id: undefined, preset: undefined });
    },
    [setFilter],
  );

  // --- Smart folder delete ---
  const handleDeleteSmartFolder = useCallback(
    async (sfId: string) => {
      try {
        await tauriInvoke('delete_smart_folder', { id: sfId });
        await fetchSmartFolders();
        if (filter.smart_folder_id === sfId) {
          resetFilter();
        }
        addToast('スマートフォルダを削除しました', 'success');
      } catch (e) {
        addToast(`スマートフォルダ削除失敗: ${String(e)}`, 'error');
      }
    },
    [fetchSmartFolders, filter.smart_folder_id, resetFilter, addToast],
  );

  // --- Smart folder context menu ---
  const handleSmartFolderContextMenu = useCallback(
    (e: React.MouseEvent, sf: SmartFolder) => {
      e.preventDefault();
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          {
            label: '編集',
            onClick: () => {
              setEditingSmartFolder(sf);
              setShowSmartFolderEditor(true);
            },
          },
          { label: '削除', onClick: () => handleDeleteSmartFolder(sf.id), separator: true },
        ],
      });
    },
    [handleDeleteSmartFolder],
  );

  // --- Drag & Drop on folders ---
  const handleFolderDragOver = useCallback((e: React.DragEvent, folderId: string) => {
    if (e.dataTransfer.types.includes('application/x-archive-ids')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetFolderId(folderId);
    }
  }, []);

  const handleFolderDragLeave = useCallback(() => {
    setDropTargetFolderId(null);
  }, []);

  const handleFolderDrop = useCallback(
    async (e: React.DragEvent, folderId: string) => {
      e.preventDefault();
      setDropTargetFolderId(null);
      const data = e.dataTransfer.getData('application/x-archive-ids');
      if (!data) return;
      try {
        const archiveIds: string[] = JSON.parse(data);
        await tauriInvoke('handle_internal_drag', {
          archiveIds,
          target: { Folder: folderId },
        });
        await fetchArchives();
        addToast(`${archiveIds.length}件をフォルダに追加しました`, 'success');
      } catch (e) {
        addToast(`フォルダ追加失敗: ${String(e)}`, 'error');
      }
    },
    [fetchArchives, addToast],
  );

  // --- Styles ---
  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-dim)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    padding: '12px 10px 4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  };

  const addButtonStyle: React.CSSProperties = {
    background: 'none',
    border: 'none',
    color: 'var(--text-dim)',
    cursor: 'pointer',
    fontSize: 16,
    padding: '0 4px',
    lineHeight: 1,
  };

  return (
    <aside
      style={{
        width: 220,
        minWidth: 220,
        background: 'var(--bg-secondary)',
        borderRight: '1px solid var(--border-color)',
        overflowY: 'auto',
        padding: '8px 6px',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Preset filters */}
      <div style={{ ...sectionTitleStyle, justifyContent: 'flex-start' }}>ライブラリ</div>
      <SidebarItem label="すべて" icon="📚" active={isPresetActive('all')} onClick={() => handlePreset('all')} />
      <SidebarItem label="お気に入り" icon="❤️" active={isPresetActive('favorites')} onClick={() => handlePreset('favorites')} />
      <SidebarItem label="未読" icon="📖" active={isPresetActive('unread')} onClick={() => handlePreset('unread')} />
      <SidebarItem label="最近読んだ" icon="🕐" active={isPresetActive('recent')} onClick={() => handlePreset('recent')} />

      {/* Folder section — always visible */}
      <div style={sectionTitleStyle}>
        <span>フォルダ</span>
        <button
          style={addButtonStyle}
          onClick={() => { setCreatingFolder(true); setNewFolderName(''); }}
          title="フォルダを作成"
        >
          +
        </button>
      </div>

      {creatingFolder && (
        <div style={{ padding: '4px 10px' }}>
          <input
            ref={newFolderInputRef}
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onBlur={handleCreateFolder}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder();
              if (e.key === 'Escape') { setCreatingFolder(false); setNewFolderName(''); }
            }}
            placeholder="フォルダ名"
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

      {folders.map((folder) => (
        <FolderItem
          key={folder.id}
          folder={folder}
          activeFolderId={filter.folder_id}
          isEditing={editingFolderId === folder.id}
          isDropTarget={dropTargetFolderId === folder.id}
          onSelect={handleFolderSelect}
          onContextMenu={handleFolderContextMenu}
          onRenameCommit={handleRenameCommit}
          onRenameCancel={() => setEditingFolderId(null)}
          onDragOver={handleFolderDragOver}
          onDragLeave={handleFolderDragLeave}
          onDrop={handleFolderDrop}
        />
      ))}

      {/* Smart folder section — always visible */}
      <div style={sectionTitleStyle}>
        <span>スマートフォルダ</span>
        <button
          style={addButtonStyle}
          onClick={() => { setEditingSmartFolder(undefined); setShowSmartFolderEditor(true); }}
          title="スマートフォルダを作成"
        >
          +
        </button>
      </div>

      {smartFolders.map((sf) => (
        <SidebarItem
          key={sf.id}
          label={sf.name}
          icon="🔍"
          active={filter.smart_folder_id === sf.id}
          onClick={() => handleSmartFolderSelect(sf.id)}
          onContextMenu={(e) => handleSmartFolderContextMenu(e, sf)}
          dataFolderId={`smart-${sf.id}`}
        />
      ))}

      {/* Bottom spacer */}
      <div style={{ flex: 1 }} />

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Smart folder editor modal */}
      {showSmartFolderEditor && (
        <SmartFolderEditor
          existing={editingSmartFolder}
          onClose={() => setShowSmartFolderEditor(false)}
        />
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/library/Sidebar.tsx
git commit -m "feat: Sidebar folder/smart folder CRUD with context menus and drop zones"
```

---

### Task 5: Frontend — ArchiveGrid List/Item extraction + ArchiveCard drag/context menu

**Files:**
- Modify: `src/components/library/ArchiveGrid.tsx`
- Modify: `src/components/library/ArchiveCard.tsx`

- [ ] **Step 1: Add `onContextMenu` and `draggable` to ArchiveCard**

Replace `src/components/library/ArchiveCard.tsx`:

In the `ArchiveCardProps` interface, add:

```typescript
interface ArchiveCardProps {
  archive: ArchiveSummary;
  libraryPath: string;
  onDoubleClick?: (id: string) => void;
  onContextMenu?: (e: React.MouseEvent, archiveId: string) => void;
}
```

In the component, add the new prop:

```typescript
export default function ArchiveCard({ archive, libraryPath, onDoubleClick, onContextMenu }: ArchiveCardProps) {
```

Add `handleDragStart` and `handleContextMenu` callbacks after the existing handlers:

```typescript
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (onContextMenu) onContextMenu(e, archive.id);
    },
    [archive.id, onContextMenu],
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      const ids = selectedArchiveIds.has(archive.id)
        ? Array.from(selectedArchiveIds)
        : [archive.id];
      e.dataTransfer.setData('application/x-archive-ids', JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
    },
    [archive.id, selectedArchiveIds],
  );
```

On the root `<div>` element (the card container), add:

```tsx
draggable
onDragStart={handleDragStart}
onContextMenu={handleContextMenu}
```

- [ ] **Step 2: Rewrite ArchiveGrid with extracted List/Item and context menu**

Replace `src/components/library/ArchiveGrid.tsx` entirely:

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import ArchiveCard from './ArchiveCard';
import ContextMenu, { type MenuItem } from '../common/ContextMenu';

interface ArchiveGridProps {
  onOpenViewer: (archiveId: string) => void;
}

// List and Item components defined OUTSIDE the component function
// to prevent recreation on re-render (VirtuosoGrid requirement).
// gridSize is passed via CSS custom property on the wrapper div.
const GridList = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, children, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(var(--grid-size, 180px), 1fr))`,
        gap: 8,
        padding: 10,
      }}
    >
      {children}
    </div>
  ),
);
GridList.displayName = 'GridList';

const GridItem = ({ children, ...props }: React.HTMLAttributes<HTMLDivElement> & { children?: React.ReactNode }) => (
  <div {...props}>{children}</div>
);

export default function ArchiveGrid({ onOpenViewer }: ArchiveGridProps) {
  const archives = useLibraryStore((s) => s.archives);
  const loading = useLibraryStore((s) => s.loading);
  const folders = useLibraryStore((s) => s.folders);
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);
  const clearSelection = useLibraryStore((s) => s.clearSelection);
  const addToast = useToastStore((s) => s.addToast);

  const [gridSize, setGridSize] = useState(180);
  const [libraryPath, setLibraryPath] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: MenuItem[];
  } | null>(null);

  const wrapperRef = useRef<HTMLDivElement>(null);

  // Update CSS custom property when gridSize changes
  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.style.setProperty('--grid-size', `${gridSize}px`);
    }
  }, [gridSize]);

  useEffect(() => {
    const handler = (e: Event) => {
      setGridSize((e as CustomEvent<number>).detail);
    };
    window.addEventListener('grid-size-change', handler);
    return () => window.removeEventListener('grid-size-change', handler);
  }, []);

  useEffect(() => {
    tauriInvoke<string | null>('get_library_path')
      .then((path) => { if (path) setLibraryPath(path); })
      .catch(() => {});
  }, []);

  const handleDoubleClick = useCallback(
    (archiveId: string) => onOpenViewer(archiveId),
    [onOpenViewer],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, archiveId: string) => {
      const items: MenuItem[] = [
        { label: '読む', onClick: () => onOpenViewer(archiveId) },
      ];

      // Add folder items if folders exist
      if (folders.length > 0) {
        for (const folder of folders) {
          items.push({
            label: `→ ${folder.name}`,
            separator: items.length === 1, // separator before first folder
            onClick: async () => {
              try {
                await tauriInvoke('move_archives_to_folder', {
                  archiveIds: [archiveId],
                  folderId: folder.id,
                });
                await fetchArchives();
                addToast(`「${folder.name}」に追加しました`, 'success');
              } catch (err) {
                addToast(`フォルダ追加失敗: ${String(err)}`, 'error');
              }
            },
          });
        }
      }

      items.push({
        label: '削除',
        separator: true,
        onClick: async () => {
          if (!window.confirm('このアーカイブを削除しますか？')) return;
          try {
            await tauriInvoke('delete_archives', { ids: [archiveId] });
            clearSelection();
            await fetchArchives();
            addToast('アーカイブを削除しました', 'success');
          } catch (err) {
            addToast(`削除失敗: ${String(err)}`, 'error');
          }
        },
      });

      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [onOpenViewer, folders, fetchArchives, clearSelection, addToast],
  );

  if (!loading && archives.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', gap: 12 }}>
        <span style={{ fontSize: 48 }}>📁</span>
        <p style={{ fontSize: 14 }}>ファイルをD&Dして追加</p>
        <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>ZIP、CBZ、RAR、CBR形式に対応</p>
      </div>
    );
  }

  if (loading && archives.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        読み込み中...
      </div>
    );
  }

  return (
    <div ref={wrapperRef} style={{ flex: 1, overflow: 'hidden' }}>
      <VirtuosoGrid
        totalCount={archives.length}
        overscan={200}
        style={{ height: '100%' }}
        components={{ List: GridList, Item: GridItem }}
        itemContent={(index) => (
          <ArchiveCard
            archive={archives[index]}
            libraryPath={libraryPath}
            onDoubleClick={handleDoubleClick}
            onContextMenu={handleContextMenu}
          />
        )}
      />
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/library/ArchiveCard.tsx src/components/library/ArchiveGrid.tsx
git commit -m "feat: ArchiveCard drag + context menu, ArchiveGrid List/Item extraction"
```

---

### Task 6: Frontend — DetailPanel full editing + delete + multi-select ops

**Files:**
- Modify: `src/components/library/DetailPanel.tsx` (major rewrite)

- [ ] **Step 1: Rewrite DetailPanel with all editing features**

Replace `src/components/library/DetailPanel.tsx` entirely:

```tsx
import { useMemo, useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import RankStars from '../common/RankStars';
import TagEditor from './TagEditor';
import type { ArchiveDetail } from '../../types';

interface DetailPanelProps {
  onOpenViewer: (archiveId: string) => void;
}

export default function DetailPanel({ onOpenViewer }: DetailPanelProps) {
  const archives = useLibraryStore((s) => s.archives);
  const selectedArchiveIds = useLibraryStore((s) => s.selectedArchiveIds);
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);
  const clearSelection = useLibraryStore((s) => s.clearSelection);
  const folders = useLibraryStore((s) => s.folders);
  const addToast = useToastStore((s) => s.addToast);

  const [libraryPath, setLibraryPath] = useState('');
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [memoDraft, setMemoDraft] = useState('');
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);

  useEffect(() => {
    tauriInvoke<string | null>('get_library_path')
      .then((path) => { if (path) setLibraryPath(path); })
      .catch(() => {});
  }, []);

  const selectedIds = useMemo(() => Array.from(selectedArchiveIds), [selectedArchiveIds]);
  const selectedArchive = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    return archives.find((a) => a.id === selectedIds[0]) ?? null;
  }, [selectedIds, archives]);

  // Fetch full detail when single selection changes
  useEffect(() => {
    if (!selectedArchive) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    tauriInvoke<ArchiveDetail>('get_archive_detail', { id: selectedArchive.id })
      .then((d) => { if (!cancelled) { setDetail(d); setMemoDraft(d.memo); } })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [selectedArchive?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const thumbnailUrl = useMemo(() => {
    if (!detail?.thumbnail_path) return null;
    const thumb = detail.thumbnail_path;
    if (thumb.startsWith('http') || thumb.startsWith('data:')) return thumb;
    return convertFileSrc(`${libraryPath}/${thumb}`);
  }, [detail?.thumbnail_path, libraryPath]);

  // --- Handlers ---

  const handleRankChange = useCallback(async (newRank: number) => {
    if (!detail) return;
    try {
      await tauriInvoke('update_archive', { id: detail.id, update: { rank: newRank } });
      setDetail((d) => d ? { ...d, rank: newRank } : d);
      fetchArchives();
    } catch (e) { console.error('Failed to update rank:', e); }
  }, [detail, fetchArchives]);

  const handleTitleCommit = useCallback(async () => {
    setEditingTitle(false);
    if (!detail) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === detail.title) return;
    try {
      await tauriInvoke('update_archive', { id: detail.id, update: { title: trimmed } });
      setDetail((d) => d ? { ...d, title: trimmed } : d);
      fetchArchives();
    } catch (e) { addToast(`タイトル更新失敗: ${String(e)}`, 'error'); }
  }, [detail, titleDraft, fetchArchives, addToast]);

  const handleMemoBlur = useCallback(async () => {
    if (!detail || memoDraft === detail.memo) return;
    try {
      await tauriInvoke('update_archive', { id: detail.id, update: { memo: memoDraft } });
      setDetail((d) => d ? { ...d, memo: memoDraft } : d);
    } catch (e) { addToast(`メモ更新失敗: ${String(e)}`, 'error'); }
  }, [detail, memoDraft, addToast]);

  const handleToggleRead = useCallback(async () => {
    if (!detail) return;
    const newVal = !detail.is_read;
    try {
      await tauriInvoke('update_archive', { id: detail.id, update: { is_read: newVal } });
      setDetail((d) => d ? { ...d, is_read: newVal } : d);
      fetchArchives();
    } catch (e) { addToast(`状態更新失敗: ${String(e)}`, 'error'); }
  }, [detail, fetchArchives, addToast]);

  const handleDelete = useCallback(async (ids: string[]) => {
    if (!window.confirm(`${ids.length}件のアーカイブを削除しますか？`)) return;
    try {
      await tauriInvoke('delete_archives', { ids });
      clearSelection();
      fetchArchives();
      addToast(`${ids.length}件を削除しました`, 'success');
    } catch (e) { addToast(`削除失敗: ${String(e)}`, 'error'); }
  }, [clearSelection, fetchArchives, addToast]);

  const handleAddToFolder = useCallback(async (folderId: string) => {
    try {
      await tauriInvoke('move_archives_to_folder', { archiveIds: selectedIds, folderId });
      fetchArchives();
      setShowFolderDropdown(false);
      addToast('フォルダに追加しました', 'success');
    } catch (e) { addToast(`フォルダ追加失敗: ${String(e)}`, 'error'); }
  }, [selectedIds, fetchArchives, addToast]);

  const handleTagsSaved = useCallback(() => {
    if (selectedArchive) {
      tauriInvoke<ArchiveDetail>('get_archive_detail', { id: selectedArchive.id })
        .then(setDetail)
        .catch(() => {});
    }
    fetchArchives();
  }, [selectedArchive, fetchArchives]);

  const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 };
  const valueStyle: React.CSSProperties = { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 };
  const btnStyle: React.CSSProperties = {
    width: '100%', padding: '8px 0', border: 'none', borderRadius: 6,
    fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s',
  };

  // --- No selection ---
  if (selectedIds.length === 0) {
    return (
      <aside style={{ width: 280, minWidth: 280, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', padding: 16, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>アーカイブを選択してください</p>
      </aside>
    );
  }

  // --- Multiple selection ---
  if (selectedIds.length > 1) {
    return (
      <aside style={{ width: 280, minWidth: 280, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 8 }}>
          {selectedIds.length}件選択中
        </p>

        {/* Add to folder */}
        {folders.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              style={{ ...btnStyle, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              onClick={() => setShowFolderDropdown(!showFolderDropdown)}
            >
              フォルダに追加 ▾
            </button>
            {showFolderDropdown && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4, zIndex: 1000, maxHeight: 200, overflowY: 'auto' }}>
                {folders.map((f) => (
                  <div
                    key={f.id}
                    onClick={() => handleAddToFolder(f.id)}
                    style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    📁 {f.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete */}
        <button
          style={{ ...btnStyle, background: '#a33', color: '#fff', marginTop: 8 }}
          onClick={() => handleDelete(selectedIds)}
        >
          削除
        </button>
      </aside>
    );
  }

  // --- Single selection ---
  if (!detail) {
    return (
      <aside style={{ width: 280, minWidth: 280, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', padding: 16, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>読み込み中...</p>
      </aside>
    );
  }

  return (
    <aside style={{ width: 280, minWidth: 280, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Cover image */}
      <div style={{ width: '100%', aspectRatio: '3 / 4', background: 'var(--bg-card)', borderRadius: 6, overflow: 'hidden', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={detail.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 48, color: 'var(--text-dim)' }}>📄</span>
        )}
      </div>

      {/* Title (click to edit) */}
      {editingTitle ? (
        <input
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={handleTitleCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') handleTitleCommit(); if (e.key === 'Escape') setEditingTitle(false); }}
          style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--bg-tertiary)', outline: 'none', width: '100%' }}
        />
      ) : (
        <h3
          onClick={() => { setTitleDraft(detail.title); setEditingTitle(true); }}
          style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.4, wordBreak: 'break-word', cursor: 'pointer' }}
          title="クリックで編集"
        >
          {detail.title}
        </h3>
      )}

      {/* Rank */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <RankStars value={detail.rank} onChange={handleRankChange} size={18} />
      </div>

      {/* Tags */}
      <div style={labelStyle}>タグ</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {detail.tags.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>タグなし</span>
        )}
        {detail.tags.map((tag) => (
          <span key={tag.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
            {tag.name}
          </span>
        ))}
        <button
          onClick={() => setShowTagEditor(true)}
          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'none', color: 'var(--accent)', border: '1px dashed var(--accent)', cursor: 'pointer' }}
        >
          編集
        </button>
      </div>

      {/* Memo */}
      <div style={labelStyle}>メモ</div>
      <textarea
        value={memoDraft}
        onChange={(e) => setMemoDraft(e.target.value)}
        onBlur={handleMemoBlur}
        placeholder="メモを入力..."
        rows={3}
        style={{ fontSize: 13, color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '6px 8px', resize: 'vertical', outline: 'none', marginBottom: 10, width: '100%' }}
      />

      {/* File info */}
      <div style={labelStyle}>形式</div>
      <div style={valueStyle}>{detail.format.toUpperCase()}</div>

      {/* Read status toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={labelStyle}>状態</div>
        <button
          onClick={handleToggleRead}
          style={{
            fontSize: 12, padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
            border: '1px solid var(--border-color)',
            background: detail.is_read ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: detail.is_read ? '#fff' : 'var(--text-secondary)',
          }}
        >
          {detail.is_read ? '既読' : '未読'}
        </button>
      </div>

      {detail.missing && (
        <div style={{ fontSize: 12, color: '#e55', marginBottom: 10 }}>ファイルが見つかりません</div>
      )}

      {/* Actions */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => onOpenViewer(detail.id)}
          style={{ ...btnStyle, background: 'var(--accent)', color: '#fff' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent)'}
        >
          読む
        </button>
        <button
          onClick={() => handleDelete([detail.id])}
          style={{ ...btnStyle, background: 'transparent', color: '#a33', border: '1px solid #a33' }}
        >
          削除
        </button>
      </div>

      {/* Tag editor modal */}
      {showTagEditor && (
        <TagEditor
          archiveId={detail.id}
          currentTags={detail.tags}
          onClose={() => setShowTagEditor(false)}
          onSaved={handleTagsSaved}
        />
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/library/DetailPanel.tsx
git commit -m "feat: DetailPanel title/tags/memo editing, read toggle, delete, multi-select ops"
```

---

### Task 7: Frontend — TopBar import button

**Files:**
- Modify: `src/components/library/TopBar.tsx`

- [ ] **Step 1: Add import button to TopBar**

In `src/components/library/TopBar.tsx`, add import at the top:

```typescript
import { open } from '@tauri-apps/plugin-dialog';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import { useToastStore } from '../../stores/toastStore';
```

Add the import handler inside the component:

```typescript
  const addToast = useToastStore((s) => s.addToast);
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);

  const handleImport = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          { name: 'Archives', extensions: ['zip', 'cbz', 'rar', 'cbr'] },
        ],
      });
      if (!selected || selected.length === 0) return;
      const filePaths = Array.isArray(selected) ? selected : [selected];
      await tauriInvoke('import_archives', { filePaths, folderId: null });
      await fetchArchives();
      addToast(`${filePaths.length}件をインポートしました`, 'success');
    } catch (e) {
      addToast(`インポート失敗: ${String(e)}`, 'error');
    }
  }, [fetchArchives, addToast]);
```

In the JSX, add the button before the `{/* Spacer */}` div (before line 264):

```tsx
      {/* Import button */}
      <button style={buttonStyle} onClick={handleImport}>
        + インポート
      </button>
```

- [ ] **Step 2: Verify frontend compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/library/TopBar.tsx
git commit -m "feat: TopBar import button with native file picker dialog"
```

---

### Task 8: Verify all Rust tests pass

- [ ] **Step 1: Run complete Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: All tests pass — including the updated tag filter test, new smart folder tests, and existing tests.

- [ ] **Step 2: Run TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Final commit if any adjustments were needed**

If any fixes were applied in steps 1-2, commit them:

```bash
git add -A
git commit -m "fix: resolve test and type check issues from feature wiring"
```

---

## Self-Review Checklist

### Spec coverage:
| Spec Section | Task |
|---|---|
| 1. Sidebar folder CRUD + drop zone | Task 4 |
| 1. Sidebar smart folder CRUD | Task 4 |
| 2. DetailPanel all editing | Task 6 |
| 3. TopBar import button | Task 7 |
| 4. ArchiveCard drag + context menu | Task 5 |
| 4. ArchiveGrid List/Item extraction + context menu | Task 5 |
| 5a. Tag filter bugfix | Task 1 |
| 5b. Favorites preset bugfix | Task 3 |
| 5c. Smart folder filter | Task 2 |
| 5c. error.rs From<serde_json::Error> | Task 1 |
| 6. clearSelection wiring | Tasks 5, 6 |
| 7. useDragDrop .rar | Task 3 |

### Placeholder scan: No TBD, TODO, or vague instructions found.

### Type consistency:
- `MenuItem` from `ContextMenu` used consistently in Tasks 4, 5
- `ArchiveDetail` from `types/index.ts` used in Task 6
- `SmartFolder` from `types/index.ts` used in Task 4
- `DragTarget` serialized as `{ Folder: id }` in Task 4
- `tauriInvoke` param names use camelCase throughout (`archiveIds`, `folderId`, `filePaths`)
