/**
 * Shared domain models for IPC payloads: Safebooru art, mods, FastFlags,
 * bootstrapper progress and system information.
 */

import type { ActivityEntry } from './state'

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
}

export interface ColorModRequest {
  name: string
  /** Hex colour such as #101014 applied to the client's UI surfaces. */
  color: string
  /** Optional secondary accent colour. */
  accent?: string
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
