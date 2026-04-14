use crate::archive::common::{is_image_file, normalize_path};
use crate::archive::{ArchivePageEntry, ArchiveReader};
use crate::error::AppError;
use std::fs;
use std::path::Path;

pub struct RarReader {
    path: String,
}

impl RarReader {
    pub fn new(path: &str) -> Result<Self, AppError> {
        if !Path::new(path).exists() {
            return Err(AppError::Archive(format!("ファイルが見つかりません: {}", path)));
        }
        Ok(Self {
            path: path.to_string(),
        })
    }

    /// RARアーカイブ内のファイル一覧を取得
    fn list_entries(&self) -> Result<Vec<String>, AppError> {
        let archive = unrar::Archive::new(&self.path)
            .open_for_listing()
            .map_err(|e| AppError::Archive(format!("RARオープン失敗: {}", e)))?;

        let mut names = Vec::new();
        for entry_result in archive {
            let entry = entry_result
                .map_err(|e| AppError::Archive(format!("RARエントリ読み取り失敗: {}", e)))?;
            if !entry.is_directory() {
                let name = normalize_path(&entry.filename.to_string_lossy());
                if is_image_file(&name) {
                    names.push(name);
                }
            }
        }

        names.sort_by(|a, b| natord::compare(a, b));
        Ok(names)
    }

    /// 全ファイルを一時ディレクトリに展開 (read_header/extract API使用)
    fn extract_all_to_dir(&self, dest: &Path) -> Result<(), AppError> {
        let mut archive = unrar::Archive::new(&self.path)
            .open_for_processing()
            .map_err(|e| AppError::Archive(format!("RAR展開失敗: {}", e)))?;

        while let Some(header) = archive.read_header()
            .map_err(|e| AppError::Archive(format!("RARヘッダ読み取り失敗: {}", e)))?
        {
            let entry_name = normalize_path(&header.entry().filename.to_string_lossy());
            let dest_path = dest.join(&entry_name);
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent)?;
            }
            archive = header.extract_to(&dest_path)
                .map_err(|e| AppError::Archive(format!("RAR展開失敗: {}", e)))?;
        }

        Ok(())
    }
}

impl ArchiveReader for RarReader {
    fn list_pages(&self) -> Result<Vec<ArchivePageEntry>, AppError> {
        let names = self.list_entries()?;
        Ok(names
            .into_iter()
            .enumerate()
            .map(|(i, name)| ArchivePageEntry { name, index: i })
            .collect())
    }

    fn extract_page(&self, page_name: &str) -> Result<Vec<u8>, AppError> {
        // HI-6: UUID付き一時ディレクトリで並行アクセス防止
        let temp_id = uuid::Uuid::new_v4().to_string();
        let temp_dir = std::env::temp_dir().join(format!("archiveviewer_rar_{}", temp_id));
        fs::create_dir_all(&temp_dir)?;

        let result = (|| -> Result<Vec<u8>, AppError> {
            self.extract_all_to_dir(&temp_dir)?;

            // 展開されたファイルを読む
            let extracted_path = temp_dir.join(page_name);
            if extracted_path.exists() {
                return Ok(fs::read(&extracted_path)?);
            }

            // バックスラッシュ版も試行
            let alt_name = page_name.replace('/', "\\");
            let alt_path = temp_dir.join(&alt_name);
            if alt_path.exists() {
                return Ok(fs::read(&alt_path)?);
            }

            Err(AppError::Archive(format!(
                "展開されたページが見つかりません: {}",
                page_name
            )))
        })();

        // クリーンアップ
        let _ = fs::remove_dir_all(&temp_dir);

        result
    }

    fn extract_first_page(&self) -> Result<Vec<u8>, AppError> {
        let pages = self.list_pages()?;
        let first = pages
            .first()
            .ok_or_else(|| AppError::Archive("画像ページが見つかりません".to_string()))?;
        self.extract_page(&first.name)
    }

    fn page_count(&self) -> Result<usize, AppError> {
        let names = self.list_entries()?;
        Ok(names.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rar_reader_nonexistent_file() {
        let result = RarReader::new("/nonexistent/path/to/file.rar");
        assert!(result.is_err());
    }
}
