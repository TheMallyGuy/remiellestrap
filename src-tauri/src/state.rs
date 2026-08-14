use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Instant;

use tokio_util::sync::CancellationToken;

use crate::models::{ActivityInfo, BootstrapStatus};
use crate::utils;

/// Managed application state. Every field is cheaply cloneable so commands and
/// spawned tasks can own a copy without fighting the borrow checker.
#[derive(Clone)]
pub struct AppState {
    pub http: reqwest::Client,
    pub data_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub mods_dir: PathBuf,
    pub downloads_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub versions_dir: PathBuf,
    pub roblox_logs_dir: PathBuf,
    pub settings_path: PathBuf,
    pub state_path: PathBuf,
    pub roblox_state_path: PathBuf,
    pub last_booru_request: Arc<tokio::sync::Mutex<Instant>>,
    pub activity: Arc<std::sync::Mutex<ActivityInfo>>,
    pub discord: Arc<std::sync::Mutex<Option<discord_rich_presence::DiscordIpcClient>>>,
    pub bootstrap_cancel: Arc<tokio::sync::Mutex<Option<CancellationToken>>>,
    pub bootstrap_status: Arc<std::sync::Mutex<BootstrapStatus>>,
    pub pending_deeplink: Arc<std::sync::Mutex<Option<Vec<String>>>>,
    pub roblox_running: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let data_dir = utils::paths::data_dir(app)?;
        let versions_dir = utils::paths::versions_dir(app)?;
        let roblox_logs_dir = utils::paths::roblox_logs_dir(app)?;
        let http = utils::http::build_client().map_err(|e| e.to_string())?;

        Ok(Self {
            cache_dir: data_dir.join("BooruCache"),
            mods_dir: data_dir.join("Mods"),
            downloads_dir: data_dir.join("Downloads"),
            logs_dir: data_dir.join("Logs"),
            settings_path: data_dir.join("Settings.json"),
            state_path: data_dir.join("State.json"),
            roblox_state_path: data_dir.join("RobloxState.json"),
            http,
            data_dir,
            versions_dir,
            roblox_logs_dir,
            last_booru_request: Arc::new(tokio::sync::Mutex::new(Instant::now() - std::time::Duration::from_secs(2))),
            activity: Arc::new(std::sync::Mutex::new(ActivityInfo::default())),
            discord: Arc::new(std::sync::Mutex::new(None)),
            bootstrap_cancel: Arc::new(tokio::sync::Mutex::new(None)),
            bootstrap_status: Arc::new(std::sync::Mutex::new(BootstrapStatus::idle())),
            pending_deeplink: Arc::new(std::sync::Mutex::new(None)),
            roblox_running: Arc::new(AtomicBool::new(false)),
        })
    }
}
