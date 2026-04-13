# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Frontend development
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # tsc type check + Vite production build
npm run lint       # ESLint static analysis

# Desktop app (Tauri)
npx tauri dev      # Full desktop app with hot reload
npx tauri build    # Production desktop build

# Rust backend only
cd src-tauri && cargo check   # Type check Rust code
cd src-tauri && cargo build   # Build Rust backend
```

There is no test suite yet.

## Architecture

**Tauri 2 + React 19 + TypeScript desktop app** — a manga/comic archive viewer (ZIP/RAR) with library management.

### Frontend (`src/`)

**Pages** (`src/pages/`): Three routes defined in `App.tsx`:
- `SetupWizard` — shown on first run when no library path is configured
- `LibraryPage` — main view with grid, sidebar, detail panel, top bar
- `ViewerPage` — manga reader with spread/single/webtoon modes

**State** (`src/stores/`): Three Zustand stores — always use selectors (`useLibraryStore(s => s.archives)`) to minimize re-renders:
- `libraryStore` — archives[], folders[], tags[], smartFolders[], selectedArchiveIds[], filter object; `setFilter(patch)` auto-fetches
- `viewerStore` — current archive pages, page navigation with spread-aware step calculation, view/order settings
- `toastStore` — transient notifications

**Components** (`src/components/`):
- `common/` — reusable primitives (ContextMenu, DragDropZone, Toast, RankStars)
- `library/` — grid and management UI (ArchiveGrid uses VirtuosoGrid for virtualization, DetailPanel, Sidebar with folder tree)
- `viewer/` — reader UI (SpreadView handles RTL/spread/cover-alone logic, PageSlider, ViewerTopBar)

**IPC** (`src/hooks/useTauriCommand.ts`): Wrapper around `@tauri-apps/api/core` `invoke()`. All backend calls go through Tauri commands — never direct file/DB access from frontend.

### Backend (`src-tauri/src/`)

**Commands** (`commands/`): ~25 Tauri commands registered in `lib.rs`:
- `library.rs` — folder/tag/smart-folder CRUD, `init_library`, `get_library_path`
- `archive.rs` — `get_archives(filter)`, update/delete, `import_files`
- `viewer.rs` — `prepare_pages` (extracts to temp dir, returns asset URLs), `save_read_position`
- `drag_drop.rs` — `import_dropped_files`

**Database** (`db/`): SQLite via `rusqlite` with WAL mode and foreign keys. Schema in `migrations.rs`. State managed as `Mutex<Option<Connection>>` in `DbState`. Tables: `archives`, `folders`, `tags`, `archive_tags`, `archive_folders`, `smart_folders`.

**Import workflow** (`library/import.rs`): drag/file-pick → extract archive → generate thumbnail (`imaging/thumbnail.rs`) → insert into DB.

**Viewer workflow** (`commands/viewer.rs`): `prepare_pages` extracts archive pages to OS temp dir → returns `PageInfo[]` with Tauri asset protocol URLs → `cleanup_temp_pages` on navigation away.

### Data Flow

```
User action → React component → Zustand action → invoke(tauri_command) → Rust handler → SQLite/filesystem → serialized response → store update → component re-render
```

### Styling

CSS custom properties only — no CSS-in-JS library. Dark theme variables defined in `src/styles/global.css` (`--bg-*`, `--text-*`, `--accent-*`). Components use inline styles and standard CSS.

## Key Patterns

- **Natural sort**: `natord` crate used for page ordering within archives (ch1, ch2... ch10)
- **Smart folders**: Conditions stored as JSON in `smart_folders.conditions` column, evaluated at query time in `queries.rs`
- **Spread view**: `viewerStore.computeStep()` accounts for cover-alone setting and `is_spread` flag per page when advancing pages
- **Virtualization**: `react-virtuoso` `VirtuosoGrid` for the archive grid — avoid layout changes that break virtual item sizing
- **Error type**: All Rust errors funnel through `AppError` enum in `error.rs`, serialized to string for frontend
