use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

use crate::core::manifest::Package;
use crate::utils;

/// Map a deployment package name to its extraction folder relative to the
/// version directory. This is a best-effort subset of the known Roblox
/// package→folder map with sensible `content-*` / `extracontent-*` heuristics.
pub fn package_dir(name: &str) -> PathBuf {
    let lower = name.to_ascii_lowercase();

    if lower.ends_with(".exe") || lower.ends_with(".dll") {
        return PathBuf::new();
    }

    match lower.as_str() {
        "appsettings.xml" => PathBuf::new(),
        "bootstrapper" => PathBuf::from("bootstrap"),
        "extracontent-translations" => PathBuf::from("content/translations"),
        "extracontent-luapackages" => PathBuf::from("ExtraContent/LuaPackages"),
        "extracontent-scripts" => PathBuf::from("ExtraContent/scripts"),
        "extracontent-textures2" => PathBuf::from("ExtraContent/textures"),
        "extracontent-models" => PathBuf::from("ExtraContent/models"),
        "extracontent-sounds" => PathBuf::from("ExtraContent/sounds"),
        "extracontent-platforms" => PathBuf::from("ExtraContent/platforms"),
        _ => {
            if let Some(rest) = lower.strip_prefix("content-") {
                PathBuf::from("content").join(rest)
            } else if lower.starts_with("shaders") {
                PathBuf::from(name)
            } else {
                // Unknown packages land in the version root.
                PathBuf::new()
            }
        }
    }
}

/// Download (or reuse) a package into the md5-keyed Downloads cache, verifying
/// its checksum. Calls `on_progress(downloaded, total)` per chunk.
pub async fn download_package(
    client: &reqwest::Client,
    downloads_dir: &Path,
    channel: &str,
    guid: &str,
    pkg: &Package,
    on_progress: &mut dyn FnMut(u64, u64),
    cancel: &CancellationToken,
) -> Result<PathBuf, String> {
    tokio::fs::create_dir_all(downloads_dir).await.map_err(|e| e.to_string())?;

    let cached = downloads_dir.join(&pkg.md5);
    if cached.exists() && utils::md5::md5_file_hex(&cached).await? == pkg.md5 {
        return Ok(cached);
    }

    let url = format!("https://setup.rbxcdn.com/channel/{channel}/{guid}-{}", pkg.name);
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;

    let total = match resp.content_length() {
        Some(n) if n > 0 => n,
        _ => pkg.compressed_size.max(pkg.size).max(1),
    };

    let tmp = downloads_dir.join(format!("{}.part", pkg.md5));
    let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;

    while let Some(chunk) = stream.next().await {
        if cancel.is_cancelled() {
            drop(file);
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err("cancelled".to_string());
        }
        let chunk = chunk.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        on_progress(received, total);
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    let actual = utils::md5::md5_file_hex(&tmp).await?;
    if actual != pkg.md5 {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(format!(
            "md5 mismatch for {}: expected {}, got {actual}",
            pkg.name, pkg.md5
        ));
    }

    tokio::fs::rename(&tmp, &cached).await.map_err(|e| e.to_string())?;
    Ok(cached)
}

/// Extract a cached package zip into the version directory at the mapped
/// package-relative location.
pub fn extract_package(zip_path: &Path, version_dir: &Path, package_name: &str) -> Result<(), String> {
    let dest = version_dir.join(package_dir(package_name));
    utils::zip::extract_zip(zip_path, &dest)
}
