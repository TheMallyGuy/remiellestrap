/**
 * Persisted runtime state models. Mirrors Bloxstrap's State.json /
 * RobloxState.json split: volatile app state vs. Roblox install bookkeeping.
 */

export interface ActivityEntry {
  placeId: string
  universeId: string | null
  jobId: string | null
  gameName: string | null
  gameThumbnailUrl: string | null
  serverType: ServerType
  machineAddress: string | null
  /** Private-server link code, when the server was joined via an access code. */
  accessCode: string | null
  isTeleport: boolean
  joinedAt: number
  leftAt: number | null
}

export type ServerType = 'public' | 'private' | 'reserved'

export interface AppState {
  lastAppVersion: string | null
  lastLaunchAt: number | null
  totalLaunches: number
  lastActivity: ActivityEntry | null
  recentActivity: ActivityEntry[]
  booruCache: Record<string, CachedArt>
  dismissedNotices: string[]
}

export interface CachedArt {
  slot: string
  postId: number
  fileName: string
  previewFileName: string | null
  width: number
  height: number
  tags: string
  rating: string
  sourceUrl: string
  postUrl: string
  fetchedAt: number
}

export const DEFAULT_APP_STATE: AppState = {
  lastAppVersion: null,
  lastLaunchAt: null,
  totalLaunches: 0,
  lastActivity: null,
  recentActivity: [],
  booruCache: {},
  dismissedNotices: []
}

export interface RobloxState {
  /** Version GUID currently installed, e.g. version-824aa25849794d67. */
  installedVersion: string | null
  installedChannel: string | null
  installedAt: number | null
  /** Package name -> md5 signature that was extracted, for incremental updates. */
  packageSignatures: Record<string, string>
  installPath: string | null
  lastUpdateCheck: number | null
  modManifest: string[]
}

export const DEFAULT_ROBLOX_STATE: RobloxState = {
  installedVersion: null,
  installedChannel: null,
  installedAt: null,
  packageSignatures: {},
  installPath: null,
  lastUpdateCheck: null,
  modManifest: []
}
