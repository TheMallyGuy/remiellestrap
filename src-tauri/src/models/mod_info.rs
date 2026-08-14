use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ModInfo {
    pub name: String,
    pub path: String,
    pub file_count: u64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PathsInfo {
    pub data_dir: String,
    pub cache_dir: String,
    pub mods_dir: String,
    pub downloads_dir: String,
    pub logs_dir: String,
    pub versions_dir: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}
