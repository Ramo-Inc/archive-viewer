# Import Progress Indicator Design

## Goal

Display a progress bar during drag-and-drop file import so the user knows the operation is running, how far along it is, and can cancel if needed.

## Problem

The current `import_dropped_files` command blocks synchronously until all files are processed. No progress events are emitted. The only feedback is a single toast after completion. For multi-file imports, the UI appears frozen.

## Architecture

```
[Drop event] → useDragDrop → invoke("import_dropped_files") 
                                    ↓ (spawned thread)
                              For each file:
                                emit("import-progress", {current, total, file_name})
                                check cancel flag → if true, break
                                prepare_import → commit_import
                                    ↓
                              emit("import-complete", {imported, total, cancelled, errors})

[Frontend]
  listen("import-progress") → importStore update → overlay render
  listen("import-complete") → importStore reset → toast
  Cancel button → invoke("cancel_import") → AtomicBool set
```

## Backend Changes

### New managed state: `ImportCancelFlag`

```rust
pub struct ImportCancelFlag {
    pub cancel: AtomicBool,
    pub running: AtomicBool,
}
```

Registered in `lib.rs` alongside `DbState`. `cancel` is set by `cancel_import`, checked each iteration. `running` prevents concurrent imports — `import_dropped_files` returns an error if already `true`.

### Modified command: `import_dropped_files`

- Add `app: AppHandle` parameter to access the event emitter.
- Spawn a blocking thread (`std::thread::spawn` or `tauri::async_runtime::spawn_blocking`) so the Tauri command returns immediately.
- Inside the thread, loop through files:
  1. Check `cancel_flag.load(Ordering::Relaxed)` — if true, break.
  2. Emit `import-progress` event with `{ current: i, total: n, file_name }`.
  3. Call `prepare_import` then `commit_import`.
  4. On per-file error: record the error, continue to next file (do not abort batch).
- After loop, emit `import-complete` with `{ imported: count, total: n, cancelled: bool, errors: Vec<String> }`.
- Reset `cancel_flag` to `false` at the start of each import batch.

### New command: `cancel_import`

```rust
#[tauri::command]
pub fn cancel_import(flag: State<'_, ImportCancelFlag>) -> Result<(), AppError> {
    flag.cancel.store(true, Ordering::Relaxed);
    Ok(())
}
```

### Error handling change

Current behavior: first error stops the entire batch. New behavior: per-file errors are collected, remaining files continue. Summary reported at completion.

### Import event payloads

```rust
#[derive(Clone, Serialize)]
struct ImportProgress {
    current: usize,   // 1-indexed (file currently being processed)
    total: usize,
    file_name: String,
}

#[derive(Clone, Serialize)]
struct ImportComplete {
    imported: usize,
    total: usize,
    cancelled: bool,
    errors: Vec<String>,
}
```

## Frontend Changes

### New store: `importStore.ts`

```typescript
interface ImportState {
  active: boolean;
  current: number;
  total: number;
  setProgress: (current: number, total: number) => void;
  reset: () => void;
}
```

Zustand store, same pattern as `toastStore`. Updated by event listeners, read by `ImportProgress` component.

### New component: `ImportProgress.tsx`

Bar at the bottom of the flex layout (48px height, `flexShrink: 0`). Part of the normal document flow — not `position: fixed` — so the content area shrinks naturally when the bar is visible. Rendered in `LibraryPage` when `importStore.active` is true.

Layout:
```
┌──────────────────────────────────────────────────┐
│  spinner  3 / 10 インポート中...  [████░░░] [キャンセル] │
└──────────────────────────────────────────────────┘
```

- Background: `var(--bg-secondary)` with top border `var(--border-color)`
- Progress bar fill: `var(--accent)`
- Cancel button: text button, calls `tauriInvoke('cancel_import')`
- Auto-hides when `active` is false

### Modified hook: `useDragDrop.ts`

- Remove the direct `tauriInvoke('import_dropped_files')` call's success/error toast handling (the import-complete event handles it now).
- Add event listeners for `import-progress` and `import-complete`:
  - `import-progress`: update `importStore`
  - `import-complete`: reset `importStore`, show summary toast, call `fetchArchives()`
- The backend spawns a thread and returns `Ok(())` immediately.
- Guard: if `importStore.active` is true, reject the drop with a toast (prevent concurrent imports).
- Show progress bar immediately on drop (before first backend event arrives).

### Toast messages

| Scenario | Message |
|----------|---------|
| All succeeded | `10件のファイルをインポートしました` |
| Partial success | `8/10件インポート完了（2件失敗）` |
| Cancelled (some imported) | `3件インポート済み（キャンセル）` |
| Cancelled (none imported) | `インポートをキャンセルしました` |
| All failed | `インポートに失敗しました` |

## Files to create or modify

| File | Action |
|------|--------|
| `src-tauri/src/commands/drag_drop.rs` | Modify: async import with emit + cancel check |
| `src-tauri/src/library/import.rs` | No change: `import_dropped_files` calls `prepare_import`/`commit_import` directly with its own loop. `import_files` is kept as-is for the file-picker path (`import_archives`). |
| `src-tauri/src/lib.rs` | Modify: register `ImportCancelFlag` state and `cancel_import` command |
| `src/stores/importStore.ts` | Create: progress state |
| `src/components/common/ImportProgress.tsx` | Create: progress bar UI |
| `src/hooks/useDragDrop.ts` | Modify: event listeners, remove blocking await |
| `src/pages/LibraryPage.tsx` | Modify: render `ImportProgress` component |

## Out of scope

- Per-file step-level progress (copy, thumbnail, DB)
- Drag-and-drop from file picker (only drag-drop is affected)
- Retry failed files
- Import queue / background import
