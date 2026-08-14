import { readdir } from 'fs/promises'
import { join } from 'path'
import { paths } from '../utils/paths'
import { ensureDir, pathExists, readJson, removeDir, removeFile, writeJson } from '../utils/fs'
import { createLogger } from '../utils/logger'

/**
 * Version bookkeeping: tracks every installed client (player and studio) in a
 * `versions.json` file, mirrors the stock bootstrapper's reindexing behaviour,
 * and remembers which install was used last.
 *
 * This replaces relying on a single `RobloxState.installedVersion` for
 * "is it installed / is it up to date" decisions, while RobloxState keeps its
 * mod/fastflag/signature bookkeeping.
 */

const logger = createLogger('Versions')

export type AppType = 'player' | 'studio'

export interface InstallationEntry {
  id: string
  versionHash: string
  appType: AppType
  installedAt: string
  channel: string
}

interface VersionsFile {
  versions: InstallationEntry[]
  currentlyUsing: InstallationEntry | null
}

let cached: VersionsFile | null = null

function isEntry(value: unknown): value is InstallationEntry {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.versionHash === 'string' &&
    candidate.versionHash.length > 0 &&
    (candidate.appType === 'player' || candidate.appType === 'studio')
  )
}

function sanitiseEntry(value: unknown, index: number): InstallationEntry | null {
  if (!isEntry(value)) return null
  return {
    id:
      typeof value.id === 'string' && value.id.length > 0 ? value.id : `Installation ${index + 1}`,
    versionHash: value.versionHash,
    appType: value.appType,
    installedAt:
      typeof value.installedAt === 'string' ? value.installedAt : new Date(0).toISOString(),
    channel: typeof value.channel === 'string' ? value.channel : 'LIVE'
  }
}

export async function loadVersions(): Promise<VersionsFile> {
  if (cached) return cached

  await ensureDir(paths.root)
  const raw = await readJson<Partial<VersionsFile> | null>(paths.versionsFile, null)

  const rawVersions = raw?.versions
  const versions = Array.isArray(rawVersions)
    ? rawVersions
        .map((entry, index) => sanitiseEntry(entry, index))
        .filter((entry): entry is InstallationEntry => entry !== null)
    : []

  const currentlyUsing = raw?.currentlyUsing ? sanitiseEntry(raw.currentlyUsing, 0) : null

  cached = { versions, currentlyUsing }
  return cached
}

export async function saveVersions(patch: Partial<VersionsFile>): Promise<VersionsFile> {
  const current = await loadVersions()
  cached = { ...current, ...patch }
  await writeJson(paths.versionsFile, cached)
  return cached
}

/** Latest usable install for an app type, preferring the last-used one. */
export async function latestEntry(appType: AppType): Promise<InstallationEntry | null> {
  const store = await loadVersions()
  const entries = store.versions.filter((entry) => entry.appType === appType)

  const current = store.currentlyUsing
  if (current && current.appType === appType && entries.some((e) => e.id === current.id)) {
    return current
  }

  return entries.at(-1) ?? null
}

/** Upserts a freshly installed version and marks it as the one in use. */
export async function saveVersion(
  versionHash: string,
  appType: AppType,
  channel: string,
  label?: string
): Promise<InstallationEntry> {
  const store = await loadVersions()
  const existing = store.versions.find(
    (entry) => entry.versionHash === versionHash && entry.appType === appType
  )

  const entry: InstallationEntry = existing
    ? { ...existing, channel }
    : {
        id: label ?? `Installation ${store.versions.length + 1}`,
        versionHash,
        appType,
        installedAt: new Date().toISOString(),
        channel
      }

  const versions = existing
    ? store.versions.map((item) =>
        item.versionHash === versionHash && item.appType === appType ? entry : item
      )
    : [...store.versions, entry]

  await saveVersions({ versions, currentlyUsing: entry })
  return entry
}

function executableName(appType: AppType): string {
  return appType === 'studio' ? 'RobloxStudioBeta.exe' : 'RobloxPlayerBeta.exe'
}

async function detectAppType(versionDir: string): Promise<AppType | null> {
  if (await pathExists(join(versionDir, 'RobloxStudioBeta.exe'))) return 'studio'
  if (await pathExists(join(versionDir, 'RobloxPlayerBeta.exe'))) return 'player'
  return null
}

async function isVersionFolderComplete(versionDir: string, appType: AppType): Promise<boolean> {
  return (
    (await pathExists(join(versionDir, executableName(appType)))) &&
    (await pathExists(join(versionDir, 'AppSettings.xml')))
  )
}

/**
 * Scans the Versions directory, removes incomplete `version-*` folders and
 * reconciles the stored list with what is actually on disk. `defaultChannel`
 * is applied to folders discovered on disk that have no stored record.
 */
export async function reindexVersions(
  versionsDir: string,
  defaultChannel: string
): Promise<InstallationEntry[]> {
  const store = await loadVersions()

  if (!(await pathExists(versionsDir))) {
    // The whole install root is gone; nothing to reconcile against.
    await saveVersions({ versions: [], currentlyUsing: null })
    return []
  }

  const entries = await readdir(versionsDir, { withFileTypes: true })
  const valid: InstallationEntry[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name || !/^version-[0-9a-f]+$/i.test(entry.name)) continue

    const versionDir = join(versionsDir, entry.name)
    const appType = await detectAppType(versionDir)
    const complete = appType !== null && (await isVersionFolderComplete(versionDir, appType))

    if (!complete || appType === null) {
      logger.info(`Removing incomplete installation: ${entry.name}`)
      await removeDir(versionDir)
      continue
    }

    const existing = store.versions.find(
      (item) => item.versionHash === entry.name && item.appType === appType
    )

    valid.push(
      existing ?? {
        id: `Installation ${valid.length + 1}`,
        versionHash: entry.name,
        appType,
        installedAt: new Date().toISOString(),
        channel: defaultChannel
      }
    )
  }

  const validHashes = new Set(valid.map((item) => item.versionHash))
  const currentlyUsing =
    store.currentlyUsing && validHashes.has(store.currentlyUsing.versionHash)
      ? store.currentlyUsing
      : null

  await saveVersions({ versions: valid, currentlyUsing })
  return valid
}

/** Clears the in-memory copy and deletes the file (used by uninstall). */
export async function resetVersions(): Promise<void> {
  cached = null
  await removeFile(paths.versionsFile)
}
