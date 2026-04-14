use crate::archive::common::{is_image_file, normalize_path};
use crate::archive::{ArchivePageEntry, ArchiveReader};
use crate::error::AppError;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use zip::ZipArchive;

pub struct ZipReader {
    path: String,
}

impl ZipReader {
    pub fn new(path: &str) -> Result<Self, AppError> {
        // ファイル存在確認
        if !Path::new(path).exists() {
            return Err(AppError::Archive(format!("ファイルが見つかりません: {}", path)));
        }
        Ok(Self {
            path: path.to_string(),
        })
    }

    fn open_archive(&self) -> Result<ZipArchive<File>, AppError> {
        let file = File::open(&self.path)?;
        // CR-5: ZipArchive::newで可変借用
        let archive = ZipArchive::new(file)
            .map_err(|e| AppError::Archive(format!("ZIPオープン失敗 [{}]: {}", self.path, e)))?;
        Ok(archive)
    }
}

impl ArchiveReader for ZipReader {
    fn list_pages(&self) -> Result<Vec<ArchivePageEntry>, AppError> {
        let mut archive = self.open_archive()?;
        let mut entries = Vec::new();

        // forループ内でarchive.by_index(i)を呼ぶ
        for i in 0..archive.len() {
            let file = archive.by_index(i)
                .map_err(|e| AppError::Archive(format!("ZIPエントリ読み取り失敗: {}", e)))?;
            let name = normalize_path(file.name());
            if !file.is_dir() && is_image_file(&name) {
                entries.push(ArchivePageEntry {
                    name: name,
                    index: i,
                });
            }
        }

        // Natural sort by name
        entries.sort_by(|a, b| natord::compare(&a.name, &b.name));

        Ok(entries)
    }

    fn extract_page(&self, page_name: &str) -> Result<Vec<u8>, AppError> {
        let mut archive = self.open_archive()?;

        // ページ名で検索
        for i in 0..archive.len() {
            let normalized = {
                let file = archive.by_index(i)
                    .map_err(|e| AppError::Archive(format!("ZIPエントリ読み取り失敗: {}", e)))?;
                normalize_path(file.name())
            };

            if normalized == page_name {
                let mut file = archive.by_index(i)
                    .map_err(|e| AppError::Archive(format!("ZIPエントリ読み取り失敗: {}", e)))?;
                let mut buf = Vec::new();
                file.read_to_end(&mut buf)?;
                return Ok(buf);
            }
        }

        Err(AppError::Archive(format!(
            "ページが見つかりません: {}",
            page_name
        )))
    }

    fn extract_first_page(&self) -> Result<Vec<u8>, AppError> {
        let pages = self.list_pages()?;
        let first = pages
            .first()
            .ok_or_else(|| AppError::Archive("画像ページが見つかりません".to_string()))?;
        self.extract_page(&first.name)
    }

    fn page_count(&self) -> Result<usize, AppError> {
        let pages = self.list_pages()?;
        Ok(pages.len())
    }
}

#[cfg(test)]
mod tests {
    // ZIPテストにはテスト用ZIPファイルが必要なため、
    // 統合テストで検証する。ここではユニットテスト可能な部分のみ。
    use super::*;

    #[test]
    fn test_zip_reader_nonexistent_file() {
        let result = ZipReader::new("/nonexistent/path/to/file.zip");
        assert!(result.is_err());
    }
}
