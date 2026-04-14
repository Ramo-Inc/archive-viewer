<h1 align="center">ArchiveViewer</h1>

<p align="center">
  手持ちのコミック・漫画アーカイブを、きれいに整理して、きれいに読む。
</p>

<p align="center">
  <a href="https://github.com/Ramo-Inc/archive-viewer/releases/latest">Download</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="README.en.md">English</a>
</p>

<br>

<p align="center">
  <img src="public/img2.png" width="100%" alt="ライブラリ画面">
</p>

<p align="center">
  <img src="public/img1.png" width="49%" alt="セットアップ画面">
  <img src="public/img3.png" width="49%" alt="ビューア画面">
</p>

<br>

## 特徴

**ZIP / RAR をそのまま読める** — `.cbz` `.zip` `.cbr` `.rar` をドラッグ&ドロップするだけ

**フォルダ・タグ・スマートフォルダで整理** — 自分の読み方に合わせたライブラリを構築

**高品質な表示** — WebGL2 エリア平均法シェーダーでモアレのないダウンスケーリング

**見開き対応** — 横長ページを自動検出して正しいページ順で並べて表示

**読書位置を自動保存** — 前回の続きからすぐ読める

**バックアップ / 復元** — ライブラリ丸ごと ZIP で持ち出せる

## 動作環境

Windows 10 / 11（64-bit）

<br>

<details>
<summary><b>技術スタック</b></summary>

<br>

| レイヤー | 技術 |
|---|---|
| UI | React 19, TypeScript, Zustand, react-virtuoso |
| デスクトップ | Tauri 2（Rust + WebView） |
| データベース | SQLite（rusqlite、WAL モード） |
| レンダリング | WebGL2 フラグメントシェーダー |
| アーカイブ | zip, unrar |

</details>

<details>
<summary><b>ソースからビルドする</b></summary>

<br>

**必要なツール:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) 1.77.2+, [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

```bash
npm install
npx tauri dev       # 開発（ホットリロード）
.\build.bat         # リリースビルド
```

</details>

<details>
<summary><b>テスト</b></summary>

<br>

```bash
cd src-tauri && cargo test   # Rust テスト
npx tsc --noEmit             # 型チェック
npm run lint                 # Lint
```

</details>

<details>
<summary><b>プロジェクト構成</b></summary>

<br>

```
src/                    # React フロントエンド
  pages/                # SetupWizard, LibraryPage, ViewerPage
  components/           # UI コンポーネント
  stores/               # Zustand ストア
  hooks/                # カスタムフック

src-tauri/src/          # Rust バックエンド
  commands/             # Tauri IPC ハンドラー
  db/                   # SQLite（マイグレーション・クエリ・モデル）
  library/              # インポート・整合性チェック
  archive/              # ZIP/RAR 展開
  imaging/              # サムネイル生成
```

</details>

<details>
<summary><b>データの保存先</b></summary>

<br>

| パス | 内容 |
|---|---|
| `<exe>\config.json` | アプリ設定 |
| `<ライブラリ>/archiveviewer.db` | データベース |
| `<ライブラリ>/archives/` | アーカイブ本体 |
| `<ライブラリ>/thumbnails/` | サムネイル |

</details>

<br>

## ライセンス

MIT
