import { vi, describe, test, expect, beforeEach } from 'vitest';

// Mock tauriInvoke to avoid Tauri runtime dependency
vi.mock('../../hooks/useTauriCommand', () => ({
  tauriInvoke: vi.fn().mockResolvedValue([]),
}));

import { useLibraryStore } from '../libraryStore';

const ARCHIVES_ABC = [
  { id: 'a', title: 'A', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
  { id: 'b', title: 'B', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
  { id: 'c', title: 'C', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
];

const ARCHIVES_ABCDE = [
  { id: 'a', title: 'A', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
  { id: 'b', title: 'B', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
  { id: 'c', title: 'C', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
  { id: 'd', title: 'D', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
  { id: 'e', title: 'E', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
];

beforeEach(() => {
  useLibraryStore.setState({
    archives: [...ARCHIVES_ABC],
    selectedArchiveIds: new Set(),
    _anchorId: null,
    filter: { sort_by: 'title', sort_order: 'asc' },
  });
});

describe('libraryStore selection', () => {
  test('plain click selects single archive and sets anchor', () => {
    useLibraryStore.getState().selectArchive('b');
    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set(['b']));
    expect(state._anchorId).toBe('b');
  });

  test('Ctrl+Click toggles selection and sets anchor', () => {
    const { selectArchive } = useLibraryStore.getState();
    selectArchive('a');
    useLibraryStore.getState().selectArchive('c', { ctrl: true });

    let state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set(['a', 'c']));

    // Ctrl+Click 'a' again to deselect it
    useLibraryStore.getState().selectArchive('a', { ctrl: true });
    state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set(['c']));
    expect(state._anchorId).toBe('a');
  });

  test('Shift+Click selects range from anchor to target', () => {
    useLibraryStore.getState().selectArchive('a');
    useLibraryStore.getState().selectArchive('c', { shift: true });

    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set(['a', 'b', 'c']));
    // Anchor should remain unchanged
    expect(state._anchorId).toBe('a');
  });

  test('Shift+Click in reverse direction', () => {
    useLibraryStore.setState({ archives: [...ARCHIVES_ABCDE] });

    useLibraryStore.getState().selectArchive('d');
    useLibraryStore.getState().selectArchive('b', { shift: true });

    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set(['b', 'c', 'd']));
  });

  test('Ctrl+Shift+Click adds range to existing selection', () => {
    useLibraryStore.setState({ archives: [...ARCHIVES_ABCDE] });

    useLibraryStore.getState().selectArchive('a');
    useLibraryStore.getState().selectArchive('b', { ctrl: true });
    // Now selected: a, b; anchor: b
    useLibraryStore.getState().selectArchive('d', { ctrl: true, shift: true });

    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  test('Shift+Click with null anchor falls through to plain click', () => {
    // _anchorId is null by default (no prior click)
    useLibraryStore.getState().selectArchive('b', { shift: true });

    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set(['b']));
    expect(state._anchorId).toBe('b');
  });

  test('Shift+Click when anchor not in current archives falls through', () => {
    // Click 'a' to set anchor
    useLibraryStore.getState().selectArchive('a');
    // Replace archives so 'a' is gone
    useLibraryStore.setState({
      archives: [
        { id: 'x', title: 'X', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
        { id: 'y', title: 'Y', rank: 0, thumbnail_path: null, is_read: false, format: 'zip', missing: false },
      ],
    });

    useLibraryStore.getState().selectArchive('y', { shift: true });

    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set(['y']));
    expect(state._anchorId).toBe('y');
  });

  test('selectAll selects all archives', () => {
    useLibraryStore.getState().selectAll();

    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set(['a', 'b', 'c']));
  });

  test('clearSelection clears both selection and anchor', () => {
    useLibraryStore.getState().selectArchive('b');
    useLibraryStore.getState().clearSelection();

    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set());
    expect(state._anchorId).toBeNull();
  });

  test('setFilter clears selection and anchor', () => {
    useLibraryStore.getState().selectArchive('b');
    useLibraryStore.getState().setFilter({ sort_by: 'title' });

    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set());
    expect(state._anchorId).toBeNull();
  });

  test('resetFilter clears selection and anchor', () => {
    useLibraryStore.getState().selectArchive('b');
    useLibraryStore.getState().resetFilter();

    const state = useLibraryStore.getState();
    expect(state.selectedArchiveIds).toEqual(new Set());
    expect(state._anchorId).toBeNull();
  });
});
