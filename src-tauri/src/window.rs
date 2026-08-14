use tauri::{AppHandle, Manager, Window};

use crate::models::AppStateFile;
use crate::state::AppState;

/// Restore the saved window geometry (size, position, maximized state).
pub fn restore_geometry(app: &AppHandle) {
    let state = app.state::<AppState>();
    let saved: AppStateFile = std::fs::read_to_string(&state.state_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if saved.window.width > 0 && saved.window.height > 0 {
        let _ = window.set_size(tauri::LogicalSize::new(
            saved.window.width as f64,
            saved.window.height as f64,
        ));
    }
    if saved.window.x >= 0 && saved.window.y >= 0 {
        let _ = window.set_position(tauri::LogicalPosition::new(
            saved.window.x as f64,
            saved.window.y as f64,
        ));
    }
    if saved.window.maximized {
        let _ = window.maximize();
    }
}

/// Persist window geometry on close.
pub fn save_geometry(window: &Window) {
    let app = window.app_handle();
    let state = app.state::<AppState>();
    let path = state.state_path.clone();

    let mut saved: AppStateFile = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();

    if let Ok(size) = window.outer_size() {
        saved.window.width = size.width;
        saved.window.height = size.height;
    }
    if let Ok(pos) = window.outer_position() {
        saved.window.x = pos.x;
        saved.window.y = pos.y;
    }
    saved.window.maximized = window.is_maximized().unwrap_or(false);

    if let Ok(json) = serde_json::to_string_pretty(&saved) {
        let _ = std::fs::write(&path, json);
    }
}
