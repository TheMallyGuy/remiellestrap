use std::path::Path;
use std::process::Child;

pub fn player_exe(version_dir: &Path) -> std::path::PathBuf {
    version_dir.join("RobloxPlayerBeta.exe")
}

/// Spawn `RobloxPlayerBeta.exe` with the given arguments.
pub fn launch(version_dir: &Path, args: &[String]) -> Result<Child, String> {
    let exe = player_exe(version_dir);
    if !exe.exists() {
        return Err(format!("Roblox client not found at {}", exe.display()));
    }
    std::process::Command::new(&exe)
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())
}

/// Synchronously check whether the Roblox client process is running.
#[cfg(windows)]
pub fn is_running() -> bool {
    use std::process::Command;
    let Ok(output) = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq RobloxPlayerBeta.exe", "/NH"])
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).contains("RobloxPlayerBeta.exe")
}

#[cfg(not(windows))]
pub fn is_running() -> bool {
    false
}

/// Asynchronously check whether the Roblox client process is running.
#[cfg(windows)]
pub async fn is_running_async() -> bool {
    use tokio::process::Command;
    let Ok(output) = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq RobloxPlayerBeta.exe", "/NH"])
        .output()
        .await
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout).contains("RobloxPlayerBeta.exe")
}

#[cfg(not(windows))]
pub async fn is_running_async() -> bool {
    false
}

/// Force-terminate the Roblox client.
#[cfg(windows)]
pub fn kill() {
    let _ = std::process::Command::new("taskkill")
        .args(["/IM", "RobloxPlayerBeta.exe", "/F"])
        .output();
}

#[cfg(not(windows))]
pub fn kill() {
    // No-op stub on non-Windows platforms.
}
