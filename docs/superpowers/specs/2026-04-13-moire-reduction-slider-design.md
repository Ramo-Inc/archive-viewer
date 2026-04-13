# モアレ軽減強度スライダー 設計書

## 概要

ビューアの ViewerTopBar にモアレ軽減の強度スライダーを追加し、ユーザーが CSS `filter: blur()` の強度を 0〜2px の範囲で調整できるようにする。設定値は `AppConfig`（config.json）に永続保存する。

## 背景

`image-rendering: smooth` + `filter: blur(0.3px)` でモアレは軽減されたが、画像やズーム比率によっては不十分。Chromium は既に Lanczos3 で縮小しており、これ以上のアルゴリズム改善は Web ベースでは困難。Panels（iOS漫画リーダー）の「Reduce Moiré」フィルタと同じアプローチで、ユーザーが強度を調整できるようにする。

## 設計

### データフロー

**スライダー操作時:**
```
ユーザーがスライダー操作
  → viewerStore.setMoireReduction(value)
  → SpreadView の filter: blur({value}px) がリアルタイム反映
  → スライダー確定時に tauriInvoke('save_viewer_settings', { settings: { moire_reduction: value } })
  → AppConfig.viewer_settings.moire_reduction を更新して config.json に保存
```

**設定読み込み（ViewerPage マウント時）:**
```
ViewerPage の useEffect で viewerStore.loadSettings() を呼び出し
  → tauriInvoke('get_viewer_settings') で config.json から ViewerSettings を取得
  → moireReduction に反映
```

### Rust バックエンド

#### config.rs の変更

`ViewerSettings` 構造体を追加し、`AppConfig` に `viewer_settings` フィールドを追加:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewerSettings {
    pub moire_reduction: f32, // 0.0 ~ 2.0 (CSS blur px)
}

impl Default for ViewerSettings {
    fn default() -> Self {
        Self {
            moire_reduction: 0.5,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub library_path: Option<String>,
    #[serde(default)]
    pub window_state: WindowState,
    #[serde(default)]
    pub viewer_settings: ViewerSettings,
}
```

`AppConfig::Default` impl にも `viewer_settings: ViewerSettings::default()` を追加する。

`#[serde(default)]` により、既存の config.json に `viewer_settings` が無くてもデフォルト値で読み込まれる（後方互換性）。

**既存テストへの影響:** `test_save_and_load_config` と `test_config_serialization_roundtrip` は struct literal に `viewer_settings` フィールドを追加する必要がある（`viewer_settings: ViewerSettings::default()` を追加するか `..Default::default()` を使用）。

#### 新規 Tauri コマンド

`commands/viewer.rs` に追加:

```rust
#[tauri::command]
pub fn get_viewer_settings() -> Result<ViewerSettings, AppError> {
    let config = config::load_config()?;
    Ok(config.viewer_settings)
}

#[tauri::command]
pub fn save_viewer_settings(settings: ViewerSettings) -> Result<(), AppError> {
    let mut validated = settings;
    validated.moire_reduction = validated.moire_reduction.clamp(0.0, 2.0);
    let mut config = config::load_config()?;
    config.viewer_settings = validated;
    config::save_config(&config)
}
```

`save_viewer_settings` は入力値を `clamp(0.0, 2.0)` でバリデーションする。

`config.rs` の `ViewerSettings` を `commands/viewer.rs` から参照するため、`pub` で公開する（`config.rs` に定義するのでモジュール間のアクセスは問題なし）。

#### lib.rs のコマンド登録

`invoke_handler` の `// viewer commands` セクションに追加:
```rust
commands::viewer::get_viewer_settings,
commands::viewer::save_viewer_settings,
```

### フロントエンド

#### Tauri invoke の呼び出し規約

Tauri 2 のコマンド引数規約:
- トップレベルの引数名は Tauri が camelCase → snake_case に自動変換する
- struct 内部のフィールド名は serde がそのまま使う（自動変換なし）

したがって:
```typescript
// 保存時: settings はトップレベル引数名（自動変換される）、moire_reduction は struct フィールド（そのまま）
tauriInvoke('save_viewer_settings', { settings: { moire_reduction: value } })

// 取得時: 戻り値の struct フィールドも snake_case
const settings = await tauriInvoke<ViewerSettings>('get_viewer_settings')
// settings.moire_reduction で値を取得
```

#### viewerStore.ts の変更

- state に `moireReduction: number` を追加（デフォルト: `0.5`）
- `setMoireReduction(value: number)` アクション: store 更新のみ（リアルタイム反映用）
- `loadSettings()` アクション: `get_viewer_settings` を呼んで `moireReduction` を設定。失敗時はデフォルト値を使用
- `saveMoireReduction(value: number)` アクション: `save_viewer_settings` を呼んで永続化

#### SpreadView.tsx の変更

- `moireReduction` を viewerStore から直接取得（`useViewerStore(s => s.moireReduction)`）
- 共通スタイルヘルパー関数で 4箇所の重複を解消:

```typescript
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

- `moireReduction === 0` の場合は `filter` プロパティ自体を除外する（`blur(0px)` ではなく）。`blur(0px)` でも Chromium は GPU 合成レイヤーを作成するため、無効時は完全に除外する
- `imageRendering: 'smooth'` は `moireReduction` の値に関わらず常に維持する

#### ViewerTopBar.tsx の変更

見開き/単ページボタンの左にスライダーを追加:

```
[← 戻る] [タイトル...] [モアレ軽減: ====○====] [単ページ] [3 / 200]
```

- `<input type="range">` で実装
- `min="0"` `max="2"` `step="0.1"`
- `onInput` でリアルタイム反映（store の `setMoireReduction`）
- `onChange`（マウスアップ時）で永続保存（`saveMoireReduction`）

**ダークテーマ用スライダースタイル:**
WebView2 は Chromium ベースなので WebKit 疑似要素で対応:
- `::-webkit-slider-runnable-track` — トラック色（`var(--bg-card)`）、高さ 4px、角丸
- `::-webkit-slider-thumb` — つまみ色（`var(--accent-primary)`）、サイズ 14px

これらのスタイルは `global.css` に追加するか、ViewerTopBar 内でインラインスタイルで対応する。

#### types/index.ts の変更

```typescript
export interface ViewerSettings {
  moire_reduction: number;
}
```

### デフォルト値

`moire_reduction` のデフォルト: **0.5**（ユーザーが 0.3px では不十分と報告したため、より強い値をデフォルトとする）

### エラーハンドリング

| ケース | 対応 |
|--------|------|
| config.json に `viewer_settings` がない | `#[serde(default)]` でデフォルト値が使われる |
| `get_viewer_settings` が失敗 | フロントエンドでデフォルト値 0.5 を使用 |
| `save_viewer_settings` が失敗 | エラーは無視（設定保存失敗は致命的ではない） |
| `moire_reduction` が範囲外 | サーバー側で `clamp(0.0, 2.0)` |

### 変更ファイル一覧

| ファイル | 操作 | 内容 |
|---------|------|------|
| `src-tauri/src/config.rs` | 修正 | `ViewerSettings` 追加、`AppConfig` に `viewer_settings` フィールド追加、`Default` impl 更新、既存テスト更新 |
| `src-tauri/src/commands/viewer.rs` | 修正 | `get_viewer_settings`, `save_viewer_settings` コマンド追加 |
| `src-tauri/src/lib.rs` | 修正 | 新コマンドを `invoke_handler` に登録 |
| `src/stores/viewerStore.ts` | 修正 | `moireReduction` state + `setMoireReduction` + `loadSettings` + `saveMoireReduction` |
| `src/components/viewer/SpreadView.tsx` | 修正 | `pageStyle` ヘルパーで blur 値を動的化、store から `moireReduction` 取得 |
| `src/components/viewer/ViewerTopBar.tsx` | 修正 | スライダー UI 追加（ダークテーマ対応） |
| `src/pages/ViewerPage.tsx` | 修正 | `useEffect` で `loadSettings()` を呼び出し |
| `src/types/index.ts` | 修正 | `ViewerSettings` 型追加 |

## スコープ外

- 既存の viewMode / pageOrder / coverAlone の永続化（将来対応）
- モアレ軽減以外の画像フィルタ（シャープネス等）
- アーカイブ個別のフィルタ設定
