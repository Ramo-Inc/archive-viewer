// Ephemeral drag state for internal archive-to-folder moves.
// Not a Zustand store — no re-renders needed during drag.
// Visual feedback is handled via DOM events in FolderItem (onMouseEnter/Leave).

let _ids: string[] = [];

export const dragState = {
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
};
