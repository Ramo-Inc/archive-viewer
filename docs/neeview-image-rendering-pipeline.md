# NeeView 画像表示パイプライン 技術調査レポート

**調査日:** 2026-04-13  
**対象:** NeeView ソースコード (`D:\Dev\App\NeeView`)  
**目的:** ComicViewer の画像表示品質を NeeView と同等にするための技術調査

---

## 目次

1. [パイプライン全体像](#1-パイプライン全体像)
2. [Stage 1: アーカイブからストリーム取得](#2-stage-1-アーカイブからストリーム取得)
3. [Stage 2: ビットマップデコード](#3-stage-2-ビットマップデコード)
4. [Stage 3: Picture モデルと ImageSource 生成](#4-stage-3-picture-モデルと-imagesource-生成)
5. [Stage 4: 表示コンポーネント](#5-stage-4-表示コンポーネント)
6. [Stage 5: スケーリングモード決定](#6-stage-5-スケーリングモード決定)
7. [Stage 6: WPF レンダリング](#7-stage-6-wpf-レンダリング)
8. [リサイズフィルター設定](#8-リサイズフィルター設定)
9. [表示サイズ計算](#9-表示サイズ計算)
10. [ComicViewer との根本的差異](#10-comicviewer-との根本的差異)
11. [ファイル一覧](#11-ファイル一覧)

---

## 1. パイプライン全体像

NeeView の画像表示は **完全にメモリ内で完結** する。ディスクへの中間ファイル書き出しは一切行わない。

```
Archive (ZIP/RAR/7z/etc.)
  |
  v
ArchiveEntry.OpenEntryAsync()
  → MemoryStream (メモリ内キャッシュ)
  |
  v
BitmapFactory.CreateBitmapSource()
  ├── [デフォルト] DefaultBitmapDecoder (WIC)
  │     DecodePixelHeight/Width でデコード時リサイズ
  │
  └── [高品質] MagicScalerBitmapDecoder (PhotoSauce)
        Lanczos 等の高品質リサンプリング
  |
  v
BitmapSource (メモリ内ピクセルバッファ, Frozen)
  |
  v
ImageContentControl
  ├── BrushImageContentControl (ImageBrush + Rectangle)
  └── CropImageContentControl (Image + CropControl)
  |
  v
ViewContentTools.SetBitmapScalingMode()
  → BitmapScalingMode.Fant (デフォルト)
  |
  v
WPF GPU コンポジション → 画面表示
```

**重要:** ファイル I/O はゼロ。全ての中間データは `MemoryStream` と `BitmapSource` としてメモリ上に存在する。

---

## 2. Stage 1: アーカイブからストリーム取得

### 2.1 ArchiveEntry

**ファイル:** `NeeView\Archiver\ArchiveEntry.cs`

アーカイブ内の個別エントリ（画像ファイル）を表す。

```csharp
// 主要プロパティ
Archive Archive       // 親アーカイブ
string EntryName      // アーカイブ内パス
long Length           // ファイルサイズ (-1 = ディレクトリ)
object? Data          // キャッシュ済みデータ (byte[] or ファイル名 string)
bool HasCache         // Data が設定済みか
```

**ストリーム取得フロー** (`OpenEntryAsync`, line 319):

```
1. Data が byte[] の場合
   → new MemoryStream(rawData, offset, count, writable:false, publiclyVisible:true)
   
2. Data が string (ファイル名) の場合
   → new FileStream(fileName, FileMode.Open, FileAccess.Read)

3. それ以外
   → OpenStreamInnerAsync() (アーカイブ固有の解凍処理)
```

### 2.2 ArchiveEntryStreamSource

**ファイル:** `NeeView\Page\ArchiveEntryStreamSource.cs`

ArchiveEntry をラップし、オプションのメモリキャッシュ付きストリームを提供する。

```csharp
class ArchiveEntryStreamSource : IStreamSource
```

**OpenStreamAsync()** (line 32-44):

```
1. CreateCacheAsync() を呼んでキャッシュ構築
2. キャッシュがあれば → MemoryStream(キャッシュバッファ) を返す
3. なければ → ArchiveEntry.OpenEntryAsync() で直接ストリーム取得
```

**CreateCacheAsync()** (line 46-69) のキャッシュ判定:

```
IF _cache が既にある         → return (二重抽出回避)
IF ArchiveEntry.HasCache     → return (ArchiveEntry.Data で既にキャッシュ済み)
IF ArchiveEntry.IsFileSystem → return (ディスクから直接読めるのでキャッシュ不要)

OTHERWISE:
  1. ArchiveEntry.OpenEntryAsync() でストリーム取得
  2. MemoryStream なら TryGetBuffer() でバッファ取得
  3. バッファ取得不可なら stream.ToArray() でコピー
  4. _cache に ArraySegment<byte> として保存
```

**ポイント:** アーカイブエントリのバイト列はメモリに展開されるが、ディスクには書き出されない。

---

## 3. Stage 2: ビットマップデコード

### 3.1 ルーティング: BitmapFactory

**ファイル:** `NeeView\Bitmap\BitmapFactory.cs`

**CreateBitmapSource()** (line 30-67) のルーティング:

```
IF (サイズ指定あり) AND (BitmapCreateMode.HighQuality):
  → MagicScalerBitmapDecoder を試行
  → 失敗したら TIFF に変換して再試行
  → それも失敗したら DefaultBitmapFactory にフォールバック

ELSE:
  → DefaultBitmapFactory (WIC のみ)
```

### 3.2 デフォルトパス: DefaultBitmapDecoder (WIC)

**ファイル:** `NeeView\Bitmap\DefaultBitmapDecoder.cs`

**Create()** (line 21-45):

```csharp
// WIC デコード時リサイズのフロー
1. stream.Seek(0, SeekOrigin.Begin)
2. var bitmap = new BitmapImage()
3. bitmap.BeginInit()
4. bitmap.StreamSource = stream              // メモリストリーム参照
5. bitmap.CreateOptions = BitmapCreateOptions.None

// ===== デコード時リサイズ =====
6. IF size が指定されている:
     bitmap.DecodePixelHeight = (int)size.Height
     bitmap.DecodePixelWidth  = (int)size.Width
     // 転置処理: 90/270度回転の場合は幅と高さを入れ替え
     IF info.IsTranspose:
       swap(DecodePixelWidth, DecodePixelHeight)

// ===== EXIF 向き処理 =====
7. IF info.Rotation != Rotation.Rotate0:
     bitmap.Rotation = info.Rotation
8. IF info.IsMirrorHorizontal:
     bitmap.DecodePixelWidth *= -1     // 負値 = 水平ミラー
9. IF info.IsMirrorVertical:
     bitmap.DecodePixelHeight *= -1    // 負値 = 垂直ミラー

10. bitmap.EndInit()       // ← ここで WIC デコード実行
11. bitmap.Freeze()        // 不変化（GPU 最適化のため）
12. return bitmap
```

**WIC の DecodePixelHeight/Width について:**

- WIC (Windows Imaging Component) がデコード時にリサイズを行う
- JPEG の場合: MCU (Minimum Coding Unit, 通常 8x8) ブロック単位でスケーリング
- ネイティブスケール比: 1/1, 1/2, 1/4, 1/8
- 指定サイズに最も近い比率が自動選択される
- アルゴリズム: バイリニア補間ベース
- **メモリ効率:** フル解像度をデコードしてからリサイズするのではなく、デコード中にリサイズする

**エラーハンドリング:**

```
- OutOfMemoryException → 再スロー
- OperationCanceledException → 再スロー
- その他 → IgnoreColorProfile フラグで再試行 (line 43)
```

### 3.3 高品質パス: MagicScalerBitmapDecoder (PhotoSauce)

**ファイル:** `NeeView\Bitmap\MagicScalerBitmapDecoder.cs`

**Create()** (line 52-73):

```csharp
// MagicScaler (PhotoSauce ライブラリ) によるリサイズ
1. ProcessImageSettings 作成:
   - Width/Height = 指定サイズ
   - CropScaleMode = 幅 or 高さが 0 なら Crop, それ以外は Stretch
   - Anchor = Left | Top

2. MagicImageProcessor.ProcessImage(stream, outStream, settings)
   - ソースデコード（WIC コーデック使用）
   - 指定アルゴリズムでリサンプリング
   - アンシャープマスク適用（有効時）
   - BMP としてメモリストリームに出力

3. outStream から BitmapImage 生成:
   - CacheOption = BitmapCacheOption.OnLoad
   - EndInit() でメモリストリームからロード
   - Freeze()
```

**利用可能な補間アルゴリズム:**

| アルゴリズム | 特性 |
|---|---|
| NearestNeighbor | ピクセル完全保持、最速 |
| Average | 単純平均 |
| Linear | 線形補間 |
| Quadratic | 2次補間 |
| Hermite | Hermite スプライン |
| Mitchell | Mitchell-Netravali |
| CatmullRom | Catmull-Rom スプライン |
| Cubic | 3次補間 |
| CubicSmoother | 滑らかな3次 |
| **Lanczos** | **デフォルト。高品質ダウンサンプリング** |
| Spline36 | Spline36 フィルタ |

### 3.4 TIFF フォールバック

**ファイル:** `NeeView\Bitmap\BitmapFactory.cs` (line 152-165)

MagicScaler が対応しないフォーマットの場合:

```
1. DefaultBitmapFactory でフル解像度デコード → BitmapImage
2. TiffBitmapEncoder で非圧縮 TIFF に変換 → MemoryStream
3. MagicScaler で TIFF を処理（TIFF は常にサポート）
```

全てメモリ内で完結。

### 3.5 BitmapInfo (メタデータ)

**ファイル:** `NeeView\Bitmap\BitmapInfo.cs`

```csharp
// 画像の前処理に必要なメタデータ
int PixelWidth, PixelHeight        // 実際のピクセルサイズ
PixelFormat PixelFormat            // ARGB32, RGB24 等
double DpiX, DpiY                  // DPI (デフォルト 96.0)
Rotation Rotation                  // EXIF 回転
bool IsMirrorHorizontal/Vertical   // EXIF ミラー
bool IsTranspose                   // 90/270度回転か
bool? HasAlpha                     // アルファチャンネル有無
```

**EXIF Orientation マッピング** (line 84-118):

| EXIF 値 | Rotation | Mirror |
|---|---|---|
| 1 (Normal) | 0 | なし |
| 2 | 0 | 水平 |
| 3 | 180 | なし |
| 4 | 0 | 垂直 |
| 5 | 270 | 水平 |
| 6 | 90 | なし |
| 7 | 90 | 水平 |
| 8 | 270 | なし |

---

## 4. Stage 3: Picture モデルと ImageSource 生成

### 4.1 Picture クラス

**ファイル:** `NeeView\Picture\Picture.cs`

画像のデコード結果をキャッシュし、サイズ変更時の再デコードを管理する。

**CreateImageSourceAsync()** (line 121-155):

```
1. CreateSizeSource(size) でサイズパラメータのハッシュ生成
   ハッシュ: 対象サイズ + フィルター設定 + カスタムサイズ設定

2. キャッシュチェック:
   IF (ImageSource != null) AND (サイズパラメータ一致):
     → false を返す（再デコード不要）

3. BitmapCreateSetting 構成:
   IF size.IsEmpty:
     → デフォルト設定（リサイズなし）
   IF Config.Current.ImageResizeFilter.IsEnabled:
     → Mode = HighQuality (MagicScaler 使用)
     → ProcessImageSettings = 設定値から生成

4. _pictureSource.CreateImageSourceAsync() 呼び出し
   → BitmapSource が返る

5. lock(_lock) でスレッドセーフに更新:
   _sizeSource = 計算したサイズソース
   ImageSource = 返された BitmapSource

6. return true（画像が更新された）
```

**メモリサイズ計算** (line 60-72):

```csharp
// BitmapSource の場合:
(long)PixelFormat.BitsPerPixel * Width * Height / 8

// 例: 1920x1080 ARGB32
// = 32 * 1920 * 1080 / 8 = 8,294,400 bytes ≒ 7.9MB
```

### 4.2 BitmapPictureSource

**ファイル:** `NeeView\PictureSource\BitmapPictureSource.cs`

**CreateImageSourceAsync()** (line 42-61):

```
1. streamSource.OpenStreamAsync()
   → ArchiveEntryStreamSource からストリーム取得

2. アスペクト比処理:
   IF IsKeepAspectRatio AND サイズ指定あり:
     width = size.Width, height = 0 (高さは自動計算)

3. _bitmapFactory.CreateBitmapSource(stream, info, size, setting)
   → MagicScaler または DefaultBitmapFactory に委譲
   → BitmapSource (ピクセルバッファ) 返却

4. PictureInfo.SetPixelInfo(bitmapSource):
   - ドミナントカラー抽出
   - BitsPerPixel 更新

5. return bitmapSource
```

### 4.3 データフロー要約

```
IStreamSource.OpenStreamAsync()        // メモリストリーム取得
  ↓
BitmapFactory.CreateBitmapSource()     // デコード + リサイズ
  ↓
BitmapSource (ピクセルバッファ)         // メモリ内、Frozen
  ↓
Picture.ImageSource に保存              // キャッシュ
```

---

## 5. Stage 4: 表示コンポーネント

### 5.1 ImageContentControl (抽象基底)

**ファイル:** `NeeView\ViewContents\ImageContentControl.cs`

```csharp
abstract class ImageContentControl : ContentControl, IDisposable, IHasImageSource
```

**コンストラクタ** (line 25-67):

```
1. Grid 作成

2. 背景処理:
   IF 画像にアルファチャンネルあり:
     → 背景色付き Rectangle 追加（透過部分の表示用）

3. CreateTarget(imageSource, viewbox) でターゲット要素作成
   → BrushImageContentControl: ImageBrush + Rectangle
   → CropImageContentControl: Image + CropControl

4. UpdateBitmapScalingMode()
   → ViewContentTools.SetBitmapScalingMode() 呼び出し

5. this.Content = grid
6. contentSize.SizeChanged イベント購読
   → サイズ変更時に BitmapScalingMode を再評価
```

### 5.2 BrushImageContentControl

**ファイル:** `NeeView\ViewContents\BrushImageContentControl.cs`

**CreateTarget()** (line 17-25):

```csharp
// ImageBrush パターン — NeeView のメイン表示方式

1. Rectangle element 作成
2. ImageBrush 作成:
   brush.ImageSource = bitmapSource    // デコード済み BitmapSource
   brush.AlignmentX = AlignmentX.Left
   brush.AlignmentY = AlignmentY.Top
   brush.Stretch = Stretch.Fill        // 表示領域全体に引き伸ばし
   brush.Viewbox = viewbox             // トリミング範囲 [0.0, 1.0]
   brush.ViewboxUnits = RelativeToBoundingBox
3. rectangle.Fill = brush
4. brush.Freeze()                      // GPU 最適化
```

**Viewbox について:**

- `Rect(0, 0, 1, 1)` = 画像全体を表示
- `Rect(0.5, 0, 0.5, 1)` = 右半分のみ表示（見開きの片ページ）
- Viewbox の設定は `PageViewSizeCalculator.GetViewBox()` で計算

### 5.3 CropImageContentControl

**ファイル:** `NeeView\ViewContents\CropImageContentControl.cs`

```csharp
// Image コントロール + CropControl パターン
// アニメーション GIF など ImageBrush が使えない場合に使用

1. Image element 作成
2. image.Source = bitmapSource
3. CropControl 作成 (Target = image, Viewbox = viewbox)
```

### 5.4 表示コンポーネント選択

**ファイル:** `NeeView\ViewContents\ImageViewContentStrategy.cs`

**CreateLoadedContent()** (line 71-95):

```
IF ImageSource is DrawingImage:
  → CropImageContentControl を使用
ELSE:
  → BrushImageContentControl を使用（通常のビットマップ画像）
```

---

## 6. Stage 5: スケーリングモード決定

### 6.1 SetBitmapScalingMode

**ファイル:** `NeeView\ViewContents\ViewContentTools.cs` (line 72-104)

これが NeeView の画質を決定する最重要ロジック。

```csharp
public static void SetBitmapScalingMode(
    UIElement element,
    Size imageSize,          // 画像のピクセルサイズ
    ViewContentSize contentSize,  // 表示領域サイズ
    BitmapScalingMode? scalingMode  // 明示的なオーバーライド
)
```

**決定ロジック:**

```
優先度 1: 明示的オーバーライド
  IF scalingMode != null:
    → 指定されたモードを使用
    → SnapsToDevicePixels = (mode == NearestNeighbor)

優先度 2: ピクセル完全一致 (ドット・バイ・ドット)
  IF contentSize.IsRightAngle (回転が直角)
  AND SizeEquals(contentSize.PixelSize, pixelSize, 誤差1.1px):
    → BitmapScalingMode.NearestNeighbor
    → SnapsToDevicePixels = true
    理由: 画像ピクセルと画面ピクセルが完全一致。補間不要。

優先度 3: DotKeep モード
  IF Config.Current.ImageDotKeep.IsImageDotKeep(contentSize, pixelSize):
    → BitmapScalingMode.NearestNeighbor
    → SnapsToDevicePixels = true
    理由: ピクセルグリッドを保持（レトロ画像等）

優先度 4: デフォルト（高品質スケーリング）
  OTHERWISE:
    → BitmapScalingMode.Fant           ← ★ これがデフォルト
    → SnapsToDevicePixels = false
    理由: WPF のアンチエイリアシング＆フィルタリングを適用
```

### 6.2 BitmapScalingMode 一覧

| モード | 特性 | 用途 |
|---|---|---|
| **Fant** | **エリア平均法。高品質。NeeView デフォルト** | **通常表示** |
| NearestNeighbor | ピクセル完全保持。ジャギーあり | 1:1 表示、DotKeep |
| Linear | バイリニア。やや甘い | 未使用 |
| HighQuality | Fant と同等 | 明示的に高品質指定時 |
| LowQuality | 最速、低品質 | 未使用 |

### 6.3 Fant フィルター (エリア平均法) とは

WPF の `BitmapScalingMode.Fant` は **エリア平均法** (Area Averaging / Box Filter) を実装している。

**アルゴリズム:**

```
出力ピクセル値 = ソース画像の対応領域に含まれる
                 全ピクセルの面積加重平均

例: 2x2 → 1x1 の場合
output = (pixel[0,0] + pixel[0,1] + pixel[1,0] + pixel[1,1]) / 4
```

**特性:**

- **スクリーントーンに最適:** 規則的なドットパターンが自然なグレーに溶ける
- **高周波パターンの抑制:** エイリアシングやモアレが発生しにくい
- **Lanczos との違い:** Lanczos は高周波を保持しようとするためトーンのドットが残る

### 6.4 ピクセルサイズ計算

**GetRenderPixelSize()** (line 107-122):

```csharp
// Viewbox を考慮した実効ピクセルサイズ
Rect viewbox = BrushImageContentTools.GetViewBox(element);
if (viewbox.IsEmpty)
    return imageSize;                    // トリミングなし→画像全体
else
    return new Size(
        viewbox.Width * imageSize.Width,   // トリミング後の幅
        viewbox.Height * imageSize.Height  // トリミング後の高さ
    );
```

---

## 7. Stage 6: WPF レンダリング

### 7.1 レンダリングパイプライン

WPF のレンダリングエンジンが行う処理:

```
1. BitmapSource (メモリ内ピクセルバッファ)
   ↓
2. ImageBrush が Rectangle の Fill として適用
   - Viewbox でトリミング範囲指定
   - Stretch.Fill で表示領域に引き伸ばし
   ↓
3. RenderTransform 適用
   - 回転、スケーリング、移動
   - ルーペ拡大
   ↓
4. BitmapScalingMode に基づくリサンプリング
   - Fant: エリア平均法でスムーズにスケーリング
   - NearestNeighbor: ピクセル完全保持
   ↓
5. DPI スケーリング
   - 論理ピクセル → 物理ピクセル変換
   - 96 DPI 基準 → 実画面 DPI
   ↓
6. GPU コンポジション
   - DirectX 経由で GPU レンダリング
   - 画面バッファに書き出し
```

### 7.2 NeeView が Fant を選ぶ理由

NeeView のデフォルト設定では:

1. **ImageResizeFilter.IsEnabled = false** (MagicScaler OFF)
2. つまりデコード時のリサイズは WIC の DecodePixelHeight のみ
3. 表示時のスケーリングは **BitmapScalingMode.Fant** が適用される
4. Fant はエリア平均法なのでスクリーントーンが自然に溶ける

**NeeView のスクリーントーン表示が自然な理由は、Fant フィルターのエリア平均法が高周波ドットパターンを効果的に平均化するため。**

---

## 8. リサイズフィルター設定

### 8.1 ImageResizeFilterConfig

**ファイル:** `NeeView\Config\ImageResizeFilterConfig.cs`

```csharp
// ★ デフォルト設定
bool IsEnabled = false                          // MagicScaler 無効
ResizeInterpolation ResizeInterpolation = Lanczos  // 有効時のアルゴリズム
bool IsUnsharpMaskEnabled = false               // シャープネスなし
```

**デフォルトでは MagicScaler は OFF。** WIC のデコード時リサイズ + WPF Fant のみ。

### 8.2 設定の影響範囲

```
IsEnabled = false の場合 (デフォルト):
  → BitmapFactory は DefaultBitmapFactory を使用
  → WIC DecodePixelHeight でデコード時リサイズ
  → 表示時に BitmapScalingMode.Fant でスケーリング

IsEnabled = true の場合:
  → BitmapFactory は MagicScalerBitmapDecoder を使用
  → PhotoSauce ライブラリで高品質リサンプリング
  → 表示時に BitmapScalingMode.Fant でスケーリング
  → ただし画像サイズが完全一致すれば NearestNeighbor (1:1)
```

---

## 9. 表示サイズ計算

### 9.1 ViewContentSize

**ファイル:** `NeeView\ViewContents\ViewContentSize.cs`

表示領域のピクセルサイズを多段階で計算する。

```csharp
Size SourceSize       // 元画像サイズ
Size LayoutSize       // LayoutTransform 適用後
Size RenderingSize    // RenderTransform 適用後
Size PixelSize        // DPI スケーリング適用後 (最終物理ピクセル)
bool IsRightAngle     // 回転角が 0/90/180/270 度か
```

**計算フロー** (line 92-100):

```
LayoutSize = element.Width × LayoutScale
           × element.Height × LayoutScale

RenderingSize = |LayoutWidth × RenderScale|
              × |LayoutHeight × RenderScale|

PixelSize = RenderingSize.Width × BaseScale × DpiScale.DpiScaleX
          × RenderingSize.Height × BaseScale × DpiScale.DpiScaleY
```

**DPI の扱い:** WPF は 96 DPI を基準とし、`DpiScale` で実画面 DPI に変換する。例: 144 DPI の画面では `DpiScaleX = 1.5`。

### 9.2 PageViewSizeCalculator

**ファイル:** `NeeView\PageFrames\PageViewSizeCalculator.cs`

表示サイズと画像ソースサイズの相互変換を行う。

**GetSourceSize(Size viewSize)** (line 86-113):

```
表示サイズ → 必要な画像ソースサイズ を逆算

1. ページ分割の逆算:
   IF 片ページ表示 (PartSize == 1):
     width = width / partRate    // 半分表示なら元画像は倍幅

2. トリミングの逆算:
   IF トリミング有効:
     wRate = 1.0 - (左トリム + 右トリム)
     hRate = 1.0 - (上トリム + 下トリム)
     width = width / wRate
     height = height / hRate

結果: ロードすべき画像のピクセルサイズ
```

**GetViewBox()** (line 115-136):

```
ImageBrush 用の正規化クリップ矩形 [0.0, 1.0] を計算

1. 初期値: Rect(0, 0, 1.0, 1.0) (画像全体)

2. トリミング適用:
   crop.X += Left
   crop.Width -= (Left + Right)
   crop.Y += Top
   crop.Height -= (Top + Bottom)

3. ページ分割適用:
   IF 片ページ (PartSize == 1):
     half = rect.Width × partRate
     左ページなら rect.X から
     右ページなら rect.X + rect.Width - half から

4. ポリゴン端補正: Offset(-0.00001, -0.00001)
   テクスチャブリーディング防止
```

---

## 10. ComicViewer との根本的差異

### 10.1 パイプライン比較

| 段階 | NeeView | ComicViewer |
|---|---|---|
| 抽出 | メモリストリーム | メモリ (同じ) |
| デコード | WIC (メモリ内) | image crate (メモリ内) |
| リサイズ | WIC DecodePixelHeight or なし | fast_image_resize Box |
| 中間保存 | **なし (メモリのみ)** | **PNG ファイルをディスクに書き出し** |
| 表示制御 | ImageBrush + Rectangle | `<img>` タグ |
| スケーリング | **BitmapScalingMode.Fant (明示指定)** | **Chromium 内部アルゴリズム (制御不可)** |
| GPU 処理 | WPF/DirectX | Chromium/Skia |

### 10.2 根本的な問題点

**問題 1: ファイル出力**

NeeView はメモリ内で完結する。ComicViewer は PNG をディスクに書き出し、ブラウザに asset:// URL で読ませている。設計が根本的に異なる。

**問題 2: 二重スケーリング**

```
ComicViewer の実際のフロー:

1回目: Box フィルターで targetHeight にリサイズ
  targetHeight = window.innerHeight × devicePixelRatio
  例: 1080 × 1.5 = 1620px

2回目: Chromium が <img> を CSS コンテナに合わせてリサイズ
  CSS: maxHeight: '100%', objectFit: 'contain'
  実際の表示領域 = window.innerHeight - TopBar - Slider
  例: 1030 CSS px = 1545 物理 px

  Chromium は 1620px → 1545px にスケーリング
  → このスケーリングに Lanczos3 系アルゴリズムが使われる
```

2回目のスケーリングが Lanczos3 系であるため、Box フィルターで平均化したトーンパターンに再びリンギングが発生する。

**問題 3: スケーリングアルゴリズムの制御不能**

```
NeeView:
  RenderOptions.SetBitmapScalingMode(element, BitmapScalingMode.Fant)
  → WPF は指定されたアルゴリズムを使用

Chromium:
  CSS image-rendering プロパティ:
    auto       → Lanczos3 系 (変更不可)
    pixelated  → NearestNeighbor (粗すぎる)
    ※ Fant / エリア平均法に相当するオプションが存在しない
```

### 10.3 NeeView と同等にするための条件

Chromium の制約下で NeeView と同等の表示品質を得るには:

1. **ブラウザスケーリングの完全排除**
   - 画像を表示ピクセルサイズと完全に一致させる
   - ブラウザに 1:1 ピクセルマッピングで表示させる
   - CSS による追加スケーリングを防ぐ

2. **正確な表示サイズの計算**
   - ビューアコンテナの実際の物理ピクセルサイズを取得
   - TopBar、スライダー等の UI 要素を差し引く
   - devicePixelRatio を考慮

3. **または Canvas 2D による描画**
   - `<img>` ではなく `<canvas>` で描画
   - Canvas の drawImage はスケーリングアルゴリズムを `imageSmoothingQuality` で制御可能
   - ただし `high` でも Lanczos 系であり Fant とは異なる

---

## 11. ファイル一覧

### アーカイブ & ストリーム

| ファイル | 主要クラス/メソッド |
|---|---|
| `NeeView\Archiver\ArchiveEntry.cs` | `OpenEntryAsync()` (line 319) |
| `NeeView\Page\ArchiveEntryStreamSource.cs` | `CreateCacheAsync()` (line 46) |
| `NeeView\Page\IStreamSource.cs` | `IStreamSource` インターフェース |

### ビットマップデコード

| ファイル | 主要クラス/メソッド |
|---|---|
| `NeeView\Bitmap\DefaultBitmapDecoder.cs` | `Create()` (line 21) |
| `NeeView\Bitmap\MagicScalerBitmapDecoder.cs` | `Create()` (line 52) |
| `NeeView\Bitmap\BitmapFactory.cs` | `CreateBitmapSource()` (line 30) |
| `NeeView\Bitmap\DefaultBitmapFactory.cs` | WIC フォールバック |
| `NeeView\Bitmap\BitmapInfo.cs` | `Create()` (line 203) |
| `NeeView\Bitmap\BitmapCreateSetting.cs` | `BitmapCreateMode` |

### Picture モデル

| ファイル | 主要クラス/メソッド |
|---|---|
| `NeeView\Picture\Picture.cs` | `CreateImageSourceAsync()` (line 121) |
| `NeeView\PictureSource\BitmapPictureSource.cs` | `CreateImageSourceAsync()` (line 42) |
| `NeeView\PictureSource\PictureSourceFactory.cs` | ソース種別ルーティング |

### 設定

| ファイル | 主要クラス/メソッド |
|---|---|
| `NeeView\Config\ImageResizeFilterConfig.cs` | `IsEnabled` (line 15), `CreateProcessImageSetting()` (line 80) |

### 表示コンポーネント

| ファイル | 主要クラス/メソッド |
|---|---|
| `NeeView\ViewContents\ImageContentControl.cs` | コンストラクタ (line 25) |
| `NeeView\ViewContents\BrushImageContentControl.cs` | `CreateTarget()` (line 17) |
| `NeeView\ViewContents\CropImageContentControl.cs` | `CreateTarget()` (line 15) |
| `NeeView\ViewContents\ViewContentTools.cs` | `SetBitmapScalingMode()` (line 72) |
| `NeeView\ViewContents\ViewContentSize.cs` | `PixelSize` 計算 (line 92) |
| `NeeView\ViewContents\ViewContent.cs` | `Initialize()` (line 111) |
| `NeeView\ViewContents\ImageViewContentStrategy.cs` | `CreateLoadedContent()` (line 71) |

### ページフレーム

| ファイル | 主要クラス/メソッド |
|---|---|
| `NeeView\PageFrames\PageFrameElement.cs` | `ViewSizeCalculator` (line 94) |
| `NeeView\PageFrames\PageFrameContent.cs` | `CreateContents()` |
| `NeeView\PageFrames\PageViewSizeCalculator.cs` | `GetSourceSize()` (line 86), `GetViewBox()` (line 115) |

### データソース

| ファイル | 主要クラス/メソッド |
|---|---|
| `NeeView\Page\PageDataSource.cs` | データコンテナ |
| `NeeView\Page\BitmapPageData.cs` | `IStreamSource` 保持 |
