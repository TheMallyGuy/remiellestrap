use tauri::State;

use crate::models::Settings;
use crate::services::discord_rpc;
use crate::state::AppState;
use crate::utils;

/// Connect to Discord and push a test presence; returns whether Discord was
/// reachable.
#[tauri::command]
pub async fn integrations_test_discord(state: State<'_, AppState>) -> bool {
    let settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    let client_id = settings.integrations.discord_client_id.clone();
    tokio::task::spawn_blocking(move || discord_rpc::test_connection(&client_id))
        .await
        .unwrap_or(false)
}
