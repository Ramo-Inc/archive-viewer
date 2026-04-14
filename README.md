# ArchiveViewer

[English](README.en.md)

Windows 向けのデスクトップ漫画・コミックアーカイブビューア。Tauri 2 + React 19 + Rust で構築しています。

## 機能

- **アーカイブ対応** — ZIP (`.cbz`, `.zip`) および RAR (`.cbr`, `.rar`) ファイルを直接読み込み
- **ライブラリ管理** — 階層フォルダ・タグ・スマートフォルダ（フィルター条件による動的コレクション）で整理
- **高品質レンダリング** — WebGL2 エリア平均法シェーダーによる高精細ダウンスケーリング（WPF の `BitmapScalingMode.Fant` 相当）
- **見開き表示** — 横長ページを自動検出してページ順を維持した左右並べ表示
- **読書進捗の保存** — 各アーカイブの読書位置を自動保存
- **バックアップ／復元** — ライブラリ全体（アーカイブ＋データベース）を ZIP にエクスポート・別PCへインポート可能
- **消失ファイル検出** — 起動時に移動・削除されたファイルを自動検出してフラグ管理（メタデータは削除しない）

## 技術スタック

| レイヤー | 技術 |
|---|---|
| UI | React 19, TypeScript, Zustand, react-virtuoso |
| デスクトップ | Tauri 2（Rust バックエンド + WebView フロントエンド） |
| データベース | SQLite（rusqlite、WAL モード） |
| レンダリング | WebGL2 フラグメントシェーダー（エリア平均法） |
| アーカイブ | zip 2, unrar 0.5 |

## 動作環境

- Windows 10/11（64-bit）
- WebView2 ランタイム（Windows 11 は標準搭載、Windows 10 は別途ダウンロード）

## ソースからビルドする

### 必要なツール

- [Node.js](https://nodejs.org/) 18 以上
- [Rust](https://rustup.rs/)（stable、1.77.2 以上）
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)（Windows での Rust ビルドに必要）

### 開発用起動

```bash
# フロントエンド依存パッケージをインストール
npm install

# ホットリロード付きでデスクトップアプリを起動
npx tauri dev
```

### リリースビルド

```bash
# リリースビルド（npm ci + tauri build を実行）
.\build.bat

# または手動で
npm ci
npx tauri build
```

ビルド成果物は `src-tauri/target/release/bundle/` に出力されます。

## テストの実行

```bash
# Rust ユニット／統合テスト
cd src-tauri && cargo test

# TypeScript 型チェック
npx tsc --noEmit

# Lint
npm run lint
```

## プロジェクト構成

```
src/                    # React フロントエンド
  pages/                # SetupWizard, LibraryPage, ViewerPage
  components/
    common/             # 共通 UI コンポーネント
    library/            # グリッド・サイドバー・詳細パネル
    viewer/             # リーダー・WebGL ページレンダラー・見開きレイアウト
  stores/               # Zustand ストア（library, viewer, toast）
  hooks/                # useTauriCommand, useKeyboardShortcuts, useDragDrop

src-tauri/src/          # Rust バックエンド
  commands/             # Tauri IPC ハンドラー（library, archive, viewer, drag_drop, settings）
  db/                   # SQLite：マイグレーション・クエリ・モデル
  library/              # インポートパイプライン・起動時整合性チェック
  archive/              # ZIP/RAR 展開（共通トレイト＋フォーマット別実装）
  imaging/              # サムネイル生成
  config.rs             # アプリ設定（exe と同じディレクトリの config.json）
```

## データ・設定ファイルの場所

| パス | 内容 |
|---|---|
| `<exeのディレクトリ>\config.json` | アプリ設定（ライブラリパス・ウィンドウ状態） |
| `<ライブラリ>/archiveviewer.db` | SQLite データベース |
| `<ライブラリ>/archives/<id>/` | アーカイブファイル本体 |
| `<ライブラリ>/archives/<id>/pages/` | ページキャッシュ（バージョン変更時に自動無効化） |
| `<ライブラリ>/thumbnails/` | 表紙サムネイル（JPEG） |

## ライセンス

MIT
