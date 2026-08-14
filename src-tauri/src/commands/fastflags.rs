use tauri::State;

use crate::models::{FlagEntry, FlagProfile, FlagValue, Settings};
use crate::state::AppState;
use crate::utils;

/// Export the active FastFlag profile as a flat `{ flag: value }` JSON map.
#[tauri::command]
pub async fn fastflags_export(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    let profile = settings
        .fast_flags
        .profiles
        .iter()
        .find(|p| p.name == settings.fast_flags.active_profile)
        .or_else(|| settings.fast_flags.profiles.first());

    let mut map = serde_json::Map::new();
    if let Some(profile) = profile {
        for flag in &profile.flags {
            map.insert(flag.key.clone(), flag.value.as_json());
        }
    }

    let json = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, json).await.map_err(|e| e.to_string())
}

/// Import a flat `{ flag: value }` JSON map into the active profile.
#[tauri::command]
pub async fn fastflags_import(state: State<'_, AppState>, path: String) -> Result<Settings, String> {
    let data = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    let map: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(&data).map_err(|e| e.to_string())?;

    let flags: Vec<FlagEntry> = map
        .into_iter()
        .map(|(key, value)| FlagEntry {
            key,
            value: FlagValue::from_json(&value),
        })
        .collect();

    let mut settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    let active = settings.fast_flags.active_profile.clone();
    if let Some(profile) = settings
        .fast_flags
        .profiles
        .iter_mut()
        .find(|p| p.name == active)
    {
        profile.flags = flags;
    } else {
        settings.fast_flags.profiles.push(FlagProfile {
            name: active,
            flags,
        });
    }

    utils::write_json(&state.settings_path, &settings).await?;
    Ok(settings)
}
