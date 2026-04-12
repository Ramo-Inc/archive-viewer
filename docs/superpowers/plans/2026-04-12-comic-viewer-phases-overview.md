# ComicViewer 実装フェーズ一覧

> 各フェーズは独立してビルド・テスト可能なソフトウェアを生成する。
> 前のフェーズの完了が次のフェーズの前提条件。

**PRD参照:** `docs/superpowers/specs/2026-04-12-comic-viewer-design.md`

---

## Phase 1: Foundation (基盤構築)
**Plan:** `docs/superpowers/plans/2026-04-12-comic-viewer-phase1-foundation.md`
**Status:** 作成済み

**成果物:** Tauri v2 + React + TypeScript プロジェクト、SQLite DB層（全テーブル・マイグレーション・CRUD）、AppError、アプリ設定管理、ダークテーマ基盤

**タスク数:** 8

---

## Phase 2: Archive Processing & Import (アーカイブ処理・インポート)
**Plan:** `docs/superpowers/plans/2026-04-12-comic-viewer-phase2-archive.md`
**Status:** 未作成

**スコープ:**
- ZIP/CBZ アーカイブ読み取り（`zip` クレート）
- CBR(RAR) アーカイブ読み取り（`unrar` クレート）
- 共通アーカイブインターフェース（ページ一覧、画像抽出）
- Natural sort によるページ順序
- 画像ファイルフィルタリング（jpg/png/webp/gif/bmp）
- サムネイル生成（JPEG, 300px幅, 品質85%）
- インポートパイプライン（コピー → DB登録 → 元ファイル削除）
- `import_archives` Tauriコマンド

**対応PRD機能:** F3, F4, F5

---

## Phase 3: Library UI (ライブラリ画面)
**Plan:** `docs/superpowers/plans/2026-04-12-comic-viewer-phase3-library-ui.md`
**Status:** 未作成

**スコープ:**
- 3ペインレイアウト（サイドバー + グリッド + 詳細パネル）
- zustand ストア（libraryStore）
- サイドバーコンポーネント（ライブラリ/フォルダ/スマートフォルダ）
- サムネイルグリッド（react-virtuoso 仮想スクロール）
- 詳細パネル（メタデータ表示・編集、★ランク、メモ、タグ）
- トップバー（ソート、タグフィルタ、ランクフィルタ、グリッドサイズスライダー、検索）
- 複数選択（Ctrl+Click, Shift+Click, Ctrl+A）
- 右クリックコンテキストメニュー
- asset protocol でのサムネイル表示

**対応PRD機能:** F1, F6, F7, F8, F9, F10, F11, F12, F13, F14, F16

---

## Phase 4: Viewer (ビューワー画面)
**Plan:** `docs/superpowers/plans/2026-04-12-comic-viewer-phase4-viewer.md`
**Status:** 未作成

**スコープ:**
- ビューワーページ（ライブラリ ↔ ビューワー遷移）
- 見開き表示（右綴じ、見開きページ自動判定）
- 単ページ表示
- ページ画像のtemp展開 + asset protocol配信
- キーボードショートカット（←→ページ送り、F フルスクリーン、Esc 戻る、1/2 モード切替、Space UI切替）
- ホバーUI（トップバー、ページスライダー、フェードイン/アウト）
- 画像プリロード（± 2見開き分）
- 読書位置レジューム
- 一時ファイルクリーンアップ

**対応PRD機能:** F2, F15

---

## Phase 5: Drag & Drop, Organization (D&D・整理機能)
**Plan:** `docs/superpowers/plans/2026-04-12-comic-viewer-phase5-dnd-organization.md`
**Status:** 未作成

**スコープ:**
- 外部ファイルドロップ（`listen('tauri://drag-drop', ...)` + デバウンス + ドロップ先判定）
- 内部ドラッグ（グリッド → フォルダ/タグ/スマートフォルダ）
- ドロップゾーンハイライト
- フォルダCRUD UI（作成・リネーム・削除）
- タグ編集UI（TagEditor）
- スマートフォルダ条件設定UI（SmartFolderEditor）
- File Watcher（notify クレートでファイル監視）
- 起動時整合性チェック（DB ↔ ファイルシステム突合）
- 一括操作（タグ、ランク、フォルダ追加、削除）

**対応PRD機能:** F3, F6, F7, F10（D&D部分）

---

## 依存関係

```
Phase 1 (Foundation)
    ↓
Phase 2 (Archive & Import)
    ↓
Phase 3 (Library UI)  ←→  Phase 4 (Viewer)  ※並行可能
    ↓                        ↓
Phase 5 (D&D & Organization)  ← 両方に依存
```

Phase 3 と Phase 4 は独立しており並行作業可能。Phase 5 は両方のUIが必要。
