# Design Review: Image Quality + Lazy Page Cache

**Reviewed documents:**
- `docs/superpowers/idea/2026-04-13-image-moire-fix-plans.md`
- `docs/superpowers/specs/2026-04-13-image-quality-and-page-cache-design.md`

**Reviewer:** Code Review Agent
**Date:** 2026-04-13
**Verdict:** Conditionally Implementable (7 issues found: 2 Critical, 3 Important, 2 Suggestions)

---

## Executive Summary

The design is generally well-thought-out and demonstrates a clear understanding of the existing codebase. However, there are several issues ranging from critical correctness bugs to important design oversights that must be addressed before implementation.

---

## 1. Implementation Feasibility Checks

### 1.1 Existing code alignment

**Status: PASS with issues noted below**

The design correctly identifies:
- `src-tauri/src/commands/viewer.rs` `prepare_pages` signature and general flow
- `src-tauri/src/db/models.rs` `PageInfo` struct fields (`index: usize`, `url: String`, `width: u32`, `height: u32`, `is_spread: bool`)
- `src/components/viewer/SpreadView.tsx` has exactly 4 `<img>` elements with `imageRendering: 'smooth'`
- `src/stores/viewerStore.ts` `closeArchive` calls `cleanup_temp_pages`
- `src-tauri/src/lib.rs` registers `prepare_pages`, `save_read_position`, and `cleanup_temp_pages`

### 1.2 serde_json in Cargo.toml

**Status: PASS**

`serde_json = "1"` is already present in `src-tauri/Cargo.toml` line 21. No additional dependency needed for meta.json read/write.

### 1.3 CachedPageMeta to PageInfo conversion

**Status: PASS with CRITICAL issue**

The design's `CachedPageMeta` struct:
```rust
struct CachedPageMeta {
    index: usize,
    file_name: String,
    width: u32,
    height: u32,
    is_spread: bool,
}
```

The existing `PageInfo` struct:
```rust
pub struct PageInfo {
    pub index: usize,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub is_spread: bool,
}
```

The conversion requires reconstructing `url` from `file_name` + cache directory path. This is conceptually correct, but see **Critical Issue #1** below regarding the exact URL construction logic.

### 1.4 Archive deletion and cache cleanup

**Status: PASS**

Verified in `src-tauri/src/commands/archive.rs` lines 61-84:
```rust
let file_full_path = library_path.join(&archive.file_path);
if let Some(parent) = file_full_path.parent() {
    let _ = std::fs::remove_dir_all(parent);
}
```

Since `archive.file_path` = `"archives/{archive_id}/filename.cbz"` (confirmed in `import.rs` line 109), `file_full_path.parent()` resolves to `library_path/archives/{archive_id}/`. The `remove_dir_all(parent)` will indeed delete the entire `archives/{archive_id}/` directory including the new `pages/` subdirectory. The design's assertion is **correct**.

---

## 2. Critical Issues (MUST FIX)

### Critical #1: URL path construction for cached pages uses wrong base path

**Location:** Design spec section "prepare_pages new flow" (cache hit path)

**Problem:** The current `prepare_pages` constructs the URL by writing files to `library_path/temp/{session_id}/` and then converting the full filesystem path:

```rust
// Current code (viewer.rs line 83-85)
let url = page_path
    .to_string_lossy()
    .replace('\\', "/");
```

This produces an absolute filesystem path like `D:/MangaLibrary/temp/uuid/0_page001.png`.

For the cached version, the design says files live in `archives/{archive_id}/pages/`. The implementation must construct the URL as the **absolute filesystem path** to the cached file (e.g., `D:/MangaLibrary/archives/{archive_id}/pages/000_page001.png`), not a relative path.

The design document does not explicitly show the URL reconstruction code for the cache hit path. The implementer must ensure:

```rust
let page_file_path = pages_dir.join(&meta.file_name);
let url = page_file_path.to_string_lossy().replace('\\', "/");
```

**Risk if missed:** If the URL is built as a relative path or with incorrect base, `convertFileSrc()` will produce a broken asset URL, and images will not display at all.

**Recommendation:** Add explicit pseudo-code for the cache-hit URL construction in the design document.

### Critical #2: Race condition -- concurrent opens of the same archive create partial cache corruption

**Location:** Design spec "prepare_pages new flow"

**Problem:** The design has no protection against the following scenario:

1. User opens Archive A. `prepare_pages` starts extracting to `archives/A/pages/`.
2. User quickly closes and reopens Archive A (or a rapid double-click triggers two `openArchive` calls).
3. The second `prepare_pages` call sees `pages/meta.json` does not exist yet (first extraction still in progress), so it also starts extracting.
4. Two processes are now writing to the same `pages/` directory simultaneously.
5. One process writes `meta.json` while the other is still extracting, resulting in a `meta.json` that lists files which are partially written or missing.

Unlike the current `temp/{UUID}/` approach which uses unique session IDs (each call gets its own directory), the cache design uses a **shared, deterministic path** (`archives/{archive_id}/pages/`).

**Impact:** File corruption, truncated images, `meta.json` listing files that are incomplete.

**Recommendation:** Add one of:
- (A) **File-based lock:** Create a `.lock` file during extraction. If `.lock` exists, second caller waits or falls back to temp extraction.
- (B) **Atomic write with rename:** Extract to a temporary directory first (e.g., `archives/{archive_id}/pages_tmp_{uuid}/`), then atomically rename to `pages/` on completion. If `pages/` already exists when rename is attempted, delete the temp dir and use the existing cache.
- (C) **In-memory Mutex per archive_id:** Use a `HashMap<String, Mutex<()>>` managed by Tauri state to serialize access per archive.

Option (B) is recommended as it is crash-safe and requires no in-memory state.

---

## 3. Important Issues (SHOULD FIX)

### Important #1: `cleanup_temp_pages` removal from `closeArchive` creates temp directory leak

**Location:** Design spec "Changed files" section

**Problem:** The design says to remove the `cleanup_temp_pages` call from `closeArchive` because "cache is persistent so cleanup is unnecessary." However, this creates a subtle leak:

The new `prepare_pages` will write to `archives/{archive_id}/pages/` on cache miss. But what about the **first time** the new code runs on an existing library that already has files in `temp/`? And what about the transition period where old temp files exist?

More importantly: **what if the cache extraction fails partway through?** The design's error handling table says "delete partial `pages/`" but does NOT address what happens to any existing `temp/` directories from previous sessions.

Furthermore, `cleanup_temp_pages` currently cleans up ALL temp session directories. If the `closeArchive` call is removed entirely, old temp data from crashed sessions will accumulate forever.

**Recommendation:** Keep `cleanup_temp_pages` but change when it runs:
- Call it **once at application startup** (in `setup()` in `lib.rs`) to clean up any leftover temp directories from previous sessions.
- Remove it from `closeArchive` as the design suggests.
- This is a safe middle ground: cache is persistent, but stale temp data does not accumulate.

### Important #2: `filter: blur()` CSP consideration

**Location:** Design spec section 1, `tauri.conf.json` line 23

**Problem:** The current CSP is:
```
default-src 'self'; img-src 'self' asset: http://asset.localhost; style-src 'self' 'unsafe-inline'
```

CSS `filter: blur(0.3px)` is an inline style applied via React. It does NOT require changes to the CSP because:
1. `'unsafe-inline'` is already in `style-src` (covers inline styles).
2. CSS `filter` does not load external resources; it is a rendering instruction.

However, there is a **performance concern** the design underestimates. The design's "Plan C demerits" section mentions "GPU composite layer added" but does not quantify the impact.

On Chromium/WebView2, `filter: blur()` on an `<img>` element:
- Forces the element onto its own compositing layer (GPU texture upload).
- For manga pages (typically 1200x1800 to 4000x6000 pixels), this means **each visible page** creates a GPU texture of that size.
- In spread mode, that is **two** large GPU textures simultaneously.
- On systems with limited VRAM or integrated GPUs, this can cause stuttering during page transitions.

**Recommendation:** 
- Document the expected VRAM impact in the design (e.g., 4000x6000x4bytes = ~96MB per page RGBA).
- Consider adding `will-change: transform` to the `<img>` elements to hint the browser to pre-allocate the compositing layer, reducing jank on page transitions.
- Alternatively, apply the blur **only when the image is at reduced scale** (when `naturalWidth > displayWidth * 1.5`) to avoid unnecessary GPU overhead on images that are displayed at or near native resolution.

### Important #3: Cache validation checks ALL files every open -- O(n) filesystem stat calls

**Location:** Design spec "prepare_pages new flow" -- "check all page files exist"

**Problem:** The design specifies that on cache hit, ALL page files must be verified to exist on disk before using the cache. For a typical manga volume with 200+ pages, this means 200+ `fs::metadata()` or `Path::exists()` calls on every `prepare_pages` invocation.

On Windows, each `Path::exists()` call involves a system call that can take 0.1-1ms depending on disk state and antivirus software. For 200 pages, this is 20-200ms of blocking I/O **on every archive open** in the happy path.

This is particularly concerning because `prepare_pages` is called from the frontend via Tauri's synchronous command handler, which blocks the Tauri command thread.

**Recommendation:**
- **Option A (Simple):** Only check `meta.json` existence and first/last page file existence as a quick sanity check rather than all pages. This reduces O(n) to O(1).
- **Option B (Better):** Store a file count or checksum in `meta.json` and only verify the count matches the directory listing (`fs::read_dir` is a single syscall).
- **Option C (Best):** Trust `meta.json` entirely. If a page file is missing at render time, the frontend's `<img>` `onerror` handler can trigger a re-extraction of that single page. This eliminates the validation cost entirely.

---

## 4. Suggestions (NICE TO HAVE)

### Suggestion #1: Zip Slip protection should be carried over to cache extraction

**Location:** Current `viewer.rs` lines 49-73

**Problem:** The current `prepare_pages` has thorough Zip Slip protection (path traversal prevention via `canonicalize` check). The design document does not mention whether this security check should be preserved when extracting to the cache directory. Since the extraction logic itself does not change (same `reader.extract_page()` + `safe_filename` construction), this should naturally carry over, but the design should explicitly state that the Zip Slip protections remain in place in the new flow.

**Recommendation:** Add a note in the design: "Existing Zip Slip (CR-1) path traversal protection MUST be preserved in the cache extraction path."

### Suggestion #2: Design should address cache invalidation for re-imported archives

**Location:** Not addressed in design

**Problem:** If a user deletes an archive and then re-imports the same file, it gets a new `archive_id` (UUID), so the cache is automatically fresh. However, if the application ever supports "re-scan" or "update archive file" functionality in the future, the cache could become stale. The design's "Out of scope" section does not mention this, which is acceptable for now but worth noting.

**Recommendation:** Add a comment in the code noting that cache invalidation relies on the immutability of `archive_id` to file content mapping.

---

## 5. Windows-Specific Concerns

### 5.1 File locking during extraction (Asked in review point 9)

**Status: Low risk but worth noting**

On Windows, a file being written to is locked by the writing process. The current code writes each page file sequentially with `std::fs::write()`, which opens, writes, and closes the file handle atomically. Since `convertFileSrc` only creates a URL (the actual file read happens when the WebView2 renderer fetches the image via the asset protocol), and the file is fully written before its path is added to `page_infos`, there is **no file locking issue in the current sequential extraction flow**.

However, with the cache design, there is a potential issue: if `prepare_pages` is called while WebView2 is still rendering images from a previous viewing session of the same archive. WebView2's asset protocol handler may hold read handles on cached page files. If the cache validation fails and the code attempts `remove_dir_all(pages_dir)`, Windows will refuse to delete files that have open read handles.

**Recommendation:** If cache re-extraction is needed (fallback path), rename the old `pages/` to `pages_old_{uuid}/` first, create a new `pages/`, and defer cleanup of the old directory. Or simply accept that the fallback may fail on Windows when files are in use, and return an error asking the user to close and reopen.

### 5.2 Long path names on Windows

**Status: Low risk**

`archives/{uuid}/pages/{idx}_{filename}` with a library path like `D:\Users\username\Documents\MangaLibrary\` could approach the 260-character MAX_PATH limit if the original image filenames are long. The current code already handles this by using the original filename as-is. No new risk introduced by the cache design since the path depth only increases by one directory level (`pages/`).

---

## 6. Verification Summary

| # | Check Point | Status | Severity |
|---|-------------|--------|----------|
| 1 | File structure / function / data flow alignment | PASS | - |
| 2 | serde_json in Cargo.toml | PASS | - |
| 3 | CachedPageMeta to PageInfo conversion | ISSUE | Critical #1 |
| 4 | Archive deletion cache cleanup | PASS | - |
| 5 | CSS filter: blur() in WebView2 | PASS (with notes) | Important #2 |
| 6 | Cache hit URL path construction | ISSUE | Critical #1 |
| 7 | Cache corruption fallback | PARTIAL | Important #1 |
| 8 | Concurrent access race condition | ISSUE | Critical #2 |
| 9 | Windows file locking | LOW RISK | See 5.1 |
| 10 | Cache validation performance | ISSUE | Important #3 |

---

## 7. Actionable Checklist for Implementation

Before starting implementation, resolve:

- [ ] **MUST:** Add explicit URL construction pseudo-code for cache hit path in design
- [ ] **MUST:** Add concurrency protection (recommend atomic rename approach)
- [ ] **SHOULD:** Move `cleanup_temp_pages` to app startup instead of removing entirely
- [ ] **SHOULD:** Document GPU/VRAM impact of `filter: blur()` and consider conditional application
- [ ] **SHOULD:** Optimize cache validation to avoid O(n) stat calls
- [ ] **NICE:** Add note about preserving Zip Slip protection in cache path
- [ ] **NICE:** Add note about cache invalidation assumptions
