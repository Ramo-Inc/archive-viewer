# 実装計画 エラッタ（修正指示書）

**作成日:** 2026-04-12
**対象:** Phase 1〜5 実装計画
**根拠:** 4観点レビュー結果の正誤評価後、正しいと判断された指摘を反映

> **For agentic workers:** 各Phaseの計画を実行する際、このエラッタの該当修正を**先に適用**してから作業すること。

---

## Phase 1 修正

### E1-1: DbState を `Mutex<Option<Connection>>` に統一 [CR-3, HI-14]

**対象:** Phase 1 Task 4 `db/mod.rs`、Task 7 `commands/library.rs`、`main.rs`

Phase間のDbState管理方式の矛盾を解消する。

```rust
// db/mod.rs — 修正後
pub struct DbState(pub Mutex<Option<Connection>>);

impl DbState {
    /// ライブラリ未初期化状態で作成
    pub fn empty() -> Self {
        Self(Mutex::new(None))
    }

    /// DBパスを指定して初期化
    pub fn init(&self, db_path: &str) -> Result<(), AppError> {
        let conn = Connection::open(db_path)?;
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
        migrations::run(&conn)?;
        let mut guard = self.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
        *guard = Some(conn);
        Ok(())
    }
}
```

```rust
// main.rs — 修正後（常にDbStateをmanage）
fn main() {
    let config = load_config().unwrap_or_default();
    let db_state = DbState::empty();

    if let Some(ref lib_path) = config.library_path {
        let db_path = format!("{}/db/library.db", lib_path);
        if let Err(e) = db_state.init(&db_path) {
            eprintln!("DB初期化エラー: {}", e);
        }
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(db_state)
        .invoke_handler(tauri::generate_handler![/* ... */])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

```rust
// 全コマンドでの使用パターン — 修正後
fn some_command(state: tauri::State<'_, DbState>) -> Result<T, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    // conn を使った処理
}
```

`init_library` コマンドではDB初期化を実行し、アプリ再起動を不要にする:

```rust
#[tauri::command]
pub fn init_library(path: String, state: tauri::State<'_, DbState>) -> Result<(), AppError> {
    let library_path = Path::new(&path);
    fs::create_dir_all(library_path.join("db"))?;
    fs::create_dir_all(library_path.join("thumbnails"))?;
    fs::create_dir_all(library_path.join("archives"))?;
    fs::create_dir_all(library_path.join("temp"))?;

    let mut config = load_config()?;
    config.library_path = Some(path.replace('\\', "/"));
    save_config(&config)?;

    // DB初期化
    let db_path = format!("{}/db/library.db", path.replace('\\', "/"));
    state.init(&db_path)?;
    Ok(())
}
```

---

### E1-2: セットアップウィザードUIを追加 [CR-2]

**対象:** Phase 1 Task 8 に新タスクとして追加

`src/pages/SetupWizard.tsx` を作成し、`App.tsx` で `get_library_path` の結果に基づいてルーティング:

```tsx
// App.tsx のルーティングロジック
// 起動時に get_library_path を呼び、null ならセットアップへリダイレクト
```

セットアップウィザードでは Tauri の `dialog.open({ directory: true })` でフォルダ選択し、`init_library` を呼ぶ。

---

### E1-3: マイグレーションをトランザクションで囲む [M-5]

**対象:** Phase 1 Task 5 `migrations.rs`

```rust
fn migrate_v1(conn: &Connection) -> Result<(), AppError> {
    conn.execute_batch("BEGIN;")?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS ...")?;
    // ... 全テーブル作成
    conn.execute_batch("PRAGMA user_version = 1; COMMIT;")?;
    Ok(())
}
```

---

### E1-4: archives テーブルに `missing` カラム追加 [HI-18]

**対象:** Phase 1 Task 5 `migrations.rs`

```sql
-- archives テーブルに追加
missing INTEGER DEFAULT 0  -- 0=正常, 1=ファイル消失
```

---

### E1-5: asset protocol スコープをライブラリフォルダに限定 [CR-11]

**対象:** Phase 1 Task 8 `tauri.conf.json`

```json
{
  "app": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": []
      }
    }
  }
}
```

起動時にRust側でライブラリパスをスコープに動的追加する。初期値は空。

---

### E1-6: DBバックアップ処理を追加 [HI-17]

**対象:** Phase 1 Task 5 `migrations.rs`

マイグレーション実行前に `library.db` → `library.db.backup` にコピー:

```rust
pub fn run(conn: &Connection, db_path: &str) -> Result<(), AppError> {
    let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < CURRENT_VERSION {
        // バックアップ作成
        let backup_path = format!("{}.backup", db_path);
        let _ = std::fs::copy(db_path, &backup_path);
    }
    // マイグレーション実行
}
```

---

## Phase 2 修正

### E2-1: `mod image` → `mod imaging` にリネーム [CR-12]

**対象:** Phase 2 Task 4 全体

- ディレクトリ名: `src-tauri/src/imaging/`
- `main.rs`: `mod imaging;`
- 全参照パス: `crate::imaging::thumbnail::...`

Phase 4 の `viewer.rs` の参照も `crate::imaging::thumbnail` に変更。

---

### E2-2: Cargo.toml に `image` / `zip` クレートを追加 [HI-5]

**対象:** Phase 2 Task 2 の Step 1 前に追加

```toml
# src-tauri/Cargo.toml [dependencies] に追加
image = "0.25"
zip = "2"
```

---

### E2-3: ZipArchive::by_index の可変借用を修正 [CR-5]

**対象:** Phase 2 Task 2 `zip.rs`

```rust
fn list_pages(&self) -> Result<Vec<ArchivePageEntry>, AppError> {
    let file = File::open(&self.path)?;
    let mut archive = ZipArchive::new(file).map_err(|e| AppError::Archive(e.to_string()))?;

    let mut names: Vec<String> = Vec::new();
    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| AppError::Archive(e.to_string()))?;
        let name = entry.name().to_string();
        if !entry.is_dir() && is_image_file(&name) {
            names.push(name);
        }
    }
    sort_filenames_natural(&mut names);
    // ...
}
```

---

### E2-4: `image::io::Reader` → `image::ImageReader` [CR-6]

**対象:** Phase 2 Task 4 `thumbnail.rs`

```rust
// Before
use image::io::Reader as ImageReader;
// After
use image::ImageReader;
```

---

### E2-5: is_image_file を Path::extension() ベースに修正 [M-1]

**対象:** Phase 2 Task 1 `common.rs`

```rust
pub fn is_image_file(name: &str) -> bool {
    std::path::Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTENSIONS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}
```

---

### E2-6: インポートパイプラインにトランザクション + クリーンアップ追加 [CR-8, HI-13, CR-9]

**対象:** Phase 2 Task 5 `import.rs`

2段階設計に変更:
1. **prepare段階**（Mutexロック不要）: ファイルコピー、アーカイブ解析、サムネイル生成
2. **commit段階**（短時間ロック）: SQLiteトランザクション内でDB挿入

```rust
/// Step 1: ファイルI/O（DBロック外で実行）
pub fn prepare_import(file_path: &Path, library_path: &Path) -> Result<PreparedImport, AppError> {
    // ファイルコピー、解析、サムネイル生成（DB不要）
}

/// Step 2: DB登録（短時間ロックで実行）
pub fn commit_import(conn: &Connection, prepared: &PreparedImport, folder_id: Option<&str>) -> Result<Archive, AppError> {
    let tx = conn.transaction()?;
    // insert_archive + move_to_folder
    tx.commit()?;
    // 成功後に元ファイル削除
}
```

エラー時はコピー済みファイル + サムネイルをクリーンアップ:

```rust
pub fn import_single_file(...) -> Result<Archive, AppError> {
    let prepared = match prepare_import(file_path, library_path) {
        Ok(p) => p,
        Err(e) => {
            // prepare段階で失敗: コピー済みファイルをクリーンアップ
            let _ = fs::remove_dir_all(library_path.join("archives").join(&id));
            return Err(e);
        }
    };
    match commit_import(conn, &prepared, folder_id) {
        Ok(archive) => Ok(archive),
        Err(e) => {
            // commit段階で失敗: 全クリーンアップ
            let _ = fs::remove_dir_all(library_path.join("archives").join(&id));
            let _ = fs::remove_file(library_path.join("thumbnails").join(format!("{}.jpg", id)));
            Err(e)
        }
    }
}
```

---

### E2-7: unrar バージョン固定 + RAR展開のキャッシュ [CR-7, HI-6]

**対象:** Phase 2 Task 3 `rar.rs`

- `Cargo.toml`: `unrar = "0.5.4"` にバージョン固定
- `extract_page` では UUID付きの一時ディレクトリを使用し、並行アクセスを防止
- 実装時にunrarの実際のAPIドキュメントに合わせてコードを調整すること

---

### E2-8: `get_library_root()` を共通関数に統合 [M-4]

**対象:** Phase 2 Task 6 以降

`config.rs` に共通関数として定義:

```rust
// config.rs に追加
pub fn get_library_root() -> Result<PathBuf, AppError> {
    let config = load_config()?;
    let path = config.library_path.ok_or(AppError::LibraryNotFound)?;
    Ok(PathBuf::from(path))
}
```

`commands/archive.rs`, `commands/viewer.rs`, `commands/drag_drop.rs` のprivate関数は削除し、`config::get_library_root()` を使用。

---

### E2-9: get_archives にフィルタ引数を追加 [HI-1]

**対象:** Phase 2 Task 6 `commands/archive.rs`

PRD通り `get_archives(filter: ArchiveFilter)` にし、`queries.rs` にフィルタ付きクエリを追加:

```rust
#[tauri::command]
pub fn get_archives(filter: ArchiveFilter, state: tauri::State<'_, DbState>) -> Result<Vec<ArchiveSummary>, AppError> {
    let guard = state.0.lock().map_err(|e| AppError::Database(e.to_string()))?;
    let conn = guard.as_ref().ok_or(AppError::LibraryNotFound)?;
    queries::get_archive_summaries_filtered(conn, &filter)
}
```

---

### E2-10: rename_folder / update_smart_folder を追加 [HI-4]

**対象:** Phase 1 Task 6 `queries.rs` に追加

```rust
pub fn rename_folder(conn: &Connection, id: &str, name: &str) -> Result<(), AppError> {
    conn.execute("UPDATE folders SET name = ?1 WHERE id = ?2", params![name, id])?;
    Ok(())
}

pub fn update_smart_folder(conn: &Connection, id: &str, name: &str, conditions: &str) -> Result<(), AppError> {
    conn.execute("UPDATE smart_folders SET name = ?1, conditions = ?2 WHERE id = ?3", params![name, conditions, id])?;
    Ok(())
}
```

Phase 5 Task 6 のコマンドにも追加し、main.rs に登録。

---

## Phase 3 修正

### E3-1: VirtuosoGrid を components prop + CSS Grid に変更 [CR-10]

**対象:** Phase 3 Task 6 `ArchiveGrid.tsx`

```tsx
<VirtuosoGrid
  totalCount={filtered.length}
  overscan={200}
  components={{
    List: React.forwardRef(({ style, children, ...props }, ref) => (
      <div ref={ref} {...props} style={{
        ...style,
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fill, minmax(${gridSize}px, 1fr))`,
        gap: 8, padding: 10,
      }}>{children}</div>
    )),
    Item: ({ children, ...props }) => <div {...props}>{children}</div>,
  }}
  itemContent={(index) => { /* ... */ }}
/>
```

`listClassName` / `itemClassName` / インラインの `<style>` タグは削除。

---

### E3-2: fetchArchives にフィルタ条件を渡す [HI-1]

**対象:** Phase 3 Task 2 `libraryStore.ts`

```typescript
fetchArchives: async () => {
  const { currentFolderId, currentSmartFolderId, currentPreset,
          sortBy, sortOrder, filterTags, filterMinRank, searchQuery } = get();
  const filter = {
    folder_id: currentFolderId,
    smart_folder_id: currentSmartFolderId,
    preset: currentPreset,
    sort_by: sortBy,
    sort_order: sortOrder,
    filter_tags: filterTags.length > 0 ? filterTags : null,
    filter_min_rank: filterMinRank > 0 ? filterMinRank : null,
    search_query: searchQuery || null,
  };
  const archives = await tauriInvoke<ArchiveSummary[]>('get_archives', { filter });
  set({ archives });
}
```

`setCurrentFolder`, `setSortBy`, `setFilterMinRank` 等のセッターで状態変更後に `get().fetchArchives()` を自動呼び出し。

---

### E3-3: convertFileSrc に絶対パスを渡す [HI-10]

**対象:** Phase 3 Task 5 `ArchiveCard.tsx`、Phase 3 Task 7 `DetailPanel.tsx`

バックエンドの `get_archives` / `get_archive_detail` がDB上の相対パスをライブラリルートと結合した**絶対パス**で返すようにする。

もしくは、libraryStoreに `libraryPath` を保持し、フロント側で結合:

```typescript
const absolutePath = `${libraryPath}/${archive.thumbnail_path}`;
const url = convertFileSrc(absolutePath);
```

---

### E3-4: 空状態UIを追加 [M-14]

**対象:** Phase 3 Task 6 `ArchiveGrid.tsx`

```tsx
if (filtered.length === 0) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--text-dim)', textAlign: 'center' }}>
        {searchQuery ? '条件に一致するアーカイブがありません' : 'ファイルをドラッグ&ドロップして追加'}
      </div>
    </div>
  );
}
```

---

### E3-5: 簡易トースト通知を追加 [HI-12]

**対象:** Phase 3 に新タスクとして追加

`src/components/common/Toast.tsx` と `src/stores/toastStore.ts` を作成。`useTauriCommand.ts` のラッパーでエラー時にトーストを表示。

---

### E3-6: SmartFolderEditor を追加 [HI-3]

**対象:** Phase 3 に新タスクとして追加（または Phase 5 に移動）

`src/components/library/SmartFolderEditor.tsx` — スマートフォルダの条件設定ダイアログ（タグ + ランク条件の設定UI）を実装。

---

## Phase 4 修正

### E4-1: Zip Slip 対策を追加 [CR-1]

**対象:** Phase 4 Task 1 `viewer.rs`

```rust
// prepare_pages 内で展開先パスをサニタイズ
let dest = temp_dir.join(&page.name);

// パストラバーサル防止: 展開先がtemp_dir内であることを検証
let canonical_temp = temp_dir.canonicalize().unwrap_or_else(|_| temp_dir.clone());
let canonical_dest = dest
    .canonicalize()
    .unwrap_or_else(|_| {
        // ファイルがまだ存在しない場合は親ディレクトリで検証
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).ok();
            parent.canonicalize().unwrap_or_else(|_| parent.to_path_buf()).join(dest.file_name().unwrap_or_default())
        } else {
            dest.clone()
        }
    });

if !canonical_dest.starts_with(&canonical_temp) {
    // 不正なパス（../が含まれている等）→ スキップ
    continue;
}
```

---

### E4-2: SpreadView にviewMode対応 + 右綴じCSS修正 [HI-8, M-10]

**対象:** Phase 4 Task 4 `SpreadView.tsx`

- `viewMode` propを追加し、`single` の場合は常に1ページ全幅表示
- コンテナに `direction: 'rtl'` を追加して右綴じの表示順を正しくする

```tsx
interface SpreadViewProps {
  pages: PageInfo[];
  currentPage: number;
  viewMode: 'spread' | 'single';
}

// 単ページモード
if (viewMode === 'single') {
  return (
    <div style={containerStyle}>
      <PageImage page={pages[currentPage]} fullWidth />
    </div>
  );
}

// 見開きコンテナ
<div style={{ ...containerStyle, direction: 'rtl' }}>
```

---

### E4-3: nextPage/prevPage に見開き/表紙考慮を追加 [HI-9]

**対象:** Phase 4 Task 2 `viewerStore.ts`

```typescript
nextPage: () => {
  const { currentPage, pages, viewMode } = get();
  if (viewMode === 'single') {
    set({ currentPage: Math.min(currentPage + 1, pages.length - 1) });
    return;
  }
  const current = pages[currentPage];
  // 表紙(0ページ目)または見開きページは1だけ進む
  if (currentPage === 0 || current?.is_spread) {
    set({ currentPage: Math.min(currentPage + 1, pages.length - 1) });
  } else {
    const next = pages[currentPage + 1];
    const step = next?.is_spread ? 1 : 2;
    set({ currentPage: Math.min(currentPage + step, pages.length - 1) });
  }
},
```

---

### E4-4: useEffect cleanup から非同期呼び出しを削除 [HI-7]

**対象:** Phase 4 Task 6 `ViewerPage.tsx`

```typescript
// cleanup関数から非同期呼び出しを削除
// 遷移は必ず handleBack 経由に限定
useEffect(() => {
  if (!archiveId) return;
  // ... load logic
  // cleanup は何もしない（handleBackで明示的に保存・クリーンアップ）
}, [archiveId]);
```

---

## Phase 5 修正

### E5-1: 整合性チェックを DELETE → missing フラグに変更 [HI-18]

**対象:** Phase 5 Task 5 `integrity.rs`

```rust
// Before: DELETE FROM archives WHERE id = ?1
// After:
conn.execute("UPDATE archives SET missing = 1 WHERE id = ?1", params![id])?;
```

起動時にファイルが復活していた場合は `missing = 0` に戻す。

---

### E5-2: Tauri コマンド引数名の注意 [M-9]

**対象:** Phase 5 全コマンド

Tauri v2 ではフロントエンドからの引数名はそのままRust側のsnake_case名と一致させる必要がある。フロントエンドの `tauriInvoke` 呼び出しでは snake_case のキー名を使用:

```typescript
// 正しい
await tauriInvoke('import_dropped_files', { file_paths: archiveFiles, target });
// 間違い
await tauriInvoke('import_dropped_files', { filePaths: archiveFiles, target });
```

---

## 対象外（v2以降に移動）

以下の指摘は v1 では対応しない:

| 指摘 | 理由 |
|------|------|
| HI-2 File Watcher (notify) | v1では起動時整合性チェックで十分 |
| HI-11 prepare_pages のプリロード化 | v1では全展開で許容。パフォーマンス問題が出たら対応 |
| HI-16 D&D座標問題 | 実装時にテストで確認 |
| M-18 CSP unsafe-inline | inline style使用中なので必要 |
| L-8 CSS-in-JS保守性 | v1ではinline styleで許容 |
