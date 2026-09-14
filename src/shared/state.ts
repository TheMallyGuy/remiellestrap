/**
 * Persisted runtime state models. Mirrors Bloxstrap's State.json /
 * RobloxState.json split: volatile app state vs. Roblox install bookkeeping.
 */

import type { CleanerHistoryEntry, PlaytimeGame } from './models'
import type { CleanerCategory } from './settings'

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

export interface PlaytimeStats {
  /** Lifetime playtime across every recorded session. */
  totalMs: number
  sessions: number
  firstLaunchAt: number | null
  /** Keyed by place id. */
  games: Record<string, PlaytimeGame>
  /** Set while a session is in flight so a crash does not lose the time. */
  openSessionStartedAt: number | null
  openSessionPlaceId: string | null
}

export const DEFAULT_PLAYTIME: PlaytimeStats = {
  totalMs: 0,
  sessions: 0,
  firstLaunchAt: null,
  games: {},
  openSessionStartedAt: null,
  openSessionPlaceId: null
}

/** Persisted UI bookkeeping so the app reopens where it was left. */
export interface UiState {
  /** Ids of sections the user expanded, e.g. "fastflags:advanced". */
  openSections: string[]
  /** Selected tab per page, keyed by page id. */
  tabs: Record<string, string>
  /** Free-form per-page scroll offsets. */
  scroll: Record<string, number>
}

export const DEFAULT_UI_STATE: UiState = {
  openSections: [],
  tabs: {},
  scroll: {}
}

export interface AppState {
  lastAppVersion: string | null
  lastLaunchAt: number | null
  totalLaunches: number
  lastActivity: ActivityEntry | null
  recentActivity: ActivityEntry[]
  booruCache: Record<string, CachedArt>
  dismissedNotices: string[]
  /** Cleared once the first-run tour has been seen. */
  onboardingComplete: boolean
  playtime: PlaytimeStats
  ui: UiState
  cleanerHistory: CleanerHistoryEntry[]
  /** Last cleaner run, used to decide whether a scheduled run is due. */
  lastCleanerRunAt: number | null
  /** When each Roblox server (by job id) was first seen, for uptime. */
  serverFirstSeen: Record<string, number>
  /** Rating/self-reported notices the user has already accepted. */
  acceptedWarnings: string[]
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
  dismissedNotices: [],
  onboardingComplete: false,
  playtime: { ...DEFAULT_PLAYTIME },
  ui: { ...DEFAULT_UI_STATE },
  cleanerHistory: [],
  lastCleanerRunAt: null,
  serverFirstSeen: {},
  acceptedWarnings: []
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
  /** Fixed-folder installs record the real GUID here for update checks. */
  fixedFolderVersion: string | null
  /** Last cleaner categories the user chose, remembered between runs. */
  lastCleanerTargets: CleanerCategory[]
}

export const DEFAULT_ROBLOX_STATE: RobloxState = {
  installedVersion: null,
  installedChannel: null,
  installedAt: null,
  packageSignatures: {},
  installPath: null,
  lastUpdateCheck: null,
  modManifest: [],
  fixedFolderVersion: null,
  lastCleanerTargets: []
}

/* ------------------------------------------------------------- Accounts */

/**
 * Accounts.json holds everything about a stored account *except* its cookie.
 * The cookie is written to the encrypted credential store as
 * `<appdata>/Credentials/<id>.bin`, so the plaintext never touches this file.
 */
export interface AccountRecord {
  id: string
  userId: number
  username: string
  displayName: string
  avatarUrl: string | null
  description: string | null
  created: string | null
  isPremium: boolean
  friendsCount: number | null
  followersCount: number | null
  followingCount: number | null
  addedAt: number
  lastUsed: number
  lastVerifiedAt: number
  valid: boolean
  statusMessage: string | null
  notes: string
}

export interface AccountsFile {
  accounts: AccountRecord[]
  activeAccountId: string | null
  /** True when the credential files are safeStorage-encrypted. */
  encrypted: boolean
}

export const DEFAULT_ACCOUNTS: AccountsFile = {
  accounts: [],
  activeAccountId: null,
  encrypted: true
}

/* -------------------------------------------------------------- Servers */

export interface ServerCacheEntry {
  placeId: string
  servers: import('./models').ServerInstance[]
  fetchedAt: number
  error: string | null
}

/**
 * ServerCache.json — deliberately short lived. Servers churn constantly, so
 * anything older than `serverCacheSeconds` is refetched rather than served.
 */
export interface ServerCacheFile {
  entries: Record<string, ServerCacheEntry>
  /** Datacenter code -> region id, learned from the region API. */
  regions: Record<string, string>
}
