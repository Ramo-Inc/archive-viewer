# ComicViewer — Product Requirements Document (PRD)

## 1. プロダクト概要

Eagle Viewer風のUIを持つWindowsネイティブのマンガビューワー。個人のマンガアー���イブ（数百〜数千冊）を整理・閲覧するための個人用ツール。

**技術スタック:** Tauri v2 + React + TypeScript + Rust

**対象OS:** Windows 10/11（WebView2標準搭載）

---

## 2. コア機能一覧

| # | 機能 | 優先度 |
|---|------|--------|
| F1 | ライブラリ画面（3ペイン：サイドバー + グリッド + 詳細パネル） | Must |
| F2 | ビューワー画面（見開き表示、右綴じ、ハイブリッドUI） | Must |
| F3 | ドラッグ&ドロップによるアーカイブ取り込み（管理フォルダに移動） | Must |
| F4 | ZIP / CBZ / CBR アーカイブ対応 | Must |
| F5 | サムネイル自動生成・キャッシュ | Must |
| F6 | フォルダによる分類 | Must |
| F7 | タグ管理（自由入力テキスト） | Must |
| F8 | お気に入りランク（★1〜5） | Must |
| F9 | メモ（自由書式テキスト） | Must |
| F10 | スマートフォルダ（タグ + ランク条件、拡張前提） | Must |
| F11 | ソート（名前、追加日、ランク、ファイルサイズ） | Must |
| F12 | フィルタ（タグ、ランク、未読/既読） | Must |
| F13 | グリッドサイズ調整（スライダー） | Must |
| F14 | 検索（タイトル、タグ、メモ） | Must |
| F15 | 読書位置レジューム | Must |
| F16 | ダークテーマ固定 | Must |

---

## 3. アーキテクチャ

### 3.1 全体構成

```
Tauri Window
├── Frontend (React + TypeScript, WebView2)
│   ├── Library Page (3-pane layout)
│   │   ├── Sidebar Component
│   │   ├── Grid Component
│   │   └── Detail Panel Component
│   ├── Viewer Page (spread view)
│   └── State Management (zustand)
│
├── Tauri invoke API (IPC boundary)
│
└── Backend (Rust)
    ├── Archive Manager    — アーカイブ解凍・ページ一覧・画像抽出
    ├── Thumbnail Generator — サムネイル生成・キャッシュ管理
    ├── Library Manager    — フォルダ/タグ/ランク/スマートフォルダCRUD
    ├── Image Decoder      — ページ画像デコード・リサイズ
    ├── SQLite DB          — メタデータ全般（Mutex<Option<Connection>>で管理）
    └── Integrity Check    — 起動時ファイル整合性チェック（File Watcherはv2で対応）
```

### 3.2 設計方針：Rust Heavy

- 画像処理・ファイルI/O・DB操作はすべてRust側で完結
- Reactは純粋なUI表示層としてTauri invoke APIでRust関数を呼び出す
- 画像配信はTauriのasset protocolを使用（`convertFileSrc()` でURL変換）
- サムネイル・ページ画像ともにasset protocol経由で配信（base64は使わない）

### 3.3 アプリ設定ファイルの保存先

ライブラリフォルダのパスは、ライブラリ内のDBではなく外部の設定ファイルで管理する:

```
%APPDATA%/ComicViewer/
└── config.json              — ライブラリパス等のアプリ設定
```

```json
{
  "library_path": "D:/MangaLibrary",
  "window_state": { "width": 1280, "height": 800, "maximized": false }
}
```

起動時にこのファイルを読み、ライブラリフォルダが見つからない場合はセットアップウィザードを再表示する。

### 3.4 ライブラリフォルダ構造

```
<library_root>/
├── db/
│   └── library.db          — SQLiteデータベース
├── thumbnails/
│   └── <archive_id>.jpg    — サムネイル画像（JPEG, 300px幅, 品質85%）
├── archives/
│   └── <archive_id>/
│       └── <original_filename>.cbz  — アーカイブファイル
└── temp/                    — ビューワー用一時展開ファイル（起動時に自動クリーンアップ）
```

- すべてのパスはライブラリルートからの相対パスでDBに保存
- パス区切り文字は常に `/` に正規化して保存（Windows `\` は `/` に変換）
- ライブラリフォルダごと移動・バックアップ可能
- 初回起動時にライブラリフォルダの場所を指定するセットアップウィザード

---

## 4. データモデル（SQLite）

### 4.0 マイグレーション戦略

- SQLiteの `PRAGMA user_version` でスキーマバージョンを管理
- アプリ起動時にバージョンを確認し、必要なマイグレーションを順次実行
- 破壊的変更時はマイグレーション前にDBファイルの自動バックアップを作成

### 4.1 archives テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT PK | UUID |
| title | TEXT NOT NULL | 表示タイトル（ファイル名ベース） |
| file_name | TEXT NOT NULL | 元のファイル名 |
| file_path | TEXT NOT NULL | archives/ 以下の相対パス |
| file_size | INTEGER NOT NULL | バイト数 |
| page_count | INTEGER NOT NULL | ページ数 |
| format | TEXT NOT NULL | "zip" / "cbz" / "cbr" |
| thumbnail_path | TEXT | thumbnails/ 以下の相対パス |
| rank | INTEGER DEFAULT 0 | 0=未評価, 1-5=★ランク |
| memo | TEXT DEFAULT "" | 自由書式メモ |
| is_read | BOOLEAN DEFAULT 0 | 既読フラグ |
| last_read_page | INTEGER DEFAULT 0 | 最後に読んだページ |
| missing | INTEGER DEFAULT 0 | 0=正常, 1=ファイル消失（整合性チェックで設定） |
| created_at | TEXT NOT NULL | 追加日時 (ISO8601) |
| updated_at | TEXT NOT NULL | 更新日時 (ISO8601) |

**インデックス:**
- `idx_archives_title` ON archives(title) — 検索用
- `idx_archives_rank` ON archives(rank) — フィルタ用
- `idx_archives_created_at` ON archives(created_at) — ソート用

### 4.2 folders テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | フォルダ名 |
| parent_id | TEXT | 親フォルダID（NULLならルート） |
| sort_order | INTEGER DEFAULT 0 | 表示順 |
| created_at | TEXT NOT NULL | 作成日時 |

### 4.3 archive_folders テーブル（多対多）

| カラム | 型 | 説明 |
|--------|-----|------|
| archive_id | TEXT NOT NULL FK | → archives.id (ON DELETE CASCADE) |
| folder_id | TEXT NOT NULL FK | → folders.id (ON DELETE CASCADE) |
| PRIMARY KEY | (archive_id, folder_id) | |

### 4.4 tags テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL UNIQUE | タグ名 |

### 4.5 archive_tags テーブル（多対多）

| カラム | 型 | 説明 |
|--------|-----|------|
| archive_id | TEXT NOT NULL FK | → archives.id (ON DELETE CASCADE) |
| tag_id | TEXT NOT NULL FK | → tags.id (ON DELETE CASCADE) |
| PRIMARY KEY | (archive_id, tag_id) | |

### 4.6 smart_folders テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | スマートフォルダ名 |
| conditions | TEXT NOT NULL | JSON形式のフィルタ条件 |
| sort_order | INTEGER DEFAULT 0 | 表示順 |
| created_at | TEXT NOT NULL | 作成日時 |

**conditions JSON例（初期版）:**
```json
{
  "match": "all",
  "rules": [
    { "field": "tag", "op": "contains", "value": "少年漫画" },
    { "field": "rank", "op": "gte", "value": 3 }
  ]
}
```

### 4.7 settings テーブル

| カラム | 型 | 説明 |
|--------|-----|------|
| key | TEXT PK | 設定キー |
| value | TEXT NOT NULL | 設定値 |

**v1で使用する設定キー:**
- `grid_size` — グリッドのサムネイルサイズ (px)
- `sort_by` — ソート項目 ("name" / "created_at" / "rank" / "file_size")
- `sort_order` — ソート順 ("asc" / "desc")
- `viewer_mode` — ビューワーモード ("spread" / "single")

---

## 5. Tauri Command API設計

フロントエンド (React) → バックエンド (Rust) の IPC インターフェース。

### 5.0 エラーハンドリング

すべてのTauriコマンドは `Result<T, AppError>` を返す。Tauri v2ではエラー型に `serde::Serialize` の実装が必須。

```rust
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("データベースエラー: {0}")]
    Database(String),
    #[error("ファイルI/Oエラー: {0}")]
    FileIO(String),
    #[error("アーカイブエラー: {0}")]
    Archive(String),
    #[error("バリデーションエラー: {0}")]
    Validation(String),
    #[error("ライブラリが見つかりません")]
    LibraryNotFound,
}

// Tauri v2要件: エラー型のSerialize実装
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::Serializer {
        serializer.serialize_str(&self.to_string())
    }
}
```

フロントエンド側ではinvokeのcatchでエラーメッセージを受け取り、トースト通知で表示する。

### 5.1 ライブラリ管理

```rust
// ライブラリ初期化・設定
#[tauri::command] fn init_library(path: String) -> Result<(), AppError>
#[tauri::command] fn get_library_path() -> Result<String, AppError>

// アーカイブCRUD
#[tauri::command] fn import_archives(file_paths: Vec<String>, folder_id: Option<String>) -> Result<Vec<Archive>, AppError>
#[tauri::command] fn get_archives(filter: ArchiveFilter) -> Result<Vec<ArchiveSummary>, AppError>
#[tauri::command] fn get_archive_detail(id: String) -> Result<ArchiveDetail, AppError>
#[tauri::command] fn update_archive(id: String, update: ArchiveUpdate) -> Result<(), AppError>
#[tauri::command] fn delete_archives(ids: Vec<String>) -> Result<(), AppError>

// フォルダCRUD
#[tauri::command] fn get_folders() -> Result<Vec<Folder>, AppError>
#[tauri::command] fn create_folder(name: String, parent_id: Option<String>) -> Result<Folder, AppError>
#[tauri::command] fn rename_folder(id: String, name: String) -> Result<(), AppError>
#[tauri::command] fn delete_folder(id: String) -> Result<(), AppError>
#[tauri::command] fn move_archives_to_folder(archive_ids: Vec<String>, folder_id: String) -> Result<(), AppError>

// タグCRUD
#[tauri::command] fn get_tags() -> Result<Vec<Tag>, AppError>
#[tauri::command] fn create_tag(name: String) -> Result<Tag, AppError>
#[tauri::command] fn delete_tag(id: String) -> Result<(), AppError>
#[tauri::command] fn set_archive_tags(archive_id: String, tag_ids: Vec<String>) -> Result<(), AppError>

// スマートフォルダCRUD
#[tauri::command] fn get_smart_folders() -> Result<Vec<SmartFolder>, AppError>
#[tauri::command] fn create_smart_folder(name: String, conditions: String) -> Result<SmartFolder, AppError>
#[tauri::command] fn update_smart_folder(id: String, name: String, conditions: String) -> Result<(), AppError>
#[tauri::command] fn delete_smart_folder(id: String) -> Result<(), AppError>

// 検索
#[tauri::command] fn search_archives(query: String) -> Result<Vec<ArchiveSummary>, AppError>
```

### 5.2 画像・ビューワー

```rust
// サムネイルURL取得（convertFileSrcで変換済みのURLを返す）
#[tauri::command] fn get_thumbnail_url(archive_id: String) -> Result<String, AppError>

// ビューワー：アーカイブのページを一時展開し、asset protocol URLを返す
#[tauri::command] fn prepare_pages(archive_id: String) -> Result<Vec<PageInfo>, AppError>
#[tauri::command] fn save_read_position(archive_id: String, page: usize) -> Result<(), AppError>
#[tauri::command] fn cleanup_temp_pages(archive_id: String) -> Result<(), AppError>
```

### 5.3 ドラッグ&ドロップ

```rust
// 外部からのD&D（ファイル取り込み）— フロントエンドのイベントリスナーから呼ばれる
#[tauri::command] fn import_dropped_files(file_paths: Vec<String>, target: DropTarget) -> Result<Vec<Archive>, AppError>

// 内部D&D（フォルダ間移動、タグ付与等）
#[tauri::command] fn handle_internal_drag(archive_ids: Vec<String>, target: DragTarget) -> Result<(), AppError>
```

**DropTarget / DragTarget enum:**
```rust
#[derive(Deserialize)]
enum DropTarget {
    Library,                          // ライブラリ全体 → 移動＋登録
    Folder(String),                   // フォルダ → 移動＋登録＋フォルダ分類
}

#[derive(Deserialize)]
enum DragTarget {
    Folder(String),                   // フォルダ → フォルダ分類追加
    SmartFolder(String),              // スマートフォルダ → タグ条件のvalueのみ付与（非タグ条件は無視）
    Tag(String),                      // タグ → タグ付与
}
```

---

## 6. フロントエンド設計

### 6.1 画面構成

アプリは2つのメイン画面で構成される。

**ライブラリ画面（デフォルト）**
```
┌──────────────────────────────────────────────────────────┐
│ [ソート▼] [タグ▼] [ランク★★★★★]     [サイズ━●━] [🔍検索] │ ← トップバー
├────────┬──────────────────────────────┬───────────────────┤
│ライブラリ│                              │ 表紙画像           │
│ すべて  │  ┌───┐ ┌───┐ ┌───┐ ┌───┐   │ タイトル           │
│ お気に入り│  │   │ │   │ │ ★ │ │   │   │ ★★★★★           │
│ 未読    │  │   │ │   │ │選択│ │   │   │                   │
│ 最近読んだ│  └───┘ └───┘ └───┘ └───┘   │ 情報              │
│        │  ┌───┐ ┌───┐ ┌───┐ ┌───┐   │ 📄 195ページ       │
│フォルダ  │  │   │ │   │ │   │ │   │   │ 💾 45.2MB         │
│ 少年漫画 │  │   │ │   │ │   │ │   │   │                   │
│ 少女漫画 │  └───┘ └───┘ └───┘ └───┘   │ タグ              │
│        │                              │ [少年漫画][アクション]│
│スマート  │                              │                   │
│ 高評価  │                              │ メモ              │
│ 最近追加 │                              │ 自由書式テキスト...  │
│        │                              │                   │
│        │                              │ [📖 読む]          │
└────────┴──────────────────────────────┴───────────────────┘
```

**サイドバーのプリセットフィルタ定義:**
- **すべて**: フィルタなし（全アーカイブ表示）
- **お気に入り**: rank >= 1（ランクが設定されているもの）
- **未読**: is_read = false
- **最近読んだ**: is_read = true、updated_atが直近30日以内、updated_at降順

**ビューワー画面（アーカイブをダブルクリックまたは「読む」ボタン）**
```
┌──────────────────────────────────────────────────────────┐
│ ← 戻る   進撃の巨人 Vol.1        見開き|単ページ|⛶  12/195│ ← ホバー時のみ
├──────────────────────────────────────────────────────────┤
│                                                          │
│          ┌──────────────┬���─────────────┐                │
│          │              │              │                │
│          │  右ページ     │  左ページ     │                │
│          │  (p.13)      │  (p.12)      │                │
│          │              │              │                │
│          └──────────────┴──────────────┘                │
│                                                          │
├──────────────────────────────────────────────────────────┤
│ ◀  ━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ▶    │ ← ホバー時のみ
└──────────────────────────────────────────────────────────┘
```

### 6.2 Reactコンポーネント構成

```
src/
├── App.tsx                     — ルーティング（ライブラリ / ビューワー）
├── pages/
│   ├── LibraryPage.tsx         — 3ペインレイアウト統合
│   └── ViewerPage.tsx          — ビューワー画面統合
├── components/
│   ├── library/
│   │   ├── TopBar.tsx          — ソート・フィルタ・検索・グリッドサイズ
│   │   ├── Sidebar.tsx         — フォルダツリー・スマートフォルダ
│   │   ├── ArchiveGrid.tsx     — サムネイルグリッド（仮想スクロール）
│   │   ├── ArchiveCard.tsx     — 個別サムネイルカード
│   │   ├── DetailPanel.tsx     — 右側詳細パネル
│   │   ├── TagEditor.tsx       — タグ編集UI
│   │   └── SmartFolderEditor.tsx — スマートフォルダ条件設定
│   ├── viewer/
│   │   ├── SpreadView.tsx      — 見開き表示
│   │   ├── SinglePageView.tsx  — 単ページ表示
│   │   ├── ViewerTopBar.tsx    — タイトル・ナビ（ホバー表示）
│   │   ├── PageSlider.tsx      — ページスライダー（ホバー表示）
│   │   └── ViewerOverlay.tsx   — ホバーUI制御
│   └── common/
│       ├── DragDropZone.tsx    — 外部ファイルD&D受付
│       ├── RankStars.tsx       — ★ラ��ク表示・編集
│       └── ContextMenu.tsx     — 右クリックメニュー
├── stores/
│   ├── libraryStore.ts         — ライブラリ状態管理（zustand）
│   └── viewerStore.ts          — ビューワー状態管理
├── hooks/
│   ├── useTauriCommand.ts      — Tauri invoke ラッパー
│   ├── useDragDrop.ts          — D&Dロジック
│   └── useKeyboardShortcuts.ts — キーボードショートカット
├── types/
│   └── index.ts                — TypeScript型定義
└── styles/
    └── global.css              — ダークテーマCSS
```

### 6.3 状態管理（zustand）

```typescript
// libraryStore
interface LibraryState {
  // データ
  archives: ArchiveSummary[]
  folders: Folder[]
  smartFolders: SmartFolder[]
  tags: Tag[]

  // UI状態
  selectedArchiveIds: string[]           // 複数選択対応
  currentFolderId: string | null         // null = "すべて"
  currentSmartFolderId: string | null
  gridSize: number                       // サムネイルサイズ（px）

  // フィルタ・ソート
  sortBy: "name" | "created_at" | "rank" | "file_size"
  sortOrder: "asc" | "desc"
  filterTags: string[]
  filterMinRank: number
  searchQuery: string
}

// viewerStore
interface ViewerState {
  archiveId: string | null
  pages: PageInfo[]
  currentPage: number
  viewMode: "spread" | "single"
  isUIVisible: boolean
}
```

### 6.4 複数選択操作

- **Ctrl + クリック**: 個別のアイテムを選択/解除のトグル
- **Shift + クリック**: 範囲選択（最後にクリックしたアイテムから現在のアイテムまで）
- **Ctrl + A**: 現在のビューの全アイテムを選択
- **複数選択時の詳細パネル**: 「N件選択中」と表示、共通のタグ・ランクの一括編集UIを表示
- **複数選択時の右クリックメニュー**: 一括タグ編集、一括ランク変更、一括フォルダ追加、一括削除

---

## 7. ビューワー詳細設計

### 7.1 見開き表示ロジック

- **右綴じ（右→左）固定**: 見開きの右側が奇数ページ、左側が偶数ページ
- **先頭ページ（表紙）**: 単独表示（見開きの右側のみ）
- **最終ページ**: ページ数が偶数なら単独表示
- **ページ送り**: 見開き時は2ページずつ、単ページ時は1ページずつ
- **見開きページ自動判定**: 画像のアスペクト比が横 > 縦×1.2 の場合、見開きページと判定し単独で全幅表示
- **1ページのみのアーカイブ**: 自動的に単ページモードで表示

### 7.2 ページ順序とフィルタリング

- **ソートアルゴリズム**: Natural sort（自然順ソート）を使用。`page_2.jpg` < `page_10.jpg` の正しい順序を保証
- **画像ファイルフィルタ**: アーカイブ内のファイルのうち、拡張子が jpg / jpeg / png / webp / gif / bmp のもののみをページとして扱う
- **非画像ファイル**: テキストファイル、メタデータファイル等は無視

### 7.3 キーボードショートカット

| キー | アクション |
|------|-----------|
| `←` / `���` | 次ページ / 前ページ（右綴じなので←が進む） |
| `Home` / `End` | 最初のページ / 最後のページ |
| `F` | フルスクリーン切り替え |
| `Esc` | ライブラリに戻る |
| `1` / `2` | 単ページ / 見開き切り替え |
| `Space` | UI表示/非表示トグル |

### 7.4 ホバーUI

- マウスが画面上端に近づく → トップバー（タイトル、モード切替、ページ番号）がフェードイン
- マウスが画面下端に近づく → ページスライダーがフェードイン
- マウスが離れると1.5秒後��フェードアウト
- キーボード操作中はUIを自動非表示

### 7.5 画像プリロード

- 現在表示中の見開き ± 2見開き分（計6ページ）をプリロード
- Rust側で事前にアーカイブから抽出し、`temp/` ディレクトリに展開
- asset protocol経由でフロントエンドに配信
- メモリ使用量の上限を設定（例: 同時キャッシュ最大20ページ）

---

## 8. ドラッグ&ドロップ設計

### 8.1 外部からのファイルドロップ

1. ユーザーがZIP/CBZ/CBRファイルをアプリウィンドウにドロップ
2. フロントエンドで `listen('tauri://drag-drop', ...)` イベントを受信（`paths` と `position` を取得）
3. イベントのデバウンス処理（Tauri v2の重複発火対策として500ms以内の同一パスのイベントを無視）
4. `position` の座標からドロップ先のコンポーネントを判定（各コンポーネントのDOMRectと比較）:
   - **グリッド領域 / ライブラリ全体**: `DropTarget::Library`
   - **特定フォルダ上**: `DropTarget::Folder(folder_id)`
5. `import_dropped_files` Tauriコマンドを呼び出し
6. Rust側で処理（安全なインポートフロー）:
   - ファイルを `archives/<uuid>/` に**コピー**
   - アーカイブを解析（ページ数、先頭画像取得）
   - サムネイル生成 → `thumbnails/<uuid>.jpg`
   - SQLiteトランザクション内でDBにレコード挿入
   - DB挿入成功後に元ファイルを削除（コピー→登録→削除の順序でデータ安全性を確保）
   - フォルダ指定がある場合は `archive_folders` にも挿入
7. インポート失敗時はコピー済みファイルをクリーンアップ
8. フロントエンドにインポート結果を返却、グリッドを更新

### 8.2 内部のドラッグ操作

| ドラッグ元 | ドロップ先 | 動作 |
|-----------|-----------|------|
| グリッドのアイテム | サイドバーのフォルダ | `archive_folders`にレコード追加（フォルダ分類） |
| グリッドのアイテム | サイドバーのスマートフォルダ | 条件内のタグルール(`field: "tag"`)のvalueのみ付与。ランク等の非タグ条件は無視 |
| グリッドのアイテム | サイドバーのタグ | `archive_tags`にレコード追加（タグ付与） |
| グリッドの���イテム | 「お気に入り」 | ランクが0の場合は★1に設定 |

- 複数選択のドラッグにも対応（Ctrl+クリック / Shift+クリックで複数選択）
- ドロップ先のハイライト表示でフィードバック

---

## 9. Rustバックエンド詳細設計

### 9.1 Rustクレート構成

```
src-tauri/
├── Cargo.toml
├── src/
│   ├── main.rs                — Tauriアプリエントリポイント
│   ├── error.rs               — AppError定義（thiserror + Serialize）
│   ├── commands/              — Tauri command handlers
│   │   ├── mod.rs
│   │   ├── library.rs         — ライブラリ管理コマンド
│   │   ├── archive.rs         — アーカイブ操作コマンド
│   │   ├���─ viewer.rs          — ビューワーコマンド
│   │   └── drag_drop.rs       — D&Dコマンド
│   ├── db/                    — データベース層
│   │   ├── mod.rs             — Mutex<Option<Connection>>によるDB接続管理
│   │   ├── models.rs          — DBモデル（構造体）
│   │   ├── migrations.rs      — PRAGMA user_version ベースのマイグレーション
│   │   └── queries.rs         — SQLクエリ
│   ├── archive/               — アーカイブ処理
│   │   ├── mod.rs
│   │   ├── zip.rs             — ZIP/CBZ解凍
│   │   ├── rar.rs             — CBR(RAR)解凍
│   │   └── common.rs          — 共通インターフェース
│   ├── imaging/               — 画像処理（`image`クレートとの名前衝突を回避）
│   │   ├── mod.rs
│   │   └── thumbnail.rs       — サムネイル生成（JPEG）+ 画像サイズ取得
│   └── library/               — ライブラリ管理
│       ├── mod.rs
│       ├── import.rs          — インポート処理（コピー→登録→削除フロー）
│       ├── watcher.rs         — ファイル監視
│       ├── integrity.rs       — 起動時整合性チェック
│       └── smart_folder.rs    — スマートフォルダ評価
```

### 9.2 主要Rustクレート依存

| クレート | 用途 |
|---------|------|
| `tauri` v2 | アプリフレームワーク（内蔵tokioランタイムを使用） |
| `rusqlite` | SQLiteアクセス（`Mutex<Option<Connection>>` でState管理。ライブラリ未初期化時はNone） |
| `zip` | ZIP/CBZ解凍 |
| `unrar` | RAR/CBR解凍（注: C++依存あり。ビルドにC++コンパイラが必要。ビルド手順をREADMEに記載） |
| `image` | 画像デコード・リサイズ・JPEGエンコード |
| `uuid` | UUID生成 |
| `serde` / `serde_json` | シリアライズ |
| `thiserror` | エラー型定義 |
| ~~`notify`~~ | ~~ファイルシステム監視~~ → v1ではスコープ外（起動時整合性チェックで代替） |
| `natord` | Natural sort（ページ順序の自然順ソート） |
| `chrono` | 日時操作 |

**注記:**
- `tokio` は明示的に依存に含めない（Tauriの内蔵ランタイム `tauri::async_runtime` を使用）
- `webp` クレートは使用しない（サムネイルはJPEG形式にすることで `image` クレートのみで完結し、ネイティブ依存を最小化）
- `unrar` はlibunrar（C++）のスタティックリンクが必要。Windows MSVCツールチェーンでのビルドにはVisual Studio Build ToolsのC++ワークロードが必要。CIでのビルド手順を別途ドキュメント化する

### 9.3 DB接続管理

Tauri v2のState管理で `rusqlite::Connection` を使用するパターン:

```rust
use std::sync::Mutex;

// ライブラリ未初期化時はNone
pub struct DbState(pub Mutex<Option<rusqlite::Connection>>);

impl DbState {
    pub fn empty() -> Self { Self(Mutex::new(None)) }
    pub fn init(&self, db_path: &str) -> Result<(), AppError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        migrations::run(&conn)?;
        *self.0.lock().unwrap() = Some(conn);
        Ok(())
    }
}

// Tauriコマンドでの使用例
#[tauri::command]
fn get_archives(
    state: tauri::State<'_, DbState>,
    filter: ArchiveFilter,
) -> Result<Vec<ArchiveSummary>, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    // conn を使ったDB操作...
}
```

- 常に `DbState` を manage し、ライブラリ未初期化時は `None`
- `init_library` コマンドで `state.init(db_path)` を呼び出しアプリ再起動不要
- インポート等の重い処理ではI/O部分をMutexスコープ外で実行し、DB操作のみ短時間ロック（2段階設計）
- 個人用ツール（同時接続数1）なのでMutexで十分

### 9.3.1 インポートパイプラインの2段階設計

ファイルI/OとDB操作を分離し、Mutexの長時間保持を防止:

```
Step 1 (prepare): コピー → アーカイブ解析 → サムネイル生成（DBロック不要）
Step 2 (commit):  SQLiteトランザクション内でDB挿入（短時間ロック）
Step 3 (cleanup): 成功時に元ファイル削除、失敗時にコピー済みファイル+サムネイルを削除
```

### 9.3.2 Zip Slip対策

アーカイブからファイルを展開する際は、展開先パスが指定ディレクトリ内であることを検証する（パストラバーサル防止）:

```rust
let dest = temp_dir.join(&page.name);
let canonical_temp = temp_dir.canonicalize()?;
// destがtemp_dir外を指していないことを検証
if !dest.starts_with(&canonical_temp) {
    continue; // 不正なパスはスキップ
}
```

### 9.4 サムネイル生成フロー

1. アーカイブからページ一覧を取得（Natural sortでソート）
2. 先頭画像を抽出（メモリ上で解凍）
3. `image` クレートでデコード
4. 300px幅にリサイズ（アスペクト比維持）
5. JPEG形式でエンコード（品質85%）
6. `thumbnails/<archive_id>.jpg` に保存
7. DBの `thumbnail_path` を更新

### 9.5 ページ画像配信方式

- Tauri v2の **asset protocol** を使用
- `tauri.conf.json` に以下の設定が必要:
  - `app.security.assetProtocol.enable: true`
  - `app.security.assetProtocol.scope` にライブラリフォルダを動的に追加
  - `app.security.csp` に `"img-src 'self' asset: http://asset.localhost"` を追加
- フロントエンドでは `@tauri-apps/api` の `convertFileSrc()` でファイルパスをasset protocol URLに変換
- サムネイル: `convertFileSrc(absolutePath)` で直接配信
- ビューワーページ: Rust側でアーカイブから `temp/` に展開 → asset protocol URLを返す
- ビューワーを閉じたタイミングで `cleanup_temp_pages` コマンドで一時ファイルを削除
- アプリ起動時に `temp/` ディレクトリの残存ファイルを自動クリーンアップ（クラッシュ対策）

### 9.6 ファイル整合性チェック

アプリ起動時に以下の整合性チェックを実行:

1. **DBとファイルシステムの突合**: `archives` テーブルの各レコードについて、`file_path` のファイルが存在するか確認
2. **消失ファイルの処理**: ファイルが見つからない場合、DBレコードに `missing` フラグを立てグリッドで警告アイコンを表示（即座に削除はしない）
3. **孤立サムネイルのクリーンアップ**: DBに対応するレコードがないサムネイルファイルを削除
4. **復活ファイルの検出**: `missing` フラグが立っているアーカイブのファイルが復活していた場合は `missing = 0` に戻す
5. ~~**File Watcherの動作**~~ → v1ではスコープ外。起動時整合性チェックで代替。v2でnotifyクレートによるリアルタイム監視を検討

---

## 10. パフォーマンス設計

### 10.1 サムネイルグリッド

- **仮想スクロール**: react-virtuosoを使用。DOMには表示範囲のカードのみ生成
- **遅延読み込み**: ビューポート内のサムネイルのみ読み込み、Intersection Observer使用
- **サムネイルキャッシュ**: JPEGファイルとしてディスクに永続化。2回目以降はasset protocol URLを直接参照

### 10.2 ビューワー

- **プリロード**: 現在ページ ± 2見開き分を事前展開
- **メモリ管理**: 同時展開は現在閲覧中の1アーカイブのみ。temp/にはLRUで最大20ページ分の展開ファイルを保持
- **非同期デコード**: ページ展開はRust側の `tauri::async_runtime::spawn_blocking` で非同期実行。UIスレッドをブロックしない

### 10.3 インポート

- **バッチ処理**: 複数ファイルの同時ドロップ時はキューイングして順次処理
- **プログレス通知**: Tauriのevent APIでインポート進捗をフロントに通知
- **バックグラウンド**: サムネイル生成は別スレッドで実行。アーカイブ登録は即座に完了

### 10.4 検索

- **初期実装**: SQLiteの `LIKE '%keyword%'` を使用（title, memoカラム + タグ名のJOIN検索）
- **レスポンス目標**: 数千冊規模で100ms以内
- **インデックス**: title, memoカラムにインデックスを作成（セクション4.1参照）
- **将来拡張**: パフォーマンスが不十分な場合はSQLite FTS5の導入を検討

---

## 11. UI/UX フロー

### 11.1 初回起動

1. `%APPDATA%/ComicViewer/config.json` を確認
2. 未設定またはライブラリフォルダが見つからない場合、セットアップダイアログ表示
3. ライブラリフォルダの場所を選択（フォルダ選択ダイアログ）
4. `db/`, `thumbnails/`, `archives/`, `temp/` サブディレクトリを自動作成
5. SQLite DBを初期化（マイグレーション実行）
6. `config.json` にライブラリパスを保存
7. 空のライブラリ画面を表示、ドロップを促すプレースホルダー

### 11.2 アーカイブインポート

1. ファイルをウィンドウにドラッグ → ドロップゾーンがハイライト
2. ドロップ → プログレスインジケータ表示
3. Rust側でファイルコピー → 解析 → サムネイル生成 → DB登録 → 元ファイル削除
4. グリッドにアイテム追加（アニメーション付き）
5. エラー時はトースト通知でエラーメッセージを表示

### 11.3 マンガ閲覧

1. グリッドでアーカイブをダブルクリック、または詳細パネルの「読む」ボタン
2. ビューワー画面に遷移（前回の読書位置からレジューム）
3. キーボード/マウスでページ送り
4. Escまたは戻るボタンでライブラリに戻る（読書位置は自動保存、一時ファイルはクリーンアップ）

### 11.4 右クリックメニュー

**単一選択時:**
- 読む
- タグを編集
- ランクを設定 → ★1〜5 / 未評価
- フォルダに追加 → フォルダ一覧
- ファイルの場所を開く
- 削除

**複数選択時:**
- タグを一括編集
- ランクを一括設定 → ★1〜5 / 未評価
- フォルダに一括追加 → フォルダ一覧
- 一括削除

---

## 12. Tauri設定（tauri.conf.json 要点）

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; img-src 'self' asset: http://asset.localhost; style-src 'self' 'unsafe-inline'",
      "assetProtocol": {
        "enable": true,
        "scope": []
      }
    }
  }
}
```

**重要:** asset protocolのスコープは初期値を空にし、アプリ起動時にRust側でライブラリフォルダのパスを動的に追加する（`**` にしない — セキュリティリスク）。

---

## 13. 対象外（スコープ外）

以下の機能はv1では実装しない:

- ライト/ダークテーマ切り替え
- 複数ライブラリの切り替え
- クラウド同期
- 左綴じ（左→右）対応
- 7z / tar.gz 等の追加アーカイブ形式
- タグのカラーラベル
- スマートフォルダの高度な条件（ファイル名、サイズ、ページ数等）
- プラグイン/拡��機能
- 多言語対応
- SQLite FTS5（全文検索）— 初期はLIKE検索で十分
- File Watcher（notifyクレートによるリアルタイムファイル監視）— 起動時整合性チェックで代替
- ビューワーのプログレッシブページロード（ページ単位のオンデマンド展開）— v1は全ページ一括展開
