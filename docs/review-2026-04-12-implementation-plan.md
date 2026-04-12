# ComicViewer 実装計画 総合レビュー結果

**レビュー日:** 2026-04-12
**対象:** PRD + Phase 1〜5 実装計画
**レビュー観点:** Rust/Tauri技術、React/フロントエンド、PRD⇔計画整合性、UX/セキュリティ

---

## 統計サマリー

| 重要度 | 件数 | 概要 |
|--------|------|------|
| **Critical** | 12 | コンパイル不能、セキュリティ脆弱性、起動不能、データ損失リスク |
| **High** | 18 | 主要機能の未実装、パフォーマンス問題、UX欠陥 |
| **Medium** | 20 | 仕様との不整合、コード品質、補助機能の欠落 |
| **Low** | 10 | コードスタイル、軽微な不整合 |

以下、重複を排除し優先度順に記載する。

---

## Critical（必ず修正）

### CR-1: Zip Slip（パストラバーサル）攻撃への対策なし
**Phase 4 Task 1 `viewer.rs`**

`prepare_pages` でアーカイブ内のファイル名をそのまま `temp_dir.join(&page.name)` に使用。悪意あるアーカイブが `../../Windows/System32/...` のようなパスを含む場合、システム上の任意の場所にファイルが書き込まれる。

**修正:** 展開先パスが `temp_dir` のプレフィックスを持つことを検証するサニタイズ処理を追加。

---

### CR-2: セットアップウィザードUIが全Phaseに存在しない
**PRD 11.1 → 全Phase**

PRDでは「初回起動時にセットアップダイアログを表示しライブラリフォルダを選択」と定義されているが、どのPhaseにもセットアップ画面の実装タスクがない。初回起動時にユーザーはライブラリを設定できず、アプリが機能しない。

**修正:** Phase 1 または Phase 3 に `SetupWizard.tsx` の実装タスクを追加。`get_library_path` が null の場合にウィザードを表示。

---

### CR-3: DbState管理方式がPhase間で互換性なし
**Phase 1 Task 7 vs Phase 2 Task 6**

Phase 1 では `Option<DbState>` としてmanage、Phase 2 では `DbState` を直接manage。`init_library` は `State<'_, Option<DbState>>` を期待するのに対し、Phase 2以降は `State<'_, DbState>` を使用。ライブラリ未設定時に全コマンドがパニックする。

**修正:** `DbState(pub Mutex<Option<Connection>>)` で統一。各コマンドで `conn.as_ref().ok_or(AppError::LibraryNotFound)?` パターンを使用。

---

### CR-4: 元ファイル自動削除に確認ダイアログなし
**Phase 5 Task 2 `useDragDrop.ts`、Phase 2 `import.rs`**

D&Dインポート時にユーザーの元ファイルが確認なしに自動削除される。ユーザーがデスクトップのファイルをドロップした場合、予告なくファイルが消える。

**修正:** デフォルトを「コピーのみ（元ファイル保持）」に変更。設定で「移動」を選択可能にする。

---

### CR-5: `ZipArchive::by_index` の可変借用違反
**Phase 2 Task 2 `zip.rs`**

`list_pages()` で `archive.by_index(i)` を呼んでいるが、`by_index` は `&mut self` を要求。不変の `archive` に対する呼び出しでコンパイルエラーになる。

**修正:** `let mut archive = ZipArchive::new(file)...` に変更し、for ループ内で `archive.by_index(i)` を呼ぶ。

---

### CR-6: `image::io::Reader` は廃止パス
**Phase 2 Task 4 `thumbnail.rs`**

`image` クレート 0.25 以降では `image::io::Reader` は `image::ImageReader` に移動。計画のコードはコンパイル不能。

**修正:** `use image::ImageReader;` に変更。

---

### CR-7: `unrar` クレートのAPIが計画コードと不一致
**Phase 2 Task 3 `rar.rs`**

`unrar 0.5` の実際のAPI（`list()`, `entry.filename`, `extract_to`）が計画のコードと一致しない可能性が高い。特に `extract_page` が全ファイル展開する非効率な実装。

**修正:** `unrar` のバージョンを固定し、実際のAPIドキュメントに合わせてコードを調整。`extract_page` にキャッシュ機構を導入。

---

### CR-8: インポートパイプラインでSQLiteトランザクション未使用
**Phase 2 Task 5 `import.rs`**

PRDで「SQLiteトランザクション内でDBにレコード挿入」と明記されているが、`insert_archive` と `move_archives_to_folder` がトランザクション外で実行。途中失敗時にデータ不整合。

**修正:** `let tx = conn.transaction()?;` で囲み、成功時に `tx.commit()?;`。

---

### CR-9: Mutex<Connection> を長時間保持しUIフリーズ
**Phase 2 Task 5 `import.rs`、Phase 2 Task 6 `archive.rs`**

`import_archives` でファイルコピー・解析・サムネイル生成を含む長時間処理中にMutexロックを保持。他のDB操作コマンドが全てブロックされUIがフリーズ。

**修正:** ファイルI/O処理をMutexスコープ外で実行。DB操作のみ短時間ロックで実行する2段階設計に変更。

---

### CR-10: VirtuosoGrid の flex-wrap 方式が仮想スクロールと矛盾
**Phase 3 Task 6 `ArchiveGrid.tsx`**

`VirtuosoGrid` に `listClassName` + CSS `flex-wrap` でグリッドレイアウトを組んでいるが、仮想化の行高さ計算と矛盾。数百冊以上でスクロールジャンプや空白が発生。

**修正:** `components` prop で `List`/`Item` をカスタムし、CSS Grid `grid-template-columns: repeat(auto-fill, minmax(${gridSize}px, 1fr))` で制御。

---

### CR-11: asset protocol スコープが `**`（全ファイルシステム開放）
**Phase 1 Task 8 `tauri.conf.json`**

`assetProtocol.scope: ["**"]` で全ファイルシステムにWebViewからアクセス可能。XSS経由で任意のファイルが読み取られるリスク。

**修正:** スコープをライブラリフォルダに限定。起動時にランタイムスコープAPIで動的追加。

---

### CR-12: `mod image` がクレート名と衝突（ほぼ確実）
**Phase 2 Task 4**

`mod image` は外部クレート `image` と名前衝突する。`thumbnail.rs` 内の `use image::imageops::...` がローカルモジュールを参照しコンパイルエラー。

**修正:** 最初から `mod imaging` にリネームし、全Phaseの参照パスを統一。

---

## High（強く修正を推奨）

### HI-1: `get_archives` がフィルタ条件をバックエンドに送っていない
**Phase 2 Task 6、Phase 3 Task 2**

PRDでは `get_archives(filter: ArchiveFilter)` だが、実装は引数なし。フォルダ選択、スマートフォルダ、プリセットフィルタ、タグフィルタ、ソートが全て動作しない。数千冊で全件フロント取得はパフォーマンス破綻。

---

### HI-2: File Watcher (notify) の実装タスクが全Phaseに存在しない
**Phase 5 スコープ → 全Task**

PRDとPhase Overviewに明記されているが、`watcher.rs` の作成手順、`notify` クレート追加がどのTaskにもない。

---

### HI-3: SmartFolderEditor UIの実装タスクが存在しない
**Phase 3/5 File Structure → 全Task**

ファイル構造に記載されているが実装タスクがない。ユーザーがUIからスマートフォルダを作成・編集できない。

---

### HI-4: `rename_folder` / `update_smart_folder` コマンドが未実装
**PRD 5.1 → Phase 5**

PRDで定義された2つのCRUDコマンドがどのPhaseにも実装されていない。

---

### HI-5: `image` / `zip` クレートが Cargo.toml に未追加
**Phase 2 Task 2, 4**

Phase 1 の Cargo.toml にこれらのクレートが含まれておらず、Phase 2に追加手順もない。

---

### HI-6: RAR extract_page が全ファイル展開 + 並行アクセス問題
**Phase 2 Task 3 `rar.rs`**

単一ページの展開にアーカイブ全体を展開。固定ディレクトリ名で並行アクセス競合。

---

### HI-7: useEffect cleanup で非同期関数が実行されない可能性
**Phase 4 Task 6 `ViewerPage.tsx`**

`return () => { savePosition(); cleanup(); }` はPromise完了を待たない。ルーティング遷移時に読書位置が保存されない。

---

### HI-8: 単ページモード (SinglePageView) が未実装
**Phase 4 Task 6**

コメントで「SpreadViewを使い回す」とあるが、SpreadViewの `maxWidth: '50%'` が単ページ時にも適用され画像が小さく表示される。

---

### HI-9: nextPage/prevPage が見開きページ(is_spread)を考慮していない
**Phase 4 Task 2 `viewerStore.ts`**

表紙(0ページ目)や見開きページの単独表示時に+2するとページがスキップされる。

---

### HI-10: convertFileSrc に相対パスを渡している
**Phase 3 Task 5 `ArchiveCard.tsx`**

DBの `thumbnail_path` は相対パス（`thumbnails/<id>.jpg`）だが、`convertFileSrc()` は絶対パスが必要。サムネイルが表示されない。

---

### HI-11: prepare_pages が全ページ一括展開（PRDと矛盾）
**Phase 4 Task 1 `viewer.rs`**

PRDでは「±2見開き分をプリロード、最大20ページ」だが、実装は全ページ展開。数百ページで遅延とディスク圧迫。

---

### HI-12: トースト通知の実装が全Phaseにない
**PRD 5.0, 11.2 → 全Phase**

PRDで「トースト通知で表示」と複数記載あるが、トーストコンポーネントの実装タスクがゼロ。全エラーが `console.error` のみ。

---

### HI-13: インポート失敗時のクリーンアップが不完全
**Phase 2 Task 5 `import.rs`**

サムネイル生成失敗やDB登録失敗時にコピー済みファイルが残る。

---

### HI-14: init_library がDB再初期化しない
**Phase 1 Task 7**

`init_library` はディレクトリ作成とconfig保存のみ。アプリ再起動なしではDB使用不可。

---

### HI-15: zustand ストアの不要な再レンダリング
**Phase 3 Task 2 `libraryStore.ts`**

セレクタなしで全プロパティを取得しており、任意の変更で全サブスクライバーが再レンダリング。

---

### HI-16: D&D の elementFromPoint が Tauri v2 座標系で機能しない可能性
**Phase 5 Task 2 `useDragDrop.ts`**

`tauri://drag-drop` の `position` はウィンドウ座標系。DPIスケーリングやタイトルバーオフセットで `elementFromPoint` が正しく動作しない。

---

### HI-17: DB破損からの復旧手段がない
**Phase 1 Task 5 `migrations.rs`**

PRDの「マイグレーション前に自動バックアップ」が未実装。DB破損時のリカバリフローもない。

---

### HI-18: 整合性チェックがPRDと矛盾（即DELETE vs missingフラグ）
**Phase 5 Task 5 `integrity.rs`**

PRDは「missingフラグを立て警告表示（即座に削除しない）」だが、実装は `DELETE FROM archives`。一時的なファイル不可用でメタデータが全消失。

---

## Medium（修正を推奨）— 20件

| # | 概要 | Phase |
|---|------|-------|
| M-1 | `is_image_file` が拡張子のドットなしで判定（`somejpg` にマッチ） | P2 T1 |
| M-2 | エラーカテゴリが不適切（サムネイルエラーが `AppError::Archive` に分類） | P2 T4 |
| M-3 | N+1 DB呼び出し（SmartFolder D&D処理） | P5 T1 |
| M-4 | `get_library_root()` が3ファイルで重複定義 | P2/P4/P5 |
| M-5 | マイグレーションの `PRAGMA user_version` がトランザクション外 | P1 T5 |
| M-6 | スマートフォルダ条件評価ロジック (`smart_folder.rs`) が未実装 | P5 |
| M-7 | タグフィルタのUI（TopBarのドロップダウン）が未実装 | P3 T8 |
| M-8 | Shift+クリック範囲選択が未実装 | P3 T2 |
| M-9 | Tauriコマンド引数名のsnake_case/camelCase変換問題 | P5 T1 |
| M-10 | SpreadView の右綴じCSS配置が逆（flex順序で右ページが左に来る） | P4 T4 |
| M-11 | 検索入力でキーストロークごとにバックエンド呼び出し（デバウンスなし） | P3 T8 |
| M-12 | useMemo依存配列にsearchQueryがあるが未使用 + ソート分岐不足 | P3 T6 |
| M-13 | ファイル名の特殊文字（日本語、スペース等）によるCSS url()パース問題 | P3 T5/P4 T1 |
| M-14 | 空状態（アーカイブ0件）の表示UIがない | P3 T6 |
| M-15 | インポート進捗表示（プログレスバー）がない | P5 T2 |
| M-16 | ビューワーのページロード失敗時のエラー表示UIがない | P4 T6 |
| M-17 | delete_archives の確認ダイアログがない | P3/P5 |
| M-18 | CSPに `'unsafe-inline'` が含まれている | P1 T8 |
| M-19 | コンテキストメニューの状態管理・連携が未完成 | P5 T3 |
| M-20 | SidebarItem/ArchiveCard/RankStars がキーボード操作不可 | P3 |

---

## Low（検討を推奨）— 10件

| # | 概要 | Phase |
|---|------|-------|
| L-1 | 冗長な `map_err` (rusqlite の From 実装があるのに手動変換) | P2 T6 |
| L-2 | ESLint exhaustive-deps 警告 (useEffect の空依存配列) | P3 T9 |
| L-3 | SidebarItem の `[key: string]: unknown` 型安全性低下 | P3 T4 |
| L-4 | hideTimer の型が Node/Browser で不一致の可能性 | P4 T5 |
| L-5 | zustandアクションを全てuseEffect依存配列に入れている | P4 T3 |
| L-6 | DetailPanel のhandleRankChange/handleMemoBlur でtry-catchなし | P3 T7 |
| L-7 | useTauriCommand ラッパーが薄すぎて付加価値なし | P3 T1 |
| L-8 | CSS-in-JS (inline style) による保守性低下 | P3 全般 |
| L-9 | Ctrl+A 全選択ショートカット未実装 | P3 |
| L-10 | `decoder.rs` がPRDにあるが実装なし（機能は他でカバー） | P2 |

---

## 最優先で対処すべき問題 TOP 5

1. **CR-1 (Zip Slip)** — セキュリティ脆弱性。悪意あるアーカイブでシステム破壊の可能性
2. **CR-2 + CR-3 (セットアップ + DbState)** — アプリが初回起動で全く機能しない
3. **CR-9 + HI-1 (Mutex長時間保持 + フィルタ未連携)** — UIフリーズとパフォーマンス破綻
4. **CR-4 + HI-18 (ファイル削除 + 整合性チェック)** — ユーザーデータ損失リスク
5. **CR-10 (VirtuosoGrid)** — ライブラリ画面のコア機能が動作しない
