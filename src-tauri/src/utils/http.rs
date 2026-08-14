use std::time::Duration;

pub const USER_AGENT: &str = "RemielleStrap/1.0 (github.com/you/remiellestrap)";

/// Build the shared HTTP client: 10s timeout and a proper User-Agent.
pub fn build_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(10))
        .build()
}
