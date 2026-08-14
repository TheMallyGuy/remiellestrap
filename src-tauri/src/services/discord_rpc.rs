use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};

use crate::state::AppState;

/// Push the current activity to Discord Rich Presence, (re)connecting lazily.
/// All options are read from settings and passed in so this module stays
/// decoupled from persistence.
pub fn update_presence(
    state: &AppState,
    client_id: &str,
    enabled: bool,
    show_game: bool,
    show_elapsed: bool,
    show_details: bool,
) {
    let mut guard = match state.discord.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    if !enabled {
        if let Some(client) = guard.as_mut() {
            let _ = client.clear_activity();
        }
        return;
    }

    if guard.is_none() {
        let mut client = DiscordIpcClient::new(client_id);
        match client.connect() {
            Ok(()) => *guard = Some(client),
            Err(_) => return,
        }
    }

    let activity = state.activity.lock().unwrap().clone();
    let Some(client) = guard.as_mut() else {
        return;
    };

    if activity.in_game() {
        let mut payload = activity::Activity::new()
            .activity_type(activity::ActivityType::Playing);

        if show_details {
            payload = payload.details("Roblox");
        }
        if show_game {
            let name = if activity.game_name.is_empty() {
                "Roblox".to_string()
            } else {
                activity.game_name.clone()
            };
            payload = payload.state(&name);
        }
        if show_elapsed && activity.joined_at > 0 {
            payload = payload.timestamps(activity::Timestamps::new().start(activity.joined_at));
        }

        let _ = client.set_activity(payload);
    } else {
        let _ = client.clear_activity();
    }
}

/// Clear the presence without touching the connection.
pub fn clear_presence(state: &AppState) {
    if let Ok(mut guard) = state.discord.lock() {
        if let Some(client) = guard.as_mut() {
            let _ = client.clear_activity();
        }
    }
}

/// Connect and push a test presence. Returns whether Discord was reachable.
pub fn test_connection(client_id: &str) -> bool {
    let mut client = DiscordIpcClient::new(client_id);
    if client.connect().is_err() {
        return false;
    }
    let ok = client
        .set_activity(
            activity::Activity::new()
                .details("RemielleStrap")
                .state("Testing rich presence"),
        )
        .is_ok();
    let _ = client.close();
    ok
}
