use serde::{Deserialize, Serialize};

/// Parsed launch parameters from a `roblox://` or `roblox-player://` URI.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LaunchParams {
    pub place_id: Option<u64>,
    pub job_id: Option<String>,
    pub launch_mode: String,
    pub game_info: Option<String>,
    pub place_launcher_url: Option<String>,
    pub browser_tracker_id: Option<String>,
}

/// Parse a Roblox deep-link URI into launch parameters.
pub fn parse(uri: &str) -> LaunchParams {
    let mut params = LaunchParams::default();

    if let Some(body) = uri.strip_prefix("roblox-player://") {
        // roblox-player://<...>+launchmode:play+gameinfo:<ticket>+placelauncherurl:<url>+...
        for part in body.split('+') {
            let (key, value) = part.split_once(':').unwrap_or((part, ""));
            match key.to_ascii_lowercase().as_str() {
                "launchmode" => params.launch_mode = value.to_string(),
                "gameinfo" => params.game_info = Some(value.to_string()),
                "placelauncherurl" => params.place_launcher_url = Some(value.to_string()),
                "browsertrackerid" => params.browser_tracker_id = Some(value.to_string()),
                _ => {}
            }
        }
    } else {
        // roblox://placeId=...&gameInstanceId=... or roblox://experiences/start?placeId=...
        let rest = uri.strip_prefix("roblox://").unwrap_or(uri);
        let query = rest.split('?').next_back().unwrap_or(rest);
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            match key.to_ascii_lowercase().as_str() {
                "placeid" => params.place_id = value.parse().ok(),
                "gameinstanceid" => params.job_id = Some(value.to_string()),
                "launchmode" => params.launch_mode = value.to_string(),
                "browsertrackerid" => params.browser_tracker_id = Some(value.to_string()),
                _ => {}
            }
        }
    }

    params
}

/// Build the RobloxPlayerBeta.exe argument list from parsed parameters.
pub fn build_launch_args(params: &LaunchParams, locale: &str) -> Vec<String> {
    let mut args = Vec::new();

    let mode = if params.launch_mode.is_empty() {
        "play".to_string()
    } else {
        params.launch_mode.clone()
    };
    args.push(format!("--launchmode={mode}"));

    if let Some(ticket) = &params.game_info {
        args.push(format!("--gameinfo={ticket}"));
    }
    if let Some(url) = &params.place_launcher_url {
        args.push(format!("--placelauncherurl={url}"));
    }
    if let Some(tracker) = &params.browser_tracker_id {
        args.push(format!("--browsertrackerid={tracker}"));
    }
    if !locale.is_empty() {
        args.push(format!("--gameLocale={locale}"));
        args.push(format!("--robloxLocale={locale}"));
    }

    args
}
