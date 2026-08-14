use std::collections::HashMap;

use serde::{Deserialize, Serialize};

pub const DEFAULT_CHANNEL: &str = "LIVE";
pub const DISCORD_APP_ID_PLACEHOLDER: &str = "1281932102909956117";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub appearance: AppearanceSettings,
    pub behaviour: BehaviourSettings,
    pub integrations: IntegrationsSettings,
    pub fast_flags: FastFlagsSettings,
    pub mods: ModsSettings,
    pub installation: InstallationSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            appearance: AppearanceSettings::default(),
            behaviour: BehaviourSettings::default(),
            integrations: IntegrationsSettings::default(),
            fast_flags: FastFlagsSettings::default(),
            mods: ModsSettings::default(),
            installation: InstallationSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppearanceSettings {
    /// "voidflare" | "lumen" | "aurora"
    pub accent: String,
    /// "curtain_call" | "classic" | "minimal"
    pub bootstrap_style: String,
    /// slot name -> custom tag override (empty string = use default)
    pub booru_tags: HashMap<String, String>,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            accent: "voidflare".into(),
            bootstrap_style: "curtain_call".into(),
            booru_tags: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BehaviourSettings {
    pub channel: String,
    pub multi_instance: bool,
    pub auto_close: bool,
    pub confirm_launch: bool,
    pub force_language: String,
    pub auto_rejoin: bool,
}

impl Default for BehaviourSettings {
    fn default() -> Self {
        Self {
            channel: DEFAULT_CHANNEL.into(),
            multi_instance: false,
            auto_close: false,
            confirm_launch: false,
            force_language: String::new(),
            auto_rejoin: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct IntegrationsSettings {
    pub discord_rpc: bool,
    pub discord_client_id: String,
    pub discord_show_game: bool,
    pub discord_show_elapsed: bool,
    pub discord_show_details: bool,
}

impl Default for IntegrationsSettings {
    fn default() -> Self {
        Self {
            discord_rpc: false,
            discord_client_id: DISCORD_APP_ID_PLACEHOLDER.into(),
            discord_show_game: true,
            discord_show_elapsed: true,
            discord_show_details: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct FastFlagsSettings {
    pub profiles: Vec<FlagProfile>,
    pub active_profile: String,
}

impl Default for FastFlagsSettings {
    fn default() -> Self {
        Self {
            profiles: vec![FlagProfile {
                name: "Default".into(),
                flags: vec![FlagEntry {
                    key: "FFlagDebugDisableTelemetry".into(),
                    value: FlagValue::Bool(true),
                }],
            }],
            active_profile: "Default".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlagProfile {
    pub name: String,
    #[serde(default)]
    pub flags: Vec<FlagEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlagEntry {
    pub key: String,
    pub value: FlagValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "lowercase")]
pub enum FlagValue {
    Bool(bool),
    Number(f64),
    String(String),
}

impl FlagValue {
    pub fn as_json(&self) -> serde_json::Value {
        match self {
            FlagValue::Bool(b) => serde_json::Value::Bool(*b),
            FlagValue::Number(n) => serde_json::json!(*n),
            FlagValue::String(s) => serde_json::Value::String(s.clone()),
        }
    }

    pub fn from_json(value: &serde_json::Value) -> Self {
        match value {
            serde_json::Value::Bool(b) => FlagValue::Bool(*b),
            serde_json::Value::Number(n) => FlagValue::Number(n.as_f64().unwrap_or(0.0)),
            other => FlagValue::String(other.as_str().unwrap_or("").to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ModsSettings {
    /// Ordered mod folder names (priority order).
    pub enabled: Vec<String>,
}

impl Default for ModsSettings {
    fn default() -> Self {
        Self { enabled: Vec::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct InstallationSettings {
    /// Override for %LOCALAPPDATA%\Roblox\Versions (empty = default).
    pub versions_dir: String,
    /// Override for the package download cache (empty = default).
    pub downloads_dir: String,
}

impl Default for InstallationSettings {
    fn default() -> Self {
        Self {
            versions_dir: String::new(),
            downloads_dir: String::new(),
        }
    }
}
