# フォルダ / スマートフォルダ サブディレクトリ対応 設計書

> **Goal:** フォルダとスマートフォルダにExplorerライクなツリー構造（最大3階層）を導入し、展開/折りたたみで操作できるようにする。スマートフォルダは親の検索条件をAND継承する。

## 現状分析

### 既に対応済み

- `folders` テーブルに `parent_id TEXT` カラム + FK (`ON DELETE SET NULL`) が存在
- Rust `create_folder(name, parent_id)` が `parent_id` を受け付ける
- フロントエンド `Folder` 型に `parent_id: string | null` がある
- `test_create_nested_folder` テストが存在し、パス

### 未対応（今回のスコープ）

| 項目 | 状態 |
|------|------|
| `smart_folders` テーブルに `parent_id` がない | DBマイグレーション必要 |
| Sidebar が全フォルダをフラットリストで表示 | ツリー構造UIに変更 |
| コンテキストメニューに「サブフォルダ作成」がない | 追加必要 |
| 削除時に子が孤児化する（SET NULL） | 再帰削除に変更 |
| スマートフォルダの条件継承ロジックがない | クエリ層で実装 |
| 階層制限がない | 3階層バリデーション追加 |

---

## 1. データベース

### 1.1 smart_folders に parent_id 追加

`migrations.rs` に Migration V3 を追加:

```sql
ALTER TABLE smart_folders ADD COLUMN parent_id TEXT REFERENCES smart_folders(id) ON DELETE SET NULL;
```

ON DELETE は SET NULL にしておき、実際のカスケード削除はアプリケーションコード側で制御する（SQLiteは ALTER TABLE で FK制約の変更ができないため、folders テーブルも同じ方針で統一）。

### 1.2 既存テーブル変更なし

`folders` テーブルは既に `parent_id` を持つため変更不要。

---

## 2. バックエンド (Rust)

### 2.1 SmartFolder モデル変更

`db/models.rs` の `SmartFolder` に `parent_id: Option<String>` を追加。

### 2.2 階層深度バリデーション（共通ヘルパー）

`db/queries.rs` に深度チェック関数を追加。parent_id を辿って祖先の数を数え、新規作成で3階層を超える場合はエラーを返す。

```
depth 0: ルート（parent_id = NULL）
depth 1: 子（親がルート）
depth 2: 孫（親の親がルート）← これが最大
depth 3: ひ孫 ← エラー
```

ロジック: 指定された `parent_id` から祖先を辿り、深度が2以上なら作成を拒否。

### 2.3 再帰削除

`delete_folder` と `delete_smart_folder` を変更。削除前に子孫を再帰的に取得し、リーフから順に削除する。

```
delete_folder("parent-id")
  → 子フォルダ一覧取得 (parent_id = "parent-id")
  → 各子に対して再帰呼び出し
  → archive_folders の紐付けも CASCADE で自動削除
  → 最後に自身を削除
```

### 2.4 create_smart_folder パラメータ追加

`commands/library.rs` の `create_smart_folder` に `parent_id: Option<String>` を追加。
`queries.rs` の INSERT 文を更新。

### 2.5 スマートフォルダの条件継承クエリ

`queries.rs` の `get_archive_summaries_filtered` 内、スマートフォルダ分岐を変更:

1. 指定された `smart_folder_id` からスマートフォルダを取得
2. `parent_id` を辿って全祖先のスマートフォルダを収集（最大2回のDB参照）
3. 自身 + 全祖先の `conditions` を結合
4. 全ルールを `match: "all"` (AND) で結合して評価

例: 親の条件が `tag contains "少年"`, 子の条件が `rank >= 3` の場合:
→ 最終条件: `tag contains "少年" AND rank >= 3`

各スマートフォルダ内部の `match` (all/any) はそのフォルダのルール群に対して適用し、フォルダ間はANDで結合する。

---

## 3. フロントエンド

### 3.1 Sidebar ツリー構造

現在の `Sidebar.tsx` 内のフラットリスト描画を、再帰的なツリーコンポーネントに置き換える。

#### ツリーアイテムの構造

```
▶ 📁 マンガ              ← depth 0, 折りたたみ状態
▼ 📁 コミック            ← depth 0, 展開状態
    📁 少年              ← depth 1
    📁 青年              ← depth 2
```

- 各アイテムの左に展開トグル（▶/▼）を表示。子がない場合はトグル非表示（インデントのみ）
- インデント: `paddingLeft = 12 + depth * 16` px
- クリック: そのフォルダを選択（filter に folder_id をセット）
- トグルクリック: 展開/折りたたみ切り替え（フォルダ選択は発火しない）

#### 展開状態の管理

`Sidebar.tsx` 内で `useState<Set<string>>` で展開中のフォルダID集合を管理。永続化しない（ページ遷移で毎回リセット）。

#### ツリー構築ヘルパー

フラットな `Folder[]` からツリー構造を構築するユーティリティ:

```typescript
interface FolderNode {
  folder: Folder;
  children: FolderNode[];
  depth: number;
}

function buildTree(folders: Folder[]): FolderNode[]
```

`parent_id === null` のフォルダをルートとし、各フォルダの子を `parent_id` で紐付ける。ソートは `sort_order` → `name` の順。

スマートフォルダも同じロジックで `SmartFolderNode` を構築。

### 3.2 コンテキストメニュー変更

**フォルダの右クリックメニュー:**
- サブフォルダを作成（depth < 2 の場合のみ表示）
- 名前変更
- ---
- 削除

**スマートフォルダの右クリックメニュー:**
- サブスマートフォルダを作成（depth < 2 の場合のみ表示）
- 編集
- ---
- 削除

「サブフォルダを作成」選択時: インラインの名前入力フィールドを表示（既存のフォルダ作成と同じUI）。確定時に `create_folder(name, parentId)` を呼び出す。

「サブスマートフォルダを作成」選択時: SmartFolderEditor を `parentId` 付きで開く。

### 3.3 SmartFolderEditor 変更

`SmartFolderEditor.tsx` に `parentId?: string` prop を追加。保存時に `create_smart_folder` へ `parent_id` を渡す。親の条件は表示しない（エディタはそのフォルダ自身の条件のみ編集）。

### 3.4 ドラッグ&ドロップ

サブフォルダも既存のドロップゾーンロジックをそのまま使える。ツリー内の各フォルダアイテムにドロップハンドラを設定。変更は不要（フォルダIDベースで動作するため）。

### 3.5 削除確認

子を持つフォルダ/スマートフォルダの削除時:
- 確認ダイアログに「サブフォルダも含めて削除されます」と表示
- 通常の削除確認と区別するため、子の数を表示

---

## 4. 型定義の変更

### TypeScript (`src/types/index.ts`)

`SmartFolder` に `parent_id: string | null` を追加。`Folder` は変更不要（既にある）。

---

## 5. エラーハンドリング

| シナリオ | 挙動 |
|----------|------|
| 4階層目のフォルダを作成しようとした | Rust側でエラー返却 → トーストに「最大3階層までです」 |
| 親フォルダが削除された | 再帰削除で子も消える |
| 選択中のフォルダが削除された | 既存の挙動と同じ（フィルタリセット） |

---

## 6. スコープ外

- フォルダのドラッグ移動（フォルダをフォルダにドラッグして親子関係を変更）
- sort_order のドラッグ並べ替え
- 展開状態の永続化
- フォルダのパンくずリスト表示
