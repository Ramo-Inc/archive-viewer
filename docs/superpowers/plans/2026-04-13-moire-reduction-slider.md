# モアレ軽減スライダー 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ビューアの TopBar にモアレ軽減強度スライダーを追加し、CSS blur の強度を 0〜2px でユーザーが調整可能にする。設定は config.json に永続保存。

**Architecture:** Rust 側で `ViewerSettings` を `AppConfig` に追加し、`get/save_viewer_settings` コマンドで読み書き。フロントエンドは `viewerStore` に `moireReduction` を追加し、SpreadView の blur 値を動的に適用。ViewerTopBar にスライダー UI を追加。

**Tech Stack:** Rust (serde, config), TypeScript/React (Zustand), CSS, Tauri 2 IPC

---

## ファイル構成

| ファイル | 操作 | 責務 |
|---------|------|------|
| `src-tauri/src/config.rs` | 修正 | `ViewerSettings` 型追加、`AppConfig` に `viewer_settings` フィールド追加 |
| `src-tauri/src/commands/viewer.rs` | 修正 | `get_viewer_settings`, `save_viewer_settings` コマンド追加 |
| `src-tauri/src/lib.rs` | 修正 | 新コマンド登録 |
| `src/types/index.ts` | 修正 | `ViewerSettings` 型追加 |
| `src/stores/viewerStore.ts` | 修正 | `moireReduction` state + アクション追加 |
| `src/components/viewer/SpreadView.tsx` | 修正 | `pageStyle` ヘルパーで blur 動的化 |
| `src/components/viewer/ViewerTopBar.tsx` | 修正 | スライダー UI 追加 |
| `src/pages/ViewerPage.tsx` | 修正 | 設定読み込み呼び出し追加 |

---

### Task 1: ViewerSettings 型と AppConfig への追加 (Rust)

**Files:**
- Modify: `src-tauri/src/config.rs:6-36`

- [ ] **Step 1: テストを先に書く**

`src-tauri/src/config.rs` の `#[cfg(test)] mod tests` ブロック内に追加:

```rust
    #[test]
    fn test_viewer_settings_default() {
        let settings = ViewerSettings::default();
        assert_eq!(settings.moire_reduction, 0.5);
    }

    #[test]
    fn test_config_missing_viewer_settings_uses_default() {
        let json = r#"{"library_path": "D:/Manga"}"#;
        let config: AppConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.viewer_settings.moire_reduction, 0.5);
    }

    #[test]
    fn test_viewer_settings_roundtrip() {
        let tmp = TempDir::new().unwrap();
        let config_file = tmp.path().join("config.json");

        let config = AppConfig {
            library_path: Some("D:/Manga".to_string()),
            window_state: WindowState::default(),
            viewer_settings: ViewerSettings { moire_reduction: 1.2 },
        };

        save_config_to(&config, &config_file).unwrap();
        let loaded = load_config_from(&config_file).unwrap();
        assert!((loaded.viewer_settings.moire_reduction - 1.2).abs() < f32::EPSILON);
    }
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd src-tauri && cargo test --lib config::tests -- --nocapture 2>&1 | tail -10`
Expected: コンパイルエラー（`ViewerSettings` が未定義）

- [ ] **Step 3: ViewerSettings 型と AppConfig の変更を実装**

`src-tauri/src/config.rs` の `WindowState` と `AppConfig` の間（line 21 の後）に追加:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewerSettings {
    pub moire_reduction: f32,
}

impl Default for ViewerSettings {
    fn default() -> Self {
        Self {
            moire_reduction: 0.5,
        }
    }
}
```

`AppConfig` の struct 定義を変更（line 23-28）:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub library_path: Option<String>,
    #[serde(default)]
    pub window_state: WindowState,
    #[serde(default)]
    pub viewer_settings: ViewerSettings,
}
```

`AppConfig::Default` impl を変更（line 30-37）:

```rust
impl Default for AppConfig {
    fn default() -> Self {
        Self {
            library_path: None,
            window_state: WindowState::default(),
            viewer_settings: ViewerSettings::default(),
        }
    }
}
```

既存テスト `test_save_and_load_config`（line 110）の AppConfig 構築を修正:

```rust
        let config = AppConfig {
            library_path: Some("D:/MangaLibrary".to_string()),
            window_state: WindowState {
                width: 1920,
                height: 1080,
                maximized: true,
            },
            viewer_settings: ViewerSettings::default(),
        };
```

既存テスト `test_config_serialization_roundtrip`（line 142）の AppConfig 構築を修正:

```rust
        let config = AppConfig {
            library_path: Some("C:/Comics".to_string()),
            window_state: WindowState::default(),
            viewer_settings: ViewerSettings::default(),
        };
```

- [ ] **Step 4: テストを実行して全パスを確認**

Run: `cd src-tauri && cargo test --lib config::tests -- --nocapture 2>&1 | tail -15`
Expected: 全テストパス

- [ ] **Step 5: コミット**

```bash
git add src-tauri/src/config.rs
git commit -m "feat: add ViewerSettings with moire_reduction to AppConfig"
```

---

### Task 2: get/save_viewer_settings コマンド (Rust)

**Files:**
- Modify: `src-tauri/src/commands/viewer.rs`
- Modify: `src-tauri/src/lib.rs:78-85`

- [ ] **Step 1: テストを先に書く**

`src-tauri/src/commands/viewer.rs` の `#[cfg(test)] mod tests` ブロック内に追加:

```rust
    #[test]
    fn test_save_and_load_viewer_settings() {
        let tmp = TempDir::new().unwrap();
        let config_file = tmp.path().join("config.json");

        // 初期設定を保存
        let initial = config::AppConfig::default();
        config::save_config_to(&initial, &config_file).unwrap();

        // save_viewer_settings_to で保存
        let settings = config::ViewerSettings { moire_reduction: 1.5 };
        save_viewer_settings_impl(&settings, &config_file).unwrap();

        // 読み込んで確認
        let loaded = config::load_config_from(&config_file).unwrap();
        assert!((loaded.viewer_settings.moire_reduction - 1.5).abs() < f32::EPSILON);
    }

    #[test]
    fn test_save_viewer_settings_clamps_value() {
        let tmp = TempDir::new().unwrap();
        let config_file = tmp.path().join("config.json");

        let initial = config::AppConfig::default();
        config::save_config_to(&initial, &config_file).unwrap();

        // 範囲外の値
        let settings = config::ViewerSettings { moire_reduction: 5.0 };
        save_viewer_settings_impl(&settings, &config_file).unwrap();

        let loaded = config::load_config_from(&config_file).unwrap();
        assert!((loaded.viewer_settings.moire_reduction - 2.0).abs() < f32::EPSILON);
    }

    #[test]
    fn test_save_viewer_settings_clamps_negative() {
        let tmp = TempDir::new().unwrap();
        let config_file = tmp.path().join("config.json");

        let initial = config::AppConfig::default();
        config::save_config_to(&initial, &config_file).unwrap();

        let settings = config::ViewerSettings { moire_reduction: -1.0 };
        save_viewer_settings_impl(&settings, &config_file).unwrap();

        let loaded = config::load_config_from(&config_file).unwrap();
        assert!((loaded.viewer_settings.moire_reduction - 0.0).abs() < f32::EPSILON);
    }
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd src-tauri && cargo test --lib commands::viewer::tests::test_save_and_load_viewer_settings -- --nocapture 2>&1 | tail -10`
Expected: コンパイルエラー（`save_viewer_settings_impl` が未定義）

- [ ] **Step 3: コマンド実装**

`src-tauri/src/commands/viewer.rs` の `cleanup_temp_pages` 関数の後に追加:

```rust
/// ビューア設定を取得
#[tauri::command]
pub fn get_viewer_settings() -> Result<config::ViewerSettings, AppError> {
    let cfg = config::load_config()?;
    Ok(cfg.viewer_settings)
}

/// ビューア設定を保存（内部実装: テスト用にパス指定可能）
fn save_viewer_settings_impl(
    settings: &config::ViewerSettings,
    config_path: &std::path::Path,
) -> Result<(), AppError> {
    let mut cfg = config::load_config_from(config_path)?;
    cfg.viewer_settings.moire_reduction = settings.moire_reduction.clamp(0.0, 2.0);
    config::save_config_to(&cfg, config_path)
}

/// ビューア設定を保存
#[tauri::command]
pub fn save_viewer_settings(settings: config::ViewerSettings) -> Result<(), AppError> {
    let config_path = config::config_path()?;
    save_viewer_settings_impl(&settings, &config_path)
}
```

- [ ] **Step 4: テストを実行して全パスを確認**

Run: `cd src-tauri && cargo test --lib commands::viewer::tests -- --nocapture 2>&1 | tail -15`
Expected: 全テストパス

- [ ] **Step 5: lib.rs にコマンド登録**

`src-tauri/src/lib.rs` の `invoke_handler` 内、`// viewer commands` セクション（`commands::viewer::cleanup_temp_pages` の後）に追加:

```rust
            commands::viewer::get_viewer_settings,
            commands::viewer::save_viewer_settings,
```

- [ ] **Step 6: ビルド確認**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: warning のみ、error なし

- [ ] **Step 7: コミット**

```bash
git add src-tauri/src/commands/viewer.rs src-tauri/src/lib.rs
git commit -m "feat: add get/save_viewer_settings Tauri commands with validation"
```

---

### Task 3: フロントエンド型定義 + viewerStore 拡張

**Files:**
- Modify: `src/types/index.ts:94`
- Modify: `src/stores/viewerStore.ts`

- [ ] **Step 1: ViewerSettings 型を追加**

`src/types/index.ts` の末尾に追加:

```typescript
/** Viewer display settings (persisted to config.json). */
export interface ViewerSettings {
  moire_reduction: number;
}
```

- [ ] **Step 2: viewerStore に moireReduction を追加**

`src/stores/viewerStore.ts` の import 文に `ViewerSettings` を追加:

```typescript
import type { ArchiveDetail, PageInfo, ViewerArchive, ViewerSettings } from '../types';
```

`ViewerState` interface に追加（`sidebarOpen: boolean;` の後）:

```typescript
  /** Moire reduction blur intensity in px (0-2, persisted). */
  moireReduction: number;
```

actions に追加（`toggleSidebar: () => void;` の後）:

```typescript
  setMoireReduction: (value: number) => void;
  saveMoireReduction: (value: number) => void;
  loadSettings: () => Promise<void>;
```

初期値を追加（`sidebarOpen: false,` の後）:

```typescript
  moireReduction: 0.5,
```

アクション実装を追加（`toggleSidebar` の後）:

```typescript
  setMoireReduction: (value) => set({ moireReduction: value }),

  saveMoireReduction: (value) => {
    tauriInvoke('save_viewer_settings', {
      settings: { moire_reduction: value },
    }).catch(() => {});
  },

  loadSettings: async () => {
    try {
      const settings = await tauriInvoke<ViewerSettings>('get_viewer_settings');
      set({ moireReduction: settings.moire_reduction });
    } catch {
      // コマンド未登録時はデフォルト値を使用
    }
  },
```

- [ ] **Step 3: コミット**

```bash
git add src/types/index.ts src/stores/viewerStore.ts
git commit -m "feat: add moireReduction to viewerStore with load/save settings"
```

---

### Task 4: SpreadView の blur 動的化

**Files:**
- Modify: `src/components/viewer/SpreadView.tsx`

- [ ] **Step 1: store import と pageStyle ヘルパーを追加**

`src/components/viewer/SpreadView.tsx` の冒頭に store import を追加:

```typescript
import { convertFileSrc } from '@tauri-apps/api/core';
import type { PageInfo } from '../../types';
import { useViewerStore } from '../../stores/viewerStore';
```

`pageUrl` 関数の後、`SpreadView` コンポーネントの前に `pageStyle` ヘルパー関数を追加:

```typescript
/** Build shared img style with conditional moire reduction blur. */
function pageStyle(moireReduction: number, maxWidth: string): React.CSSProperties {
  return {
    maxWidth,
    maxHeight: '100%',
    objectFit: 'contain',
    imageRendering: 'smooth' as const,
    ...(moireReduction > 0 ? { filter: `blur(${moireReduction}px)` } : {}),
  };
}
```

- [ ] **Step 2: SpreadView 内で store から moireReduction を取得し、4箇所の style を置換**

`SpreadView` コンポーネントの冒頭（`if (pages.length === 0)` の前）に追加:

```typescript
  const moireReduction = useViewerStore((s) => s.moireReduction);
```

4箇所のインラインスタイルを `pageStyle` ヘルパーに置換:

**Single モード（line ~62-72 の `<img>`）:**
```typescript
        <img
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          style={pageStyle(moireReduction, '100%')}
          draggable={false}
        />
```

**Spread ソロ（line ~100-110 の `<img>`）:**
```typescript
        <img
          src={pageUrl(currentPageInfo)}
          alt={`Page ${currentPage + 1}`}
          style={pageStyle(moireReduction, '100%')}
          draggable={false}
        />
```

**Spread 右ページ（line ~132-141 の `<img>`）:**
```typescript
      <img
        src={pageUrl(rightPage)}
        alt={`Page ${currentPage + 1}`}
        style={pageStyle(moireReduction, '50%')}
        draggable={false}
      />
```

**Spread 左ページ（line ~143-153 の `<img>`）:**
```typescript
        <img
          src={pageUrl(leftPage)}
          alt={`Page ${currentPage + 2}`}
          style={pageStyle(moireReduction, '50%')}
          draggable={false}
        />
```

- [ ] **Step 3: TypeScript 型チェック**

Run: `npx tsc -b --noEmit 2>&1 | grep SpreadView || echo "No SpreadView errors"`
Expected: SpreadView 関連のエラーなし

- [ ] **Step 4: コミット**

```bash
git add src/components/viewer/SpreadView.tsx
git commit -m "feat: dynamic moire reduction blur via pageStyle helper"
```

---

### Task 5: ViewerTopBar にスライダー UI 追加

**Files:**
- Modify: `src/components/viewer/ViewerTopBar.tsx`

- [ ] **Step 1: ViewerTopBar の props にスライダー用の値とコールバックを追加**

`ViewerTopBarProps` interface を変更:

```typescript
interface ViewerTopBarProps {
  title: string;
  currentPage: number;
  totalPages: number;
  viewMode: 'spread' | 'single';
  onBack: () => void;
  onToggleViewMode: () => void;
  visible: boolean;
  moireReduction: number;
  onMoireChange: (value: number) => void;
  onMoireCommit: (value: number) => void;
}
```

関数シグネチャを更新:

```typescript
export default function ViewerTopBar({
  title,
  currentPage,
  totalPages,
  viewMode,
  onBack,
  onToggleViewMode,
  visible,
  moireReduction,
  onMoireChange,
  onMoireCommit,
}: ViewerTopBarProps) {
```

- [ ] **Step 2: スライダー UI を追加**

`</span>`（title 表示）と `<button>`（見開き/単ページトグル）の間にスライダーグループを追加:

```typescript
      {/* Moire reduction slider */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          モアレ軽減
        </span>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={moireReduction}
          onChange={(e) =>
            onMoireChange(parseFloat(e.target.value))
          }
          onMouseUp={(e) =>
            onMoireCommit(parseFloat((e.target as HTMLInputElement).value))
          }
          style={{
            width: 80,
            height: 4,
            cursor: 'pointer',
            accentColor: 'var(--accent)',
          }}
        />
        <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 24 }}>
          {moireReduction.toFixed(1)}
        </span>
      </div>
```

- [ ] **Step 3: コミット**

```bash
git add src/components/viewer/ViewerTopBar.tsx
git commit -m "feat: add moire reduction slider to ViewerTopBar"
```

---

### Task 6: ViewerOverlay と ViewerPage の接続

**Files:**
- Modify: `src/components/viewer/ViewerOverlay.tsx:137-145`
- Modify: `src/pages/ViewerPage.tsx:37-48, 53-61, 202-214`

- [ ] **Step 1: ViewerOverlay に moireReduction props を追加**

`src/components/viewer/ViewerOverlay.tsx` の `ViewerOverlayProps` interface に追加:

```typescript
  moireReduction: number;
  onMoireChange: (value: number) => void;
  onMoireCommit: (value: number) => void;
```

関数パラメータに追加:

```typescript
export default function ViewerOverlay({
  pages,
  currentPage,
  totalPages,
  title,
  viewMode,
  isUIVisible,
  onBack,
  onToggleViewMode,
  onPageChange,
  onNext,
  onPrev,
  moireReduction,
  onMoireChange,
  onMoireCommit,
}: ViewerOverlayProps) {
```

`<ViewerTopBar>` の props に追加:

```typescript
      <ViewerTopBar
        title={title}
        currentPage={currentPage}
        totalPages={totalPages}
        viewMode={viewMode}
        onBack={onBack}
        onToggleViewMode={onToggleViewMode}
        visible={topBarVisible}
        moireReduction={moireReduction}
        onMoireChange={onMoireChange}
        onMoireCommit={onMoireCommit}
      />
```

- [ ] **Step 2: ViewerPage で store から値を取得し渡す**

`src/pages/ViewerPage.tsx` の store selectors セクション（line 37-48 あたり）に追加:

```typescript
  const moireReduction = useViewerStore((s) => s.moireReduction);
  const setMoireReduction = useViewerStore((s) => s.setMoireReduction);
  const saveMoireReduction = useViewerStore((s) => s.saveMoireReduction);
  const loadSettings = useViewerStore((s) => s.loadSettings);
```

初期ロード useEffect（line 53-61）を更新:

```typescript
  useEffect(() => {
    loadSettings();
    if (archiveId) {
      openArchive(archiveId);
    }
    return () => {
      closeArchive();
    };
  }, [archiveId, openArchive, closeArchive, loadSettings]);
```

`<ViewerOverlay>` の props に追加（line 202-214）:

```typescript
      <ViewerOverlay
        pages={archive.pages}
        currentPage={currentPage}
        totalPages={archive.pages.length}
        title={archive.title}
        viewMode={effectiveViewMode}
        isUIVisible={isUIVisible}
        onBack={handleBack}
        onToggleViewMode={handleToggleViewMode}
        onPageChange={goToPage}
        onNext={nextPage}
        onPrev={prevPage}
        moireReduction={moireReduction}
        onMoireChange={setMoireReduction}
        onMoireCommit={saveMoireReduction}
      />
```

- [ ] **Step 3: TypeScript 型チェック**

Run: `npx tsc -b --noEmit 2>&1 | head -20`
Expected: SpreadView / ViewerTopBar / ViewerOverlay / ViewerPage 関連のエラーなし

- [ ] **Step 4: コミット**

```bash
git add src/components/viewer/ViewerOverlay.tsx src/pages/ViewerPage.tsx
git commit -m "feat: wire moire reduction slider through ViewerOverlay to ViewerPage"
```

---

### Task 7: 動作確認

- [ ] **Step 1: Tauri dev で起動**

Run: `npx tauri dev`

- [ ] **Step 2: スライダー動作確認**

1. ライブラリからスクリーントーンのあるマンガを開く
2. マウスを画面上端に移動して TopBar を表示
3. 「モアレ軽減」スライダーが表示されていることを確認
4. スライダーを左右に動かし、画像の blur が リアルタイムで変化することを確認
5. スライダーを 0 にした時、blur が完全に無効化されることを確認
6. スライダーを 2.0 にした時、十分にぼかされることを確認

- [ ] **Step 3: 永続化確認**

1. スライダーを 1.0 に設定
2. アプリを閉じる
3. `npx tauri dev` で再起動
4. マンガを開く
5. スライダーが 1.0 で表示され、blur も 1.0px が適用されていることを確認

- [ ] **Step 4: 全テスト実行**

Run: `cd src-tauri && cargo test 2>&1 | tail -10`
Expected: 全テストパス（新規テスト含む）
