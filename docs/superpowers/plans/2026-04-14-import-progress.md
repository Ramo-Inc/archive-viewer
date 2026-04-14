# Import Progress Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a progress bar with file count and cancel button during drag-and-drop import.

**Architecture:** Backend spawns a background thread for import, emitting Tauri events per file. Frontend listens to events via a Zustand store and renders a fixed bottom bar. Cancel uses an `AtomicBool` flag checked each iteration.

**Tech Stack:** Tauri 2 events (`AppHandle::emit`), `std::sync::atomic::AtomicBool`, Zustand, React

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src-tauri/src/commands/drag_drop.rs` | Modify | Async import with event emission + cancel check |
| `src-tauri/src/lib.rs` | Modify | Register `ImportCancelFlag` state + `cancel_import` command |
| `src/stores/importStore.ts` | Create | Import progress state (active, current, total, fileName) |
| `src/components/common/ImportProgress.tsx` | Create | Bottom bar UI with progress + cancel |
| `src/hooks/useDragDrop.ts` | Modify | Listen to import events, remove blocking await |
| `src/pages/LibraryPage.tsx` | Modify | Render `ImportProgress` |

---

### Task 1: Backend — Add `ImportCancelFlag` and `cancel_import` command

**Files:**
- Modify: `src-tauri/src/commands/drag_drop.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `ImportCancelFlag` struct and `cancel_import` command to `drag_drop.rs`**

At the top of `src-tauri/src/commands/drag_drop.rs`, add the new imports and struct. Add `cancel_import` command at the end of the file.

```rust
// Add to existing imports:
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::State;

/// キャンセルフラグ (Tauri managed state)
pub struct ImportCancelFlag(pub AtomicBool);

// ... existing code ...

/// インポートをキャンセル
#[tauri::command]
pub fn cancel_import(flag: State<'_, ImportCancelFlag>) -> Result<(), crate::error::AppError> {
    flag.0.store(true, Ordering::Relaxed);
    Ok(())
}
```

- [ ] **Step 2: Register state and command in `lib.rs`**

In `src-tauri/src/lib.rs`, add the import and registration:

```rust
// Add import at top:
use commands::drag_drop::ImportCancelFlag;
use std::sync::atomic::AtomicBool;

// In run(), add .manage() call after existing .manage(DbState::empty()):
.manage(ImportCancelFlag(AtomicBool::new(false)))

// In invoke_handler, add after existing drag_drop commands:
commands::drag_drop::cancel_import,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors (warning about unused imports is OK at this stage)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/drag_drop.rs src-tauri/src/lib.rs
git commit -m "feat: add ImportCancelFlag state and cancel_import command"
```

---

### Task 2: Backend — Rewrite `import_dropped_files` with events and cancel support

**Files:**
- Modify: `src-tauri/src/commands/drag_drop.rs`

- [ ] **Step 1: Add event payload structs and new imports**

Add at the top of `src-tauri/src/commands/drag_drop.rs`:

```rust
use crate::config;
use crate::db::models::*;
use crate::db::queries;
use crate::db::DbState;
use crate::error::AppError;
use crate::library::import;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
struct ImportProgress {
    current: usize,
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

- [ ] **Step 2: Rewrite `import_dropped_files` to spawn a background thread**

Replace the existing `import_dropped_files` function with:

```rust
/// ドロップされたファイルをインポート (非同期・進捗イベント付き)
#[tauri::command]
pub fn import_dropped_files(
    app: AppHandle,
    file_paths: Vec<String>,
    folder_id: Option<String>,
) -> Result<(), AppError> {
    let library_path = config::get_library_root()?;

    // キャンセルフラグをリセット
    app.state::<ImportCancelFlag>().0.store(false, Ordering::Relaxed);

    std::thread::spawn(move || {
        let paths: Vec<PathBuf> = file_paths.iter().map(PathBuf::from).collect();
        let total = paths.len();
        let mut imported = 0usize;
        let mut errors: Vec<String> = Vec::new();
        let mut cancelled = false;

        for (i, file_path) in paths.iter().enumerate() {
            // キャンセルチェック
            if app.state::<ImportCancelFlag>().0.load(Ordering::Relaxed) {
                cancelled = true;
                break;
            }

            // 進捗イベント送信
            let file_name = file_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();
            let _ = app.emit("import-progress", ImportProgress {
                current: i + 1,
                total,
                file_name,
            });

            // ファイルをインポート (エラーは記録して続行)
            let result: Result<(), AppError> = (|| {
                let prepared = import::prepare_import(file_path, &library_path)?;
                let guard = app.state::<DbState>().0.lock()
                    .map_err(|e| AppError::Database(e.to_string()))?;
                let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
                import::commit_import(conn, &prepared, folder_id.as_deref())?;
                Ok(())
            })();

            match result {
                Ok(()) => imported += 1,
                Err(e) => errors.push(format!("{}: {}", file_name, e)),
            }
        }

        // 完了イベント送信
        let _ = app.emit("import-complete", ImportComplete {
            imported,
            total,
            cancelled,
            errors,
        });
    });

    Ok(())
}
```

- [ ] **Step 3: Remove unused import**

The `use tauri::State;` line is still needed for `cancel_import` and `handle_internal_drag`. Check that no unused imports remain. The `use crate::db::models::*;` import is needed for `DragTarget` in `handle_internal_drag`.

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: No errors

- [ ] **Step 5: Run existing tests**

Run: `cd src-tauri && cargo test`
Expected: All existing tests pass (import unit tests still work since `prepare_import` and `commit_import` are unchanged)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/drag_drop.rs
git commit -m "feat: async import_dropped_files with progress events and cancel support"
```

---

### Task 3: Frontend — Create `importStore`

**Files:**
- Create: `src/stores/importStore.ts`

- [ ] **Step 1: Create the store**

Create `src/stores/importStore.ts`:

```typescript
import { create } from 'zustand';

interface ImportState {
  active: boolean;
  current: number;
  total: number;
  fileName: string;
  setProgress: (current: number, total: number, fileName: string) => void;
  reset: () => void;
}

export const useImportStore = create<ImportState>((set) => ({
  active: false,
  current: 0,
  total: 0,
  fileName: '',

  setProgress: (current, total, fileName) =>
    set({ active: true, current, total, fileName }),

  reset: () =>
    set({ active: false, current: 0, total: 0, fileName: '' }),
}));
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/stores/importStore.ts
git commit -m "feat: add importStore for tracking import progress"
```

---

### Task 4: Frontend — Create `ImportProgress` component

**Files:**
- Create: `src/components/common/ImportProgress.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/common/ImportProgress.tsx`:

```tsx
import { useImportStore } from '../../stores/importStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';

export default function ImportProgress() {
  const active = useImportStore((s) => s.active);
  const current = useImportStore((s) => s.current);
  const total = useImportStore((s) => s.total);

  if (!active) return null;

  const percent = total > 0 ? (current / total) * 100 : 0;

  const handleCancel = () => {
    tauriInvoke('cancel_import').catch(() => {});
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 48,
        background: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 12,
        zIndex: 9000,
      }}
    >
      {/* Spinner */}
      <div
        style={{
          width: 18,
          height: 18,
          border: '2px solid var(--text-dim)',
          borderTopColor: 'var(--accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />

      {/* Text */}
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
        {current} / {total} インポート中...
      </span>

      {/* Progress bar */}
      <div
        style={{
          flex: 1,
          height: 6,
          background: 'var(--bg-tertiary)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${percent}%`,
            height: '100%',
            background: 'var(--accent)',
            borderRadius: 3,
            transition: 'width 0.2s ease',
          }}
        />
      </div>

      {/* Cancel button */}
      <button
        onClick={handleCancel}
        style={{
          fontSize: 12,
          padding: '4px 12px',
          borderRadius: 4,
          border: '1px solid var(--border-color)',
          background: 'transparent',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        キャンセル
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add spinner keyframe to global CSS**

In `src/styles/global.css`, add the `@keyframes spin` rule (check if it already exists first):

```css
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/components/common/ImportProgress.tsx src/styles/global.css
git commit -m "feat: add ImportProgress bottom bar component"
```

---

### Task 5: Frontend — Modify `useDragDrop` to listen to import events

**Files:**
- Modify: `src/hooks/useDragDrop.ts`

- [ ] **Step 1: Rewrite `useDragDrop.ts`**

Replace the entire file content:

```typescript
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { tauriInvoke } from './useTauriCommand';
import { useLibraryStore } from '../stores/libraryStore';
import { useImportStore } from '../stores/importStore';
import { useToastStore } from '../stores/toastStore';

const SUPPORTED_EXTENSIONS = ['.zip', '.cbz', '.cbr', '.rar'];
const DEBOUNCE_MS = 500;

function isSupportedFile(path: string): boolean {
  const lower = path.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function useDragDrop() {
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const unlisteners = Promise.all([
      // ドロップイベント
      listen<{ paths: string[]; position: { x: number; y: number } }>(
        'tauri://drag-drop',
        (event) => {
          if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
          }
          debounceTimer.current = setTimeout(() => {
            handleDrop(event.payload);
          }, DEBOUNCE_MS);
        },
      ),

      // インポート進捗イベント
      listen<{ current: number; total: number; file_name: string }>(
        'import-progress',
        (event) => {
          const { current, total, file_name } = event.payload;
          useImportStore.getState().setProgress(current, total, file_name);
        },
      ),

      // インポート完了イベント
      listen<{ imported: number; total: number; cancelled: boolean; errors: string[] }>(
        'import-complete',
        (event) => {
          const { imported, total, cancelled, errors } = event.payload;
          useImportStore.getState().reset();

          const addToast = useToastStore.getState().addToast;
          if (cancelled) {
            addToast(`${imported}件インポート済み（キャンセル）`, 'info');
          } else if (errors.length === 0) {
            addToast(`${imported}件のファイルをインポートしました`, 'success');
          } else if (imported > 0) {
            addToast(`${imported}/${total}件インポート完了（${errors.length}件失敗）`, 'error');
          } else {
            addToast('インポートに失敗しました', 'error');
          }

          useLibraryStore.getState().fetchArchives();
        },
      ),
    ]);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      unlisteners.then((fns) => fns.forEach((fn) => fn()));
    };
  }, []);
}

async function handleDrop(payload: {
  paths: string[];
  position: { x: number; y: number };
}) {
  const { paths, position } = payload;
  const addToast = useToastStore.getState().addToast;

  const archivePaths = paths.filter(isSupportedFile);

  if (archivePaths.length === 0) {
    addToast('サポートされていないファイル形式です。ZIP/CBZ/CBRファイルをドロップしてください。', 'error');
    return;
  }

  // ドロップ先フォルダを判定
  let folderId: string | null = null;
  const element = document.elementFromPoint(position.x, position.y);
  if (element) {
    const folderEl = (element as HTMLElement).closest('[data-folder-id]');
    if (folderEl) {
      const raw = folderEl.getAttribute('data-folder-id');
      if (raw !== null && !raw.startsWith('smart-')) {
        folderId = raw;
      }
    }
  }

  try {
    // バックエンドはスレッドをspawnして即座にOKを返す
    // 進捗はimport-progress/import-completeイベントで受信
    await tauriInvoke('import_dropped_files', {
      filePaths: archivePaths,
      folderId,
    });
  } catch (e) {
    addToast(`インポート開始に失敗しました: ${String(e)}`, 'error');
  }
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useDragDrop.ts
git commit -m "feat: useDragDrop listens to import-progress/complete events"
```

---

### Task 6: Frontend — Wire `ImportProgress` into `LibraryPage`

**Files:**
- Modify: `src/pages/LibraryPage.tsx`

- [ ] **Step 1: Add ImportProgress to LibraryPage**

In `src/pages/LibraryPage.tsx`, add the import and render the component:

Add import at top:
```typescript
import ImportProgress from '../components/common/ImportProgress';
```

Add `<ImportProgress />` inside the return JSX, right after `<ToastContainer />`:

```tsx
return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <DragDropZone />
      <ToastContainer />
      <ImportProgress />
      <TopBar />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar />
        <ArchiveGrid onOpenViewer={handleOpenViewer} />
        <DetailPanel onOpenViewer={handleOpenViewer} />
      </div>
    </div>
  );
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/pages/LibraryPage.tsx
git commit -m "feat: render ImportProgress in LibraryPage"
```

---

### Task 7: Full build and manual test

- [ ] **Step 1: Run full type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run Rust tests**

Run: `cd src-tauri && cargo test`
Expected: All tests pass

- [ ] **Step 3: Build and run the app**

Run: `npx tauri dev`

- [ ] **Step 4: Manual test — single file import**

1. Drag one ZIP/CBZ file onto the app window
2. Verify: progress bar appears at bottom with "1 / 1 インポート中..."
3. Verify: progress bar disappears when done
4. Verify: success toast appears
5. Verify: the imported archive appears in the grid

- [ ] **Step 5: Manual test — multi-file import**

1. Select 3+ ZIP/CBZ files and drag them onto the app window
2. Verify: progress bar shows "1 / 3", "2 / 3", "3 / 3" as each file is processed
3. Verify: progress bar fill animates
4. Verify: success toast shows correct count

- [ ] **Step 6: Manual test — cancel**

1. Prepare 5+ large ZIP files
2. Drag them onto the app window
3. Click "キャンセル" button during import
4. Verify: import stops processing remaining files
5. Verify: toast shows "N件インポート済み（キャンセル）"
6. Verify: already-imported files are in the grid, remaining files are not

- [ ] **Step 7: Commit final state**

```bash
git add -A
git commit -m "feat: import progress bar with cancel support"
```
