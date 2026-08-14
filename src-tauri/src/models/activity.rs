use serde::Serialize;

/// The current Roblox session state, fed by the log activity watcher and
/// consumed by Discord Rich Presence, the tray menu and the frontend.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ActivityInfo {
    /// "idle" | "joining" | "in_game" | "left" | "disconnected" | "exited"
    pub status: String,
    pub job_id: String,
    pub place_id: u64,
    pub game_name: String,
    /// Unix seconds of the join event.
    pub joined_at: i64,
}

impl ActivityInfo {
    pub fn in_game(&self) -> bool {
        self.status == "in_game" || self.status == "joining"
    }
}

pub fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
