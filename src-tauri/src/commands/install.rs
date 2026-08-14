use tauri::{AppHandle, State};

use crate::models::RobloxState;
use crate::state::AppState;
use crate::utils;

/// Delete the installed version directory and clear RobloxState.json.
#[tauri::command]
pub async fn install_uninstall(state: State<'_, AppState>) -> Result<(), String> {
    let roblox: RobloxState = utils::read_json_or_default(&state.roblox_state_path).await;
    if let Some(guid) = &roblox.installed_guid {
        utils::remove_dir(&state.versions_dir.join(guid)).await?;
    }
    utils::write_json(&state.roblox_state_path, &RobloxState::default()).await
}

/// Force a fresh reinstall of the current channel's deployment.
#[tauri::command]
pub async fn install_force_reinstall(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    crate::commands::bootstrap::start(app, state.inner(), None, true).await
}
