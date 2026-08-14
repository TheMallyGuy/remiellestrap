use std::path::PathBuf;

use tauri::{AppHandle, Manager};

/// The app's persistent data directory (Settings.json, State.json, caches).
pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// `%LOCALAPPDATA%\Roblox\Versions` (meaningful on Windows; resolves to the
/// platform local data dir elsewhere).
pub fn versions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .local_data_dir()
        .map_err(|e| e.to_string())?
        .join("Roblox")
        .join("Versions"))
}

/// `%LOCALAPPDATA%\Roblox\Logs`.
pub fn roblox_logs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .local_data_dir()
        .map_err(|e| e.to_string())?
        .join("Roblox")
        .join("Logs"))
}
