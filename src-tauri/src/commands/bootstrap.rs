use tauri::{AppHandle, Emitter, Manager, State};
use tokio_util::sync::CancellationToken;

use crate::core::{bootstrapper, manifest};
use crate::models::{BootstrapStatus, ClientVersion};
use crate::state::AppState;

/// Spawn the bootstrapper pipeline and translate its result into a final
/// `bootstrap-status` event.
pub async fn start(
    app: AppHandle,
    state: &AppState,
    uri: Option<String>,
    force: bool,
) -> Result<(), String> {
    let token = CancellationToken::new();
    *state.bootstrap_cancel.lock().await = Some(token.clone());

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = bootstrapper::run(handle.clone(), uri, force, token).await;
        let s = handle.state::<AppState>().inner().clone();

        let status = match result {
            Ok(()) => BootstrapStatus::done(),
            Err(e) if e == "cancelled" => BootstrapStatus::cancelled(),
            Err(e) => BootstrapStatus::error(e),
        };

        if let Ok(mut st) = s.bootstrap_status.lock() {
            *st = status.clone();
        }
        let _ = handle.emit("bootstrap-status", status);
    });

    Ok(())
}

#[tauri::command]
pub async fn bootstrap_start(
    app: AppHandle,
    state: State<'_, AppState>,
    uri: Option<String>,
    force: bool,
) -> Result<(), String> {
    start(app, state.inner(), uri, force).await
}

#[tauri::command]
pub async fn launch_roblox(
    app: AppHandle,
    state: State<'_, AppState>,
    uri: Option<String>,
) -> Result<(), String> {
    start(app, state.inner(), uri, false).await
}

#[tauri::command]
pub async fn bootstrap_cancel(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(token) = state.bootstrap_cancel.lock().await.as_ref() {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
pub fn bootstrap_status(state: State<'_, AppState>) -> Result<BootstrapStatus, String> {
    Ok(state
        .bootstrap_status
        .lock()
        .map_err(|e| e.to_string())?
        .clone())
}

#[tauri::command]
pub async fn check_version(state: State<'_, AppState>, channel: String) -> Result<ClientVersion, String> {
    manifest::fetch_version(&state.http, &channel).await
}
