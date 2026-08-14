use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use super::settings::DEFAULT_CHANNEL;

/// Persisted in `{app_data}/State.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppStateFile {
    pub window: WindowState,
    pub booru_slots: HashMap<String, BooruSlotChoice>,
    pub last_played: Option<LastPlayed>,
}

impl Default for AppStateFile {
    fn default() -> Self {
        Self {
            window: WindowState::default(),
            booru_slots: HashMap::new(),
            last_played: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WindowState {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub maximized: bool,
    pub sidebar_collapsed: bool,
}

impl Default for WindowState {
    fn default() -> Self {
        Self {
            width: 1120,
            height: 720,
            x: -1,
            y: -1,
            maximized: false,
            sidebar_collapsed: false,
        }
    }
}

/// The chosen Safebooru post for a UI slot (persisted per-slot).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BooruSlotChoice {
    pub id: u64,
    pub image: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastPlayed {
    pub place_id: u64,
    pub job_id: String,
    pub name: String,
    pub at: u64,
}

/// Persisted in `{app_data}/RobloxState.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct RobloxState {
    pub installed_guid: Option<String>,
    pub channel: String,
    pub packages: HashMap<String, String>,
}

impl Default for RobloxState {
    fn default() -> Self {
        Self {
            installed_guid: None,
            channel: DEFAULT_CHANNEL.into(),
            packages: HashMap::new(),
        }
    }
}
