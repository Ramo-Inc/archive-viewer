// Ephemeral drag state for internal archive-to-folder moves.
// Not a Zustand store — no re-renders needed during drag.
//
// Drop handling is registered by Sidebar via setDropHandler().
// Visual feedback (outline on hovered folder) is applied directly
// to DOM elements by ArchiveCard's mousemove listener via elementFromPoint,
// the same technique used in useDragDrop.ts for external file drops.

type DropHandler = (folderId: string, archiveIds: string[]) => void;

let _ids: string[] = [];
let _dropHandler: DropHandler | null = null;

export const dragState = {
  setDropHandler(fn: DropHandler): void {
    _dropHandler = fn;
  },
  clearDropHandler(): void {
    _dropHandler = null;
  },
  start(ids: string[]): void {
    _ids = [...ids];
  },
  end(): void {
    _ids = [];
  },
  getIds(): readonly string[] {
    return _ids;
  },
  isDragging(): boolean {
    return _ids.length > 0;
  },
  /** Called when mouse is released over a valid folder target. */
  drop(folderId: string): void {
    if (_dropHandler && _ids.length > 0) {
      _dropHandler(folderId, [..._ids]);
    }
    _ids = [];
  },
};
