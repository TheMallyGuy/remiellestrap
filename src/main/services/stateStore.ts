import {
  DEFAULT_APP_STATE,
  DEFAULT_ROBLOX_STATE,
  type ActivityEntry,
  type AppState,
  type CachedArt,
  type RobloxState
} from '@shared/state'
import { paths } from '../utils/paths'
import { ensureDir, readJson, writeJson } from '../utils/fs'
import { createLogger } from '../utils/logger'

const logger = createLogger('StateStore')

const MAX_RECENT_ACTIVITY = 25

/**
 * Owns State.json (app/session bookkeeping) and RobloxState.json (install
 * bookkeeping). Both are written atomically and tolerate corruption by
 * falling back to defaults rather than throwing during startup.
 */

let appState: AppState | null = null
let robloxState: RobloxState | null = null

export async function loadState(): Promise<AppState> {
  if (appState) return appState
  await ensureDir(paths.root)
  const raw = await readJson<Partial<AppState>>(paths.stateFile, {})

  appState = {
    ...DEFAULT_APP_STATE,
    ...raw,
    recentActivity: Array.isArray(raw.recentActivity)
      ? raw.recentActivity.slice(0, MAX_RECENT_ACTIVITY)
      : [],
    booruCache: typeof raw.booruCache === 'object' && raw.booruCache !== null ? raw.booruCache : {},
    dismissedNotices: Array.isArray(raw.dismissedNotices) ? raw.dismissedNotices : []
  }
  return appState
}

export function getState(): AppState {
  return appState ?? { ...DEFAULT_APP_STATE }
}

export async function saveState(patch: Partial<AppState>): Promise<AppState> {
  const current = await loadState()
  appState = { ...current, ...patch }
  try {
    await writeJson(paths.stateFile, appState)
  } catch (error) {
    logger.error(`Failed to write State.json: ${String(error)}`)
  }
  return appState
}

export async function recordActivity(entry: ActivityEntry): Promise<void> {
  const current = await loadState()
  const recent = [
    entry,
    ...current.recentActivity.filter((item) => item.jobId !== entry.jobId)
  ].slice(0, MAX_RECENT_ACTIVITY)
  await saveState({ lastActivity: entry, recentActivity: recent })
}

export async function updateLastActivity(patch: Partial<ActivityEntry>): Promise<void> {
  const current = await loadState()
  if (!current.lastActivity) return
  const updated: ActivityEntry = { ...current.lastActivity, ...patch }
  const recent = current.recentActivity.map((item) =>
    item.jobId === updated.jobId && item.joinedAt === updated.joinedAt ? updated : item
  )
  await saveState({ lastActivity: updated, recentActivity: recent })
}

export async function setCachedArt(slot: string, art: CachedArt | null): Promise<void> {
  const current = await loadState()
  const cache = { ...current.booruCache }
  if (art) cache[slot] = art
  else delete cache[slot]
  await saveState({ booruCache: cache })
}

export async function clearArtCacheState(): Promise<void> {
  await saveState({ booruCache: {} })
}

/* ----------------------------------------------------------- RobloxState */

export async function loadRobloxState(): Promise<RobloxState> {
  if (robloxState) return robloxState
  await ensureDir(paths.root)
  const raw = await readJson<Partial<RobloxState>>(paths.robloxStateFile, {})

  robloxState = {
    ...DEFAULT_ROBLOX_STATE,
    ...raw,
    packageSignatures:
      typeof raw.packageSignatures === 'object' && raw.packageSignatures !== null
        ? raw.packageSignatures
        : {},
    modManifest: Array.isArray(raw.modManifest) ? raw.modManifest : []
  }
  return robloxState
}

export function getRobloxState(): RobloxState {
  return robloxState ?? { ...DEFAULT_ROBLOX_STATE }
}

export async function saveRobloxState(patch: Partial<RobloxState>): Promise<RobloxState> {
  const current = await loadRobloxState()
  robloxState = { ...current, ...patch }
  try {
    await writeJson(paths.robloxStateFile, robloxState)
  } catch (error) {
    logger.error(`Failed to write RobloxState.json: ${String(error)}`)
  }
  return robloxState
}

export async function resetRobloxState(): Promise<RobloxState> {
  robloxState = { ...DEFAULT_ROBLOX_STATE }
  await writeJson(paths.robloxStateFile, robloxState)
  return robloxState
}
