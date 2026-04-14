import { useState, useCallback } from 'react';
import { useLibraryStore } from '../../stores/libraryStore';
import { useToastStore } from '../../stores/toastStore';
import { tauriInvoke } from '../../hooks/useTauriCommand';
import type { SmartFolder } from '../../types';

// ============================================================
// Smart folder editor modal (Errata HI-3)
//
// Allows creating/editing smart folders with named rule sets.
// Supports match "all" / "any" toggle and per-rule configuration
// with field, operator, and value.
// ============================================================

type RuleField = 'tag' | 'rank';
type RuleOp = 'contains' | 'gte' | 'lte' | 'eq';
type MatchMode = 'all' | 'any';

interface Rule {
  field: RuleField;
  op: RuleOp;
  value: string;
}

interface SmartFolderEditorProps {
  /** Pass an existing smart folder to edit, or omit to create new. */
  existing?: SmartFolder;
  parentId?: string | null;
  onClose: () => void;
  onSaved?: () => void;
}

/** Operators available per field type */
const OPS_BY_FIELD: Record<RuleField, { value: RuleOp; label: string }[]> = {
  tag: [
    { value: 'contains', label: '含む' },
    { value: 'eq', label: '一致' },
  ],
  rank: [
    { value: 'gte', label: '以上' },
    { value: 'lte', label: '以下' },
    { value: 'eq', label: '一致' },
  ],
};

function parseExistingRules(existing?: SmartFolder): {
  name: string;
  match: MatchMode;
  rules: Rule[];
} {
  if (!existing) {
    return {
      name: '',
      match: 'all',
      rules: [{ field: 'tag', op: 'contains', value: '' }],
    };
  }

  // Reconstruct rules from the conditions JSON string
  const rules: Rule[] = [];
  try {
    const parsed = JSON.parse(existing.conditions) as {
      match?: string;
      rules?: { field: string; op: string; value: unknown }[];
    };
    const matchMode: MatchMode = parsed.match === 'any' ? 'any' : 'all';
    if (parsed.rules) {
      for (const r of parsed.rules) {
        rules.push({
          field: (r.field as RuleField) || 'tag',
          op: (r.op as RuleOp) || 'contains',
          value: String(r.value ?? ''),
        });
      }
    }
    if (rules.length === 0) {
      rules.push({ field: 'tag', op: 'contains', value: '' });
    }
    return { name: existing.name, match: matchMode, rules };
  } catch {
    return {
      name: existing.name,
      match: 'all',
      rules: [{ field: 'tag', op: 'contains', value: '' }],
    };
  }
}

export default function SmartFolderEditor({
  existing,
  parentId,
  onClose,
  onSaved,
}: SmartFolderEditorProps) {
  const fetchSmartFolders = useLibraryStore((s) => s.fetchSmartFolders);
  const addToast = useToastStore((s) => s.addToast);

  const initial = parseExistingRules(existing);
  const [name, setName] = useState(initial.name);
  const [match, setMatch] = useState<MatchMode>(initial.match);
  const [rules, setRules] = useState<Rule[]>(initial.rules);
  const [saving, setSaving] = useState(false);

  const updateRule = useCallback((index: number, patch: Partial<Rule>) => {
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const updated = { ...r, ...patch };
        // When field changes, reset op to first valid option
        if (patch.field && patch.field !== r.field) {
          updated.op = OPS_BY_FIELD[patch.field][0].value;
          updated.value = '';
        }
        return updated;
      }),
    );
  }, []);

  const addRule = useCallback(() => {
    setRules((prev) => [...prev, { field: 'tag', op: 'contains', value: '' }]);
  }, []);

  const removeRule = useCallback((index: number) => {
    setRules((prev) => {
      if (prev.length <= 1) return prev; // Keep at least one rule
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      addToast('フォルダ名を入力してください', 'error');
      return;
    }

    const validRules = rules.filter((r) => r.value.trim() !== '');
    if (validRules.length === 0) {
      addToast('少なくとも1つのルールに値を設定してください', 'error');
      return;
    }

    // Build conditions as JSON string (backend expects String)
    const conditions = JSON.stringify({
      match,
      rules: validRules.map((r) => ({
        field: r.field,
        op: r.op,
        value: r.field === 'rank' ? Number(r.value) : r.value,
      })),
    });

    setSaving(true);
    try {
      if (existing) {
        await tauriInvoke('update_smart_folder', {
          id: existing.id,
          name: name.trim(),
          conditions,
        });
        addToast('スマートフォルダを更新しました', 'success');
      } else {
        await tauriInvoke('create_smart_folder', {
          name: name.trim(),
          conditions,
          parentId: parentId ?? null,
        });
        addToast('スマートフォルダを作成しました', 'success');
      }
      await fetchSmartFolders();
      onSaved?.();
      onClose();
    } catch (e) {
      addToast(`保存に失敗しました: ${String(e)}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [name, match, rules, existing, parentId, fetchSmartFolders, addToast, onSaved, onClose]);

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
          width: 500,
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
          {existing ? 'スマートフォルダ編集' : 'スマートフォルダ作成'}
        </div>

        {/* Name input */}
        <div>
          <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
            フォルダ名
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="スマートフォルダ名"
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-primary)',
              fontSize: 14,
              outline: 'none',
            }}
          />
        </div>

        {/* Match mode toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>条件一致:</span>
          <button
            onClick={() => setMatch('all')}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              border: `1px solid ${match === 'all' ? 'var(--accent)' : 'var(--border-color)'}`,
              background: match === 'all' ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: match === 'all' ? '#fff' : 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            すべて一致
          </button>
          <button
            onClick={() => setMatch('any')}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              border: `1px solid ${match === 'any' ? 'var(--accent)' : 'var(--border-color)'}`,
              background: match === 'any' ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: match === 'any' ? '#fff' : 'var(--text-secondary)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            いずれか一致
          </button>
        </div>

        {/* Rules */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>ルール</label>
          {rules.map((rule, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: 8,
                background: 'var(--bg-tertiary)',
                borderRadius: 4,
                border: '1px solid var(--border-color)',
              }}
            >
              {/* Field select */}
              <select
                value={rule.field}
                onChange={(e) => updateRule(i, { field: e.target.value as RuleField })}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                }}
              >
                <option value="tag">タグ</option>
                <option value="rank">評価</option>
              </select>

              {/* Op select */}
              <select
                value={rule.op}
                onChange={(e) => updateRule(i, { op: e.target.value as RuleOp })}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                }}
              >
                {OPS_BY_FIELD[rule.field].map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>

              {/* Value input */}
              <input
                type={rule.field === 'rank' ? 'number' : 'text'}
                value={rule.value}
                onChange={(e) => updateRule(i, { value: e.target.value })}
                placeholder={rule.field === 'rank' ? '1-5' : 'タグ名'}
                min={rule.field === 'rank' ? 1 : undefined}
                max={rule.field === 'rank' ? 5 : undefined}
                style={{
                  flex: 1,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  outline: 'none',
                  minWidth: 0,
                }}
              />

              {/* Remove button */}
              <button
                onClick={() => removeRule(i)}
                disabled={rules.length <= 1}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 4,
                  border: '1px solid var(--border-color)',
                  background: 'var(--bg-card)',
                  color: rules.length <= 1 ? 'var(--text-dim)' : 'var(--text-secondary)',
                  fontSize: 16,
                  cursor: rules.length <= 1 ? 'default' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
                title="ルールを削除"
              >
                -
              </button>
            </div>
          ))}

          <button
            onClick={addRule}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px dashed var(--border-color)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 13,
              cursor: 'pointer',
              textAlign: 'center',
            }}
          >
            + ルールを追加
          </button>
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            paddingTop: 8,
            borderTop: '1px solid var(--border-color)',
          }}
        >
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
