pub mod commands;
pub mod core;
pub mod deeplink;
pub mod errors;
pub mod models;
pub mod services;
pub mod state;
pub mod utils;
pub mod window;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Single-instance must be registered first so secondary launches
        // (e.g. a roblox:// URI opened while running) are forwarded here.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let urls = crate::deeplink::take_current(app);
            if !urls.is_empty() {
                crate::deeplink::store_pending(app, urls.clone());
                let _ = app.emit("deeplink", crate::deeplink::DeeplinkPayload { urls });
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let handle = app.handle().clone();

            // Managed state + logging (before anything that might log).
            let state = crate::state::AppState::new(&handle)?;
            crate::utils::logging::init(&state.logs_dir, 7);
            app.manage(state);

            // Deep-link handling (cold-start URIs, scheme registration).
            crate::deeplink::init(&handle)?;

            // Explicit Windows protocol registration (belt-and-braces).
            let _ = crate::utils::registry::register_protocols();

            // Window geometry.
            crate::window::restore_geometry(&handle);

            // System tray.
            let _ = crate::services::tray::build(&handle);

            // Log activity watcher + Discord RPC + process monitor.
            crate::services::activity_watcher::spawn(handle.clone());

            tracing::info!("RemielleStrap ready");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                crate::window::save_geometry(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            // booru
            commands::booru::booru_search,
            commands::booru::booru_fetch_image,
            commands::booru::booru_get_art_for_slot,
            commands::booru::booru_clear_cache,
            // settings
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::settings::settings_reset,
            commands::settings::settings_export,
            commands::settings::settings_import,
            // bootstrap / launch
            commands::bootstrap::bootstrap_start,
            commands::bootstrap::bootstrap_cancel,
            commands::bootstrap::bootstrap_status,
            commands::bootstrap::launch_roblox,
            commands::bootstrap::check_version,
            // app
            commands::app::get_paths,
            commands::app::open_path,
            commands::app::open_url,
            commands::app::app_get_info,
            commands::app::app_state_get,
            commands::app::app_state_update,
            commands::app::roblox_state_get,
            // mods
            commands::mods::mods_list,
            commands::mods::mods_set_enabled,
            commands::mods::mods_reorder,
            commands::mods::mods_delete,
            commands::mods::mods_import,
            commands::mods::mods_open_folder,
            commands::mods::mods_apply,
            // fastflags
            commands::fastflags::fastflags_export,
            commands::fastflags::fastflags_import,
            // integrations
            commands::integrations::integrations_test_discord,
            // install
            commands::install::install_uninstall,
            commands::install::install_force_reinstall,
            // deeplink
            crate::deeplink::deeplink_pending,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Geometry is persisted on CloseRequested; nothing else to do.
        }
    });
}
