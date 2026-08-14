use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager};

use crate::state::AppState;

pub const TRAY_ID: &str = "main-tray";

/// Build and install the system tray icon.
pub fn build(app: &AppHandle) -> Result<(), String> {
    let menu = build_menu(app)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(handle_menu_event);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app).map_err(|e| e.to_string())?;
    Ok(())
}

fn build_menu(app: &AppHandle) -> Result<Menu, String> {
    let state = app.state::<AppState>();
    let activity = state.activity.lock().unwrap().clone();

    let status = if activity.in_game() {
        let name = if activity.game_name.is_empty() {
            "Roblox".to_string()
        } else {
            activity.game_name.clone()
        };
        format!("Playing: {name}")
    } else if activity.status == "idle" || activity.status == "exited" {
        "Not in a game".to_string()
    } else {
        "Roblox: left the game".to_string()
    };

    let status_item =
        MenuItem::with_id(app, "status", status, false, None::<&str>).map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let rejoin = MenuItem::with_id(app, "rejoin", "Rejoin last game", activity.place_id > 0, None::<&str>)
        .map_err(|e| e.to_string())?;
    let close = MenuItem::with_id(app, "close_roblox", "Close Roblox", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let sep2 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let settings = MenuItem::with_id(app, "settings", "Open Settings", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quit = PredefinedMenuItem::quit(app, Some("Exit RemielleStrap")).map_err(|e| e.to_string())?;

    Menu::with_items(
        app,
        &[&status_item, &sep, &rejoin, &close, &sep2, &settings, &quit],
    )
    .map_err(|e| e.to_string())
}

/// Rebuild the tray menu from the current activity (called on state changes).
pub fn refresh(app: &AppHandle) {
    let Ok(menu) = build_menu(app) else {
        return;
    };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_menu(Some(menu));

        let state = app.state::<AppState>();
        let activity = state.activity.lock().unwrap().clone();
        if activity.in_game() && !activity.game_name.is_empty() {
            let _ = tray.set_tooltip(Some(format!("RemielleStrap — {}", activity.game_name)));
        } else {
            let _ = tray.set_tooltip(Some("RemielleStrap"));
        }
    }
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    match event.id.as_ref() {
        "rejoin" => {
            let state = app.state::<AppState>();
            let activity = state.activity.lock().unwrap().clone();
            if activity.place_id > 0 {
                let uri = format!("roblox://placeId={}", activity.place_id);
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>().inner().clone();
                    let token = tokio_util::sync::CancellationToken::new();
                    *state.bootstrap_cancel.lock().await = Some(token.clone());
                    let _ = crate::core::bootstrapper::run(handle, Some(uri), false, token).await;
                });
            }
        }
        "close_roblox" => crate::core::launcher::kill(),
        "settings" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }
        "quit" => app.exit(0),
        _ => {}
    }
}
