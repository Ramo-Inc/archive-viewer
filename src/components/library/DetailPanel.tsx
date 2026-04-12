import { useMemo, useState, useEffect, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import RankStars from '../common/RankStars';
import TagEditor from './TagEditor';
import type { ArchiveDetail } from '../../types';

interface DetailPanelProps {
  onOpenViewer: (archiveId: string) => void;
}

export default function DetailPanel({ onOpenViewer }: DetailPanelProps) {
  const archives = useLibraryStore((s) => s.archives);
  const selectedArchiveIds = useLibraryStore((s) => s.selectedArchiveIds);
  const fetchArchives = useLibraryStore((s) => s.fetchArchives);
  const clearSelection = useLibraryStore((s) => s.clearSelection);
  const folders = useLibraryStore((s) => s.folders);
  const addToast = useToastStore((s) => s.addToast);

  const [libraryPath, setLibraryPath] = useState('');
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [memoDraft, setMemoDraft] = useState('');
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [showFolderDropdown, setShowFolderDropdown] = useState(false);

  useEffect(() => {
    tauriInvoke<string | null>('get_library_path')
      .then((path) => { if (path) setLibraryPath(path); })
      .catch(() => {});
  }, []);

  const selectedIds = useMemo(() => Array.from(selectedArchiveIds), [selectedArchiveIds]);
  const selectedArchive = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    return archives.find((a) => a.id === selectedIds[0]) ?? null;
  }, [selectedIds, archives]);

  // Fetch full detail when single selection changes
  useEffect(() => {
    if (!selectedArchive) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    tauriInvoke<ArchiveDetail>('get_archive_detail', { id: selectedArchive.id })
      .then((d) => { if (!cancelled) { setDetail(d); setMemoDraft(d.memo); } })
      .catch(() => { if (!cancelled) setDetail(null); });
    return () => { cancelled = true; };
  }, [selectedArchive?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const thumbnailUrl = useMemo(() => {
    if (!detail?.thumbnail_path) return null;
    const thumb = detail.thumbnail_path;
    if (thumb.startsWith('http') || thumb.startsWith('data:')) return thumb;
    return convertFileSrc(`${libraryPath}/${thumb}`);
  }, [detail?.thumbnail_path, libraryPath]);

  // --- Handlers ---

  const handleRankChange = useCallback(async (newRank: number) => {
    if (!detail) return;
    try {
      await tauriInvoke('update_archive', { id: detail.id, update: { rank: newRank } });
      setDetail((d) => d ? { ...d, rank: newRank } : d);
      await fetchArchives();
    } catch (e) { console.error('Failed to update rank:', e); }
  }, [detail, fetchArchives]);

  const handleTitleCommit = useCallback(async () => {
    setEditingTitle(false);
    if (!detail) return;
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === detail.title) return;
    try {
      await tauriInvoke('update_archive', { id: detail.id, update: { title: trimmed } });
      setDetail((d) => d ? { ...d, title: trimmed } : d);
      await fetchArchives();
    } catch (e) { addToast(`タイトル更新失敗: ${String(e)}`, 'error'); }
  }, [detail, titleDraft, fetchArchives, addToast]);

  const handleMemoBlur = useCallback(async () => {
    if (!detail || memoDraft === detail.memo) return;
    try {
      await tauriInvoke('update_archive', { id: detail.id, update: { memo: memoDraft } });
      setDetail((d) => d ? { ...d, memo: memoDraft } : d);
    } catch (e) { addToast(`メモ更新失敗: ${String(e)}`, 'error'); }
  }, [detail, memoDraft, addToast]);

  const handleToggleRead = useCallback(async () => {
    if (!detail) return;
    const newVal = !detail.is_read;
    try {
      await tauriInvoke('update_archive', { id: detail.id, update: { is_read: newVal } });
      setDetail((d) => d ? { ...d, is_read: newVal } : d);
      await fetchArchives();
    } catch (e) { addToast(`状態更新失敗: ${String(e)}`, 'error'); }
  }, [detail, fetchArchives, addToast]);

  const handleDelete = useCallback(async (ids: string[]) => {
    if (!window.confirm(`${ids.length}件のアーカイブを削除しますか？`)) return;
    try {
      await tauriInvoke('delete_archives', { ids });
      clearSelection();
      fetchArchives();
      addToast(`${ids.length}件を削除しました`, 'success');
    } catch (e) { addToast(`削除失敗: ${String(e)}`, 'error'); }
  }, [clearSelection, fetchArchives, addToast]);

  const handleAddToFolder = useCallback(async (folderId: string) => {
    try {
      await tauriInvoke('move_archives_to_folder', { archiveIds: selectedIds, folderId });
      fetchArchives();
      setShowFolderDropdown(false);
      addToast('フォルダに追加しました', 'success');
    } catch (e) { addToast(`フォルダ追加失敗: ${String(e)}`, 'error'); }
  }, [selectedIds, fetchArchives, addToast]);

  const handleTagsSaved = useCallback(() => {
    if (selectedArchive) {
      tauriInvoke<ArchiveDetail>('get_archive_detail', { id: selectedArchive.id })
        .then(setDetail)
        .catch(() => {});
    }
    fetchArchives();
  }, [selectedArchive, fetchArchives]);

  const labelStyle: React.CSSProperties = { fontSize: 11, color: 'var(--text-dim)', marginBottom: 2 };
  const valueStyle: React.CSSProperties = { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 10 };
  const btnStyle: React.CSSProperties = {
    width: '100%', padding: '8px 0', border: 'none', borderRadius: 6,
    fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s',
  };

  // --- No selection ---
  if (selectedIds.length === 0) {
    return (
      <aside style={{ width: 280, minWidth: 280, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', padding: 16, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <p style={{ fontSize: 13, color: 'var(--text-dim)', textAlign: 'center' }}>アーカイブを選択してください</p>
      </aside>
    );
  }

  // --- Multiple selection ---
  if (selectedIds.length > 1) {
    return (
      <aside style={{ width: 280, minWidth: 280, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 8 }}>
          {selectedIds.length}件選択中
        </p>

        {/* Add to folder */}
        {folders.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              style={{ ...btnStyle, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
              onClick={() => setShowFolderDropdown(!showFolderDropdown)}
            >
              フォルダに追加 ▾
            </button>
            {showFolderDropdown && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 4, zIndex: 1000, maxHeight: 200, overflowY: 'auto' }}>
                {folders.map((f) => (
                  <div
                    key={f.id}
                    onClick={() => handleAddToFolder(f.id)}
                    style={{ padding: '6px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--text-secondary)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    📁 {f.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Delete */}
        <button
          style={{ ...btnStyle, background: '#a33', color: '#fff', marginTop: 8 }}
          onClick={() => handleDelete(selectedIds)}
        >
          削除
        </button>
      </aside>
    );
  }

  // --- Single selection ---
  if (!detail) {
    return (
      <aside style={{ width: 280, minWidth: 280, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', padding: 16, overflowY: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>読み込み中...</p>
      </aside>
    );
  }

  return (
    <aside style={{ width: 280, minWidth: 280, background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border-color)', padding: 12, overflowY: 'auto', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Cover image */}
      <div style={{ width: '100%', aspectRatio: '3 / 4', background: 'var(--bg-card)', borderRadius: 6, overflow: 'hidden', marginBottom: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt={detail.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{ fontSize: 48, color: 'var(--text-dim)' }}>📄</span>
        )}
      </div>

      {/* Title (click to edit) */}
      {editingTitle ? (
        <input
          autoFocus
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={handleTitleCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') handleTitleCommit(); if (e.key === 'Escape') setEditingTitle(false); }}
          style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--accent)', background: 'var(--bg-tertiary)', outline: 'none', width: '100%' }}
        />
      ) : (
        <h3
          onClick={() => { setTitleDraft(detail.title); setEditingTitle(true); }}
          style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.4, wordBreak: 'break-word', cursor: 'pointer' }}
          title="クリックで編集"
        >
          {detail.title}
        </h3>
      )}

      {/* Rank */}
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <RankStars value={detail.rank} onChange={handleRankChange} size={18} />
      </div>

      {/* Tags */}
      <div style={labelStyle}>タグ</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {detail.tags.length === 0 && (
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>タグなし</span>
        )}
        {detail.tags.map((tag) => (
          <span key={tag.id} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'var(--bg-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}>
            {tag.name}
          </span>
        ))}
        <button
          onClick={() => setShowTagEditor(true)}
          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, background: 'none', color: 'var(--accent)', border: '1px dashed var(--accent)', cursor: 'pointer' }}
        >
          編集
        </button>
      </div>

      {/* Memo */}
      <div style={labelStyle}>メモ</div>
      <textarea
        value={memoDraft}
        onChange={(e) => setMemoDraft(e.target.value)}
        onBlur={handleMemoBlur}
        placeholder="メモを入力..."
        rows={3}
        style={{ fontSize: 13, color: 'var(--text-primary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '6px 8px', resize: 'vertical', outline: 'none', marginBottom: 10, width: '100%' }}
      />

      {/* File info */}
      <div style={labelStyle}>形式</div>
      <div style={valueStyle}>{detail.format.toUpperCase()}</div>

      {/* Read status toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={labelStyle}>状態</div>
        <button
          onClick={handleToggleRead}
          style={{
            fontSize: 12, padding: '2px 10px', borderRadius: 4, cursor: 'pointer',
            border: '1px solid var(--border-color)',
            background: detail.is_read ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: detail.is_read ? '#fff' : 'var(--text-secondary)',
          }}
        >
          {detail.is_read ? '既読' : '未読'}
        </button>
      </div>

      {detail.missing && (
        <div style={{ fontSize: 12, color: '#e55', marginBottom: 10 }}>ファイルが見つかりません</div>
      )}

      {/* Actions */}
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => onOpenViewer(detail.id)}
          style={{ ...btnStyle, background: 'var(--accent)', color: '#fff' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-hover)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent)'}
        >
          読む
        </button>
        <button
          onClick={() => handleDelete([detail.id])}
          style={{ ...btnStyle, background: 'transparent', color: '#a33', border: '1px solid #a33' }}
        >
          削除
        </button>
      </div>

      {/* Tag editor modal */}
      {showTagEditor && (
        <TagEditor
          archiveId={detail.id}
          currentTags={detail.tags}
          onClose={() => setShowTagEditor(false)}
          onSaved={handleTagsSaved}
        />
      )}
    </aside>
  );
}
