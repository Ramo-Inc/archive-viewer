# Full Feature Wiring — 全未接続機能の接続

## Goal

バックエンドに実装済みだがフロントエンドから呼び出されていない9個のTauriコマンド、および実装済みだが未接続の3個のReactコンポーネントを接続し、すべての機能をUIから利用可能にする。加えて、既存のバグ修正（タグフィルタ、プリセットフィルタ）も行う。

## Architecture

既存コンポーネント（SmartFolderEditor, TagEditor, ContextMenu）をそのまま利用し、呼び出しトリガーとなるボタン・右クリックハンドラ・ドラッグハンドラのみを追加する。新規コンポーネントは作成しない。各モーダルは既に自己完結しており（onClose受取、バックエンド呼び出し、store更新まで内包）、親コンポーネントに `useState` のトグルを足すだけで接続できる。

## Tech Stack

Tauri v2 + React 19 + TypeScript + Zustand + Rust (rusqlite)

---

## 変更一覧

### 1. Sidebar — フォルダ・スマートフォルダ管理UI

**ファイル**: `src/components/library/Sidebar.tsx`

**現状**: folders/smartFolders が0件だとセクション自体が非表示。作成・編集・削除のUIなし。

**変更内容**:

1. **セクションを常時表示**: `folders.length > 0` / `smartFolders.length > 0` の条件ガードを削除し、データが空でもセクションヘッダーと「+」ボタンを表示する。

2. **フォルダ作成**: セクションタイトル「フォルダ」の横に「+」ボタンを配置。クリックでインライン入力フィールドを展開し、Enter で `create_folder` コマンドを呼び出し（空文字は無視）、`fetchFolders()` で反映する。Escape でキャンセル。**blur 時は入力内容があれば commit（保存）する（macOS Finder と同様の動作）。**

3. **フォルダ右クリックメニュー**: `FolderItem` に `onContextMenu` ハンドラを追加。既存 `ContextMenu` コンポーネントを import して表示する。メニュー項目:
   - 「名前変更」→ インライン編集モード → blur で commit → `rename_folder` コマンド。**blur 時は変更があれば保存、Escape は変更を破棄。**
   - 「削除」→ `delete_folder` コマンド → `fetchFolders()` で反映。**削除したフォルダが現在のフィルタ対象 (`filter.folder_id === deletedId`) の場合は `resetFilter()` を呼び出してフィルタをリセットする。**

4. **スマートフォルダ作成**: セクションタイトル「スマートフォルダ」の横に「+」ボタンを配置。クリックで `SmartFolderEditor` モーダルを表示（新規作成モード: `existing` prop なし）。

5. **スマートフォルダ右クリックメニュー**: 各スマートフォルダ項目に `onContextMenu` ハンドラ。メニュー項目:
   - 「編集」→ `SmartFolderEditor` モーダルを表示（`existing` に当該スマートフォルダを渡す）
   - 「削除」→ `delete_smart_folder` コマンド → `fetchSmartFolders()` で反映。**削除したスマートフォルダが現在のフィルタ対象 (`filter.smart_folder_id === deletedId`) の場合は `resetFilter()` を呼び出す。**

6. **フォルダへのドロップ受付**: `FolderItem` に `onDragOver` / `onDrop` ハンドラを追加。ドロップされた archive ID を `handle_internal_drag` コマンドに渡す。ドラッグ中はフォルダにハイライトスタイルを適用。**ドロップ後は `fetchArchives()` を呼び出してグリッドを更新する。**

   **DragTarget シリアライゼーション**: Rust の `DragTarget` enum は serde デフォルトの外部タグ形式。フロントエンドから送信する JSON は以下の形式:
   ```js
   tauriInvoke('handle_internal_drag', {
     archiveIds: ['uuid-1', 'uuid-2'],
     target: { Folder: 'folder-uuid' }  // 大文字 "F"、オブジェクト形式
   })
   ```

**import 追加**: `ContextMenu`, `SmartFolderEditor`, `tauriInvoke`, `useToastStore`

**state 追加**:
- `showSmartFolderEditor: boolean` — モーダル開閉
- `editingSmartFolder: SmartFolder | undefined` — 編集対象
- `contextMenu: { x: number; y: number; items: MenuItem[] } | null` — 右クリックメニュー
- `creatingFolder: boolean` — フォルダ新規作成インライン入力表示
- `editingFolderId: string | null` — リネーム中のフォルダID
- `dropTargetFolderId: string | null` — ドラッグ中のハイライト対象

---

### 2. DetailPanel — アーカイブメタデータ編集・削除

**ファイル**: `src/components/library/DetailPanel.tsx`

**現状**: rank のみ編集可能。タイトル・メモ・タグ・既読状態は表示のみ or 未表示。削除UIなし。

**変更内容**:

1. **Archive Detail の取得**: 単一選択時に `get_archive_detail` を呼び出し、tags / folders / memo を含む完全なメタデータを取得する。現在は `ArchiveSummary`（tags/memo なし）のみ参照しているため。

2. **タイトル編集**: タイトル `<h3>` をクリックで `<input>` に切り替え。blur または Enter で `update_archive({ title })` を呼び出し、`fetchArchives()` で反映。

3. **タグセクション**: rank の下にタグ一覧をピル形式で表示。「編集」ボタンクリックで `TagEditor` モーダルを開く。`TagEditor` の `onSaved` コールバックで detail を再取得 + `fetchArchives()` を呼び出し（タグフィルタがアクティブな場合にグリッドも更新するため）。

4. **メモ欄**: `<textarea>` で memo を表示・編集。blur で `update_archive({ memo })` を呼び出し。

5. **既読/未読トグル**: 「状態」表示の横にトグルボタンを配置。クリックで `update_archive({ is_read: !current })` を呼び出し、`fetchArchives()` で反映。

6. **削除ボタン**: パネル下部（「読む」ボタンの下）に赤系の「削除」ボタンを配置。クリックで `window.confirm()` による確認ダイアログ → `delete_archives([id])` → `fetchArchives()` + `clearSelection()` で反映。

7. **複数選択時の操作**: 「N件選択中」の下に:
   - 「フォルダに追加」ドロップダウン → フォルダ一覧から選択 → `move_archives_to_folder(selectedIds, folderId)` → `fetchArchives()` で反映。**注: `move_archives_to_folder` は `INSERT OR IGNORE` で既存フォルダ所属を維持したまま追加する動作（Eagleと同様、アーカイブは複数フォルダに所属可能）。**
   - 「削除」ボタン → 確認 → `delete_archives(selectedIds)` → `fetchArchives()` + `clearSelection()`

**import 追加**: `TagEditor`

**state 追加**:
- `detail: ArchiveDetail | null` — フル詳細データ
- `editingTitle: boolean` — タイトル編集モード
- `showTagEditor: boolean` — TagEditor モーダル開閉
- `editingMemo: string` — メモ編集中のテキスト
- `showFolderDropdown: boolean` — フォルダ追加ドロップダウン

---

### 3. TopBar — インポートボタン

**ファイル**: `src/components/library/TopBar.tsx`

**現状**: 検索・ソート・フィルタは動作。ファイルインポートはドラッグ&ドロップのみ。

**変更内容**:

1. **「インポート」ボタン**: スペーサーの前（ランクフィルタの後ろ）に「+ インポート」ボタンを配置。
2. **クリック処理**: Tauri の `@tauri-apps/plugin-dialog` の `open()` を使用してネイティブファイル選択ダイアログを表示（確認済み: package.json, Cargo.toml, lib.rs, capabilities すべてに設定済み）。拡張子フィルタ: `["zip", "cbz", "rar", "cbr"]`。複数選択可。**注: 7z/cb7 はバックエンドが未対応（ライブラリ依存なし、detect_format で "unknown" 判定）のため除外。**
3. **インポート実行**: 選択されたファイルパスを `import_archives` コマンドに渡す（Tauri IPC 形式: `{ filePaths: [...], folderId: null }`）。完了後 `fetchArchives()` で一覧を更新。トーストで結果を通知。

---

### 4. ArchiveCard / ArchiveGrid — 右クリックメニュー + ドラッグ

**ファイル**: `src/components/library/ArchiveCard.tsx`, `src/components/library/ArchiveGrid.tsx`

**現状**: クリック選択、ダブルクリックでビューア起動は動作。右クリックメニューなし。カードのドラッグなし。

**変更内容**:

#### ArchiveCard:
1. **`draggable` 属性追加**: カード要素に `draggable={true}` を設定。
2. **`onDragStart`**: `dataTransfer` に `application/x-archive-ids` MIME タイプで、選択中のアーカイブ ID 配列（JSON 文字列）をセット。複数選択時は選択中の全 ID を渡す。単一の場合はそのカードの ID のみ。
3. **`onContextMenu` コールバック追加**: props に `onContextMenu(e: React.MouseEvent, archiveId: string)` を追加。イベントを親（ArchiveGrid）に伝播する。

#### ArchiveGrid:

**前提修正**: VirtuosoGrid の `components` prop 内で `List` / `Item` コンポーネントが `React.forwardRef` でレンダー関数内に定義されている（ArchiveGrid.tsx:97-114）。state を追加するとこれらが毎回再作成され、スクロール位置消失やちらつきが発生する。**`List` / `Item` コンポーネントの定義をコンポーネント関数の外に移動する。** `gridSize` は CSS カスタムプロパティまたは context 経由で渡す。

1. **ContextMenu state 管理**: `contextMenu` state を持ち、ArchiveCard からの `onContextMenu` で位置と対象を記録。
2. **ContextMenu 表示**: 既存 `ContextMenu` コンポーネントを import。メニュー項目:
   - 「読む」→ `onOpenViewer(archiveId)`
   - フォルダが存在する場合、各フォルダを個別のメニュー項目として「→ {フォルダ名}」形式で表示（separator 付き）。クリックで `move_archives_to_folder` を呼び出す。フォルダが0件の場合はこのセクションを省略。
   - セパレータ
   - 「削除」→ `window.confirm()` で確認 → `delete_archives` → `fetchArchives()` + **`clearSelection()`**
3. **フォルダ一覧の参照**: `useLibraryStore(s => s.folders)` で取得。

---

### 5. バックエンドバグ修正

**ファイル**: `src-tauri/src/db/queries.rs`, `src/components/library/Sidebar.tsx`, `src-tauri/src/error.rs`

#### 5a. タグフィルタのバグ修正

**現状**: `get_archive_summaries_filtered()` 内のタグフィルタ（行479）が `t.name IN (...)` でフィルタしているが、フロントエンドは tag の **ID**（UUID）を送信している。結果としてタグフィルタが一切機能しない。

**修正**: `t.name IN (...)` → `t.id IN (...)` に変更。

**テスト修正**: 既存テスト `test_get_archive_summaries_filtered_by_tags` も tag name ではなく tag ID を `filter_tags` に渡すよう修正する（現在のテストは名前を渡しており、バグのある SQL に合致してパスしている）。

#### 5b. お気に入りプリセットのバグ修正

**現状**: Sidebar が `preset: "favorite"`（単数形）を送信しているが、バックエンドは `"favorites"`（複数形）をマッチしている。結果としてお気に入りフィルタが一切機能しない。

**修正**: `Sidebar.tsx` のプリセット値を `"favorites"` に統一する（バックエンドに合わせる）。対象箇所: `isPresetActive('favorite')` と `handlePreset('favorite')` の両方。

#### 5c. スマートフォルダフィルタの実装

**現状**: `filter.smart_folder_id` がフィルタロジックで完全に無視されている。フロントエンドからスマートフォルダを選択しても、全アーカイブが返される。

**実装方針**:
1. `filter.smart_folder_id` がセットされている場合、まず `get_smart_folder_by_id` で当該スマートフォルダの `conditions` JSON を取得する。
2. `conditions` を `SmartFolderConditions` にパースする。**パースには `serde_json::from_str` を使用するため、`AppError` に `From<serde_json::Error>` の実装を追加するか、`.map_err(|e| AppError::Validation(e.to_string()))` で明示的にマッピングする。**
3. 各ルールを SQL 条件に変換する。**すべての条件値は `param_values` にバインドパラメータとして追加する（文字列補間は使用しない。SQL injection 防止）。**
   - `field: "tag"`, `op: "contains"` → `EXISTS (SELECT 1 FROM archive_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE at2.archive_id = a.id AND t2.name LIKE ?N)` (value = `%value%`)
   - `field: "tag"`, `op: "eq"` → 同上、`t2.name = ?N`
   - `field: "rank"`, `op: "gte"` → `a.rank >= ?N`
   - `field: "rank"`, `op: "lte"` → `a.rank <= ?N`
   - `field: "rank"`, `op: "eq"` → `a.rank = ?N`
4. `match: "all"` の場合は条件を AND で結合、`match: "any"` の場合は OR で結合。

**追加クエリ**: `get_smart_folder_by_id(conn, id) -> Result<SmartFolder, AppError>` を新規追加。SQL: `SELECT id, name, conditions, sort_order, created_at FROM smart_folders WHERE id = ?1`

**エラー型追加**: `src-tauri/src/error.rs` に `From<serde_json::Error>` impl を追加（または呼び出し箇所で map_err を使用）。

---

### 6. libraryStore — clearSelection の接続

**ファイル**: `src/stores/libraryStore.ts`

**現状**: `clearSelection()` アクションが定義されているが未使用。

**接続先**: DetailPanel の削除操作完了後、および ArchiveGrid のコンテキストメニューからの削除操作完了後に呼び出す。

---

### 7. useDragDrop — サポート拡張子の整合

**ファイル**: `src/hooks/useDragDrop.ts`

**現状**: `SUPPORTED_EXTENSIONS` が `['.zip', '.cbz', '.cbr']` のみ。`.rar` が含まれていない。

**修正**: `.rar` を追加して `['.zip', '.cbz', '.cbr', '.rar']` にする。バックエンドは ZIP と RAR のみ対応（7z は未対応）。

---

## 変更しないもの

- `search_archives` コマンド: `get_archives` の `filter.search_query` と同等機能であり、既に検索は動作している。独立接続は不要。
- `import_dropped_files` / `import_archives`: 両方とも同じ `import::import_files` を呼ぶ。D&D は既存の `import_dropped_files` を使用、ボタンインポートには `import_archives` を使用する。
- 新規コンポーネントの作成: 既存の ContextMenu / SmartFolderEditor / TagEditor をそのまま利用する。
- `TagEditor` の `tag.color` 参照: デッドコード（Tag 型に color フィールドなし）だが、`&&` ガードで安全に無視される。本スペック範囲外。
- `delete_archives` のトランザクション化: 現在のファイル先削除→DB削除の順序に一貫性リスクがあるが、本スペックは UI 接続が主目的。別イシューとして対応する。
- `import_files` のバッチエラーハンドリング: 最初のエラーでバッチ中断する設計。改善は別イシューとして対応する。

## ファイル変更サマリー

| ファイル | 変更種別 |
|---------|---------|
| `src/components/library/Sidebar.tsx` | 大幅変更 — フォルダCRUD UI、スマートフォルダCRUD UI、ドロップゾーン、プリセットバグ修正 |
| `src/components/library/DetailPanel.tsx` | 大幅変更 — タイトル編集、タグ編集、メモ、既読トグル、削除、複数選択操作 |
| `src/components/library/TopBar.tsx` | 小規模変更 — インポートボタン追加 |
| `src/components/library/ArchiveCard.tsx` | 中規模変更 — draggable、onContextMenu |
| `src/components/library/ArchiveGrid.tsx` | 中規模変更 — List/Item 外部化、ContextMenu state管理、メニュー表示 |
| `src-tauri/src/db/queries.rs` | 中規模変更 — タグフィルタバグ修正、スマートフォルダフィルタ実装、get_smart_folder_by_id 追加 |
| `src-tauri/src/error.rs` | 小規模変更 — From<serde_json::Error> 追加 |
| `src/hooks/useDragDrop.ts` | 小規模変更 — .rar 拡張子追加 |

## テスト計画

### Rust ユニットテスト
- `get_smart_folder_by_id` の正常系・異常系
- `get_archive_summaries_filtered` のスマートフォルダフィルタ: all/any マッチ、tag/rank ルール
- タグフィルタが **ID** で正しくフィルタされることの確認（既存テストの修正含む）
- お気に入りプリセットフィルタの動作確認

### フロントエンド手動テスト
- Sidebar: フォルダ作成 → 表示確認 → 右クリック → 名前変更 → 削除
- Sidebar: 表示中のフォルダを削除 → フィルタが「すべて」にリセットされること
- Sidebar: スマートフォルダ作成 → 選択してフィルタ確認 → 右クリック → 編集 → 削除
- Sidebar: お気に入りプリセット → ランク1以上のアーカイブのみ表示されること
- DetailPanel: タイトル編集 → タグ編集 → メモ編集 → 既読トグル → 削除
- DetailPanel (複数選択): フォルダに追加 → 削除
- TopBar: インポートボタン → ファイル選択（zip/cbz/rar/cbr のみ） → インポート完了
- ArchiveCard: 右クリックメニュー → 各操作 → 削除後に選択がクリアされること
- ArchiveCard: ドラッグ → Sidebar のフォルダにドロップ → フォルダ内に表示確認
- ArchiveCard: ドラッグ → フォルダ以外にドロップ → 何も起きないこと
