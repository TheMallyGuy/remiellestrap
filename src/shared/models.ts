/**
 * Shared domain models for IPC payloads: accounts, servers, Safebooru art,
 * mods, FastFlags, bootstrapper progress, playtime and system information.
 */

import type { ActivityEntry } from './state'
import type {
  AllowlistSeverity,
  CleanerCategory,
  ModTarget,
  ServerSizePreference,
  ServerSortKey,
  WindowEffect
} from './settings'

/**
 * Settings-shaped unions are re-exported here so consumers that already reach
 * for `@shared/models` do not have to import two modules to describe one
 * payload.
 */
export type {
  AllowlistSeverity,
  CleanerCategory,
  LauncherStyle,
  ModTarget,
  ServerSizePreference,
  ServerSortKey,
  WindowEffect
} from './settings'
/* ------------------------------------------------------------------ Booru */

export interface BooruPost {
  id: number
  fileUrl: string
  previewUrl: string
  sampleUrl: string | null
  width: number
  height: number
  tags: string
  rating: string
  score: number
  postUrl: string
}

export interface ArtAsset {
  slot: string
  postId: number
  /** app:// style URL the renderer can render directly from the local cache. */
  url: string
  previewUrl: string | null
  width: number
  height: number
  tags: string
  rating: string
  postUrl: string
  fetchedAt: number
}

export interface BooruSearchRequest {
  tags: string
  page?: number
  limit?: number
}

export interface ArtRequest {
  slot: string
  /** Force a re-roll rather than reusing the persisted post for the slot. */
  shuffle?: boolean
  /** Override the configured tags for this fetch only. */
  tags?: string
}

export interface CacheStats {
  fileCount: number
  totalBytes: number
  directory: string
}

/* --------------------------------------------------------------- Accounts */

export type AccountPresence = 'ingame' | 'online' | 'website' | 'offline' | 'unknown'

/**
 * A stored Roblox account.
 *
 * The cookie never appears in this shape: it lives in the encrypted credential
 * store keyed by `id`. `valid` and `statusMessage` describe the last time the
 * credential was exercised.
 */
export interface RobloxAccount {
  id: string
  userId: number
  username: string
  displayName: string
  avatarUrl: string | null
  description: string | null
  created: string | null
  isPremium: boolean
  presence: AccountPresence
  /** Experience the account is currently in, when it is in one. */
  lastLocation: string | null
  friendsCount: number | null
  followersCount: number | null
  followingCount: number | null
  lastUsed: number
  addedAt: number
  notes: string
  isActive: boolean
  valid: boolean
  statusMessage: string | null
}

export interface AccountState {
  /** False when no OS credential store is available, so accounts cannot persist. */
  secureStorage: boolean
  secureStorageReason: string | null
  accounts: RobloxAccount[]
  activeAccountId: string | null
  backgroundRefreshing: boolean
}

export interface AccountAddRequest {
  cookie: string
  notes?: string
}

export interface AccountBrowserLoginRequest {
  /** Seconds to wait for the user to finish signing in. */
  timeoutSeconds?: number
  /**
   * `login` opens the normal sign-in form; `quick` opens Roblox's Quick Log In
   * page, where a code generated on a phone or another browser can be typed in.
   */
  mode?: 'login' | 'quick'
}

export interface AccountProfileRequest {
  accountId: string
  /** Bypass the cached profile and hit the API again. */
  refresh?: boolean
}

export interface AccountProfile {
  accountId: string
  userId: number
  username: string
  displayName: string
  description: string | null
  avatarUrl: string | null
  created: string | null
  isPremium: boolean
  presence: AccountPresence
  lastOnline: string | null
  friendsCount: number | null
  followersCount: number | null
  followingCount: number | null
  fetchedAt: number
}

export interface AccountFriend {
  userId: number
  username: string
  displayName: string
  avatarUrl: string | null
  presence: AccountPresence
  isOnline: boolean
  isPlaying: boolean
}

/** A game entry returned by search, favourites and continue-playing. */
export interface GameSummary {
  universeId: number
  placeId: number
  name: string
  description: string | null
  creatorName: string | null
  creatorType: string | null
  playerCount: number | null
  visitCount: number | null
  favoriteCount: number | null
  maxPlayers: number | null
  thumbnailUrl: string | null
  updatedAt: number | null
  rootPlaceId: number | null
}

export interface GameSearchRequest {
  query: string
  limit?: number
  /** Search the token instead of the logged-in account. */
  anonymous?: boolean
}

export interface GameDetailsRequest {
  universeId?: number
  placeId?: number
}

export interface GameListRequest {
  accountId: string
  limit?: number
  /** Continue-playing, favourites or recommendations. */
  kind: 'continue-playing' | 'favorites' | 'recommendations'
}

export interface JoinAsRequest {
  accountId?: string | null
  placeId?: string
  universeId?: number
  /** Roblox job id for a specific server. */
  serverId?: string
  /** Private-server access code. */
  accessCode?: string
  /** Skip the confirmation dialog. */
  force?: boolean
}

/* ---------------------------------------------------------------- Servers */

export interface ServerInstance {
  id: string
  placeId: string
  region: string | null
  datacenter: string | null
  ping: number | null
  fps: number | null
  playing: number
  maxPlayers: number
  /** Up to twenty player display names, when the API exposes them. */
  playerTokens: string[]
  uptimeSeconds: number | null
  /** When this app first saw the server, used to derive uptime. */
  firstSeenAt: number
  healthy: boolean
  full: boolean
}

export interface ServerListRequest {
  placeId?: string
  universeId?: number
  sort?: ServerSortKey
  region?: string
  size?: ServerSizePreference
  /** Ignore the cache and hit the API again. */
  refresh?: boolean
  limit?: number
}

export interface ServerListResult {
  placeId: string
  placeName: string | null
  servers: ServerInstance[]
  fetchedAt: number
  cached: boolean
  /** Present when the API was unreachable or rate-limited. */
  error: string | null
  /** True when incomplete results came back because of an error. */
  stale: boolean
}

export interface ServerJoinRequest {
  placeId: string
  serverId?: string
  accountId?: string | null
  /** Pick the best server matching these filters instead of `serverId`. */
  region?: string
  size?: ServerSizePreference
  sort?: ServerSortKey
  force?: boolean
}

export interface ServerJoinResult {
  serverId: string | null
  region: string | null
  ping: number | null
  launched: boolean
  message: string
}

export interface ServerPingSample {
  serverId: string
  ping: number | null
  region: string | null
  datacenter: string | null
  method: 'measured' | 'estimated' | 'none'
  samples: number[]
}

/* ------------------------------------------------------------------- Mods */

export interface ModEntry {
  id: string
  name: string
  enabled: boolean
  priority: number
  fileCount: number
  sizeBytes: number
  path: string
  addedAt: number
  description: string | null
  target: ModTarget
  /** How the mod got here, used by the UI to pick an icon and actions. */
  kind: 'archive' | 'folder' | 'generated' | 'file-replacement' | 'cursor-set' | 'community'
  author: string | null
  version: string | null
  sourceUrl: string | null
  /** Community mod id when the mod came from the community index. */
  communityId: string | null
  /** Relative client paths this mod writes, for conflict detection. */
  provides: string[]
}

export interface ModTargetRequest {
  id: string
  target: ModTarget
}

export interface ColorModRequest {
  name: string
  /** Hex colour such as #101014 applied to the client's UI surfaces. */
  color: string
  /** Optional secondary accent colour. */
  accent?: string
}

/** A client file a user may drop their own replacement into. */
export interface ModFileSlot {
  id: string
  label: string
  description: string
  /** Path inside the Roblox version directory. */
  relative: string
  extensions: string[]
  kind: 'image' | 'audio' | 'font'
}

/** Which parts of the client the rich generator touches. */
export interface RichModTargets {
  uiSurfaces: boolean
  cursor: boolean
  shiftLock: boolean
  emoteWheel: boolean
  voiceChat: boolean
}

export interface RichModRequest {
  name: string
  /** Base colour, hex. */
  color: string
  /** Accent colour, hex. */
  accent: string
  /** When set, the generated textures are a vertical gradient to this colour. */
  gradientTo: string | null
  targets: RichModTargets
  target: ModTarget
  /** Optional images the user supplied for the cursor / shift lock slots. */
  cursorImage: string | null
  shiftLockImage: string | null
}

export interface FileReplacementRequest {
  /** A `MOD_FILE_SLOTS` id. */
  slot: string
  name?: string
  target: ModTarget
}

export interface FileReplacementResult {
  slot: string
  mod: ModEntry
  /** Client path the file will land at. */
  relativePath: string
}

export interface CursorSetRequest {
  name: string
  /** Files chosen for each cursor role. */
  cursor: string
  farCursor?: string
  target: ModTarget
}

export interface CommunityMod {
  id: string
  name: string
  author: string
  description: string
  version: string
  /** Direct download URL for the mod archive. */
  url: string
  sha256: string | null
  sizeBytes: number | null
  previewUrl: string | null
  tags: string[]
  target: ModTarget
  updatedAt: number | null
}

export interface CommunityIndex {
  source: string
  fetchedAt: number
  mods: CommunityMod[]
  error: string | null
  cached: boolean
}

export interface CommunityInstallRequest {
  ids: string[]
  target?: ModTarget
}

export interface ModConflict {
  relativePath: string
  /** Mod ids that write this path, in priority order. */
  modIds: string[]
}

/* -------------------------------------------------------------- FastFlags */

export type FlagValue = string | number | boolean

export interface FlagProfile {
  name: string
  flags: Record<string, FlagValue>
  isActive: boolean
  flagCount: number
}

export interface SaveProfileRequest {
  name: string
  flags: Record<string, FlagValue>
  setActive?: boolean
}

export type FlagRisk = 'safe' | 'caution' | 'advanced'
export type FlagKind = 'boolean' | 'number' | 'string'

/** One entry of the FastFlag allowlist. */
export interface FlagAllowlistEntry {
  name: string
  category: string
  description: string
  kind: FlagKind
  /** Value the client ships with, when it is known. */
  defaultValue: FlagValue | null
  min: number | null
  max: number | null
  /** Enumerated values, for flags that are really a switch. */
  options: FlagValue[]
  risk: FlagRisk
  /** Ids of presets that include this flag. */
  presets: string[]
}

export interface FlagAllowlist {
  entries: FlagAllowlistEntry[]
  updatedAt: number
  source: 'builtin' | 'remote' | 'cache'
  url: string
  error: string | null
}

export interface FlagAllowlistRequest {
  /** Re-fetch from the configured URL. */
  refresh?: boolean
}

export interface FlagAudit {
  profile: string
  total: number
  allowed: number
  unknown: string[]
  severity: AllowlistSeverity
}

export interface FlagCleanResult {
  profile: string
  removed: string[]
  kept: number
}

export interface FlagPreset {
  id: string
  name: string
  description: string
  /** Category the preset belongs to, mirroring the allowlist groups. */
  category: string
  flags: Record<string, FlagValue>
  risk: FlagRisk
}

export interface FlagPresetApplyRequest {
  presetId: string
  profile?: string
  /** Remove flags the preset owns before applying, instead of merging. */
  replace?: boolean
}

/* --------------------------------------------------------- Bootstrapper */

export type BootstrapperStage =
  | 'idle'
  | 'connecting'
  | 'checking'
  | 'downloading'
  | 'extracting'
  | 'configuring'
  | 'applying-mods'
  | 'writing-flags'
  | 'launching'
  | 'running'
  | 'cancelled'
  | 'done'
  | 'error'

export interface BootstrapperProgress {
  stage: BootstrapperStage
  /** 0..1, or null when the stage is indeterminate. */
  progress: number | null
  message: string
  detail?: string
  bytesDownloaded?: number
  bytesTotal?: number
  currentPackage?: string
  packagesDone?: number
  packagesTotal?: number
  version?: string | null
  cancellable: boolean
}

export interface BootstrapperResult {
  ok: boolean
  version: string | null
  launched: boolean
  message: string
}

export interface UpdateCheckResult {
  installedVersion: string | null
  latestVersion: string | null
  channel: string
  upToDate: boolean
  installed: boolean
  clientVersion: string | null
  checkedAt: number
  /** Null when the deployment endpoints could not be reached. */
  error: string | null
}

export type AppUpdateStatus =
  | 'not-supported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'up-to-date'
  | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  currentVersion: string
  latestVersion: string | null
  /** 0..1, or null while indeterminate. */
  progress: number | null
  bytesPerSecond: number
  bytesDownloaded: number
  bytesTotal: number
  releaseName: string | null
  releaseNotes: string | null
  releaseUrl: string | null
  checkedAt: number | null
  error: string | null
}

export interface LaunchRequest {
  /** Raw roblox:// or roblox-player: URI. */
  uri?: string
  mode?: 'player' | 'studio'
  /** Skip the confirmation dialog even when confirmLaunches is on. */
  force?: boolean
  /** Account to authenticate as; falls back to the active account. */
  accountId?: string | null
}

/* ------------------------------------------------------- Channels/versions */

export interface ChannelInfo {
  name: string
  /** Latest player version on this channel, or null when unavailable. */
  playerVersion: string | null
  studioVersion: string | null
  /** Latest player client version string, e.g. "0.641.0.6410810". */
  playerClientVersion: string | null
  /** True when this is the channel currently configured. */
  isCurrent: boolean
  /** True when the install on disk matches this channel. */
  isInstalled: boolean
  error: string | null
}

export interface InstalledVersion {
  id: string
  versionHash: string
  appType: 'player' | 'studio'
  channel: string
  installedAt: string
  sizeBytes: number
  fileCount: number
  isCurrent: boolean
  path: string
  executable: string | null
  missing: boolean
}

export interface VersionActionRequest {
  /** Version folder name, e.g. version-824aa25849794d67. */
  versionHash: string
  appType?: 'player' | 'studio'
}

/* ---------------------------------------------------------------- Cleaner */

export interface CleanerTarget {
  id: CleanerCategory
  label: string
  description: string
  path: string | null
  exists: boolean
  fileCount: number
  bytes: number
  safe: boolean
}

export interface CleanerScan {
  scannedAt: number
  targets: CleanerTarget[]
  totalBytes: number
  totalFiles: number
}

export interface CleanerRunRequest {
  targets: CleanerCategory[]
  /** Count what would be removed without deleting anything. */
  dryRun?: boolean
}

export interface CleanerResult {
  dryRun: boolean
  removedFiles: number
  freedBytes: number
  targets: { id: CleanerCategory; fileCount: number; bytes: number }[]
  errors: string[]
  ranAt: number
}

export interface CleanerHistoryEntry extends CleanerResult {
  trigger: 'manual' | 'launch' | 'scheduled'
}

/* ------------------------------------------------------------------ Logs */

export interface LogFileInfo {
  name: string
  path: string
  size: number
  modifiedAt: number
  kind: 'roblox' | 'strap'
}

export interface LogLine {
  at: number | null
  level: string | null
  scope: string | null
  text: string
}

export interface LogReadRequest {
  path?: string
  /** Defaults to the tail of the file. */
  tailLines?: number
  filter?: string
  /** Follow the file and push new lines over `logs:line`. */
  follow?: boolean
}

export interface LogReadResult {
  file: LogFileInfo | null
  lines: LogLine[]
  error: string | null
}

/** A parsed event from a Roblox client log. */
export interface ClientLogEvent {
  kind: 'join' | 'leave' | 'chat' | 'player' | 'error' | 'info'
  at: number
  text: string
  placeId: string | null
  jobId: string | null
  player: string | null
}

/* --------------------------------------------------------- Client settings */

export interface ClientSettingOption {
  value: number | string
  label: string
}

export interface ClientSettingField {
  key: string
  label: string
  description: string
  group: string
  kind: 'boolean' | 'number' | 'select'
  min: number | null
  max: number | null
  step: number | null
  options: ClientSettingOption[]
}

export interface ClientSettingsState {
  /** False when GlobalBasicSettings is not present on this machine. */
  present: boolean
  path: string | null
  values: Record<string, unknown>
  fields: ClientSettingField[]
  /** File contents summary, e.g. the raw XML size. */
  sizeBytes: number
  error: string | null
  readOnly: boolean
}

export interface ClientSettingsPatch {
  values: Record<string, unknown>
}

/* -------------------------------------------------------------- Shortcuts */

export interface ShortcutRequest {
  name: string
  placeId: string
  accountId?: string | null
  region?: string | null
  locations: ('desktop' | 'start-menu')[]
}

export interface ShortcutResult {
  created: string[]
  errors: string[]
}

/* --------------------------------------------------------------- Backup */

export interface BackupRequest {
  includeSettings: boolean
  includeAccounts: boolean
  includeMods: boolean
  includeFlags: boolean
  includePlaytime: boolean
  /** Passphrase used to encrypt the account cookies inside the archive. */
  password: string
}

export interface BackupResult {
  path: string
  bytes: number
  sections: string[]
}

export interface BackupImportResult {
  settings: boolean
  accounts: number
  mods: number
  flagProfiles: string[]
  skipped: string[]
}

/* -------------------------------------------------- Launcher / appearance */

export interface LauncherDefinition {
  name: string
  title: string
  width: number
  height: number
  background: string
  textColor: string
  accent: string
  /** 'bar' | 'spinner' | 'dots' */
  progress: 'bar' | 'spinner' | 'dots'
  showArt: boolean
  /** Optional CSS appended to the bootstrapper window. */
  customCss: string
  messages: Record<string, string>
}

export interface WindowEffectState {
  requested: WindowEffect
  applied: WindowEffect
  supported: WindowEffect[]
  platform: NodeJS.Platform
  reason: string | null
}

export interface FontCatalog {
  families: string[]
  userFonts: { family: string; path: string }[]
  /** Absolute path of the font file currently loaded, if any. */
  activeFontFile: string | null
}

/* ---------------------------------------------------------- Studio bridge */

/** A report posted by the companion Studio plugin. */
export interface StudioBridgeReport {
  placeName: string
  placeId: string | null
  placeVersion: number | null
  studioVersion: string | null
  /** False while the plugin is in a play-test rather than the editor. */
  authoring: boolean
  /** Script the user is editing, when the plugin reports one. */
  scriptName: string | null
  lineCount: number | null
  at: number
}

export interface StudioBridgeInfo {
  enabled: boolean
  port: number
  /** True when the bridge is listening on 127.0.0.1:port. */
  listening: boolean
  pluginInstalled: boolean
  pluginPath: string | null
  lastReportAt: number | null
  placeName: string | null
  placeId: string | null
  scriptName: string | null
  lineCount: number | null
}

/* ------------------------------------------------------------ Other straps */

export type StrapId = 'bloxstrap' | 'fishstrap' | 'froststrap' | 'remiellestrap'

export interface StrapDetection {
  id: StrapId
  name: string
  detected: boolean
  settingsFile: string | null
  modsFolder: string | null
  versionsFolder: string | null
  detail: string | null
}

export interface StrapImportRequest {
  id: StrapId
  settings: boolean
  flagProfiles: boolean
  mods: boolean
}

export interface StrapImportResult {
  settingsApplied: string[]
  flagProfiles: string[]
  modsImported: number
  skipped: string[]
}

/* ------------------------------------------------------------- PC tweaks */

export interface ProcessTweakState {
  running: boolean
  pid: number | null
  priority: string | null
  affinity: number[] | null
  workingSetBytes: number | null
  cpuCount: number
}

export interface ProcessTweakRequest {
  priority?: 'normal' | 'abovenormal' | 'high'
  affinity?: number[] | null
  /** Trim the working set once, immediately. */
  trim?: boolean
}

export interface PowerPlan {
  guid: string
  name: string
  active: boolean
}

/* ------------------------------------------------------------- Activity */

export interface ActivityUpdate {
  activity: ActivityEntry | null
  inGame: boolean
  robloxRunning: boolean
}

export interface RpcUpdate {
  connected: boolean
  details: string | null
  state: string | null
  largeImage: string | null
  since: number | null
}

export interface PlaytimeGame {
  placeId: string
  name: string
  thumbnailUrl: string | null
  totalMs: number
  sessions: number
  lastPlayedAt: number
}

export interface PlaytimeSummary {
  totalMs: number
  sessions: number
  firstLaunchAt: number | null
  games: PlaytimeGame[]
  currentSessionMs: number | null
}

/* --------------------------------------------------------------- System */

export interface SystemInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: NodeJS.Platform
  arch: string
  osRelease: string
  isWindows: boolean
  paths: {
    appData: string
    logs: string
    mods: string
    cache: string
    versions: string
    downloads: string
  }
  robloxSupported: boolean
}

export interface ToastPayload {
  id?: string
  kind: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  timeout?: number
}

export interface OperationResult<T = void> {
  ok: boolean
  error?: string
  data?: T
}

export interface RobloxExitPayload {
  code: number | null
  version: string | null
  playtimeMs: number
}
