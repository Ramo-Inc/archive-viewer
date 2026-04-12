import { useState, useCallback } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import type { Tag } from '../../types';

// ============================================================
// Tag editor modal dialog
//
// Displays all available tags from the library store.
// Users can toggle tags on/off, create new tags inline,
// and save the selection via the set_archive_tags command.
// ============================================================

interface TagEditorProps {
  archiveId: number;
  /** Currently assigned tags for the archive */
  currentTags: Tag[];
  onClose: () => void;
  onSaved?: () => void;
}

export default function TagEditor({
  archiveId,
  currentTags,
  onClose,
  onSaved,
}: TagEditorProps) {
  const allTags = useLibraryStore((s) => s.tags);
  const fetchTags = useLibraryStore((s) => s.fetchTags);
  const addToast = useToastStore((s) => s.addToast);

  // Set of selected tag IDs
  const [selectedIds, setSelectedIds] = useState<Set<number>>(
    () => new Set(currentTags.map((t) => t.id)),
  );
  const [newTagName, setNewTagName] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleTag = useCallback((tagId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        next.add(tagId);
      }
      return next;
    });
  }, []);

  const handleAddTag = useCallback(async () => {
    const name = newTagName.trim();
    if (!name) return;

    try {
      const newTag = await tauriInvoke<Tag>('create_tag', { name });
      await fetchTags();
      setSelectedIds((prev) => new Set([...prev, newTag.id]));
      setNewTagName('');
    } catch (e) {
      addToast(`タグの作成に失敗しました: ${String(e)}`, 'error');
    }
  }, [newTagName, fetchTags, addToast]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await tauriInvoke('set_archive_tags', {
        archiveId,
        tagIds: Array.from(selectedIds),
      });
      addToast('タグを保存しました', 'success');
      onSaved?.();
      onClose();
    } catch (e) {
      addToast(`タグの保存に失敗しました: ${String(e)}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [archiveId, selectedIds, addToast, onSaved, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddTag();
      }
    },
    [handleAddTag],
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 8000,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          padding: 24,
          width: 420,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
          タグ編集
        </div>

        {/* Tag list */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            minHeight: 60,
            maxHeight: 300,
            padding: 4,
          }}
        >
          {allTags.length === 0 && (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              タグがありません。下のフィールドで新規タグを作成してください。
            </div>
          )}
          {allTags.map((tag) => {
            const isSelected = selectedIds.has(tag.id);
            return (
              <div
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 16,
                  fontSize: 13,
                  cursor: 'pointer',
                  border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'}`,
                  background: isSelected ? 'var(--accent)' : 'var(--bg-tertiary)',
                  color: isSelected ? '#fff' : 'var(--text-secondary)',
                  transition: 'all 0.15s',
                  userSelect: 'none',
                }}
              >
                {tag.color && (
                  <span
                    style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: tag.color,
                      marginRight: 6,
                      verticalAlign: 'middle',
                    }}
                  />
                )}
                {tag.name}
              </div>
            );
          })}
        </div>

        {/* New tag input */}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="新しいタグ名"
            style={{
              flex: 1,
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              outline: 'none',
            }}
          />
          <button
            onClick={handleAddTag}
            disabled={!newTagName.trim()}
            style={{
              padding: '6px 14px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: newTagName.trim() ? 'pointer' : 'default',
              opacity: newTagName.trim() ? 1 : 0.5,
            }}
          >
            追加
          </button>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 20px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-secondary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: '8px 20px',
              borderRadius: 4,
              border: 'none',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              cursor: saving ? 'wait' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
