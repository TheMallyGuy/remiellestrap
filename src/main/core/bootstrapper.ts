import { spawn } from 'child_process'
import { readdir, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  BootstrapperProgress,
  BootstrapperResult,
  BootstrapperStage,
  LaunchRequest,
  UpdateCheckResult
} from '@shared/models'
import { createLogger } from '../utils/logger'
import { paths, stockRobloxRoot } from '../utils/paths'
import { ensureDir, formatBytes, pathExists, removeDir, removeFile } from '../utils/fs'
import { md5File } from '../utils/hash'
import { extractZip, isZipFile } from '../utils/zip'
import { buildRobloxArguments, parseLaunchUri, type ParsedLaunchUri } from '../utils/uri'
import { closeBootstrapperWindow, showBootstrapperWindow } from '../app/window'
import { downloadToFile } from '../services/http'
import { emit, toast } from '../services/events'
import { getSettings } from '../services/settingsStore'
import { getRobloxState, saveRobloxState } from '../services/stateStore'
import { applyFlags } from '../services/fastflags'
import { applyMods, revertMods } from '../services/mods'
import {
  appSettingsXml,
  binaryTypeFor,
  CONDITIONAL_PACKAGES,
  executableName,
  getLatestClientVersion,
  getPackageManifest,
  packageDirectoryMap,
  packageUrls,
  resolveBaseUrl,
  type BinaryType,
  type DeploymentTarget,
  type PackageEntry
} from './deployment'
import {
  latestEntry,
  loadVersions,
  reindexVersions,
  resetVersions,
  saveVersion,
  type AppType
} from './versions'

/**
 * The bootstrapper: resolves the latest deployment, downloads and verifies the
 * packages, extracts them into a versioned install directory, applies mods and
 * FastFlags, and launches the client.
 */

const logger = createLogger('Bootstrapper')

const IDLE: BootstrapperProgress = {
  stage: 'idle',
  progress: null,
  message: 'Ready',
  cancellable: false
}

let progress: BootstrapperProgress = { ...IDLE }
let controller: AbortController | null = null
let running = false

export function currentProgress(): BootstrapperProgress {
  return progress
}

export function isBusy(): boolean {
  return running
}

function report(patch: Partial<BootstrapperProgress> & { stage: BootstrapperStage }): void {
  progress = { ...progress, ...patch }
  emit('bootstrapper:progress', progress)
}

function reset(): void {
  progress = { ...IDLE }
  emit('bootstrapper:progress', progress)
}

export function cancel(): boolean {
  if (!controller || !running) return false
  logger.info('Cancellation requested')
  controller.abort()
  return true
}

class CancelledError extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'CancelledError'
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledError()
}

/** Base directory that contains the `Versions` folder. */
function installBase(): string {
  return getSettings().installLocation ?? paths.root
}

/** Directory the `version-*` install folders live in. */
export function versionsDirectory(): string {
  return join(installBase(), 'Versions')
}

function appTypeFor(binaryType: BinaryType): AppType {
  return binaryType === 'WindowsStudio64' ? 'studio' : 'player'
}

/** Where the client for a given version GUID lives. */
export function installDirectoryFor(versionGuid: string): string {
  return join(versionsDirectory(), versionGuid)
}

export function clientExecutable(versionGuid: string, binaryType: BinaryType): string {
  return join(installDirectoryFor(versionGuid), executableName(binaryType))
}

/** True when the recorded install is present and its executable exists. */
export async function isInstalled(binaryType: BinaryType = 'WindowsPlayer'): Promise<boolean> {
  const entry = await latestEntry(appTypeFor(binaryType))
  if (!entry) return false
  return pathExists(clientExecutable(entry.versionHash, binaryType))
}

export async function checkForUpdates(signal?: AbortSignal): Promise<UpdateCheckResult> {
  const settings = getSettings()
  const channel = settings.channel || 'LIVE'
  const binaryType = binaryTypeFor(settings.preferredLaunchMode)
  const entry = await latestEntry(appTypeFor(binaryType))

  const base: UpdateCheckResult = {
    installedVersion: entry?.versionHash ?? null,
    latestVersion: null,
    channel,
    upToDate: false,
    installed: await isInstalled(binaryType),
    clientVersion: null,
    checkedAt: Date.now(),
    error: null
  }

  if (settings.disableUpdates && base.installed) {
    logger.info('Update checks are disabled; treating the current install as current')
    return { ...base, latestVersion: entry?.versionHash ?? null, upToDate: true }
  }

  try {
    const latest = await getLatestClientVersion(binaryType, channel, signal)
    const upToDate =
      base.installed &&
      entry?.versionHash === latest.clientVersionUpload &&
      entry?.channel === channel

    await saveRobloxState({ lastUpdateCheck: Date.now() })

    return {
      ...base,
      latestVersion: latest.clientVersionUpload,
      clientVersion: latest.version,
      upToDate
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Update check failed: ${message}`)
    return { ...base, error: message }
  }
}

interface InstallOptions {
  force?: boolean
  signal: AbortSignal
}

/**
 * Ensures the newest client is installed, returning the version GUID that is
 * ready to launch. Reuses the existing install when it is already current.
 */
async function ensureInstalled(options: InstallOptions): Promise<string> {
  const { signal } = options
  const settings = getSettings()
  const channel = settings.channel || 'LIVE'
  const binaryType = binaryTypeFor(settings.preferredLaunchMode)
  const appType = appTypeFor(binaryType)

  report({
    stage: 'connecting',
    progress: null,
    message: 'Connecting to Roblox',
    cancellable: true
  })

  const baseUrl = await resolveBaseUrl()
  throwIfCancelled(signal)

  report({ stage: 'checking', message: 'Checking for updates', progress: null })
  const latest = await getLatestClientVersion(binaryType, channel, signal)
  const versionGuid = latest.clientVersionUpload
  throwIfCancelled(signal)

  const directory = installDirectoryFor(versionGuid)
  const executable = join(directory, executableName(binaryType))
  const entry = await latestEntry(appType)
  const alreadyInstalled =
    !options.force &&
    entry?.versionHash === versionGuid &&
    entry.channel === channel &&
    (await pathExists(executable))

  if (alreadyInstalled) {
    logger.info(`Version ${versionGuid} is already installed`)
    report({
      stage: 'configuring',
      message: 'Roblox is up to date',
      progress: 1,
      version: versionGuid
    })
    return versionGuid
  }

  if (options.force) {
    logger.info('Force reinstall requested; clearing the version directory')
    await removeDir(directory)
  }

  const target: DeploymentTarget = { baseUrl, channel, versionGuid }
  const manifest = await getPackageManifest(target, signal)
  throwIfCancelled(signal)

  const directoryMap = packageDirectoryMap(binaryType)
  const packages = manifest.filter((entry) => !CONDITIONAL_PACKAGES.has(entry.name))
  const totalBytes = packages.reduce((sum, entry) => sum + entry.packedSize, 0)

  logger.info(
    `Installing ${versionGuid} (${packages.length} packages, ${formatBytes(totalBytes)} compressed)`
  )

  await ensureDir(directory)
  await ensureDir(paths.downloads)

  const downloaded = new Map<string, string>()
  let packagesDone = 0
  let completedBytes = 0
  const received = new Map<number, number>()
  const active = new Set<string>()
  let aborted = false
  let firstError: Error | null = null
  const concurrency = Math.min(Math.max(getSettings().parallelDownloads, 1), 16)

  const reportDownload = (): void => {
    if (aborted) return
    const inFlight = [...received.values()].reduce((sum, value) => sum + value, 0)
    const aggregate = completedBytes + inFlight
    report({
      stage: 'downloading',
      message: `Downloading Roblox ${latest.version}`,
      detail: undefined,
      currentPackage: [...active].slice(0, 4).join(', ') || undefined,
      packagesDone,
      packagesTotal: packages.length,
      bytesTotal: totalBytes,
      bytesDownloaded: aggregate,
      progress: totalBytes > 0 ? Math.min(aggregate / totalBytes, 1) : null,
      version: versionGuid,
      cancellable: true
    })
  }

  let nextIndex = 0

  // Worker pool: each worker pulls the next package until the queue is empty,
  // mirroring the stock bootstrapper's parallel download behaviour.
  const workers = Array.from({ length: concurrency }, async () => {
    while (!aborted && !signal.aborted) {
      const index = nextIndex++
      if (index >= packages.length) return
      const entry = packages[index]
      if (!entry) return

      active.add(entry.name)
      reportDownload()

      const cached = join(paths.downloads, `${versionGuid}-${entry.name}`)

      try {
        const valid = await verifyPackage(cached, entry)
        if (valid) {
          logger.info(`Using cached package ${entry.name}`)
        } else {
          await downloadPackage(target, entry, cached, signal, (amount) => {
            if (aborted) return
            received.set(index, amount)
            reportDownload()
          })
        }
        downloaded.set(entry.name, cached)
      } catch (error) {
        if (signal.aborted) {
          aborted = true
          return
        }
        aborted = true
        firstError = error instanceof Error ? error : new Error(String(error))
        return
      } finally {
        active.delete(entry.name)
        received.delete(index)
      }

      completedBytes += entry.packedSize
      packagesDone += 1
      reportDownload()
    }
  })

  await Promise.all(workers)
  throwIfCancelled(signal)
  if (firstError) throw firstError

  report({
    stage: 'extracting',
    message: 'Installing Roblox',
    progress: 0,
    packagesDone: 0,
    packagesTotal: packages.length,
    cancellable: true
  })

  const signatures: Record<string, string> = {}
  let extracted = 0

  for (const entry of packages) {
    throwIfCancelled(signal)

    const archive = downloaded.get(entry.name)
    if (!archive) continue

    const relativeTarget = directoryMap[entry.name] ?? ''
    const destination = relativeTarget ? join(directory, ...relativeTarget.split('/')) : directory

    await ensureDir(destination)
    await extractZip(archive, destination, { signal })

    signatures[entry.name] = entry.signature
    extracted += 1

    report({
      stage: 'extracting',
      message: 'Installing Roblox',
      detail: entry.name,
      currentPackage: entry.name,
      packagesDone: extracted,
      packagesTotal: packages.length,
      progress: extracted / packages.length
    })
  }

  throwIfCancelled(signal)

  report({ stage: 'configuring', message: 'Finishing up', progress: null, cancellable: false })
  await writeFile(join(directory, 'AppSettings.xml'), appSettingsXml(), 'utf8')

  await saveRobloxState({
    installedVersion: versionGuid,
    installedChannel: channel,
    installedAt: Date.now(),
    packageSignatures: signatures,
    installPath: directory,
    modManifest: []
  })

  await saveVersion(versionGuid, appType, channel)

  if (!getSettings().disableUpdates) await cleanupOldVersions()

  logger.info(`Installed ${versionGuid} to ${directory}`)
  return versionGuid
}

async function verifyPackage(file: string, entry: PackageEntry): Promise<boolean> {
  if (!(await pathExists(file))) return false

  try {
    const fileInfo = await stat(file)
    if (fileInfo.size !== entry.packedSize) {
      logger.warn(
        `${entry.name} has the wrong size (${fileInfo.size} bytes, expected ${entry.packedSize})`
      )
      return false
    }

    const signature = await md5File(file)
    if (signature.toLowerCase() !== entry.signature.toLowerCase()) {
      logger.warn(`${entry.name} failed its Roblox manifest checksum`)
      return false
    }

    // The MD5 and byte count protect authenticity/completeness. Parsing the
    // central directory here additionally catches old, truncated cache files
    // before yauzl reaches extraction and reports its opaque EOCD error.
    if (!(await isZipFile(file))) {
      logger.warn(`${entry.name} has no readable zip central directory`)
      return false
    }

    return true
  } catch (error) {
    logger.warn(`Could not verify ${entry.name}: ${String(error)}`)
    return false
  }
}

/**
 * Downloads one package atomically and fails over across Roblox's official CDN
 * mirrors. A bad body is removed before the next attempt, so extraction never
 * sees a partial response or an HTML error page saved under a .zip name.
 */
async function downloadPackage(
  target: DeploymentTarget,
  entry: PackageEntry,
  destination: string,
  signal: AbortSignal,
  onProgress: (received: number) => void
): Promise<void> {
  let lastError: unknown = null
  const urls = packageUrls(target, entry.name)

  for (const [index, url] of urls.entries()) {
    throwIfCancelled(signal)
    await removeFile(destination)
    onProgress(0)

    try {
      logger.info(`Downloading ${entry.name} from ${new URL(url).host}`)
      await downloadToFile(url, destination, {
        signal,
        retries: 0,
        expectedBytes: entry.packedSize,
        onProgress: ({ received }) => onProgress(received)
      })

      if (!(await verifyPackage(destination, entry))) {
        throw new Error('the downloaded file failed its size, checksum, or zip integrity check')
      }

      return
    } catch (error) {
      if (signal.aborted) throw new CancelledError()
      lastError = error
      await removeFile(destination)
      logger.warn(
        `Package ${entry.name} failed on mirror ${index + 1}/${urls.length}: ${String(error)}`
      )
    }
  }

  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new Error(
    `Roblox package ${entry.name} could not be downloaded intact from any official CDN mirror. ` +
      `The partial file was removed; check your connection and try again. Last error: ${detail}`
  )
}

/**
 * Removes version directories and cached packages that the version store no
 * longer references. Keeps the latest install of every app type rather than a
 * single global version, so player and studio can coexist.
 */
async function cleanupOldVersions(): Promise<void> {
  const store = await loadVersions()
  const keep = new Set(store.versions.map((entry) => entry.versionHash))

  try {
    const entries = await readdir(versionsDirectory(), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!/^version-[0-9a-f]+$/i.test(entry.name)) continue
      if (keep.has(entry.name)) continue
      await removeDir(join(versionsDirectory(), entry.name))
      logger.info(`Removed stale version ${entry.name}`)
    }
  } catch {
    // Nothing to clean.
  }

  try {
    const entries = await readdir(paths.downloads, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const match = entry.name.match(/^(version-[0-9a-f]+)-/i)
      if (!match || keep.has(match[1])) continue
      await removeFile(join(paths.downloads, entry.name))
    }
  } catch {
    // Nothing to clean.
  }
}

export interface InstallRunOptions {
  force?: boolean
  launch?: boolean
  uri?: ParsedLaunchUri | null
  rawUri?: string | null
}

/**
 * Full bootstrapper run: install/update, apply mods and flags, then optionally
 * launch. Only one run can be in flight at a time.
 */
export async function run(options: InstallRunOptions = {}): Promise<BootstrapperResult> {
  if (running) {
    showBootstrapperWindow()
    return {
      ok: false,
      version: null,
      launched: false,
      message: 'A bootstrapper run is already in progress'
    }
  }

  running = true
  controller = new AbortController()
  showBootstrapperWindow()
  const signal = controller.signal

  try {
    // Reconcile the version store with what is actually on disk before deciding
    // whether anything needs installing.
    await reindexVersions(versionsDirectory(), getSettings().channel || 'LIVE').catch((error) => {
      logger.warn(`Version reindex failed: ${String(error)}`)
    })

    const versionGuid = await ensureInstalled({ force: options.force, signal })
    const directory = installDirectoryFor(versionGuid)
    const settings = getSettings()
    const binaryType = binaryTypeFor(settings.preferredLaunchMode)

    // Revert the previous run's mod files so disabled mods stop applying.
    const state = getRobloxState()
    if (state.modManifest.length > 0) {
      report({ stage: 'applying-mods', message: 'Reverting previous mods', progress: null })
      await revertMods(
        {
          versionDirectory: directory,
          versionGuid,
          binaryType,
          channel: settings.channel || 'LIVE'
        },
        state.modManifest
      )
    }

    throwIfCancelled(signal)
    report({ stage: 'applying-mods', message: 'Applying mods', progress: null, cancellable: false })
    const applied = await applyMods(directory)
    if (applied.length > 0) logger.info(`Applied ${applied.length} modded file(s)`)

    throwIfCancelled(signal)
    report({ stage: 'writing-flags', message: 'Writing FastFlags', progress: null })
    const flagCount = await applyFlags(directory)

    if (!options.launch) {
      report({
        stage: 'done',
        message: 'Roblox is ready',
        progress: 1,
        version: versionGuid,
        cancellable: false
      })
      const result: BootstrapperResult = {
        ok: true,
        version: versionGuid,
        launched: false,
        message: 'Roblox is up to date'
      }
      emit('bootstrapper:complete', result)
      if (settings.notifyOnInstallComplete) {
        toast('success', 'Roblox is ready', `${versionGuid} · ${flagCount} FastFlags`)
      }
      return result
    }

    throwIfCancelled(signal)
    report({
      stage: 'launching',
      message: 'Launching Roblox',
      progress: 1,
      version: versionGuid,
      cancellable: false
    })

    const executable = clientExecutable(versionGuid, binaryType)
    await launchClient(executable, directory, options.rawUri ?? null)

    const result: BootstrapperResult = {
      ok: true,
      version: versionGuid,
      launched: true,
      message: 'Roblox launched'
    }

    report({ stage: 'running', message: 'Roblox is running', progress: 1, cancellable: false })
    emit('bootstrapper:complete', result)

    if (settings.autoCloseBootstrapper) {
      setTimeout(() => {
        if (progress.stage === 'running') closeBootstrapperWindow()
      }, 900)
    }

    return result
  } catch (error) {
    if (error instanceof CancelledError || signal.aborted) {
      logger.info('Bootstrapper run cancelled')
      report({ stage: 'cancelled', message: 'Cancelled', progress: null, cancellable: false })
      const result: BootstrapperResult = {
        ok: false,
        version: null,
        launched: false,
        message: 'Cancelled'
      }
      emit('bootstrapper:complete', result)
      return result
    }

    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Bootstrapper run failed: ${message}`)
    // If the user hid the progress window while the download continued, bring
    // it back for a failure so the actionable error is never lost.
    showBootstrapperWindow()
    report({
      stage: 'error',
      message: 'Something went wrong',
      detail: message,
      progress: null,
      cancellable: false
    })
    emit('bootstrapper:error', { message: 'Roblox could not be started', detail: message })

    return { ok: false, version: null, launched: false, message }
  } finally {
    running = false
    controller = null
  }
}

/**
 * Spawns the client. The launch URI is passed through verbatim, which is what
 * the Roblox client expects from a registered protocol handler.
 */
async function launchClient(
  executable: string,
  workingDirectory: string,
  rawUri: string | null
): Promise<void> {
  if (!(await pathExists(executable))) {
    throw new Error(`The Roblox client is missing at ${executable}`)
  }

  const settings = getSettings()
  const parsed = rawUri ? parseLaunchUri(rawUri) : null
  const args = buildRobloxArguments(parsed, {
    robloxLocale: settings.robloxLocale,
    gameLocale: settings.gameLocale,
    extraArguments: settings.launchArguments
  })

  logger.info(
    `Launching ${executable} ${args.map((a) => (a.length > 80 ? `${a.slice(0, 80)}…` : a)).join(' ')}`
  )

  const child = spawn(executable, args, {
    cwd: workingDirectory,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })

  // Do not announce a successful launch until Windows has actually created the
  // process. spawn() reports missing/blocked executables asynchronously.
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve)
    child.once('error', reject)
  })

  child.unref()
}

/** Convenience wrapper used by IPC handlers and deep links. */
export async function install(force = false): Promise<BootstrapperResult> {
  return run({ force, launch: false })
}

export async function launch(
  request: LaunchRequest | null | undefined
): Promise<BootstrapperResult> {
  return run({ launch: true, rawUri: request?.uri ?? null })
}

export async function forceReinstall(): Promise<BootstrapperResult> {
  reset()
  return run({ force: true, launch: false })
}

/**
 * Removes everything this app installed. Settings are preserved unless the
 * caller asks otherwise; the stock Roblox install is never touched.
 */
export async function uninstall(keepSettings: boolean): Promise<void> {
  logger.info(`Uninstalling (keepSettings=${keepSettings})`)

  await removeDir(versionsDirectory())
  await resetVersions()
  await removeDir(paths.downloads)
  await removeDir(paths.cache)
  await removeDir(paths.modifications)

  if (!keepSettings) {
    await removeFile(paths.settingsFile)
    await removeFile(paths.stateFile)
    await removeDir(paths.mods)
  }

  await removeFile(paths.robloxStateFile)
  logger.info(`Stock Roblox at ${stockRobloxRoot()} was left untouched`)
}
