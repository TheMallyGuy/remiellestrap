use tauri::State;

use crate::services::booru::{self, BooruPost, CachedArt};
use crate::state::AppState;

#[tauri::command]
pub async fn booru_search(
    state: State<'_, AppState>,
    tags: String,
    limit: u32,
    page: u32,
) -> Result<Vec<BooruPost>, String> {
    booru::search(state.inner(), &tags, limit, page).await
}

#[tauri::command]
pub async fn booru_fetch_image(
    state: State<'_, AppState>,
    post: BooruPost,
    use_sample: bool,
) -> Result<String, String> {
    booru::fetch_image(state.inner(), &post, use_sample).await
}

#[tauri::command]
pub async fn booru_get_art_for_slot(
    state: State<'_, AppState>,
    slot: String,
    shuffle: bool,
) -> Result<CachedArt, String> {
    booru::get_art_for_slot(state.inner(), &slot, shuffle).await
}

#[tauri::command]
pub async fn booru_clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    booru::clear_cache(state.inner()).await
}
