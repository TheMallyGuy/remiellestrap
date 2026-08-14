use std::path::Path;

use tauri::State;

use crate::models::Settings;
use crate::state::AppState;
use crate::utils;

#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<Settings, String> {
    Ok(utils::read_json_or_default(&state.settings_path).await)
}

#[tauri::command]
pub async fn settings_update(state: State<'_, AppState>, settings: Settings) -> Result<(), String> {
    utils::write_json(&state.settings_path, &settings).await
}

#[tauri::command]
pub async fn settings_reset(state: State<'_, AppState>) -> Result<Settings, String> {
    let defaults = Settings::default();
    utils::write_json(&state.settings_path, &defaults).await?;
    Ok(defaults)
}

#[tauri::command]
pub async fn settings_export(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    utils::write_json(Path::new(&path), &settings).await
}

#[tauri::command]
pub async fn settings_import(state: State<'_, AppState>, path: String) -> Result<Settings, String> {
    let data = tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
    let settings: Settings = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    utils::write_json(&state.settings_path, &settings).await?;
    Ok(settings)
}
