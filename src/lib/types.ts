// ═══════════════════════════════════════════════════════════════
// TypeScript mirrors of the Rust (serde) models. Field names are
// snake_case to match serde's default serialization.
// ═══════════════════════════════════════════════════════════════

/* ── Settings ── */
export type BootstrapStyle = "curtain_call" | "minimal" | "classic";
export type AccentId = "voidflare" | "lumen" | "aurora";

export type FlagValue =
  | { type: "bool"; value: boolean }
  | { type: "number"; value: number }
  | { type: "string"; value: string };

export interface FlagEntry {
  key: string;
  value: FlagValue;
}

export interface FlagProfile {
  name: string;
  flags: FlagEntry[];
}

export interface AppearanceSettings {
  accent: AccentId;
  bootstrap_style: BootstrapStyle;
  /** slot name -> custom tag override (empty string = use default) */
  booru_tags: Record<string, string>;
}

export interface BehaviourSettings {
  channel: string;
  multi_instance: boolean;
  auto_close: boolean;
  confirm_launch: boolean;
  force_language: string;
  auto_rejoin: boolean;
}

export interface IntegrationsSettings {
  discord_rpc: boolean;
  discord_client_id: string;
  discord_show_game: boolean;
  discord_show_elapsed: boolean;
  discord_show_details: boolean;
}

export interface FastFlagsSettings {
  profiles: FlagProfile[];
  active_profile: string;
}

export interface ModsSettings {
  /** ordered mod folder names (priority order) */
  enabled: string[];
}

export interface InstallationSettings {
  /** override for %LOCALAPPDATA%\Roblox\Versions (empty = default) */
  versions_dir: string;
  /** override for the package download cache (empty = default) */
  downloads_dir: string;
}

export interface Settings {
  appearance: AppearanceSettings;
  behaviour: BehaviourSettings;
  integrations: IntegrationsSettings;
  fast_flags: FastFlagsSettings;
  mods: ModsSettings;
  installation: InstallationSettings;
}

/* ── Booru ── */
export interface BooruPost {
  id: number;
  directory: string;
  image: string;
  width: number;
  height: number;
  tags: string;
  sample: boolean;
}

export interface CachedArt {
  local_path: string;
  post_url: string;
  id: number;
}

/* ── App state (State.json) ── */
export interface WindowState {
  width: number;
  height: number;
  x: number;
  y: number;
  maximized: boolean;
  sidebar_collapsed: boolean;
}

export interface BooruSlotChoice {
  id: number;
  image: string;
}

export interface LastPlayed {
  place_id: number;
  job_id: string;
  name: string;
  at: number;
}

export interface AppState {
  window: WindowState;
  booru_slots: Record<string, BooruSlotChoice>;
  last_played: LastPlayed | null;
}

/* ── Roblox state ── */
export interface RobloxState {
  installed_guid: string | null;
  channel: string;
  packages: Record<string, string>;
}

/* ── Activity / Discord ── */
export type ActivityStatus =
  | "idle"
  | "joining"
  | "in_game"
  | "left"
  | "disconnected"
  | "exited";

export interface ActivityInfo {
  status: ActivityStatus;
  job_id: string;
  place_id: number;
  game_name: string;
  joined_at: number;
}

/* ── Bootstrap ── */
export interface BootstrapProgress {
  stage: string;
  package: string | null;
  pkg_progress: number;
  total_progress: number;
  bytes_per_sec: number;
  detail: string | null;
}

export interface BootstrapStatus {
  state: "idle" | "working" | "done" | "error" | "cancelled";
  message: string;
}

/* ── Mods ── */
export interface ModInfo {
  name: string;
  path: string;
  file_count: number;
  enabled: boolean;
}

/* ── Misc ── */
export interface PathsInfo {
  data_dir: string;
  cache_dir: string;
  mods_dir: string;
  downloads_dir: string;
  logs_dir: string;
  versions_dir: string;
}

export interface ClientVersion {
  version: string;
  client_version_upload: string;
  bootstrapper_version: string;
}

export interface AppInfo {
  name: string;
  version: string;
}

/** Payload for the `deeplink` event forwarded from Rust. */
export interface DeeplinkPayload {
  urls: string[];
}
