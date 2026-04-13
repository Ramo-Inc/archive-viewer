# サブディレクトリ対応 設計・実装プラン 批判的レビュー

**対象文書:**
- `docs/superpowers/specs/2026-04-14-subdirectory-support-design.md`
- `docs/superpowers/plans/2026-04-14-subdirectory-support.md`

**レビュー日:** 2026-04-14
**レビュー観点:** Rustバックエンド互換性、フロントエンド統合、データ整合性・エッジケース

---

## CRITICAL（実装すると確実に壊れる / ランタイム障害）

### C1: 再帰削除がトランザクションで囲まれていない

**対象:** Plan Task 3 — `delete_folder_recursive` / `delete_smart_folder_recursive`

再帰削除は複数のDELETE文を発行するが、トランザクションで囲まれていない。ディスクエラーやロック競合で中途半敗すると、一部の子フォルダだけ削除されて親が残る不整合状態になる。

**修正案:** コマンド層またはクエリ関数のトップレベルで `BEGIN` / `COMMIT` / `ROLLBACK` を使用:

```rust
pub fn delete_folder_recursive(conn: &Connection, id: &str) -> Result<(), AppError> {
    conn.execute_batch("BEGIN;")?;
    match delete_folder_recursive_inner(conn, id) {
        Ok(()) => { conn.execute_batch("COMMIT;")?; Ok(()) }
        Err(e) => { let _ = conn.execute_batch("ROLLBACK;"); Err(e) }
    }
}
```

---

### C2: 再帰削除のエラー黙殺

**対象:** Plan Task 3 — `.filter_map(|r| r.ok())`

子フォルダIDの収集で `.filter_map(|r| r.ok())` を使っており、行マッピングエラーを黙殺する。該当する子フォルダ（とそのサブツリー）が削除されず孤児化する。

**修正案:** `.collect::<Result<Vec<_>, _>>()?` に変更:

```rust
let child_ids: Vec<String> = stmt
    .query_map(params![id], |row| row.get(0))?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| AppError::Database(e.to_string()))?;
```

---

### C3: 親フォルダ削除時に子フォルダ選択中のフィルタがリセットされない

**対象:** `Sidebar.tsx` — `handleDeleteFolder` (line 282-296), `handleDeleteSmartFolder` (line 323-337)

現在の `handleDeleteFolder` は `filter.folder_id === folderId` のみチェックする。バックエンドの再帰削除で子孫も消えるが、子フォルダが選択中の場合 `filter.folder_id` は子のIDを保持し続け、存在しないフォルダでフィルタされて空の結果が表示される。

**修正案:** 削除後に `fetchFolders()` で取得したリストに `filter.folder_id` が存在するか確認:

```typescript
const handleDeleteFolder = useCallback(async (folderId: string) => {
  try {
    await tauriInvoke('delete_folder', { id: folderId });
    await fetchFolders();
    // 削除後、選択中フォルダがリストに残っているか確認
    const current = useLibraryStore.getState().folders;
    if (filter.folder_id && !current.find(f => f.id === filter.folder_id)) {
      resetFilter();
    }
    addToast('フォルダを削除しました', 'success');
  } catch (e) { ... }
}, ...);
```

`handleDeleteSmartFolder` も同様に修正が必要。

---

### C4: `db/mod.rs` のテストがマイグレーションバージョン 1 を期待

**対象:** `src-tauri/src/db/mod.rs`

既存のテスト `test_init_runs_migrations` が `version == 1` をアサートしている可能性がある。V2マイグレーション追加後、`version == 2` になるためテスト失敗する。プランには `migrations.rs` 内のテスト更新は記載されているが、`db/mod.rs` のテストは言及されていない。

**修正案:** `db/mod.rs` のテストも `CURRENT_VERSION` または `2` を期待するよう更新。

---

## WARNING（潜在的な問題 / エッジケース）

### W1: 深度チェック・条件継承に無限ループ防止がない

**対象:** Plan Task 3 — `get_folder_depth`, `get_smart_folder_depth`, `collect_smart_folder_conditions`

`parent_id` を辿るループに上限がない。データ破損で循環参照（A→B→A）が発生するとハングする。

**修正案:** ループに最大反復回数ガード（例: `if depth > 10 { return Err(...) }`）を追加。

---

### W2: V2マイグレーションが冪等でない

**対象:** Plan Task 1 — `migrate_v2`

`ALTER TABLE smart_folders ADD COLUMN parent_id ...` はカラムが既に存在すると「duplicate column name」エラーになる。アプリがV2マイグレーション後にクラッシュし、`PRAGMA user_version = 2` が書き込まれなかった場合、再起動時に再実行されてエラーとなる。

**修正案:** カラムの存在を事前チェック:

```rust
fn migrate_v2(conn: &Connection) -> Result<(), AppError> {
    let has_column = conn
        .prepare("SELECT parent_id FROM smart_folders LIMIT 0")
        .is_ok();
    if !has_column {
        conn.execute_batch(
            "ALTER TABLE smart_folders ADD COLUMN parent_id TEXT REFERENCES smart_folders(id) ON DELETE SET NULL;",
        )?;
    }
    conn.execute_batch("PRAGMA user_version = 2;")?;
    Ok(())
}
```

---

### W3: ルートフォルダ作成とサブフォルダ作成の状態が排他制御されていない

**対象:** Plan Task 8 — `creatingFolder` と `creatingSubfolderId`

「+」ボタンでルートフォルダ作成中に、右クリックでサブフォルダ作成を開始すると、2つのインライン入力が同時表示される。

**修正案:** `setCreatingSubfolderId` 時に `setCreatingFolder(false)` をセット、およびその逆も実施。

---

### W4: 「+」ボタンでスマートフォルダ作成時に `creatingSfSubfolderId` がリセットされない

**対象:** `Sidebar.tsx` line 498-499, Plan Task 8 Step 6

スマートフォルダセクションの「+」ボタンは `setEditingSmartFolder(undefined); setShowSmartFolderEditor(true)` のみ実行し、`creatingSfSubfolderId` をリセットしない。以前のサブフォルダ作成操作で残った値がSmartFolderEditorに渡され、ルートレベルのつもりがサブフォルダとして作成される。

**修正案:** 「+」ボタンのハンドラに `setCreatingSfSubfolderId(null)` を追加。

---

### W5: 存在しないフォルダIDに対する深度チェックのエラーメッセージが不明瞭

**対象:** Plan Task 3 — `get_folder_depth` / `get_smart_folder_depth`

不存在のIDが渡されると `rusqlite::Error::QueryReturnedNoRows` → `AppError::Database("Query returned no rows")` となり、原因がわかりにくい。

**修正案:** `QueryReturnedNoRows` を `AppError::Validation("フォルダが見つかりません: {id}")` にマッピング。

---

### W6: `update_smart_folder` が `parent_id` を更新しない

**対象:** `src-tauri/src/db/queries.rs` lines 406-417

`update_smart_folder` のSQLは `UPDATE smart_folders SET name = ?1, conditions = ?2 WHERE id = ?3` で、`parent_id` を更新しない。現時点ではスコープ外（フォルダ移動は対象外）だが、将来的に必要になった場合に忘れやすいポイント。

**修正案:** 認識の上、コードコメントで明記。

---

### W7: テストカバレッジの不足

**対象:** Plan Task 10

以下のテストケースが不足:
1. アーカイブが削除フォルダと存続フォルダの両方に所属している場合の再帰削除
2. 3階層（祖父→親→子）のスマートフォルダ条件継承
3. 存在しないフォルダIDでの深度チェック
4. 全フォルダが `sort_order = 0` の場合の兄弟ソート順

---

### W8: 兄弟フォルダのソート順

**対象:** `queries.rs` — `get_folders` (line 171)

SQLは `ORDER BY sort_order` のみで、名前による二次ソートがない。全フォルダが `sort_order = 0` で作成されるため、兄弟フォルダは挿入順に表示される（アルファベット順ではない）。

**修正案:** `ORDER BY sort_order, name` に変更。`get_smart_folders` も同様。

---

## INFO（改善提案）

### I1: DetailPanel のフォルダ表示がフラットリストのまま

`DetailPanel.tsx` の「フォルダに追加」ドロップダウンはフラットリスト。サブフォルダ導入後、親子が区別できない。ドロップダウンにインデントを追加するか、パス表示にすべき。現時点では機能は壊れないが、UXが低下する。

### I2: ツリー構築が毎レンダリング実行される

`buildFolderTree(folders)` がJSX内のIIFEで毎回呼ばれる。`useMemo(() => buildFolderTree(folders), [folders])` にすべき。

### I3: 最大深度でのサイドバー幅

depth 2 で `paddingLeft = 44px` + アイコン + トグルで、テキスト表示幅は約112px（8-10文字）。`textOverflow: 'ellipsis'` で切り詰められるが、長いフォルダ名は見切れる。現状の220px幅では実用上問題ないレベル。

### I4: SQLite FK制約の非対称性

`folders.parent_id` のFKは `CREATE TABLE` で定義されているため強制される。`smart_folders.parent_id` は `ALTER TABLE ADD COLUMN` で追加されるため、SQLiteバージョンによってはFKが強制されない場合がある（SQLite 3.25.0以降では強制される）。アプリケーションコードで再帰削除を行うため実害はないが、コードコメントで非対称性を文書化すべき。

### I5: 条件継承のN+1クエリ

`collect_smart_folder_conditions` は祖先1つにつき1クエリ発行。最大3階層で3クエリ。ローカルSQLiteのプライマリキールックアップなので実用上問題なし。再帰CTEの最適化は不要。

---

## 修正優先度サマリー

| 優先度 | ID | 内容 | 影響 |
|--------|----|------|------|
| **CRITICAL** | C1 | 再帰削除をトランザクションで囲む | データ不整合 |
| **CRITICAL** | C2 | `.filter_map` → `.collect::<Result>` | データ孤児化 |
| **CRITICAL** | C3 | 親削除時の子フォルダフィルタリセット | 空表示バグ |
| **CRITICAL** | C4 | `db/mod.rs` テスト更新 | ビルド失敗 |
| WARNING | W1 | 無限ループ防止 | ハング |
| WARNING | W2 | マイグレーション冪等性 | 起動失敗 |
| WARNING | W3 | フォルダ作成状態の排他制御 | UI不整合 |
| WARNING | W4 | SF「+」ボタンの状態リセット | 誤った親子関係 |
| WARNING | W5 | エラーメッセージ改善 | デバッグ困難 |
| WARNING | W6 | `update_smart_folder` のparent_id | 将来の拡張障害 |
| WARNING | W7 | テストケース不足 | カバレッジ低 |
| WARNING | W8 | 兄弟ソート順 | UX |
| INFO | I1-I5 | 各種改善提案 | — |
