<h1 align="center">ArchiveViewer</h1>

<p align="center">
  Organize your image archives. Read them beautifully.
</p>

<p align="center">
  <a href="https://github.com/Ramo-Inc/archive-viewer/releases/latest">Download</a>&nbsp;&nbsp;|&nbsp;&nbsp;<a href="README.md">日本語</a>
</p>

<br>

<p align="center">
  <img src="public/img2.png" width="100%" alt="Library view">
</p>

<p align="center">
  <img src="public/img1.png" width="49%" alt="Setup wizard">
  <img src="public/img3.png" width="49%" alt="Viewer">
</p>

<br>

## Features

**Read ZIP / RAR directly** — Drag & drop `.cbz` `.zip` `.cbr` `.rar` files

**Organize with folders, tags & smart folders** — Build a library that fits your reading style

**High-quality rendering** — WebGL2 area-averaging shader for moire-free downscaling

**Spread view** — Auto-detects landscape pages and displays them side by side

**Auto-save reading position** — Pick up right where you left off

**Backup / restore** — Export your entire library as a single ZIP

## Requirements

Windows 10 / 11 (64-bit)

<br>

<details>
<summary><b>Tech Stack</b></summary>

<br>

| Layer | Technology |
|---|---|
| UI | React 19, TypeScript, Zustand, react-virtuoso |
| Desktop | Tauri 2 (Rust + WebView) |
| Database | SQLite via rusqlite (WAL mode) |
| Rendering | WebGL2 fragment shader |
| Archives | zip, unrar |

</details>

<details>
<summary><b>Building from Source</b></summary>

<br>

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) 1.77.2+, [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)

```bash
npm install
npx tauri dev       # Development (hot reload)
.\build.bat         # Release build
```

</details>

<details>
<summary><b>Tests</b></summary>

<br>

```bash
cd src-tauri && cargo test   # Rust tests
npx tsc --noEmit             # Type check
npm run lint                 # Lint
```

</details>

<details>
<summary><b>Project Structure</b></summary>

<br>

```
src/                    # React frontend
  pages/                # SetupWizard, LibraryPage, ViewerPage
  components/           # UI components
  stores/               # Zustand stores
  hooks/                # Custom hooks

src-tauri/src/          # Rust backend
  commands/             # Tauri IPC handlers
  db/                   # SQLite (migrations, queries, models)
  library/              # Import pipeline, integrity check
  archive/              # ZIP/RAR extraction
  imaging/              # Thumbnail generation
```

</details>

<details>
<summary><b>Data Locations</b></summary>

<br>

| Path | Contents |
|---|---|
| `<exe>\config.json` | App settings |
| `<library>/archiveviewer.db` | Database |
| `<library>/archives/` | Archive files |
| `<library>/thumbnails/` | Thumbnails |

</details>

<br>

## License

MIT
