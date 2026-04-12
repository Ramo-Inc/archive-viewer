# Implementation Plan Review: Full Feature Wiring

> Reviewed: `docs/superpowers/plans/2026-04-13-full-feature-wiring.md`
> Date: 2026-04-13
> Reviewers: 4 independent agents (Rust code, Frontend code, IPC/Integration, Spec completeness)

## Overall Assessment

**プランは高品質で、ほぼそのまま実行可能。** Rust コードは全てコンパイル可能、IPC 呼び出し16件は全て正しいパラメータ名・型で検証済み、スペック要件は100%カバー。ただし TypeScript 側に2件の修正必要な問題あり。

---

## CRITICAL Issues (実装前に修正必須)

### C-1. TagEditor の `tag.color` 参照が TypeScript コンパイルエラーを引き起こす可能性

- **場所**: 既存 `src/components/library/TagEditor.tsx:162-169`
- **問題**: `tag.color` を参照しているが、`Tag` 型 (`src/types/index.ts:72-75`) には `id` と `name` しかない。Rust 側の `Tag` 構造体にも `color` フィールドなし。
- **影響**: プランは TagEditor を変更せずそのまま利用するが、DetailPanel から import するため `npx tsc --noEmit` の検証ステップで失敗する可能性がある。
- **注意**: 現状 TypeScript strict モードの設定次第では `undefined` として扱われエラーにならない可能性もある。実装時に `tsc --noEmit` で確認し、エラーになる場合は `Tag` 型に `color?: string` を追加するか、TagEditor の当該コードを削除する。

### C-2. GridItem が `React.forwardRef` を使っておらず VirtuosoGrid の型期待と不一致

- **場所**: プラン Task 5, ArchiveGrid の `GridItem` コンポーネント定義
- **問題**: `GridItem` は plain arrow function だが、VirtuosoGrid の `GridComponents.Item` は `React.RefAttributes<HTMLDivElement>` と `'data-index': number` を期待する。
- **影響**: 型エラーまたは React warnings が出る可能性。ただし既存コード（ArchiveGrid.tsx:114）も同じ問題を持っているため、回帰ではない。
- **修正案**: `GridItem` にも `React.forwardRef` を使用し、props 型に `'data-index'?: number` を含める。

---

## MAJOR Issues

**なし。** 全候補を検証した結果、MAJOR 問題は確認されなかった。

---

## MINOR Issues

| ID | 発見元 | 内容 |
|----|--------|------|
| m-1 | Rust | `crate::db::models::SmartFolderConditions` の完全修飾パスは冗長（`use crate::db::models::*` で既に import 済み）。`SmartFolderConditions` だけで可 |
| m-2 | Frontend | `GridList` に `displayName` 設定あるが `GridItem` にはなし。一貫性の問題のみ |
| m-3 | Integration | `handleRankChange`, `handleTitleCommit`, `handleToggleRead` で `fetchArchives()` が `await` されていない。エラーが握りつぶされる |
| m-4 | Integration | Sidebar の `SmartFolderEditor` で `onSaved` コールバック省略。内部で `fetchSmartFolders()` を呼ぶので動作するが、明示的に渡すとより安全 |
| m-5 | Completeness | Grid コンテキストメニューの「フォルダに追加」「削除」が単一アーカイブのみ対象。複数選択時は DetailPanel を使う想定だが、UX 的に不統一 |
| m-6 | Frontend | `window.confirm()` はTauri アプリで未スタイルのOS ダイアログを表示。`@tauri-apps/plugin-dialog` の `ask()` の方がUI統一性あり |

---

## Positive Findings (検証済み正常項目)

### Rust コード (全てコンパイル確認済み)
- `From<serde_json::Error>` impl は正しく `?` 演算子を有効にする
- スマートフォルダフィルタは `param_idx`, `param_values`, `conditions` を正しく使用
- `r#match` raw identifier 構文は正しい
- テストヘルパー関数のシグネチャは全て一致 (`setup_db`, `make_test_archive`, `create_tag`, etc.)
- `serde_json` は Cargo.toml 依存 + Rust 2021 edition で自動解決済み

### IPC 呼び出し (16件全て検証済み)

| コマンド | JS パラメータ | Rust パラメータ | 結果 |
|---------|-------------|----------------|------|
| `create_folder` | `{ name, parentId: null }` | `name, parent_id: Option<String>` | OK |
| `rename_folder` | `{ id, name }` | `id, name` | OK |
| `delete_folder` | `{ id }` | `id` | OK |
| `delete_smart_folder` | `{ id }` | `id` | OK |
| `handle_internal_drag` | `{ archiveIds, target: { Folder: id } }` | `archive_ids, target: DragTarget` | OK |
| `move_archives_to_folder` | `{ archiveIds, folderId }` | `archive_ids, folder_id` | OK |
| `delete_archives` | `{ ids: [...] }` | `ids: Vec<String>` | OK |
| `get_archive_detail` | `{ id }` | `id` | OK |
| `update_archive` | `{ id, update: { rank/title/memo/is_read } }` | `id, update: ArchiveUpdate` | OK |
| `import_archives` | `{ filePaths, folderId: null }` | `file_paths, folder_id: Option` | OK |

- DragTarget enum シリアライゼーション `{ Folder: id }` は serde デフォルト外部タグ形式と一致
- Tauri v2 camelCase→snake_case 変換はトップレベルパラメータのみ（ネストされた構造体は対象外）
- 全19コマンドが `lib.rs` の `generate_handler![]` に登録済み
- デッドロックリスク: なし（全コマンドは同期的にMutex取得→解放）

### スペックカバレッジ: 100%

| スペックセクション | プランタスク | 状態 |
|-------------------|-------------|------|
| 1. Sidebar フォルダ CRUD | Task 4 | 完全カバー |
| 1. Sidebar スマートフォルダ CRUD | Task 4 | 完全カバー |
| 1. Sidebar ドロップゾーン | Task 4 | 完全カバー |
| 2. DetailPanel 全編集機能 | Task 6 | 完全カバー |
| 3. TopBar インポートボタン | Task 7 | 完全カバー |
| 4. ArchiveCard drag + context menu | Task 5 | 完全カバー |
| 4. ArchiveGrid List/Item 外部化 | Task 5 | 完全カバー |
| 5a. タグフィルタバグ修正 | Task 1 | 完全カバー |
| 5b. お気に入りプリセット修正 | Task 3 | 完全カバー |
| 5c. スマートフォルダフィルタ | Task 2 | 完全カバー |
| 6. clearSelection 接続 | Tasks 5, 6 | 完全カバー |
| 7. useDragDrop .rar | Task 3 | 完全カバー |

---

## 実装前に必要な対応

| 優先度 | 対応 |
|--------|------|
| **必須** | C-1: `tsc --noEmit` でエラー確認。エラーなら `Tag` 型に `color?: string` 追加 |
| **必須** | C-2: `GridItem` を `React.forwardRef` に変更 |
| **推奨** | m-3: `fetchArchives()` に `await` 追加（3箇所） |
| **任意** | m-1〜m-6: 実装時に余裕があれば対応 |
