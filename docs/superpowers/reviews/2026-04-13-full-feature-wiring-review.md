# Design Review: Full Feature Wiring Spec

> Reviewed: `docs/superpowers/specs/2026-04-13-full-feature-wiring.md`
> Date: 2026-04-13
> Reviewers: 4 independent agents (Backend, Frontend, Integration, Edge Cases)

## Overall Assessment

The spec is **well-researched and largely accurate**. Component interfaces (SmartFolderEditor, TagEditor, ContextMenu) match what the spec assumes. All Tauri commands exist and are registered. Type alignment between TypeScript and Rust is solid. However, reviewers independently found **the same set of critical gaps** from different angles, indicating real issues that must be fixed before implementation.

---

## CRITICAL Issues (Must fix before implementation)

### C-1. Favorites preset name mismatch (3/4 reviewers found independently)

- **Frontend**: `Sidebar.tsx:199` sends `preset: "favorite"` (singular)
- **Backend**: `queries.rs:450` matches `"favorites"` (plural)
- **Result**: "お気に入り" filter silently returns ALL archives. Has never worked.
- **Spec gap**: Not mentioned in the spec. Must be fixed as part of this work since the spec claims filters are working.
- **Fix**: Change `Sidebar.tsx` to send `"favorites"`, or change `queries.rs` to accept `"favorite"`.

### C-2. DragTarget enum serialization format undocumented (2/4 reviewers)

- **Rust**: `DragTarget::Folder(String)` with default serde externally-tagged serialization
- **Required JSON**: `{ "Folder": "uuid-123" }` (capital F, not `{ folder: id }` or `{ type: "Folder", id: ... }`)
- **Risk**: Extremely easy to get wrong. Runtime deserialization error with no obvious cause.
- **Fix**: Spec must document the exact JSON shape. Frontend call must be:
  ```js
  tauriInvoke('handle_internal_drag', {
    archiveIds: [...],
    target: { Folder: folderId }
  })
  ```

### C-3. Missing `From<serde_json::Error>` for AppError (1/4 reviewers)

- **File**: `src-tauri/src/error.rs`
- **Problem**: Smart folder filter (spec section 5b) parses conditions JSON via `serde_json::from_str`. This produces `serde_json::Error` which has no `From` impl for `AppError`.
- **Result**: Code will not compile without explicit `.map_err()` at every parse site.
- **Fix**: Add `impl From<serde_json::Error> for AppError` or use `.map_err(|e| AppError::Validation(e.to_string()))`.

### C-4. `delete_archives` has no transaction — partial failure leaves inconsistent state (1/4 reviewers)

- **File**: `src-tauri/src/commands/archive.rs:69-83`
- **Problem**: Deletes files from disk first, then DB rows. If DB delete fails, files are gone but DB rows remain (orphan rows pointing to deleted files).
- **Risk**: Amplified by multi-select delete (spec section 2.7).
- **Fix**: Reverse order: (1) begin transaction, (2) delete DB rows, (3) commit, (4) delete files. Orphan files are harmless; orphan DB rows are not.

### C-5. `import_files` aborts entire batch on first error (1/4 reviewers)

- **File**: `src-tauri/src/library/import.rs:171-188`
- **Problem**: Uses `?` operator — first corrupt file aborts remaining files. Files 1-2 may import, files 3-10 don't, user gets single error.
- **Fix**: Collect per-file results and return summary (e.g., "Imported 7/10 files. 3 failed.").

### C-6. Smart folder filter must use parameterized queries (2/4 reviewers)

- **Spec section 5b** proposes converting condition values to SQL. If values are interpolated as strings (not bound parameters), this is a SQL injection vector.
- **Fix**: Spec must explicitly state all condition values are pushed to `param_values` and bound as `?N` parameters, following the existing pattern in `get_archive_summaries_filtered`.

---

## MAJOR Issues (Should fix during implementation)

### M-1. `move_archives_to_folder` is "add to folder", not "move" (3/4 reviewers)

- **File**: `queries.rs:223-235` uses `INSERT OR IGNORE INTO archive_folders`
- **Problem**: Archives keep existing folder associations. User clicks "フォルダに移動" but archive stays in old folder too.
- **Options**: (A) Change SQL to DELETE existing + INSERT new (true move), or (B) Rename UI to "フォルダに追加" (add to folder).

### M-2. TagEditor `tag.color` dead code (4/4 reviewers found)

- **Files**: `TagEditor.tsx:162`, `types/index.ts` Tag type, `models.rs` Tag struct, `migrations.rs` tags table
- **Problem**: No `color` field exists anywhere. `tag.color` is always `undefined`, color dot never renders.
- **Options**: (A) Remove dead code from TagEditor, or (B) Add `color` column to schema + types if tag colors are desired.

### M-3. DetailPanel archive detail fetch — no request cancellation (1/4 reviewers)

- **Problem**: Spec proposes fetching `get_archive_detail` on every selection change. Rapid selection (keyboard navigation) fires multiple concurrent backend calls. Stale responses can overwrite newer ones.
- **Fix**: Use a version counter (`useRef`) or `AbortController` pattern to discard stale responses.

### M-4. VirtuosoGrid List/Item components recreated on re-render (1/4 reviewers)

- **File**: `ArchiveGrid.tsx:97-114`
- **Problem**: `React.forwardRef` components are created inside the render function. Adding ContextMenu state to ArchiveGrid causes re-renders, which recreate these components, causing VirtuosoGrid to unmount/remount the list (scroll position loss, flickering).
- **Fix**: Move List/Item component definitions outside the function body.

### M-5. Sidebar inline editing focus/blur race conditions (2/4 reviewers)

- **Problem**: Context menu "Rename" → close menu → show inline input → auto-focus. The `setTimeout(0)` in ContextMenu's click handler may interfere with the new input's focus.
- **Fix**: Use `requestAnimationFrame` for the transition. Define explicit behavior: blur = commit (like Finder) or blur = cancel.

### M-6. Delete currently viewed folder → invalid filter state (1/4 reviewers)

- **Problem**: If user views Folder X (`filter.folder_id = 'x'`), then deletes it, filter still points to deleted folder. Backend returns 0 results.
- **Fix**: After `delete_folder`, check if `filter.folder_id === deletedId` and call `resetFilter()`. Same for `delete_smart_folder`.

### M-7. Stale DetailPanel after context menu delete (1/4 reviewers)

- **Problem**: ArchiveGrid context menu delete doesn't call `clearSelection()`. DetailPanel still shows deleted archive.
- **Fix**: ArchiveGrid delete handler must also call `clearSelection()` after `delete_archives` + `fetchArchives()`.

### M-8. No folder name validation (1/4 reviewers)

- **Problem**: Backend `create_folder` (queries.rs:189) accepts empty/whitespace names. No UNIQUE constraint on name.
- **Fix**: Trim input, reject empty strings in frontend. Consider duplicate name check.

### M-9. Tech stack version — spec says React 18, project uses React 19 (1/4 reviewers)

- **File**: `package.json` — `"react": "^19.2.4"`
- **Fix**: Correct the spec.

### M-10. Existing tag filter test will break after bugfix (1/4 reviewers)

- **File**: `queries.rs` test `test_get_archive_summaries_filtered_by_tags`
- **Problem**: Test passes tag **names** (matching the buggy `t.name`). After fixing to `t.id`, the test must be updated to pass tag IDs.

---

## MINOR Issues (Address during implementation if convenient)

| ID | Issue | Source |
|----|-------|--------|
| m-1 | `window.confirm()` looks alien in dark-themed Tauri app. Consider in-app modal or `@tauri-apps/plugin-dialog` `ask()` | Edge, Frontend |
| m-2 | Drag-drop outside any FolderItem (on sidebar header/spacer) has no defined behavior. Card snaps back silently. | Edge |
| m-3 | useDragDrop `SUPPORTED_EXTENSIONS` only has `.zip/.cbz/.cbr` but spec import lists `.rar/.7z/.cb7` too. Align formats. | Integration |
| m-4 | Toast auto-dismiss 3s may be too short for error messages. Consider longer duration for error type. | Edge |
| m-5 | Smart folder conditions reference tag names (not IDs). If a tag is renamed after smart folder creation, it stops matching. | Integration |
| m-6 | ContextMenu `separator` field draws separator ABOVE the item, not below. Implementer must put `separator: true` on the first item after the divider. | Frontend |
| m-7 | `delete_archives` uses `remove_dir_all(parent)` which deletes the entire parent directory. Safe if archives use per-ID subdirectories, dangerous otherwise. | Integration, Edge |
| m-8 | No keyboard shortcut for folder/smart folder creation (power user gap). | Edge |
| m-9 | After folder drag operation, DetailPanel's `folders` list becomes stale. Need to re-fetch detail. | Integration |
| m-10 | `Mutex<Option<Connection>>` serializes all commands. Fine for sync commands but blocks concurrency. | Backend |
| m-11 | Sidebar will grow to 5 store selectors + 6 local states. Consider extracting `useContextMenu` hook (reused by ArchiveGrid too). | Frontend |
| m-12 | `import_archives` returns `Vec<Archive>` — return value available for "N files imported" toast. | Integration |
| m-13 | Duplicate folder names allowed (no UNIQUE constraint on `folders.name`). | Edge |

---

## Positive Findings (What's already correct)

- All 25 Tauri commands are registered in `lib.rs`. Every command the spec needs exists.
- SmartFolderEditor props (`existing?`, `onClose`, `onSaved?`) match spec's assumptions exactly.
- TagEditor props (`archiveId`, `currentTags`, `onClose`, `onSaved?`) match exactly.
- ContextMenu props (`x`, `y`, `items`, `onClose`) match exactly.
- Foreign key cascades are properly configured (archive_folders, archive_tags both CASCADE on DELETE).
- `PRAGMA foreign_keys=ON` is set at connection init.
- `clearSelection()` is defined in the store (libraryStore.ts:122).
- `fetchFolders()` / `fetchSmartFolders()` are defined and available.
- `ArchiveDetail` type includes `tags`, `folders`, `memo` — matches backend.
- `@tauri-apps/plugin-dialog` is installed (npm + Cargo + lib.rs + capabilities).
- Tauri IPC parameter naming (camelCase ↔ snake_case) is correctly handled in all existing call sites.
- Type alignment between TypeScript and Rust is solid for all models.

---

## Recommended Spec Updates (Priority Order)

1. **Add to bug fixes**: Favorites preset "favorite" → "favorites" (C-1)
2. **Document**: DragTarget JSON format `{ Folder: id }` (C-2)
3. **Add**: `From<serde_json::Error>` impl needed (C-3)
4. **Specify**: Transaction ordering for `delete_archives` (C-4)
5. **Specify**: Parameterized queries for smart folder conditions (C-6)
6. **Clarify**: "move to folder" semantics — true move or add? (M-1)
7. **Note**: `tag.color` is dead code in TagEditor (M-2)
8. **Add**: Request cancellation for DetailPanel detail fetch (M-3)
9. **Note**: Move VirtuosoGrid components outside render body (M-4)
10. **Add**: Reset filter after deleting active folder/smart folder (M-6)
11. **Add**: `clearSelection()` in ArchiveGrid delete path too (M-7)
12. **Fix**: React version in spec (18 → 19) (M-9)
13. **Note**: Tag filter test must be updated alongside bugfix (M-10)
