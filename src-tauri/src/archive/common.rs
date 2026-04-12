use std::path::Path;

/// 画像ファイルかどうかをPath::extension()ベースで判定 (E2-5)
pub fn is_image_file(filename: &str) -> bool {
    let path = Path::new(filename);
    match path.extension().and_then(|e| e.to_str()) {
        Some(ext) => matches!(
            ext.to_lowercase().as_str(),
            "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "avif" | "tiff" | "tif"
        ),
        None => false,
    }
}

/// Natural sortでファイル名をソート
pub fn sort_filenames_natural(filenames: &mut [String]) {
    filenames.sort_by(|a, b| natord::compare(a, b));
}

/// アーカイブフォーマットを拡張子から検出
pub fn detect_format(path: &str) -> &str {
    let lower = path.to_lowercase();
    if lower.ends_with(".cbz") || lower.ends_with(".zip") {
        "zip"
    } else if lower.ends_with(".cbr") || lower.ends_with(".rar") {
        "rar"
    } else {
        "unknown"
    }
}

/// パスの区切り文字を正規化 (バックスラッシュをスラッシュに)
pub fn normalize_path(path: &str) -> String {
    path.replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;

    // === is_image_file tests ===

    #[test]
    fn test_is_image_file_jpg() {
        assert!(is_image_file("page001.jpg"));
    }

    #[test]
    fn test_is_image_file_jpeg() {
        assert!(is_image_file("photo.jpeg"));
    }

    #[test]
    fn test_is_image_file_png() {
        assert!(is_image_file("image.png"));
    }

    #[test]
    fn test_is_image_file_gif() {
        assert!(is_image_file("anim.gif"));
    }

    #[test]
    fn test_is_image_file_bmp() {
        assert!(is_image_file("bitmap.bmp"));
    }

    #[test]
    fn test_is_image_file_webp() {
        assert!(is_image_file("modern.webp"));
    }

    #[test]
    fn test_is_image_file_case_insensitive() {
        assert!(is_image_file("PAGE.JPG"));
        assert!(is_image_file("page.Png"));
    }

    #[test]
    fn test_is_image_file_not_image() {
        assert!(!is_image_file("readme.txt"));
        assert!(!is_image_file("Thumbs.db"));
        assert!(!is_image_file(".DS_Store"));
        assert!(!is_image_file("metadata.xml"));
    }

    #[test]
    fn test_is_image_file_no_extension() {
        assert!(!is_image_file("noext"));
    }

    #[test]
    fn test_is_image_file_with_path() {
        assert!(is_image_file("chapter01/page001.jpg"));
        assert!(is_image_file("dir/subdir/image.png"));
    }

    // === sort_filenames_natural tests ===

    #[test]
    fn test_sort_filenames_natural_numeric() {
        let mut files = vec![
            "page10.jpg".to_string(),
            "page2.jpg".to_string(),
            "page1.jpg".to_string(),
            "page20.jpg".to_string(),
        ];
        sort_filenames_natural(&mut files);
        assert_eq!(files, vec!["page1.jpg", "page2.jpg", "page10.jpg", "page20.jpg"]);
    }

    #[test]
    fn test_sort_filenames_natural_mixed() {
        let mut files = vec![
            "img_003.png".to_string(),
            "img_001.png".to_string(),
            "img_002.png".to_string(),
        ];
        sort_filenames_natural(&mut files);
        assert_eq!(files, vec!["img_001.png", "img_002.png", "img_003.png"]);
    }

    #[test]
    fn test_sort_filenames_natural_empty() {
        let mut files: Vec<String> = vec![];
        sort_filenames_natural(&mut files);
        assert!(files.is_empty());
    }

    // === detect_format tests ===

    #[test]
    fn test_detect_format_zip() {
        assert_eq!(detect_format("comic.zip"), "zip");
        assert_eq!(detect_format("comic.cbz"), "zip");
    }

    #[test]
    fn test_detect_format_rar() {
        assert_eq!(detect_format("comic.rar"), "rar");
        assert_eq!(detect_format("comic.cbr"), "rar");
    }

    #[test]
    fn test_detect_format_case_insensitive() {
        assert_eq!(detect_format("COMIC.ZIP"), "zip");
        assert_eq!(detect_format("COMIC.CBR"), "rar");
    }

    #[test]
    fn test_detect_format_unknown() {
        assert_eq!(detect_format("file.7z"), "unknown");
        assert_eq!(detect_format("file.tar.gz"), "unknown");
    }

    // === normalize_path tests ===

    #[test]
    fn test_normalize_path_backslash() {
        assert_eq!(normalize_path("dir\\subdir\\file.jpg"), "dir/subdir/file.jpg");
    }

    #[test]
    fn test_normalize_path_already_normalized() {
        assert_eq!(normalize_path("dir/subdir/file.jpg"), "dir/subdir/file.jpg");
    }

    #[test]
    fn test_normalize_path_mixed() {
        assert_eq!(normalize_path("dir\\subdir/file.jpg"), "dir/subdir/file.jpg");
    }
}
