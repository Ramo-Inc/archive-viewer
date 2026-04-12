use crate::error::AppError;
use image::ImageReader;
use std::io::Cursor;
use std::path::Path;

/// サムネイルを生成して指定パスに保存
/// JPEG 300px幅 品質85%
pub fn generate_thumbnail(image_data: &[u8], output_path: &Path) -> Result<(), AppError> {
    let img = ImageReader::new(Cursor::new(image_data))
        .with_guessed_format()
        .map_err(|e| AppError::FileIO(format!("画像フォーマット判定失敗: {}", e)))?
        .decode()
        .map_err(|e| AppError::FileIO(format!("画像デコード失敗: {}", e)))?;

    // 300px幅にリサイズ (アスペクト比維持)
    let thumbnail = img.thumbnail(300, u32::MAX);

    // 出力ディレクトリを作成
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // JPEG品質85%で保存
    let mut output_file = std::fs::File::create(output_path)?;
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output_file, 85);
    thumbnail
        .write_with_encoder(encoder)
        .map_err(|e| AppError::FileIO(format!("サムネイル書き込み失敗: {}", e)))?;

    Ok(())
}

/// 画像データからサイズを取得
pub fn get_image_dimensions(image_data: &[u8]) -> Result<(u32, u32), AppError> {
    let img = ImageReader::new(Cursor::new(image_data))
        .with_guessed_format()
        .map_err(|e| AppError::FileIO(format!("画像フォーマット判定失敗: {}", e)))?
        .decode()
        .map_err(|e| AppError::FileIO(format!("画像デコード失敗: {}", e)))?;

    Ok((img.width(), img.height()))
}

/// 見開きページ判定 (横 > 縦 * 1.2)
pub fn is_spread_page(width: u32, height: u32) -> bool {
    width as f64 > height as f64 * 1.2
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_png(width: u32, height: u32) -> Vec<u8> {
        let img = image::RgbImage::new(width, height);
        let mut buf = Vec::new();
        let encoder = image::codecs::png::PngEncoder::new(&mut buf);
        image::ImageEncoder::write_image(
            encoder,
            img.as_raw(),
            width,
            height,
            image::ExtendedColorType::Rgb8,
        )
        .unwrap();
        buf
    }

    #[test]
    fn test_generate_thumbnail() {
        let tmp = TempDir::new().unwrap();
        let output = tmp.path().join("thumb.jpg");
        let img_data = create_test_png(1200, 1800);

        generate_thumbnail(&img_data, &output).unwrap();

        assert!(output.exists());
        let metadata = std::fs::metadata(&output).unwrap();
        assert!(metadata.len() > 0);
    }

    #[test]
    fn test_generate_thumbnail_creates_parent_dir() {
        let tmp = TempDir::new().unwrap();
        let output = tmp.path().join("sub").join("dir").join("thumb.jpg");
        let img_data = create_test_png(800, 1200);

        generate_thumbnail(&img_data, &output).unwrap();

        assert!(output.exists());
    }

    #[test]
    fn test_generate_thumbnail_width_is_300() {
        let tmp = TempDir::new().unwrap();
        let output = tmp.path().join("thumb.jpg");
        let img_data = create_test_png(1200, 1800);

        generate_thumbnail(&img_data, &output).unwrap();

        let thumb_data = std::fs::read(&output).unwrap();
        let (w, _h) = get_image_dimensions(&thumb_data).unwrap();
        assert_eq!(w, 300);
    }

    #[test]
    fn test_get_image_dimensions() {
        let img_data = create_test_png(640, 480);
        let (w, h) = get_image_dimensions(&img_data).unwrap();
        assert_eq!(w, 640);
        assert_eq!(h, 480);
    }

    #[test]
    fn test_get_image_dimensions_small() {
        let img_data = create_test_png(1, 1);
        let (w, h) = get_image_dimensions(&img_data).unwrap();
        assert_eq!(w, 1);
        assert_eq!(h, 1);
    }

    #[test]
    fn test_is_spread_page_landscape() {
        // 横 > 縦 * 1.2 → true
        assert!(is_spread_page(2400, 1800));
    }

    #[test]
    fn test_is_spread_page_portrait() {
        // 縦長 → false
        assert!(!is_spread_page(1200, 1800));
    }

    #[test]
    fn test_is_spread_page_borderline() {
        // ちょうど1.2倍 → false (厳密に>)
        assert!(!is_spread_page(1200, 1000));
        // 1.2倍より大きい
        assert!(is_spread_page(1201, 1000));
    }

    #[test]
    fn test_is_spread_page_square() {
        assert!(!is_spread_page(1000, 1000));
    }

    #[test]
    fn test_generate_thumbnail_invalid_data() {
        let tmp = TempDir::new().unwrap();
        let output = tmp.path().join("thumb.jpg");
        let invalid_data = vec![0u8; 100];

        let result = generate_thumbnail(&invalid_data, &output);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_image_dimensions_invalid_data() {
        let invalid_data = vec![0u8; 100];
        let result = get_image_dimensions(&invalid_data);
        assert!(result.is_err());
    }
}
