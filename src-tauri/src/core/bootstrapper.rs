use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::Instant;

use tauri::{AppHandle, Emitter, Manager};
use tokio_util::sync::CancellationToken;

use crate::core::{deployment, launcher, manifest, uri};
use crate::models::{BootstrapProgress, BootstrapStatus, RobloxState, Settings};
use crate::state::AppState;
use crate::utils;

/// Full bootstrapper pipeline: version check → manifest → download/extract →
/// mods + FastFlags → launch. Emits `bootstrap-progress` and `bootstrap-status`
/// events throughout and honours the cancellation token.
pub async fn run(
    app: AppHandle,
    uri: Option<String>,
    force: bool,
    cancel: CancellationToken,
) -> Result<(), String> {
    let state = app.state::<AppState>().inner().clone();

    emit_status(&app, &state, BootstrapStatus::working("checking_version"));
    emit_progress(&app, "checking_version", None, 0.0, 0.0, 0.0, None);

    let settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    let channel = settings.behaviour.channel.trim().to_string();
    if channel.is_empty() {
        return Err("no deployment channel configured".to_string());
    }

    // 1. Version check against the CDN.
    let version = manifest::fetch_version(&state.http, &channel).await?;
    let mut roblox: RobloxState = utils::read_json_or_default(&state.roblox_state_path).await;

    let versions_root = effective_versions_dir(&state, &settings);
    let dest = versions_root.join(&version.client_version_upload);

    let up_to_date = !force
        && roblox.installed_guid.as_deref() == Some(version.client_version_upload.as_str())
        && launcher::player_exe(&dest).exists();

    // 2. Install (or update) the deployment when needed.
    if !up_to_date {
        if cancel.is_cancelled() {
            return Err("cancelled".to_string());
        }

        emit_status(&app, &state, BootstrapStatus::working("fetching_manifest"));
        emit_progress(&app, "fetching_manifest", None, 0.0, 0.0, 0.0, None);

        let manifest = manifest::fetch(&state.http, &channel, &version.client_version_upload).await?;
        if manifest.packages.is_empty() {
            return Err("deployment manifest contained no packages".to_string());
        }
        tokio::fs::create_dir_all(&dest).await.map_err(|e| e.to_string())?;

        let total_bytes: u64 = manifest
            .packages
            .iter()
            .map(|p| p.size.max(p.compressed_size).max(1))
            .sum();

        let downloads_dir = effective_downloads_dir(&state, &settings);
        let mut base_done: u64 = 0;

        let mut tracker = Tracker {
            app: &app,
            pkg_name: String::new(),
            base_done: 0,
            total_bytes,
            window: Instant::now(),
            window_bytes: 0,
            last: 0,
            bps: 0.0,
        };

        for pkg in &manifest.packages {
            if cancel.is_cancelled() {
                return Err("cancelled".to_string());
            }

            tracker.pkg_name = pkg.name.clone();
            tracker.base_done = base_done;
            tracker.last = 0;
            tracker.window_bytes = 0;
            tracker.window = Instant::now();
            tracker.bps = 0.0;

            emit_status(&app, &state, BootstrapStatus::working(format!("downloading {}", pkg.name)));
            emit_progress(
                &app,
                "downloading",
                Some(&pkg.name),
                0.0,
                base_done as f64 / total_bytes as f64,
                0.0,
                None,
            );

            let pkg_path = deployment::download_package(
                &state.http,
                &downloads_dir,
                &channel,
                &version.client_version_upload,
                pkg,
                &mut |n, total| tracker.tick(n, total),
                &cancel,
            )
            .await?;

            if cancel.is_cancelled() {
                return Err("cancelled".to_string());
            }

            emit_status(&app, &state, BootstrapStatus::working(format!("extracting {}", pkg.name)));
            emit_progress(
                &app,
                "extracting",
                Some(&pkg.name),
                1.0,
                (base_done + pkg.size.max(pkg.compressed_size)) as f64 / total_bytes as f64,
                0.0,
                None,
            );

            let zip_path = pkg_path.clone();
            let target = dest.clone();
            let pkg_name = pkg.name.clone();
            tokio::task::spawn_blocking(move || deployment::extract_package(&zip_path, &target, &pkg_name))
                .await
                .map_err(|e| e.to_string())??;

            base_done += pkg.size.max(pkg.compressed_size).max(1);
            roblox.packages.insert(pkg.name.clone(), pkg.md5.clone());
        }

        // 3. Pre-launch: overlay mods and write the active FastFlag profile.
        if cancel.is_cancelled() {
            return Err("cancelled".to_string());
        }

        emit_status(&app, &state, BootstrapStatus::working("applying_mods"));
        emit_progress(&app, "applying_mods", None, 1.0, 0.95, 0.0, None);
        apply_mods(&state, &settings, &dest).await;

        emit_status(&app, &state, BootstrapStatus::working("writing_settings"));
        emit_progress(&app, "writing_settings", None, 1.0, 0.97, 0.0, None);
        write_client_settings(&settings, &dest).await?;

        roblox.installed_guid = Some(version.client_version_upload.clone());
        roblox.channel = channel.clone();
        utils::write_json(&state.roblox_state_path, &roblox).await?;
    }

    // 4. Launch Roblox.
    if cancel.is_cancelled() {
        return Err("cancelled".to_string());
    }

    emit_status(&app, &state, BootstrapStatus::working("launching"));
    emit_progress(&app, "launching", None, 1.0, 1.0, 0.0, None);

    let params = uri::parse(uri.as_deref().unwrap_or(""));
    let locale = settings.behaviour.force_language.clone();
    let args = uri::build_launch_args(&params, &locale);
    let _child = launcher::launch(&dest, &args)?;

    state.roblox_running.store(true, Ordering::SeqCst);

    emit_status(&app, &state, BootstrapStatus::done());
    emit_progress(&app, "done", None, 1.0, 1.0, 0.0, None);

    Ok(())
}

/// Per-package download progress tracker that throttles event emission and
/// computes a rolling bytes/sec rate.
struct Tracker<'a> {
    app: &'a AppHandle,
    pkg_name: String,
    base_done: u64,
    total_bytes: u64,
    window: Instant,
    window_bytes: u64,
    last: u64,
    bps: f64,
}

impl Tracker<'_> {
    fn tick(&mut self, n: u64, total: u64) {
        self.window_bytes += n.saturating_sub(self.last);
        self.last = n;

        let elapsed = self.window.elapsed().as_secs_f64();
        if elapsed >= 0.5 {
            self.bps = self.window_bytes as f64 / elapsed;
            self.window = Instant::now();
            self.window_bytes = 0;
        }

        let pkg_progress = (n as f64 / total.max(1) as f64).clamp(0.0, 1.0);
        let total_progress =
            ((self.base_done + n) as f64 / self.total_bytes.max(1) as f64).clamp(0.0, 1.0);

        let _ = self.app.emit(
            "bootstrap-progress",
            BootstrapProgress {
                stage: "downloading".to_string(),
                package: Some(self.pkg_name.clone()),
                pkg_progress,
                total_progress,
                bytes_per_sec: self.bps,
                detail: None,
            },
        );
    }
}

fn emit_status(app: &AppHandle, state: &AppState, status: BootstrapStatus) {
    if let Ok(mut s) = state.bootstrap_status.lock() {
        *s = status.clone();
    }
    let _ = app.emit("bootstrap-status", status);
}

#[allow(clippy::too_many_arguments)]
fn emit_progress(
    app: &AppHandle,
    stage: &str,
    package: Option<&str>,
    pkg_progress: f64,
    total_progress: f64,
    bytes_per_sec: f64,
    detail: Option<&str>,
) {
    let _ = app.emit(
        "bootstrap-progress",
        BootstrapProgress {
            stage: stage.to_string(),
            package: package.map(|p| p.to_string()),
            pkg_progress,
            total_progress,
            bytes_per_sec,
            detail: detail.map(|d| d.to_string()),
        },
    );
}

fn effective_versions_dir(state: &AppState, settings: &Settings) -> PathBuf {
    let override_dir = settings.installation.versions_dir.trim();
    if override_dir.is_empty() {
        state.versions_dir.clone()
    } else {
        PathBuf::from(override_dir)
    }
}

fn effective_downloads_dir(state: &AppState, settings: &Settings) -> PathBuf {
    let override_dir = settings.installation.downloads_dir.trim();
    if override_dir.is_empty() {
        state.downloads_dir.clone()
    } else {
        PathBuf::from(override_dir)
    }
}

async fn apply_mods(state: &AppState, settings: &Settings, dest: &Path) {
    for name in &settings.mods.enabled {
        let src = state.mods_dir.join(name);
        if src.exists() {
            let _ = utils::copy_dir_recursive(&src, dest).await;
        }
    }
}

async fn write_client_settings(settings: &Settings, dest: &Path) -> Result<(), String> {
    let profile = settings
        .fast_flags
        .profiles
        .iter()
        .find(|p| p.name == settings.fast_flags.active_profile)
        .or_else(|| settings.fast_flags.profiles.first());

    let mut map = serde_json::Map::new();
    if let Some(profile) = profile {
        for flag in &profile.flags {
            map.insert(flag.key.clone(), flag.value.as_json());
        }
    }

    let dir = dest.join("ClientSettings");
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    tokio::fs::write(dir.join("ClientAppSettings.json"), json)
        .await
        .map_err(|e| e.to_string())
}
