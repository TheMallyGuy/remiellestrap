use std::path::PathBuf;

use tauri::{AppHandle, State};
use tauri_plugin_shell::ShellExt;

use crate::models::{ModInfo, RobloxState, Settings};
use crate::state::AppState;
use crate::utils;

#[tauri::command]
pub async fn mods_list(state: State<'_, AppState>) -> Result<Vec<ModInfo>, String> {
    let settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    let _ = tokio::fs::create_dir_all(&state.mods_dir).await;

    let mut names = Vec::new();
    let mut entries = tokio::fs::read_dir(&state.mods_dir).await.map_err(|e| e.to_string())?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        if entry.file_type().await.map(|t| t.is_dir()).unwrap_or(false) {
            names.push(entry.file_name().to_string_lossy().to_string());
        }
    }
    names.sort();

    let enabled = settings.mods.enabled.clone();
    let mut infos = Vec::new();
    for name in names {
        let path = state.mods_dir.join(&name);
        let file_count = utils::count_files_recursive(&path).await;
        infos.push(ModInfo {
            enabled: enabled.contains(&name),
            name: name.clone(),
            path: path.display().to_string(),
            file_count,
        });
    }

    // Enabled mods in priority order first, then disabled alphabetically.
    infos.sort_by_key(|m| {
        let priority = enabled
            .iter()
            .position(|e| e == &m.name)
            .map(|i| i as i64)
            .unwrap_or(i64::MAX);
        (priority, m.name.clone())
    });

    Ok(infos)
}

#[tauri::command]
pub async fn mods_set_enabled(state: State<'_, AppState>, name: String, enabled: bool) -> Result<(), String> {
    let mut settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    if enabled {
        if !settings.mods.enabled.contains(&name) {
            settings.mods.enabled.push(name);
        }
    } else {
        settings.mods.enabled.retain(|n| n != &name);
    }
    utils::write_json(&state.settings_path, &settings).await
}

#[tauri::command]
pub async fn mods_reorder(state: State<'_, AppState>, names: Vec<String>) -> Result<(), String> {
    let mut settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    settings.mods.enabled = names;
    utils::write_json(&state.settings_path, &settings).await
}

#[tauri::command]
pub async fn mods_delete(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let mut settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    settings.mods.enabled.retain(|n| n != &name);
    utils::write_json(&state.settings_path, &settings).await?;
    utils::remove_dir(&state.mods_dir.join(&name)).await
}

#[tauri::command]
pub async fn mods_import(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err("import source does not exist".to_string());
    }

    let name = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "mod".to_string());

    let dst = state.mods_dir.join(&name);
    tokio::fs::create_dir_all(&state.mods_dir).await.map_err(|e| e.to_string())?;

    if src.is_dir() {
        utils::copy_dir_recursive(&src, &dst).await?;
    } else if path.to_ascii_lowercase().ends_with(".zip") {
        let zip_src = src.clone();
        let zip_dst = dst.clone();
        tokio::task::spawn_blocking(move || crate::utils::zip::extract_zip(&zip_src, &zip_dst))
            .await
            .map_err(|e| e.to_string())??;
    } else {
        return Err("unsupported mod format (expected a folder or .zip)".to_string());
    }

    let mut settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    if !settings.mods.enabled.contains(&name) {
        settings.mods.enabled.push(name);
    }
    utils::write_json(&state.settings_path, &settings).await
}

#[tauri::command]
pub fn mods_open_folder(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let _ = std::fs::create_dir_all(&state.mods_dir);
    app.shell()
        .open(state.mods_dir.display().to_string(), None)
        .map_err(|e| e.to_string())
}

/// Re-overlay enabled mods onto the currently installed version.
#[tauri::command]
pub async fn mods_apply(state: State<'_, AppState>) -> Result<(), String> {
    let settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    let roblox: RobloxState = utils::read_json_or_default(&state.roblox_state_path).await;
    let Some(guid) = roblox.installed_guid else {
        return Err("Roblox is not installed yet".to_string());
    };

    let dest = state.versions_dir.join(&guid);
    for name in &settings.mods.enabled {
        let src = state.mods_dir.join(name);
        if src.exists() {
            utils::copy_dir_recursive(&src, &dest).await?;
        }
    }
    Ok(())
}
