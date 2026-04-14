pub mod common;
pub mod rar;
pub mod zip;

use crate::error::AppError;

/// アーカイブ内のページエントリ
#[derive(Debug, Clone)]
pub struct ArchivePageEntry {
    pub name: String,
    pub index: usize,
}

/// アーカイブリーダーのトレイト
pub trait ArchiveReader {
    /// 画像ページの一覧を取得 (Natural sort済み)
    fn list_pages(&self) -> Result<Vec<ArchivePageEntry>, AppError>;

    /// 指定ページのバイナリデータを取得
    fn extract_page(&self, page_name: &str) -> Result<Vec<u8>, AppError>;

    /// 最初のページのバイナリデータを取得 (サムネイル用)
    fn extract_first_page(&self) -> Result<Vec<u8>, AppError>;

    /// ページ数を取得
    fn page_count(&self) -> Result<usize, AppError>;
}

/// ファクトリ関数: パスからアーカイブリーダーを作成
pub fn open_archive(path: &str) -> Result<Box<dyn ArchiveReader>, AppError> {
    let format = common::detect_format(path);
    match format {
        "zip" => Ok(Box::new(zip::ZipReader::new(path)?)),
        "rar" => Ok(Box::new(rar::RarReader::new(path)?)),
        _ => Err(AppError::Archive(format!(
            "未対応のアーカイブ形式: {}",
            path
        ))),
    }
}
