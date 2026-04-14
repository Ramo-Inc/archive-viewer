# Import Progress Indicator - Multi-Angle Critical Review

Reviewed: `docs/superpowers/specs/2026-04-14-import-progress-design.md` and `docs/superpowers/plans/2026-04-14-import-progress.md`

Date: 2026-04-14

Reviewers: 4 independent subagents (Backend Architecture, Frontend Integration, Concurrency & Edge Cases, Spec-Plan Consistency)

---

## Critical Issues (must fix before implementation)

### C1: `file_name` use-after-move — code will not compile

**Found by:** All 4 reviewers

In Task 2's import loop, `file_name` (a `String`) is moved into `ImportProgress` struct via `app.emit()`, then used again in the error branch:

```rust
let _ = app.emit("import-progress", ImportProgress {
    current: i + 1, total, file_name,  // <-- moves file_name
});
// ...
Err(e) => errors.push(format!("{}: {}", file_name, e)),  // use after move!
```

**Fix:** Clone before moving:
```rust
let _ = app.emit("import-progress", ImportProgress {
    current: i + 1, total, file_name: file_name.clone(),
});
```

### C2: No concurrent import guard — cancel flag race condition

**Found by:** Backend, Frontend, Concurrency reviewers

If the user drops a second batch while the first import is running:
1. `import_dropped_files` resets `cancel_flag` to `false`, silently un-cancelling the first import
2. Two threads run concurrently, emitting interleaved progress events
3. `importStore` has a single `{current, total}` — progress bar shows nonsensical state (e.g., "2/5" then "1/10")
4. First thread's `import-complete` event resets the progress bar while second is still running

**Fix:** Add a running guard:
```rust
pub struct ImportCancelFlag {
    pub cancel: AtomicBool,
    pub running: AtomicBool,
}
```
Check `running` at the start — return an error if already `true`. Set to `true` before spawning, `false` in the thread after loop ends. Also add frontend guard: if `importStore.active`, reject the drop with a toast.

---

## High Severity Issues

### H1: `position: fixed` progress bar overlaps content

**Found by:** Frontend reviewer

`ImportProgress` uses `position: fixed; bottom: 0; height: 48px`. The main content `height: 100vh` does not shrink. The bottom 48px of `ArchiveGrid` is occluded during import. `VirtuosoGrid` does not know about the overlay.

**Fix:** Either:
- (a) Make `ImportProgress` part of the flex layout (not `fixed`) with `flexShrink: 0`, placed at the bottom of the column. Content area naturally shrinks.
- (b) Keep `position: fixed` but add conditional `paddingBottom: 48px` to the content container when `active` is true.

### H2: Detached thread has no shutdown coordination

**Found by:** Concurrency reviewer

`std::thread::spawn` drops the `JoinHandle`, detaching the thread. If the app closes mid-import:
- The thread continues running against a partially-destroyed runtime
- `fs::copy` of a large archive could be interrupted mid-write, leaving a corrupt file
- No `import-complete` event is ever emitted

**Fix:** Consider using `tauri::async_runtime::spawn_blocking` for graceful shutdown integration. Or store the `JoinHandle` in managed state and join on `RunEvent::Exit`. At minimum, set the cancel flag on app exit to allow the thread to finish cleanly.

### H3: DbState mutex contention may starve UI commands

**Found by:** Concurrency reviewer

The import thread acquires `DbState` mutex for each `commit_import`. Other Tauri commands (`get_archives`, `update_archive`, etc.) also lock this mutex. On a multi-core system, the import thread can re-acquire the lock before queued UI commands, causing brief UI freezes during multi-file import.

**Fix:** Add `std::thread::yield_now()` after each `commit_import` to give waiting Tauri command threads a chance to acquire the lock.

### H4: `import_archives` (file picker) not updated — inconsistent UX

**Found by:** Backend, Concurrency reviewers

The `import_archives` command in `archive.rs` (used by TopBar file picker) still calls `import::import_files()` synchronously with no progress indicator. Drag-drop gets progress + cancel; file picker freezes the UI. Users will be confused by the inconsistency.

**Fix:** Either update `import_archives` to use the same event-based pattern, or explicitly document as out-of-scope with a follow-up ticket.

---

## Medium Severity Issues

### M1: Thread panic leaves progress bar stuck forever

**Found by:** Consistency reviewer

If the spawned thread panics (unexpected error, poisoned Mutex), no `import-complete` event is emitted. The progress bar stays visible indefinitely with no dismiss mechanism.

**Fix:** Wrap thread body in `std::panic::catch_unwind` and emit `import-complete` with error info in the catch handler:
```rust
std::thread::spawn(move || {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // ... import loop ...
    }));
    if result.is_err() {
        let _ = app.emit("import-complete", ImportComplete {
            imported: 0, total: 0, cancelled: false,
            errors: vec!["内部エラーが発生しました".to_string()],
        });
    }
});
```

### M2: `Arc<AtomicBool>` vs bare `AtomicBool` — spec/plan disagree

**Found by:** All 4 reviewers

Design spec says `Arc<AtomicBool>`, plan says `AtomicBool`. Plan is correct (Tauri wraps managed state in `Arc` internally).

**Fix:** Update the design spec to match the plan.

### M3: `std::thread::spawn` vs `tauri::async_runtime::spawn_blocking`

**Found by:** Consistency reviewer

`std::thread::spawn` creates a fully detached thread outside Tauri's runtime lifecycle. `spawn_blocking` would be managed by Tokio's runtime and shut down more gracefully on app exit.

**Fix:** Consider switching to `spawn_blocking`. If keeping `std::thread::spawn`, document the rationale.

### M4: `Ordering::Relaxed` technically non-portable

**Found by:** Concurrency reviewer

`Relaxed` provides no ordering guarantees on ARM. While this Windows app targets x86_64 (strong memory model), the correct pattern is `Release` for the store (in `cancel_import`) and `Acquire` for the load (in the import loop).

**Fix:** Change to `Release`/`Acquire` ordering. Negligible performance cost.

### M5: Three separate Zustand selectors cause unnecessary subscriptions

**Found by:** Frontend reviewer

`ImportProgress` uses three individual selectors (`active`, `current`, `total`). While React 18 batches updates, using a single shallow selector is cleaner:
```typescript
import { shallow } from 'zustand/shallow';
const { active, current, total } = useImportStore(
  (s) => ({ active: s.active, current: s.current, total: s.total }),
  shallow
);
```

### M6: `import.rs` not modified per spec

**Found by:** Consistency reviewer

The spec says to modify `import_files` to return partial results. The plan bypasses it by calling `prepare_import`/`commit_import` directly. This is functionally correct but should be documented as an intentional divergence. The existing `import_files` retains fail-fast behavior for the file picker path.

### M7: 500ms debounce can discard intentional drops

**Found by:** Concurrency reviewer

If a user drops 3 files, then drops 2 more within 500ms, the first drop's payload is overwritten. Only the second set of 2 files is imported.

**Fix:** Document that the debounce is for Tauri's duplicate event handling, not for user rapid-drops. Consider accumulating paths instead of replacing them.

---

## Low Severity Issues

### L1: `fileName` tracked in store but never displayed

The `importStore` tracks `fileName` but `ImportProgress` never reads it. Either display it or remove it from the store.

### L2: "0件インポート済み（キャンセル）" is awkward UX

If cancel fires before any file is processed, the message "0件インポート済み" sounds like it did something. Add a special case:
```typescript
if (cancelled && imported === 0) {
    addToast('インポートをキャンセルしました', 'info');
}
```

### L3: No immediate progress bar on drop

The progress bar does not appear until the first `import-progress` event arrives from the spawned thread. For fast imports, the user may never see it. Consider calling `setProgress(0, archivePaths.length, '')` immediately in `handleDrop`.

### L4: Toast type `'error'` for partial success

Partial success (8/10 imported, 2 failed) shows an `'error'` toast. Consider `'info'` since most files succeeded.

### L5: Empty `file_paths` spawns unnecessary thread

If 0 files pass the filter, the backend spawns a thread that immediately emits `import-complete` with `imported: 0`. Add an early return before thread spawn.

### L6: Mutex PoisonError skips `cleanup_prepared`

If `DbState` lock fails after `prepare_import` succeeds, the copied file and thumbnail are orphaned on disk. Move `prepare_import` outside the inner closure and add explicit cleanup on lock failure.

---

## Recommendations Summary

| Priority | Issue | Action |
|----------|-------|--------|
| **MUST FIX** | C1: `file_name` use-after-move | Add `.clone()` |
| **MUST FIX** | C2: Concurrent import race | Add `running` guard (backend + frontend) |
| **SHOULD FIX** | H1: Progress bar overlaps content | Use flex layout instead of `position: fixed` |
| **SHOULD FIX** | H2: Detached thread shutdown | Use `spawn_blocking` or handle `RunEvent::Exit` |
| **SHOULD FIX** | H3: Mutex contention starvation | Add `yield_now()` after each commit |
| **CONSIDER** | H4: `import_archives` inconsistency | Update or document as out-of-scope |
| **CONSIDER** | M1: Thread panic recovery | Add `catch_unwind` |
| **CONSIDER** | M4: Memory ordering | Change to `Release`/`Acquire` |
| Plan update | M2, M6: Spec divergences | Update spec to match plan decisions |
| Plan update | L1-L6: Minor UX/cleanup | Incorporate into implementation tasks |

---

## Verdict

The overall architecture (background thread + Tauri events + Zustand store + cancel flag) is sound. The approach follows established Tauri patterns and the code structure is clean. However, **2 critical issues** must be fixed before implementation (compile error and race condition), and **4 high-severity issues** should be addressed to avoid UX degradation and edge-case failures. After incorporating these fixes, the plan is ready for implementation.
