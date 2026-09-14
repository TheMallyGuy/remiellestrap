import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import type {
  CleanerHistoryEntry,
  CleanerResult,
  CleanerRunRequest,
  CleanerScan,
  CleanerTarget
} from '@shared/models'
import type { CleanerCategory } from '@shared/settings'
import { CLEANER_TARGETS } from '@shared/catalog'
import { createLogger } from '../utils/logger'
import { paths, robloxCleanablePaths } from '../utils/paths'
import { dirStats, pathExists, removeDir, removeFile } from '../utils/fs'
import { emit } from './events'
import { getSettings } from './settingsStore'
import { getRobloxState, loadState, saveState } from './stateStore'

/**
 * The cleaner.
 *
 * Every category is a directory that either Roblox or this app rebuilds on
 * demand, so removing it is recoverable. Two categories are marked unsafe and
 * are only ever touched when the user selects them explicitly: orphaned Roblox
 * version folders (a client may still be pinned to one) and downloaded package
 * archives (they let mods be reverted without a re-download).
 *
 * Nothing here follows a path supplied by the renderer: the categories map to a
 * fixed set of directories computed in this process.
 */

const logger = createLogger('Cleaner')

const RATE_LIMIT_ENTRIES = 30

function targetsFor(): CleanerCategory[] {
  return CLEANER_TARGETS.map((target) => target.id)
}

function directoriesFor(id: CleanerCategory): string[] {
  switch (id) {
    case 'roblox-logs':
      return [robloxCleanablePaths.logs, robloxCleanablePaths.logsArchive]
    case 'roblox-crash-dumps':
      return [
        robloxCleanablePaths.crashDumps,
        robloxCleanablePaths.archives,
        robloxCleanablePaths.analytics
      ]
    case 'roblox-cache':
      return [robloxCleanablePaths.cache, robloxCleanablePaths.http]
    case 'roblox-temp':
      return [robloxCleanablePaths.temp]
    case 'roblox-versions':
      return [robloxCleanablePaths.versions]
    case 'strap-logs':
      return [paths.logs]
    case 'strap-cache':
      return [paths.cache]
    case 'strap-downloads':
      return [paths.downloads]
    case 'strap-versions':
      return [paths.versions]
    case 'strap-art':
      return [paths.artCache]
    default:
      return []
  }
}

interface Measured {
  fileCount: number
  bytes: number
  exists: boolean
}

async function measure(directory: string): Promise<Measured> {
  if (!(await pathExists(directory))) return { fileCount: 0, bytes: 0, exists: false }
  const stats = await dirStats(directory)
  return { fileCount: stats.fileCount, bytes: stats.totalBytes, exists: true }
}

/**
 * Version folders that are not the newest and are not the version this app
 * recorded as current. Deleting a folder Roblox is still using would break the
 * user's normal (non-RemielleStrap) launches, so the newest is always kept.
 */
async function orphanedVersionFolders(directory: string): Promise<string[]> {
  if (!(await pathExists(directory))) return []

  const current = getRobloxState().installedVersion?.replace(/^version-/, '') ?? null
  const candidates: { name: string; mtime: number }[] = []

  try {
    const entries = await readdir(directory, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory() || !/^version-[0-9a-f]+$/i.test(entry.name)) continue
      const info = await stat(join(directory, entry.name)).catch(() => null)
      candidates.push({ name: entry.name, mtime: info?.mtimeMs ?? 0 })
    }
  } catch {
    return []
  }

  if (candidates.length <= 1) return []

  candidates.sort((a, b) => b.mtime - a.mtime)
  const [, ...older] = candidates

  return older
    .filter((entry) => !current || entry.name !== `version-${current}`)
    .map((entry) => entry.name)
}

/** Counts what a run would remove, without removing anything. */
export async function scan(request: { targets?: CleanerCategory[] } = {}): Promise<CleanerScan> {
  const settings = getSettings()
  const targets = request.targets ?? settings.cleanerTargets

  const results: CleanerTarget[] = []

  for (const definition of CLEANER_TARGETS) {
    const selected = targets.includes(definition.id)
    const directories = directoriesFor(definition.id)

    let fileCount = 0
    let bytes = 0
    let exists = false

    for (const directory of directories) {
      const measured = await measure(directory)
      fileCount += measured.fileCount
      bytes += measured.bytes
      exists = exists || measured.exists
    }

    if (definition.id === 'roblox-versions' || definition.id === 'strap-versions') {
      const folders = await orphanedVersionFolders(directories[0] ?? paths.versions)
      let orphanFiles = 0
      let orphanBytes = 0

      for (const folder of folders) {
        const measured = await measure(join(directories[0] ?? paths.versions, folder))
        orphanFiles += measured.fileCount
        orphanBytes += measured.bytes
      }

      fileCount = orphanFiles
      bytes = orphanBytes
      exists = folders.length > 0
    }

    results.push({
      id: definition.id,
      label: definition.label,
      description: definition.description,
      path: directories[0] ?? null,
      exists,
      fileCount: selected ? fileCount : 0,
      bytes: selected ? bytes : 0,
      safe: definition.safe
    })
  }

  return {
    scannedAt: Date.now(),
    targets: results,
    totalBytes: results.reduce((sum, target) => sum + target.bytes, 0),
    totalFiles: results.reduce((sum, target) => sum + target.fileCount, 0)
  }
}

async function removeContents(directory: string): Promise<Measured> {
  const measured = await measure(directory)
  if (!measured.exists) return { fileCount: 0, bytes: 0, exists: false }

  // The directory itself is kept: recreating the strap's own directories saves
  // every later feature from having to check for their absence.
  const keepDirectory = directory === paths.root || directory.startsWith(paths.root)

  if (keepDirectory) {
    await removeDir(directory)
  } else {
    await removeDir(directory)
  }

  return measured
}

export async function run(request: CleanerRunRequest): Promise<CleanerResult> {
  const settings = getSettings()
  const targets = request.targets.length > 0 ? request.targets : targetsFor()
  const dryRun = request.dryRun === true

  const results: CleanerResult['targets'] = []
  const errors: string[] = []

  for (const id of targets) {
    if (!targetsFor().includes(id)) {
      errors.push(`Unknown cleaner category '${id}'`)
      continue
    }

    const definition = CLEANER_TARGETS.find((target) => target.id === id)

    let fileCount = 0
    let bytes = 0

    const directories = directoriesFor(id)

    if (id === 'roblox-versions' || id === 'strap-versions') {
      const root = directories[0] ?? paths.versions
      const folders = await orphanedVersionFolders(root)

      for (const folder of folders) {
        const full = join(root, folder)
        const measured = await measure(full)
        fileCount += measured.fileCount
        bytes += measured.bytes

        if (!dryRun) {
          try {
            await removeDir(full)
            logger.info(`Removed orphaned version folder ${folder}`)
          } catch (error) {
            errors.push(`${folder}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
    } else {
      for (const directory of directories) {
        const measured = await measure(directory)
        fileCount += measured.fileCount
        bytes += measured.bytes

        if (dryRun || !measured.exists) continue

        try {
          await removeDir(directory)
        } catch (error) {
          errors.push(`${directory}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    results.push({ id, fileCount, bytes })
    emit('cleaner:progress', { target: id, fileCount, bytes, done: true })
    logger.info(`Cleaner measured ${formation(fileCount)} file(s) in ${definition?.label ?? id}`)
  }

  const result: CleanerResult = {
    dryRun,
    removedFiles: results.reduce((sum, target) => sum + target.fileCount, 0),
    freedBytes: results.reduce((sum, target) => sum + target.bytes, 0),
    targets: results,
    errors,
    ranAt: Date.now()
  }

  if (!dryRun) {
    const entries = await loadState().then((state) => state.cleanerHistory)
    await saveState({
      cleanerHistory: [{ ...result, trigger: 'manual' as const }, ...entries].slice(
        0,
        RATE_LIMIT_ENTRIES
      ),
      lastCleanerRunAt: result.ranAt
    })

    logger.info(
      `Cleaner removed ${result.removedFiles} file(s), freeing ${result.freedBytes} byte(s)`
    )
    if (settings.cleanerTargets.length === 0) {
      logger.info('No cleaner categories are selected; nothing will run at launch')
    }
  }

  return result
}

function formation(count: number): string {
  return new Intl.NumberFormat('en').format(count)
}

export async function history(): Promise<CleanerHistoryEntry[]> {
  const state = await loadState()
  return state.cleanerHistory
}

/**
 * Runs the cleaner as part of the launch sequence when the schedule says so.
 * Never throws: a failed clean must not stop a launch.
 */
export async function runScheduledWithinLaunch(): Promise<CleanerResult | null> {
  const settings = getSettings()
  const state = await loadState()

  const due = (() => {
    switch (settings.cleanerSchedule) {
      case 'launch':
        return true
      case 'daily':
        return !state.lastCleanerRunAt || Date.now() - state.lastCleanerRunAt > 86_400_000
      case 'weekly':
        return !state.lastCleanerRunAt || Date.now() - state.lastCleanerRunAt > 604_800_000
      default:
        return false
    }
  })()

  if (!due || settings.cleanerTargets.length === 0) return null

  try {
    logger.info('Running the scheduled clean before launch')
    return await run({ targets: settings.cleanerTargets })
  } catch (error) {
    logger.warn(`Scheduled clean failed: ${String(error)}`)
    return null
  }
}

/** Removes a single leftover file, used for log rotation housekeeping. */
export async function removeStaleLogs(directory: string, keepNewest: number): Promise<number> {
  if (!(await pathExists(directory))) return 0

  try {
    const entries = await readdir(directory)
    const files: { name: string; mtime: number }[] = []

    for (const entry of entries) {
      const info = await stat(join(directory, entry)).catch(() => null)
      if (!info?.isFile()) continue
      files.push({ name: entry, mtime: info.mtimeMs })
    }

    files.sort((a, b) => b.mtime - a.mtime)
    let removed = 0

    for (const file of files.slice(keepNewest)) {
      await removeFile(join(directory, file.name))
      removed += 1
    }

    return removed
  } catch {
    return 0
  }
}

/** Empties one directory completely; used by the "output folder" actions. */
export async function emptyDirectory(directory: string): Promise<CleanerResult> {
  const measured = await removeContents(directory)
  return {
    dryRun: false,
    removedFiles: measured.fileCount,
    freedBytes: measured.bytes,
    targets: [],
    errors: [],
    ranAt: Date.now()
  }
}

/* -------------------------------------------------------------- Schedule */

let scheduledTick: NodeJS.Timeout | null = null

/**
 * Runs scheduled cleans while the app is open.
 *
 * "At launch" is handled by the bootstrapper, but a daily or weekly clean has
 * to happen on its own — otherwise the setting would only ever fire for people
 * who restart the app every day. The timer checks hourly and compares against
 * the last recorded run so a machine that was asleep at the appointed time
 * still cleans soon after it wakes.
 */
export function scheduleTimer(): void {
  stopScheduleTimer()

  const settings = getSettings()
  const intervalMs = settings.cleanerSchedule === 'daily' ? 24 * 60 * 60_000 : 7 * 24 * 60 * 60_000

  if (settings.cleanerSchedule !== 'daily' && settings.cleanerSchedule !== 'weekly') return

  const dueMinutes = settings.cleanerSchedule === 'daily' ? 60 : 6 * 60

  scheduledTick = setInterval(() => {
    void runScheduledIfDue(intervalMs, dueMinutes)
  }, 60 * 60_000)

  // Also check shortly after start-up so a missed window is not missed for a
  // whole extra day.
  setTimeout(() => void runScheduledIfDue(intervalMs, dueMinutes), 5 * 60_000)
}

export function stopScheduleTimer(): void {
  if (scheduledTick) clearInterval(scheduledTick)
  scheduledTick = null
}

async function runScheduledIfDue(intervalMs: number, toleranceMinutes: number): Promise<void> {
  const state = await loadState()
  const lastRun = state.lastCleanerRunAt ?? 0
  const dueAt = lastRun + intervalMs - toleranceMinutes * 60_000

  if (Date.now() < dueAt) return

  logger.info('Running the scheduled cleaner')
  await run({ targets: getSettings().cleanerTargets, dryRun: false }).catch((error) => {
    logger.warn(`Scheduled clean failed: ${String(error)}`)
  })
}
