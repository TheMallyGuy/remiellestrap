use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use std::time::Duration;

use regex::Regex;
use tauri::{AppHandle, Emitter, Manager};

use crate::models::{now_unix, Settings};
use crate::state::AppState;
use crate::utils;

const TAIL_BYTES: u64 = 256 * 1024;

const LEAVE_PATTERNS: &[&str] = &[
    "Disconnected from server",
    "Disconnected:",
    "! Leaving game",
    "Connection lost",
    "Lost connection to the game",
];

fn join_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"! Joining game '([0-9a-fA-F-]+)' place (\d+)").unwrap())
}

/// Start the two background tasks: a `notify` watcher tailing the newest Roblox
/// log and a process poller detecting Roblox exit.
pub fn spawn(app: AppHandle) {
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = watch_logs(a).await;
    });

    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        watch_process(a).await;
    });
}

async fn watch_logs(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>().inner().clone();
    let dir = state.roblox_logs_dir.clone();
    let _ = tokio::fs::create_dir_all(&dir).await;

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(&dir, notify::RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    // Initial scan in case a log already exists.
    scan_logs(&app).await;

    while rx.recv().await.is_some() {
        // Debounce: let the log write settle, then drain and scan once.
        tokio::time::sleep(Duration::from_millis(300)).await;
        while rx.try_recv().is_ok() {}
        scan_logs(&app).await;
    }

    let _ = watcher.unwatch(&dir);
    Ok(())
}

async fn scan_logs(app: &AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    let Some(path) = newest_log(&state.roblox_logs_dir).await else {
        return;
    };
    let Ok(text) = read_tail(&path, TAIL_BYTES).await else {
        return;
    };
    handle_log_text(app, &state, &text).await;
}

async fn newest_log(dir: &Path) -> Option<PathBuf> {
    let mut entries = tokio::fs::read_dir(dir).await.ok()?;
    let mut best: Option<(PathBuf, std::time::SystemTime)> = None;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(ft) = entry.file_type().await {
            if ft.is_file() {
                if let Ok(meta) = entry.metadata().await {
                    let mtime = meta.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    let better = best.as_ref().map(|(_, t)| mtime > *t).unwrap_or(true);
                    if better {
                        best = Some((entry.path(), mtime));
                    }
                }
            }
        }
    }
    best.map(|(p, _)| p)
}

async fn read_tail(path: &Path, max: u64) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};

    let mut f = tokio::fs::File::open(path).await.map_err(|e| e.to_string())?;
    let len = f.metadata().await.map_err(|e| e.to_string())?.len();
    let start = len.saturating_sub(max);
    f.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|e| e.to_string())?;
    let mut buf = String::new();
    f.read_to_string(&mut buf).await.map_err(|e| e.to_string())?;
    Ok(buf)
}

async fn handle_log_text(app: &AppHandle, state: &AppState, text: &str) {
    // Take the most recent join line (the log is append-only).
    let mut joined: Option<(String, u64)> = None;
    for caps in join_re().captures_iter(text) {
        if let (Some(job), Some(place)) = (caps.get(1), caps.get(2)) {
            if let Ok(place_id) = place.as_str().parse::<u64>() {
                joined = Some((job.as_str().to_string(), place_id));
            }
        }
    }

    let mut changed = false;

    if let Some((job_id, place_id)) = joined {
        let mut activity = state.activity.lock().unwrap();
        let is_new = activity.job_id != job_id;
        if is_new {
            activity.status = "in_game".to_string();
            activity.job_id = job_id.clone();
            activity.place_id = place_id;
            activity.joined_at = now_unix();
            activity.game_name.clear();
            state.roblox_running.store(true, Ordering::SeqCst);
            changed = true;
        }
        drop(activity);

        if is_new {
            // Resolve the game name and persist last-played.
            if let Some(name) = fetch_game_name(&state.http, place_id).await {
                {
                    let mut activity = state.activity.lock().unwrap();
                    activity.game_name = name.clone();
                }

                let mut app_state: crate::models::AppStateFile =
                    utils::read_json_or_default(&state.state_path).await;
                app_state.last_played = Some(crate::models::LastPlayed {
                    place_id,
                    job_id: job_id.clone(),
                    name,
                    at: now_unix() as u64,
                });
                let _ = utils::write_json(&state.state_path, &app_state).await;
            }
        }
    } else {
        let mut status: Option<&str> = None;
        for pat in LEAVE_PATTERNS {
            if text.contains(pat) {
                status = Some(if *pat == "Disconnected from server" || *pat == "Disconnected:" || *pat == "Connection lost" {
                    "disconnected"
                } else {
                    "left"
                });
                break;
            }
        }
        if let Some(status) = status {
            let mut activity = state.activity.lock().unwrap();
            if activity.in_game() {
                activity.status = status.to_string();
                activity.job_id.clear();
                changed = true;
            }
        }
    }

    if changed {
        let settings: Settings = utils::read_json_or_default(&state.settings_path).await;
        emit_activity(app, state);
        crate::services::discord_rpc::update_presence(
            state,
            &settings.integrations.discord_client_id,
            settings.integrations.discord_rpc,
            settings.integrations.discord_show_game,
            settings.integrations.discord_show_elapsed,
            settings.integrations.discord_show_details,
        );
        crate::services::tray::refresh(app);

        let activity = state.activity.lock().unwrap().clone();
        if activity.in_game() && settings.behaviour.auto_close {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        if activity.status == "disconnected" && activity.place_id > 0 && settings.behaviour.auto_rejoin {
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
}

async fn fetch_game_name(http: &reqwest::Client, place_id: u64) -> Option<String> {
    let uni_url = format!("https://apis.roblox.com/universes/v1/places/{place_id}/universe");
    let uni: serde_json::Value = http.get(&uni_url).send().await.ok()?.json().await.ok()?;
    let universe_id = uni.get("universeId")?.as_i64()?;

    let games_url = format!("https://games.roblox.com/v1/games?universeIds={universe_id}");
    let games: serde_json::Value = http.get(&games_url).send().await.ok()?.json().await.ok()?;
    games
        .get("data")?
        .get(0)?
        .get("name")?
        .as_str()
        .map(|s| s.to_string())
}

fn emit_activity(app: &AppHandle, state: &AppState) {
    let activity = state.activity.lock().unwrap().clone();
    let _ = app.emit("activity", activity);
}

async fn watch_process(app: AppHandle) {
    let state = app.state::<AppState>().inner().clone();
    loop {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let running = crate::core::launcher::is_running_async().await;
        let believed = state.roblox_running.load(Ordering::SeqCst);

        if believed && !running {
            state.roblox_running.store(false, Ordering::SeqCst);
            let mut activity = state.activity.lock().unwrap();
            if activity.status != "idle" {
                activity.status = "exited".to_string();
                activity.job_id.clear();
                activity.game_name.clear();
            }
            drop(activity);

            emit_activity(&app, &state);
            crate::services::discord_rpc::clear_presence(&state);
            crate::services::tray::refresh(&app);

            let settings: Settings = utils::read_json_or_default(&state.settings_path).await;
            if settings.behaviour.auto_close {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        } else if running && !believed {
            state.roblox_running.store(true, Ordering::SeqCst);
        }
    }
}
