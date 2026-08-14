import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as shellOpen } from "@tauri-apps/plugin-shell";
import { open as dialogOpen, save as dialogSave } from "@tauri-apps/plugin-dialog";
import { exit, relaunch } from "@tauri-apps/plugin-process";
import type {
  AppInfo,
  AppState,
  BootstrapProgress,
  BootstrapStatus,
  BooruPost,
  CachedArt,
  ClientVersion,
  DeeplinkPayload,
  ModInfo,
  PathsInfo,
  RobloxState,
  Settings,
  ActivityInfo,
} from "$lib/types";

export { convertFileSrc };

/* ── invoke wrappers ── */

export const api = {
  // booru
  booru_search: (tags: string, limit: number, page: number) =>
    invoke<BooruPost[]>("booru_search", { tags, limit, page }),
  booru_fetch_image: (post: BooruPost, use_sample: boolean) =>
    invoke<string>("booru_fetch_image", { post, useSample: use_sample }),
  booru_get_art_for_slot: (slot: string, shuffle: boolean) =>
    invoke<CachedArt>("booru_get_art_for_slot", { slot, shuffle }),
  booru_clear_cache: () => invoke<void>("booru_clear_cache"),

  // settings / state
  settings_get: () => invoke<Settings>("settings_get"),
  settings_update: (settings: Settings) =>
    invoke<void>("settings_update", { settings }),
  settings_reset: () => invoke<Settings>("settings_reset"),
  settings_export: (path: string) => invoke<void>("settings_export", { path }),
  settings_import: (path: string) => invoke<Settings>("settings_import", { path }),
  app_state_get: () => invoke<AppState>("app_state_get"),
  app_state_update: (state: AppState) =>
    invoke<void>("app_state_update", { state }),
  roblox_state_get: () => invoke<RobloxState>("roblox_state_get"),

  // bootstrap / launch
  bootstrap_start: (uri: string | null, force: boolean) =>
    invoke<void>("bootstrap_start", { uri, force }),
  bootstrap_cancel: () => invoke<void>("bootstrap_cancel"),
  bootstrap_status: () => invoke<BootstrapStatus>("bootstrap_status"),
  launch_roblox: (uri: string | null) => invoke<void>("launch_roblox", { uri }),
  check_version: (channel: string) =>
    invoke<ClientVersion>("check_version", { channel }),

  // mods
  mods_list: () => invoke<ModInfo[]>("mods_list"),
  mods_set_enabled: (name: string, enabled: boolean) =>
    invoke<void>("mods_set_enabled", { name, enabled }),
  mods_reorder: (names: string[]) => invoke<void>("mods_reorder", { names }),
  mods_delete: (name: string) => invoke<void>("mods_delete", { name }),
  mods_import: (path: string) => invoke<void>("mods_import", { path }),
  mods_open_folder: () => invoke<void>("mods_open_folder"),
  mods_apply: () => invoke<void>("mods_apply"),

  // fastflags
  fastflags_export: (path: string) => invoke<void>("fastflags_export", { path }),
  fastflags_import: (path: string) =>
    invoke<Settings>("fastflags_import", { path }),

  // integrations
  integrations_test_discord: () => invoke<boolean>("integrations_test_discord"),

  // install
  install_uninstall: () => invoke<void>("install_uninstall"),
  install_force_reinstall: () => invoke<void>("install_force_reinstall"),

  // misc
  get_paths: () => invoke<PathsInfo>("get_paths"),
  open_path: (path: string) => invoke<void>("open_path", { path }),
  open_url: (url: string) => invoke<void>("open_url", { url }),
  app_get_info: () => invoke<AppInfo>("app_get_info"),
  deeplink_pending: () => invoke<string[] | null>("deeplink_pending"),
  app_exit: () => exit(0),
  restart_app: () => relaunch(),
};

/* ── event listeners ── */

export function onBootstrapProgress(
  cb: (p: BootstrapProgress) => void,
): Promise<UnlistenFn> {
  return listen<BootstrapProgress>("bootstrap-progress", (e) => cb(e.payload));
}

export function onBootstrapStatus(
  cb: (s: BootstrapStatus) => void,
): Promise<UnlistenFn> {
  return listen<BootstrapStatus>("bootstrap-status", (e) => cb(e.payload));
}

export function onActivity(cb: (a: ActivityInfo) => void): Promise<UnlistenFn> {
  return listen<ActivityInfo>("activity", (e) => cb(e.payload));
}

export function onDeeplink(cb: (urls: string[]) => void): Promise<UnlistenFn> {
  return listen<DeeplinkPayload>("deeplink", (e) => cb(e.payload.urls));
}

/* ── convenience (thin wrappers around plugins) ── */

export function openInBrowser(url: string) {
  return shellOpen(url);
}

export async function pickFolder(title = "Choose a folder"): Promise<string | null> {
  const sel = await dialogOpen({ directory: true, multiple: false, title });
  if (typeof sel === "string") return sel;
  return sel?.[0] ?? null;
}

export async function pickZip(title = "Choose a mod zip"): Promise<string | null> {
  const sel = await dialogOpen({
    multiple: false,
    title,
    filters: [{ name: "Zip archive", extensions: ["zip"] }],
  });
  if (typeof sel === "string") return sel;
  return sel?.[0] ?? null;
}

export async function pickSaveFile(
  title: string,
  defaultPath: string,
): Promise<string | null> {
  return dialogSave({ title, defaultPath });
}

export async function pickJson(title = "Choose a JSON file"): Promise<string | null> {
  const sel = await dialogOpen({
    multiple: false,
    title,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (typeof sel === "string") return sel;
  return sel?.[0] ?? null;
}
