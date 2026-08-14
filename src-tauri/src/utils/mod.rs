pub mod paths;
pub mod http;
pub mod md5;
pub mod zip;
pub mod registry;
pub mod logging;

use std::path::Path;

use serde::de::DeserializeOwned;
use serde::Serialize;

/// Read a JSON file into `T`, falling back to `T::default()` when the file is
/// missing or unparseable (forward compatibility).
pub async fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> T {
    match tokio::fs::read_to_string(path).await {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => T::default(),
    }
}

/// Pretty-print `value` as JSON to `path`, creating parent directories.
pub async fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    tokio::fs::write(path, json).await.map_err(|e| e.to_string())
}

/// Recursively copy a directory tree (used to overlay mods and import folders).
pub async fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    if !src.exists() {
        return Ok(());
    }
    tokio::fs::create_dir_all(dst).await.map_err(|e| e.to_string())?;
    let mut entries = tokio::fs::read_dir(src).await.map_err(|e| e.to_string())?;
    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
        let ty = entry.file_type().await.map_err(|e| e.to_string())?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if ty.is_dir() {
            Box::pin(copy_dir_recursive(&from, &to)).await?;
        } else {
            tokio::fs::copy(&from, &to).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Recursively count files under a directory.
pub async fn count_files_recursive(path: &Path) -> u64 {
    let mut count = 0u64;
    let mut stack = vec![path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if let Ok(mut entries) = tokio::fs::read_dir(&dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                if let Ok(ft) = entry.file_type().await {
                    if ft.is_dir() {
                        stack.push(entry.path());
                    } else {
                        count += 1;
                    }
                }
            }
        }
    }
    count
}

/// Recursively remove a directory (used for mod deletion / uninstall).
pub async fn remove_dir(path: &Path) -> Result<(), String> {
    if path.exists() {
        tokio::fs::remove_dir_all(path).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
