use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

#[derive(Debug, Clone, Serialize)]
pub struct DeeplinkPayload {
    pub urls: Vec<String>,
}

fn payload(urls: Vec<String>) -> DeeplinkPayload {
    DeeplinkPayload { urls }
}

/// Read the deep-link URLs currently known to the plugin.
pub fn take_current<R: tauri::Runtime>(app: &AppHandle<R>) -> Vec<String> {
    match app.deep_link().get_current() {
        Ok(Some(urls)) => urls.into_iter().map(|u| u.to_string()).collect(),
        _ => Vec::new(),
    }
}

/// Buffer a URL for the frontend to pick up on load (cold-start case).
pub fn store_pending(app: &AppHandle, urls: Vec<String>) {
    let state = app.state::<crate::state::AppState>();
    if let Ok(mut pending) = state.pending_deeplink.lock() {
        *pending = Some(urls);
    }
}

/// Cold-start deep-link handling: parse CLI args, register schemes, and set up
/// the macOS `on_open_url` listener.
pub fn init(app: &AppHandle) -> Result<(), String> {
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        app.deep_link().handle_cli_arguments(std::env::args());
        app.deep_link().register_all().map_err(|e| e.to_string())?;

        let urls = take_current(app);
        if !urls.is_empty() {
            store_pending(app, urls.clone());
            let _ = app.emit("deeplink", payload(urls));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let handle = app.clone();
        app.deep_link().on_open_url(move |event| {
            let urls: Vec<String> = event.urls().into_iter().map(|u| u.to_string()).collect();
            let state = handle.state::<crate::state::AppState>();
            if let Ok(mut pending) = state.pending_deeplink.lock() {
                *pending = Some(urls.clone());
            }
            let _ = handle.emit("deeplink", payload(urls));
        });
    }

    Ok(())
}

/// Drain the pending cold-start URL (called by the frontend on load).
#[tauri::command]
pub fn deeplink_pending(app: AppHandle) -> Option<Vec<String>> {
    let state = app.state::<crate::state::AppState>();
    match state.pending_deeplink.lock() {
        Ok(mut pending) => pending.take(),
        Err(_) => None,
    }
}
