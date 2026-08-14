use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;

use crate::models::{AppInfo, AppStateFile, PathsInfo, RobloxState};
use crate::state::AppState;
use crate::utils;

#[tauri::command]
pub fn get_paths(state: State<'_, AppState>) -> Result<PathsInfo, String> {
    Ok(PathsInfo {
        data_dir: state.data_dir.display().to_string(),
        cache_dir: state.cache_dir.display().to_string(),
        mods_dir: state.mods_dir.display().to_string(),
        downloads_dir: state.downloads_dir.display().to_string(),
        logs_dir: state.logs_dir.display().to_string(),
        versions_dir: state.versions_dir.display().to_string(),
    })
}

#[tauri::command]
pub fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    app.shell().open(path, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.shell().open(url, None).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn app_get_info(app: AppHandle) -> AppInfo {
    AppInfo {
        name: "RemielleStrap".into(),
        version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
pub async fn app_state_get(state: State<'_, AppState>) -> Result<AppStateFile, String> {
    Ok(utils::read_json_or_default(&state.state_path).await)
}

#[tauri::command]
pub async fn app_state_update(state: State<'_, AppState>, value: AppStateFile) -> Result<(), String> {
    utils::write_json(&state.state_path, &value).await
}

#[tauri::command]
pub async fn roblox_state_get(state: State<'_, AppState>) -> Result<RobloxState, String> {
    Ok(utils::read_json_or_default(&state.roblox_state_path).await)
}
