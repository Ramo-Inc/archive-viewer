// ============================================================
// Data model types — aligned with Rust backend (src-tauri/src/db/models.rs)
// IDs are String (UUID) in the backend, represented as string here.
// ============================================================

/** Summary returned when listing archives in the library grid. */
export interface ArchiveSummary {
  id: string;
  title: string;
  thumbnail_path: string | null;
  rank: number;
  is_read: boolean;
  format: string;
  missing: boolean;
}

/** Full detail returned when opening a single archive. */
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
  missing: boolean;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  folders: Folder[];
}

/** ArchiveDetail + pages (assembled in the frontend after prepare_pages) */
export interface ViewerArchive extends ArchiveDetail {
  pages: PageInfo[];
}

/** Payload for updating archive metadata. */
export interface ArchiveUpdate {
  title?: string;
  rank?: number;
  memo?: string;
  is_read?: boolean;
}

/** Filter / sort criteria sent to the backend. */
export interface ArchiveFilter {
  folder_id?: string | null;
  smart_folder_id?: string | null;
  preset?: string;
  sort_by?: string;
  sort_order?: string;
  filter_tags?: string[];
  filter_min_rank?: number;
  search_query?: string;
}

/** A physical folder registered in the library. */
export interface Folder {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
}

/** A tag that can be attached to archives. */
export interface Tag {
  id: string;
  name: string;
}

/** A smart folder (saved filter). */
export interface SmartFolder {
  id: string;
  name: string;
  conditions: string;
  sort_order: number;
  created_at: string;
}

/** Information about a single page within an archive. */
export interface PageInfo {
  index: number;
  url: string;
  width: number;
  height: number;
  /** Whether this page should be displayed as a spread (double-width). */
  is_spread: boolean;
}

/** Viewer display settings (persisted to config.json). */
export interface ViewerSettings {
  moire_reduction: number;
}
