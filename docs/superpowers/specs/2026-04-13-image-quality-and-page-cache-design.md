# 画像品質改善 + 遅延ページキャッシュ 設計書

## 概要

ビューアの画像表示品質を向上させ、アーカイブページ展開のパフォーマンスを改善する。

1. **画像品質**: CSS `filter: blur(0.3px)` を追加し、スクリーントーンのモアレをさらに軽減
2. **遅延キャッシュ**: 初回閲覧時にページを `archives/{archive_id}/pages/` に永続展開し、2回目以降はキャッシュから即時読み込み

## 背景

### 画像品質の問題

マンガのスクリーントーン（ハーフトーンドット）が、画像縮小時にChromium/WebView2のLanczos 3フィルタと干渉してモアレパターンを生じる。Plan A（`image-rendering: smooth`）で改善済みだが、さらなる平滑化のためPlan C（軽量blur）を適用する。

### パフォーマンスの問題

現状の `prepare_pages` は毎回アーカイブを開封し、全ページを `temp/{UUID}/` に展開する。ビューアを閉じると `cleanup_temp_pages` で全削除されるため、同じアーカイブを再度開くたびに同じ展開コストが発生する。

## 設計

### 1. 画像品質改善（Plan C）

**変更ファイル**: `src/components/viewer/SpreadView.tsx`

全4箇所の `<img>` 要素の style に追加:
```typescript
filter: 'blur(0.3px)',
```

既存の `imageRendering: 'smooth'` と併用する。

### 2. 遅延ページキャッシュ

#### ディレクトリ構成

```
archives/{archive_id}/
  ├── original_file.cbz          # 既存: インポート済みアーカイブ
  └── pages/                     # 新規: 展開済みキャッシュ
      ├── meta.json              # PageInfo メタデータ
      ├── 000_page001.png
      ├── 001_page002.png
      └── ...
```

#### meta.json 構造

```json
[
  { "index": 0, "file_name": "000_page001.png", "width": 1200, "height": 1800, "is_spread": false },
  { "index": 1, "file_name": "001_page002.png", "width": 2400, "height": 1800, "is_spread": true }
]
```

- `url` は保存しない。読み込み時にキャッシュディレクトリパス + `file_name` から動的に構築する（パス移植性を保つ）

#### meta.json の Rust 型定義

```rust
#[derive(Serialize, Deserialize)]
struct CachedPageMeta {
    index: usize,
    file_name: String,
    width: u32,
    height: u32,
    is_spread: bool,
}
```

#### キャッシュヒット時のURL構築

キャッシュヒット時は `CachedPageMeta` からフルパスを構築し、既存コードと同じ形式で `PageInfo.url` を生成する:

```rust
let pages_dir = library_path.join("archives").join(&archive_id).join("pages");
// meta.json を読み込み
let meta_path = pages_dir.join("meta.json");
let meta_json = std::fs::read_to_string(&meta_path)?;
let cached: Vec<CachedPageMeta> = serde_json::from_str(&meta_json)?;

let page_infos: Vec<PageInfo> = cached.into_iter().map(|m| {
    let url = pages_dir.join(&m.file_name)
        .to_string_lossy()
        .replace('\\', "/");
    PageInfo {
        index: m.index,
        url,
        width: m.width,
        height: m.height,
        is_spread: m.is_spread,
    }
}).collect();
```

#### prepare_pages の新フロー

```
prepare_pages(archive_id) が呼ばれる
  │
  ├── archives/{archive_id}/pages/meta.json が存在するか？
  │     │
  │     ├── YES: meta.json を読み込み・パース
  │     │     │
  │     │     ├── パース成功 → PageInfo[] を構築して返却（高速パス）
  │     │     └── パース失敗 → pages/ を削除して再展開へフォールバック
  │     │
  │     └── NO: アーカイブを開封
  │           ├── pages/ ディレクトリ作成
  │           ├── 全ページを pages/ に展開（Zip Slip保護を維持）
  │           ├── 各ページの dimensions/is_spread を取得
  │           ├── meta.json を最後に保存（アトミック性の目印）
  │           └── PageInfo[] を返却
```

#### キャッシュ検証の方針

`meta.json` は全ページ展開完了後に最後に書き込まれる。したがって `meta.json` が存在してパース可能であれば、全ページファイルは展開済みであると信頼する。個別ファイルの存在チェック（O(n)）は行わない。

万一ファイルが欠損している場合（手動削除等）は、フロントエンド側で `<img>` の読み込み失敗として検出される。

#### 同時アクセスについて

`prepare_pages` は関数冒頭で `DbState`（`Mutex<Option<Connection>>`）のロックを取得し、関数終了まで保持する。これにより、同一アーカイブへの同時呼び出しは自動的に直列化されるため、追加の排他制御は不要。

#### 変更ファイル

**Rust バックエンド:**

- `src-tauri/src/commands/viewer.rs`
  - `prepare_pages`: キャッシュ存在チェック → キャッシュヒットなら即返却 / ミスなら展開してキャッシュ保存
  - `cleanup_temp_pages`: 既存のまま残す（古い temp/ セッションの掃除用）
- `src-tauri/src/lib.rs`
  - `setup()` 内でアプリ起動時に `cleanup_temp_pages` 相当の処理を1回実行し、古い `temp/` を掃除する

**フロントエンド:**

- `src/components/viewer/SpreadView.tsx`: blur フィルタ追加
- `src/stores/viewerStore.ts`: `closeArchive` から `cleanup_temp_pages` 呼び出しを削除（キャッシュは永続のため不要）

#### セキュリティ: Zip Slip 保護

キャッシュへの展開時も既存の CR-1 Zip Slip 対策（`file_name()` 抽出 + `canonicalize` によるパストラバーサル検出）をそのまま維持する。展開先が `temp/` から `pages/` に変わるだけでロジックは同一。

#### アーカイブ削除時の挙動

`delete_archives` コマンドは `remove_dir_all(parent)` で `archives/{archive_id}/` ディレクトリを丸ごと削除する。`pages/` サブディレクトリもこの操作で自動的に削除されるため、追加の対応は不要。

#### キャッシュ無効化の前提

キャッシュの有効性は `archive_id`（UUID）とアーカイブファイルの1対1対応に依存する。UUIDはインポート時に生成され不変。同じファイルを再インポートしても新しいUUIDが割り当てられるため、キャッシュが古いデータを返すことはない。

#### エラーハンドリング

| ケース | 対応 |
|--------|------|
| `meta.json` パース失敗 | `pages/` を削除して再展開 |
| 展開中にエラー（ディスク容量不足等） | `AppError::FileIO` を返却、部分展開した `pages/` を削除 |
| アーカイブファイル自体が missing | 既存の `missing` フラグ処理に委ねる |

## スコープ外

- ページ単位の遅延展開（全ページ一括展開のみ）
- キャッシュサイズ制限や LRU 管理
- バックエンド側での画像リサイズ/前処理
