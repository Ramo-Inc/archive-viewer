# Full Feature Wiring — 全未接続機能の接続

## Goal

バックエンドに実装済みだがフロントエンドから呼び出されていない9個のTauriコマンド、および実装済みだが未接続の3個のReactコンポーネントを接続し、すべての機能をUIから利用可能にする。

## Architecture

既存コンポーネント（SmartFolderEditor, TagEditor, ContextMenu）をそのまま利用し、呼び出しトリガーとなるボタン・右クリックハンドラ・ドラッグハンドラのみを追加する。新規コンポーネントは作成しない。各モーダルは既に自己完結しており（onClose受取、バックエンド呼び出し、store更新まで内包）、親コンポーネントに `useState` のトグルを足すだけで接続できる。

## Tech Stack

Tauri v2 + React 18 + TypeScript + Zustand + Rust (rusqlite)

---

## 変更一覧

### 1. Sidebar — フォルダ・スマートフォルダ管理UI

**ファイル**: `src/components/library/Sidebar.tsx`

**現状**: folders/smartFolders が0件だとセクション自体が非表示。作成・編集・削除のUIなし。

**変更内容**:

1. **セクションを常時表示**: `folders.length > 0` / `smartFolders.length > 0` の条件ガードを削除し、データが空でもセクションヘッダーと「+」ボタンを表示する。

2. **フォルダ作成**: セクションタイトル「フォルダ」の横に「+」ボタンを配置。クリックでインライン入力フィールドを展開し、Enter で `create_folder` コマンドを呼び出し、`fetchFolders()` で反映する。Escape でキャンセル。

3. **フォルダ右クリックメニュー**: `FolderItem` に `onContextMenu` ハンドラを追加。既存 `ContextMenu` コンポーネントを import して表示する。メニュー項目:
   - 「名前変更」→ インライン編集モード → `rename_folder` コマンド
   - 「削除」→ `delete_folder` コマンド → `fetchFolders()` で反映

4. **スマートフォルダ作成**: セクションタイトル「スマートフォルダ」の横に「+」ボタンを配置。クリックで `SmartFolderEditor` モーダルを表示（新規作成モード: `existing` prop なし）。

5. **スマートフォルダ右クリックメニュー**: 各スマートフォルダ項目に `onContextMenu` ハンドラ。メニュー項目:
   - 「編集」→ `SmartFolderEditor` モーダルを表示（`existing` に当該スマートフォルダを渡す）
   - 「削除」→ `delete_smart_folder` コマンド → `fetchSmartFolders()` で反映

6. **フォルダへのドロップ受付**: `FolderItem` に `onDragOver` / `onDrop` ハンドラを追加。ドロップされた archive ID を `handle_internal_drag` コマンドの `DragTarget::Folder(folderId)` に渡す。ドラッグ中はフォルダにハイライトスタイルを適用。

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

3. **タグセクション**: rank の下にタグ一覧をピル形式で表示。「編集」ボタンクリックで `TagEditor` モーダルを開く。`TagEditor` の `onSaved` コールバックで detail を再取得。

4. **メモ欄**: `<textarea>` で memo を表示・編集。blur で `update_archive({ memo })` を呼び出し。

5. **既読/未読トグル**: 「状態」表示の横にトグルボタンを配置。クリックで `update_archive({ is_read: !current })` を呼び出し、`fetchArchives()` で反映。

6. **削除ボタン**: パネル下部（「読む」ボタンの下）に赤系の「削除」ボタンを配置。クリックで `window.confirm()` による確認ダイアログ → `delete_archives([id])` → `fetchArchives()` + `clearSelection()` で反映。

7. **複数選択時の操作**: 「N件選択中」の下に:
   - 「フォルダに移動」ドロップダウン → フォルダ一覧から選択 → `move_archives_to_folder(selectedIds, folderId)` → `fetchArchives()` で反映
   - 「削除」ボタン → 確認 → `delete_archives(selectedIds)` → `fetchArchives()` + `clearSelection()`

**import 追加**: `TagEditor`

**state 追加**:
- `detail: ArchiveDetail | null` — フル詳細データ
- `editingTitle: boolean` — タイトル編集モード
- `showTagEditor: boolean` — TagEditor モーダル開閉
- `editingMemo: string` — メモ編集中のテキスト
- `showFolderDropdown: boolean` — フォルダ移動ドロップダウン

---

### 3. TopBar — インポートボタン

**ファイル**: `src/components/library/TopBar.tsx`

**現状**: 検索・ソート・フィルタは動作。ファイルインポートはドラッグ&ドロップのみ。

**変更内容**:

1. **「インポート」ボタン**: スペーサーの前（ランクフィルタの後ろ）に「+ インポート」ボタンを配置。
2. **クリック処理**: Tauri の `@tauri-apps/plugin-dialog` の `open()` を使用してネイティブファイル選択ダイアログを表示。拡張子フィルタ: `["zip", "cbz", "rar", "cbr", "7z", "cb7"]`。複数選択可。
3. **インポート実行**: 選択されたファイルパスを `import_archives` コマンドに渡す。完了後 `fetchArchives()` で一覧を更新。トーストで結果を通知。

**依存**: `@tauri-apps/plugin-dialog` がプロジェクトに追加されている必要がある。未追加の場合は `<input type="file">` の非表示要素をフォールバックとして使用する。

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
1. **ContextMenu state 管理**: `contextMenu` state を持ち、ArchiveCard からの `onContextMenu` で位置と対象を記録。
2. **ContextMenu 表示**: 既存 `ContextMenu` コンポーネントを import。メニュー項目:
   - 「読む」→ `onOpenViewer(archiveId)`
   - フォルダが存在する場合、各フォルダを個別のメニュー項目として「→ {フォルダ名}」形式で表示（separator 付き）。クリックで `move_archives_to_folder` を呼び出す。フォルダが0件の場合はこのセクションを省略。
   - セパレータ
   - 「削除」→ `window.confirm()` で確認 → `delete_archives`
3. **フォルダ一覧の参照**: `useLibraryStore(s => s.folders)` で取得。

---

### 5. バックエンドバグ修正 — タグフィルタとスマートフォルダフィルタ

**ファイル**: `src-tauri/src/db/queries.rs`

#### 5a. タグフィルタのバグ修正

**現状**: `get_archive_summaries_filtered()` 内のタグフィルタ（行479）が `t.name IN (...)` でフィルタしているが、フロントエンドは tag の **ID**（UUID）を送信している。結果としてタグフィルタが一切機能しない。

**修正**: `t.name IN (...)` → `t.id IN (...)` に変更。

#### 5b. スマートフォルダフィルタの実装

**現状**: `filter.smart_folder_id` がフィルタロジックで完全に無視されている。フロントエンドからスマートフォルダを選択しても、全アーカイブが返される。

**実装方針**:
1. `filter.smart_folder_id` がセットされている場合、まず `get_smart_folder_by_id` で当該スマートフォルダの `conditions` JSON を取得する。
2. `conditions` を `SmartFolderConditions` にパースし、各ルールを SQL 条件に変換する:
   - `field: "tag"`, `op: "contains"` → `EXISTS (SELECT 1 FROM archive_tags at2 JOIN tags t2 ON at2.tag_id = t2.id WHERE at2.archive_id = a.id AND t2.name LIKE '%value%')`
   - `field: "tag"`, `op: "eq"` → 同上、`t2.name = value`
   - `field: "rank"`, `op: "gte"` → `a.rank >= value`
   - `field: "rank"`, `op: "lte"` → `a.rank <= value`
   - `field: "rank"`, `op: "eq"` → `a.rank = value`
3. `match: "all"` の場合は条件を AND で結合、`match: "any"` の場合は OR で結合。

**追加クエリ**: `get_smart_folder_by_id(conn, id) -> Result<SmartFolder, AppError>` を新規追加。

---

### 6. libraryStore — clearSelection の接続

**ファイル**: `src/stores/libraryStore.ts`

**現状**: `clearSelection()` アクションが定義されているが未使用。

**接続先**: DetailPanel の削除操作完了後に呼び出す。

---

## 変更しないもの

- `search_archives` コマンド: `get_archives` の `filter.search_query` と同等機能であり、既に検索は動作している。独立接続は不要。
- `import_dropped_files` / `import_archives`: 両方とも同じ `import::import_files` を呼ぶ。D&D は既存の `import_dropped_files` を使用、ボタンインポートには `import_archives` を使用する。
- 新規コンポーネントの作成: 既存の ContextMenu / SmartFolderEditor / TagEditor をそのまま利用する。

## ファイル変更サマリー

| ファイル | 変更種別 |
|---------|---------|
| `src/components/library/Sidebar.tsx` | 大幅変更 — フォルダCRUD UI、スマートフォルダCRUD UI、ドロップゾーン |
| `src/components/library/DetailPanel.tsx` | 大幅変更 — タイトル編集、タグ編集、メモ、既読トグル、削除、複数選択操作 |
| `src/components/library/TopBar.tsx` | 小規模変更 — インポートボタン追加 |
| `src/components/library/ArchiveCard.tsx` | 中規模変更 — draggable、onContextMenu |
| `src/components/library/ArchiveGrid.tsx` | 中規模変更 — ContextMenu state管理、メニュー表示 |
| `src-tauri/src/db/queries.rs` | 中規模変更 — タグフィルタバグ修正、スマートフォルダフィルタ実装、get_smart_folder_by_id 追加 |

## テスト計画

### Rust ユニットテスト
- `get_smart_folder_by_id` の正常系・異常系
- `get_archive_summaries_filtered` のスマートフォルダフィルタ: all/any マッチ、tag/rank ルール
- タグフィルタが ID で正しくフィルタされることの確認

### フロントエンド手動テスト
- Sidebar: フォルダ作成 → 表示確認 → 右クリック → 名前変更 → 削除
- Sidebar: スマートフォルダ作成 → 選択してフィルタ確認 → 右クリック → 編集 → 削除
- DetailPanel: タイトル編集 → タグ編集 → メモ編集 → 既読トグル → 削除
- DetailPanel (複数選択): フォルダ移動 → 削除
- TopBar: インポートボタン → ファイル選択 → インポート完了
- ArchiveCard: 右クリックメニュー → 各操作
- ArchiveCard: ドラッグ → Sidebar のフォルダにドロップ → フォルダ内に移動確認
