// ============================================================
// Data model types aligned with the PRD / Rust backend
// ============================================================

/** Summary returned when listing archives in the library grid. */
export interface ArchiveSummary {
  id: number;
  title: string;
  path: string;
  folder_id: number | null;
  page_count: number;
  /** base64-encoded thumbnail or asset URL */
  thumbnail: string | null;
  rating: number;
  favorite: boolean;
  read_count: number;
  last_read_at: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
}

/** Full detail returned when opening a single archive. */
export interface ArchiveDetail {
  id: number;
  title: string;
  path: string;
  folder_id: number | null;
  page_count: number;
  thumbnail: string | null;
  rating: number;
  favorite: boolean;
  read_count: number;
  last_read_at: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
  pages: PageInfo[];
}

/** Payload for updating archive metadata. */
export interface ArchiveUpdate {
  title?: string;
  rating?: number;
  favorite?: boolean;
  tag_ids?: number[];
}

/** Filter / sort criteria sent to the backend (Errata E3-2). */
export interface ArchiveFilter {
  folder_id?: number | null;
  smart_folder_id?: number | null;
  search_query?: string;
  tag_ids?: number[];
  rating_min?: number;
  favorite_only?: boolean;
  sort_by?: SortField;
  sort_order?: SortOrder;
  offset?: number;
  limit?: number;
}

export type SortField =
  | 'title'
  | 'created_at'
  | 'updated_at'
  | 'last_read_at'
  | 'rating'
  | 'page_count';

export type SortOrder = 'asc' | 'desc';

/** A physical folder registered in the library. */
export interface Folder {
  id: number;
  name: string;
  path: string;
  parent_id: number | null;
  archive_count: number;
  children?: Folder[];
}

/** A tag that can be attached to archives. */
export interface Tag {
  id: number;
  name: string;
  color: string | null;
  archive_count?: number;
}

/** A smart folder (saved filter). */
export interface SmartFolder {
  id: number;
  name: string;
  icon: string | null;
  filter: ArchiveFilter;
}

/** Information about a single page within an archive. */
export interface PageInfo {
  index: number;
  filename: string;
  width: number;
  height: number;
  /** Whether this page should be displayed as a spread (double-width). */
  is_spread: boolean;
}
