use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Archive {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub file_path: String,
    pub file_size: i64,
    pub page_count: i32,
    pub format: String,
    pub thumbnail_path: Option<String>,
    pub rank: i32,
    pub memo: String,
    pub is_read: bool,
    pub last_read_page: i32,
    pub missing: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveSummary {
    pub id: String,
    pub title: String,
    pub thumbnail_path: Option<String>,
    pub rank: i32,
    pub is_read: bool,
    pub format: String,
    pub missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveDetail {
    pub id: String,
    pub title: String,
    pub file_name: String,
    pub file_size: i64,
    pub page_count: i32,
    pub format: String,
    pub thumbnail_path: Option<String>,
    pub rank: i32,
    pub memo: String,
    pub is_read: bool,
    pub last_read_page: i32,
    pub missing: bool,
    pub created_at: String,
    pub updated_at: String,
    pub tags: Vec<Tag>,
    pub folders: Vec<Folder>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveUpdate {
    pub title: Option<String>,
    pub rank: Option<i32>,
    pub memo: Option<String>,
    pub is_read: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveFilter {
    pub folder_id: Option<String>,
    pub smart_folder_id: Option<String>,
    pub preset: Option<String>,
    pub sort_by: Option<String>,
    pub sort_order: Option<String>,
    pub filter_tags: Option<Vec<String>>,
    pub filter_min_rank: Option<i32>,
    pub search_query: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub sort_order: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolder {
    pub id: String,
    pub name: String,
    pub conditions: String,
    pub sort_order: i32,
    pub parent_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolderConditions {
    pub r#match: String,
    pub rules: Vec<SmartFolderRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SmartFolderRule {
    pub field: String,
    pub op: String,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageInfo {
    pub index: usize,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub is_spread: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DropTarget {
    Library,
    Folder(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DragTarget {
    Folder(String),
    SmartFolder(String),
    Tag(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_archive_serialization() {
        let archive = Archive {
            id: "test-id".to_string(),
            title: "Test Comic".to_string(),
            file_name: "test.cbz".to_string(),
            file_path: "archives/test-id/test.cbz".to_string(),
            file_size: 1024000,
            page_count: 100,
            format: "cbz".to_string(),
            thumbnail_path: Some("thumbnails/test-id.jpg".to_string()),
            rank: 3,
            memo: "Good manga".to_string(),
            is_read: false,
            last_read_page: 0,
            missing: false,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&archive).unwrap();
        let deserialized: Archive = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "test-id");
        assert_eq!(deserialized.title, "Test Comic");
        assert_eq!(deserialized.missing, false);
    }

    #[test]
    fn test_archive_summary_serialization() {
        let summary = ArchiveSummary {
            id: "id1".to_string(),
            title: "Title".to_string(),
            thumbnail_path: None,
            rank: 0,
            is_read: false,
            format: "zip".to_string(),
            missing: false,
        };

        let json = serde_json::to_string(&summary).unwrap();
        let deserialized: ArchiveSummary = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.id, "id1");
        assert!(deserialized.thumbnail_path.is_none());
        assert!(!deserialized.missing);
    }

    #[test]
    fn test_archive_filter_all_none() {
        let filter = ArchiveFilter {
            folder_id: None,
            smart_folder_id: None,
            preset: None,
            sort_by: None,
            sort_order: None,
            filter_tags: None,
            filter_min_rank: None,
            search_query: None,
        };

        let json = serde_json::to_string(&filter).unwrap();
        assert!(json.contains("null"));
    }

    #[test]
    fn test_folder_serialization() {
        let folder = Folder {
            id: "folder-1".to_string(),
            name: "Manga".to_string(),
            parent_id: None,
            sort_order: 0,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&folder).unwrap();
        let deserialized: Folder = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "Manga");
        assert!(deserialized.parent_id.is_none());
    }

    #[test]
    fn test_tag_serialization() {
        let tag = Tag {
            id: "tag-1".to_string(),
            name: "Action".to_string(),
        };

        let json = serde_json::to_string(&tag).unwrap();
        let deserialized: Tag = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "Action");
    }

    #[test]
    fn test_smart_folder_serialization() {
        let sf = SmartFolder {
            id: "sf-1".to_string(),
            name: "Favorites".to_string(),
            conditions: r#"{"match":"all","rules":[]}"#.to_string(),
            sort_order: 0,
            parent_id: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&sf).unwrap();
        let deserialized: SmartFolder = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "Favorites");
    }

    #[test]
    fn test_smart_folder_conditions_parsing() {
        let json = r#"{"match":"all","rules":[{"field":"tag","op":"contains","value":"Action"}]}"#;
        let conditions: SmartFolderConditions = serde_json::from_str(json).unwrap();
        assert_eq!(conditions.r#match, "all");
        assert_eq!(conditions.rules.len(), 1);
        assert_eq!(conditions.rules[0].field, "tag");
    }

    #[test]
    fn test_page_info_serialization() {
        let page = PageInfo {
            index: 0,
            url: "asset://localhost/temp/page001.jpg".to_string(),
            width: 1200,
            height: 1800,
            is_spread: false,
        };

        let json = serde_json::to_string(&page).unwrap();
        let deserialized: PageInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.index, 0);
        assert_eq!(deserialized.width, 1200);
    }

    #[test]
    fn test_drop_target_serialization() {
        let target = DropTarget::Library;
        let json = serde_json::to_string(&target).unwrap();
        assert!(json.contains("Library"));

        let folder_target = DropTarget::Folder("folder-1".to_string());
        let json2 = serde_json::to_string(&folder_target).unwrap();
        assert!(json2.contains("folder-1"));
    }

    #[test]
    fn test_drag_target_serialization() {
        let target = DragTarget::Tag("tag-1".to_string());
        let json = serde_json::to_string(&target).unwrap();
        assert!(json.contains("tag-1"));

        let sf_target = DragTarget::SmartFolder("sf-1".to_string());
        let json2 = serde_json::to_string(&sf_target).unwrap();
        assert!(json2.contains("sf-1"));
    }

    #[test]
    fn test_archive_detail_with_tags_and_folders() {
        let detail = ArchiveDetail {
            id: "id1".to_string(),
            title: "Test".to_string(),
            file_name: "test.cbz".to_string(),
            file_size: 1024,
            page_count: 50,
            format: "cbz".to_string(),
            thumbnail_path: None,
            rank: 5,
            memo: "".to_string(),
            is_read: true,
            last_read_page: 25,
            missing: false,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
            tags: vec![Tag {
                id: "t1".to_string(),
                name: "Action".to_string(),
            }],
            folders: vec![Folder {
                id: "f1".to_string(),
                name: "Manga".to_string(),
                parent_id: None,
                sort_order: 0,
                created_at: "2026-01-01T00:00:00Z".to_string(),
            }],
        };

        let json = serde_json::to_string(&detail).unwrap();
        let deserialized: ArchiveDetail = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.tags.len(), 1);
        assert_eq!(deserialized.folders.len(), 1);
        assert!(!deserialized.missing);
    }

    #[test]
    fn test_smart_folder_with_parent_id() {
        let sf = SmartFolder {
            id: "sf-child".to_string(),
            name: "Child".to_string(),
            conditions: r#"{"match":"all","rules":[]}"#.to_string(),
            sort_order: 0,
            parent_id: Some("sf-parent".to_string()),
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&sf).unwrap();
        let deserialized: SmartFolder = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.parent_id, Some("sf-parent".to_string()));
    }

    #[test]
    fn test_smart_folder_without_parent_id() {
        let sf = SmartFolder {
            id: "sf-root".to_string(),
            name: "Root".to_string(),
            conditions: r#"{"match":"all","rules":[]}"#.to_string(),
            sort_order: 0,
            parent_id: None,
            created_at: "2026-01-01T00:00:00Z".to_string(),
        };
        let json = serde_json::to_string(&sf).unwrap();
        let deserialized: SmartFolder = serde_json::from_str(&json).unwrap();
        assert!(deserialized.parent_id.is_none());
    }

    #[test]
    fn test_archive_update_partial() {
        let update = ArchiveUpdate {
            title: Some("New Title".to_string()),
            rank: None,
            memo: None,
            is_read: None,
        };

        let json = serde_json::to_string(&update).unwrap();
        assert!(json.contains("New Title"));
    }

    #[test]
    fn test_archive_missing_field() {
        let archive = Archive {
            id: "id".to_string(),
            title: "Title".to_string(),
            file_name: "file.cbz".to_string(),
            file_path: "archives/id/file.cbz".to_string(),
            file_size: 500,
            page_count: 10,
            format: "cbz".to_string(),
            thumbnail_path: None,
            rank: 0,
            memo: "".to_string(),
            is_read: false,
            last_read_page: 0,
            missing: true,
            created_at: "2026-01-01T00:00:00Z".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        };

        assert!(archive.missing);
        let json = serde_json::to_string(&archive).unwrap();
        assert!(json.contains("\"missing\":true"));
    }
}
