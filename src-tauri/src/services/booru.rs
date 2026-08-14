use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

use crate::models::{AppStateFile, BooruSlotChoice, Settings};
use crate::state::AppState;
use crate::utils;

const BASE: &str = "https://safebooru.org";
const MAX_IMAGE_BYTES: u64 = 15 * 1024 * 1024; // 15 MB cap
const MAX_CACHE_BYTES: u64 = 200 * 1024 * 1024; // 200 MB LRU cache
const MIN_REQUEST_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BooruPost {
    pub id: u64,
    pub directory: String,
    pub image: String,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    pub tags: String,
    #[serde(default)]
    pub sample: bool,
}

impl BooruPost {
    pub fn file_url(&self) -> String {
        format!("{BASE}/images/{}/{}", self.directory, self.image)
    }
    pub fn sample_url(&self) -> String {
        format!("{BASE}/samples/{}/sample_{}", self.directory, self.image)
    }
    pub fn post_url(&self) -> String {
        post_url(self.id)
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CachedArt {
    pub local_path: String,
    pub post_url: String,
    pub id: u64,
}

pub fn post_url(id: u64) -> String {
    format!("{BASE}/index.php?page=post&s=view&id={id}")
}

/// Percent-encode a tag query, using `+` for spaces (Safebooru/Gelbooru style).
fn encode_tags(tags: &str) -> String {
    let mut out = String::new();
    for ch in tags.chars() {
        match ch {
            ' ' => out.push('+'),
            c if c.is_ascii_alphanumeric() || c == '_' || c == '-' => out.push(c),
            c => {
                for b in c.to_string().as_bytes() {
                    out.push_str(&format!("%{b:02X}"));
                }
            }
        }
    }
    out
}

/// Search Safebooru. Tries `sort:score` first and transparently retries without
/// it (Safebooru may not support the meta-tag). Every API hit is rate-limited.
pub async fn search(state: &AppState, tags: &str, limit: u32, page: u32) -> Result<Vec<BooruPost>, String> {
    let sorted = format!("{tags} sort:score");
    let mut posts = fetch_page(state, &sorted, limit, page).await.unwrap_or_default();
    if posts.is_empty() {
        posts = fetch_page(state, tags, limit, page).await?;
    }
    Ok(posts)
}

async fn rate_limit(state: &AppState) {
    let mut last = state.last_booru_request.lock().await;
    let elapsed = last.elapsed();
    if elapsed < MIN_REQUEST_INTERVAL {
        tokio::time::sleep(MIN_REQUEST_INTERVAL - elapsed).await;
    }
    *last = Instant::now();
}

async fn fetch_page(state: &AppState, tags: &str, limit: u32, page: u32) -> Result<Vec<BooruPost>, String> {
    rate_limit(state).await;

    let url = format!(
        "{BASE}/index.php?page=dapi&s=post&q=index&tags={}&json=1&limit={limit}&pid={page}",
        encode_tags(tags)
    );
    let body = state
        .http
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    if body.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&body).map_err(|e| format!("safebooru parse error: {e}"))
}

fn default_tags(slot: &str) -> &'static str {
    match slot {
        "splash" => "remielle_dan solo",
        "home_banner" => "remielle_dan",
        "sidebar" => "remielle_dan solo",
        _ => "remielle_dan solo",
    }
}

fn is_banner_slot(slot: &str) -> bool {
    slot == "home_banner"
}

/// Ordered fallback queries for a slot. A user override short-circuits the
/// character fallback chain (it's a literal query).
fn query_chain(slot: &str, override_tags: Option<&str>) -> Vec<String> {
    if let Some(t) = override_tags.filter(|t| !t.trim().is_empty()) {
        return vec![t.trim().to_string()];
    }
    match slot {
        "home_banner" => vec![
            "remielle_dan".to_string(),
            "ramiel_(zenless_zone_zero)".to_string(),
            "zenless_zone_zero 1girl solo".to_string(),
        ],
        _ => vec![
            "remielle_dan solo".to_string(),
            "ramiel_(zenless_zone_zero) solo".to_string(),
            "zenless_zone_zero 1girl solo".to_string(),
        ],
    }
}

fn cached_path(state: &AppState, id: u64, image: &str) -> std::path::PathBuf {
    let ext = image.rsplit('.').next().unwrap_or("jpg");
    state.cache_dir.join(format!("{id}.{ext}"))
}

/// Deterministic-ish shuffle without an RNG dependency.
fn pick_index(len: usize) -> usize {
    if len == 0 {
        return 0;
    }
    static S: AtomicU64 = AtomicU64::new(0x9E37_79B9_7F4A_7C15);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64)
        .unwrap_or(0);
    let mut x = S.load(Ordering::Relaxed);
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    x = x.wrapping_add(nanos);
    S.store(x, Ordering::Relaxed);
    (x as usize) % len
}

/// Search + pick + cache in one call, reusing the persisted choice for `slot`
/// across launches until the user shuffles.
pub async fn get_art_for_slot(state: &AppState, slot: &str, shuffle: bool) -> Result<CachedArt, String> {
    let settings: Settings = utils::read_json_or_default(&state.settings_path).await;
    let mut app_state: AppStateFile = utils::read_json_or_default(&state.state_path).await;

    // Serve the persisted choice without a network round-trip when possible.
    if !shuffle {
        if let Some(choice) = app_state.booru_slots.get(slot) {
            let path = cached_path(state, choice.id, &choice.image);
            if path.exists() {
                return Ok(CachedArt {
                    local_path: path.display().to_string(),
                    post_url: post_url(choice.id),
                    id: choice.id,
                });
            }
        }
    }

    let override_tags = settings.appearance.booru_tags.get(slot).map(|s| s.as_str());
    let queries = query_chain(slot, override_tags);

    let mut chosen: Option<BooruPost> = None;
    for q in queries {
        let mut posts = search(state, &q, 20, 0).await?;
        if is_banner_slot(slot) {
            posts.retain(|p| !p.tags.contains("comic") && !p.tags.contains("monochrome"));
        }
        if !posts.is_empty() {
            let idx = pick_index(posts.len());
            chosen = Some(posts.swap_remove(idx));
            break;
        }
    }

    let Some(post) = chosen else {
        return Err(
            "No artwork found for this slot. Remielle Dan is a new character; try again later (art is fetched live from Safebooru)."
                .to_string(),
        );
    };

    let use_sample = slot == "sidebar";
    let local_path = fetch_image(state, &post, use_sample).await?;

    app_state
        .booru_slots
        .insert(slot.to_string(), BooruSlotChoice { id: post.id, image: post.image.clone() });
    let _ = utils::write_json(&state.state_path, &app_state).await;

    Ok(CachedArt {
        local_path,
        post_url: post.post_url(),
        id: post.id,
    })
}

/// Download a post's image into `BooruCache/{id}.{ext}`, skipping when cached
/// and enforcing the 15 MB size cap.
pub async fn fetch_image(state: &AppState, post: &BooruPost, use_sample: bool) -> Result<String, String> {
    tokio::fs::create_dir_all(&state.cache_dir).await.map_err(|e| e.to_string())?;

    let ext = post.image.rsplit('.').next().unwrap_or("jpg");
    let final_path = state.cache_dir.join(format!("{}.{ext}", post.id));
    if final_path.exists() {
        if let Ok(meta) = tokio::fs::metadata(&final_path).await {
            if meta.len() > 0 {
                return Ok(final_path.display().to_string());
            }
        }
    }

    let url = if use_sample && post.sample {
        post.sample_url()
    } else {
        post.file_url()
    };

    let resp = state.http.get(&url).send().await.map_err(|e| e.to_string())?;
    if let Some(total) = resp.content_length() {
        if total > MAX_IMAGE_BYTES {
            return Err("image exceeds the 15 MB cap".to_string());
        }
    }

    let tmp = state.cache_dir.join(format!("{}.part", post.id));
    let mut file = tokio::fs::File::create(&tmp).await.map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut received: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        received += chunk.len() as u64;
        if received > MAX_IMAGE_BYTES {
            drop(file);
            let _ = tokio::fs::remove_file(&tmp).await;
            return Err("image exceeds the 15 MB cap".to_string());
        }
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    tokio::fs::rename(&tmp, &final_path).await.map_err(|e| e.to_string())?;
    evict_cache(&state.cache_dir).await;

    Ok(final_path.display().to_string())
}

/// Remove every cached artwork file.
pub async fn clear_cache(state: &AppState) -> Result<(), String> {
    if state.cache_dir.exists() {
        let mut entries = tokio::fs::read_dir(&state.cache_dir).await.map_err(|e| e.to_string())?;
        while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
            if let Ok(ft) = entry.file_type().await {
                if ft.is_file() {
                    let _ = tokio::fs::remove_file(entry.path()).await;
                }
            }
        }
    }
    Ok(())
}

/// Keep the cache under `MAX_CACHE_BYTES`, evicting least-recently-modified
/// files first.
async fn evict_cache(dir: &Path) {
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    let mut files: Vec<(std::path::PathBuf, u64, Option<SystemTime>)> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        if let Ok(meta) = entry.metadata().await {
            if meta.is_file() {
                let modified = meta.modified().ok();
                files.push((entry.path(), meta.len(), modified));
            }
        }
    }

    let mut total: u64 = files.iter().map(|(_, size, _)| *size).sum();
    if total <= MAX_CACHE_BYTES {
        return;
    }

    files.sort_by_key(|(_, _, modified)| *modified);
    for (path, size, _) in files {
        if total <= MAX_CACHE_BYTES {
            break;
        }
        if tokio::fs::remove_file(&path).await.is_ok() {
            total = total.saturating_sub(size);
        }
    }
}
