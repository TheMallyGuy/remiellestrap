import { spawn } from 'child_process'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  BootstrapperProgress,
  BootstrapperResult,
  BootstrapperStage,
  LaunchRequest,
  UpdateCheckResult
} from '@shared/models'
import { createLogger } from '../utils/logger'
import { paths, stockRobloxRoot, versionDirectory } from '../utils/paths'
import { ensureDir, formatBytes, pathExists, removeDir, removeFile } from '../utils/fs'
import { md5File } from '../utils/hash'
import { extractZip } from '../utils/zip'
import { buildRobloxArguments, parseLaunchUri, type ParsedLaunchUri } from '../utils/uri'
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
  packageUrl,
  resolveBaseUrl,
  type BinaryType,
  type DeploymentTarget,
  type PackageEntry
} from './deployment'

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

function installRoot(): string {
  return getSettings().installLocation ?? paths.versions
}

/** Where the client for a given version GUID lives. */
export function installDirectoryFor(versionGuid: string): string {
  return versionDirectory(installRoot(), versionGuid)
}

export function clientExecutable(versionGuid: string, binaryType: BinaryType): string {
  return join(installDirectoryFor(versionGuid), executableName(binaryType))
}

/** True when the recorded install is present and its executable exists. */
export async function isInstalled(binaryType: BinaryType = 'WindowsPlayer'): Promise<boolean> {
  const state = getRobloxState()
  if (!state.installedVersion) return false
  return pathExists(clientExecutable(state.installedVersion, binaryType))
}

export async function checkForUpdates(signal?: AbortSignal): Promise<UpdateCheckResult> {
  const settings = getSettings()
  const state = getRobloxState()
  const channel = settings.channel || 'LIVE'
  const binaryType = binaryTypeFor(settings.preferredLaunchMode)

  const base: UpdateCheckResult = {
    installedVersion: state.installedVersion,
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
    return { ...base, latestVersion: state.installedVersion, upToDate: true }
  }

  try {
    const latest = await getLatestClientVersion(binaryType, channel, signal)
    const upToDate = base.installed && state.installedVersion === latest.clientVersionUpload

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
  const state = getRobloxState()

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
  const alreadyInstalled =
    !options.force &&
    state.installedVersion === versionGuid &&
    state.installedChannel === channel &&
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
  let completedBytes = 0

  for (const [index, entry] of packages.entries()) {
    throwIfCancelled(signal)

    const cached = join(paths.downloads, `${versionGuid}-${entry.name}`)
    const startedAt = completedBytes

    report({
      stage: 'downloading',
      message: `Downloading Roblox ${latest.version}`,
      detail: entry.name,
      currentPackage: entry.name,
      packagesDone: index,
      packagesTotal: packages.length,
      bytesTotal: totalBytes,
      bytesDownloaded: completedBytes,
      progress: totalBytes > 0 ? completedBytes / totalBytes : null,
      version: versionGuid,
      cancellable: true
    })

    const valid = await verifyPackage(cached, entry)

    if (valid) {
      logger.info(`Using cached package ${entry.name}`)
    } else {
      await removeFile(cached)
      await downloadToFile(packageUrl(target, entry.name), cached, {
        signal,
        onProgress: ({ received }) => {
          completedBytes = startedAt + received
          report({
            stage: 'downloading',
            bytesDownloaded: completedBytes,
            progress: totalBytes > 0 ? Math.min(completedBytes / totalBytes, 1) : null,
            message: `Downloading Roblox ${latest.version}`,
            detail: `${entry.name} · ${formatBytes(completedBytes)} of ${formatBytes(totalBytes)}`
          })
        }
      })

      if (!(await verifyPackage(cached, entry))) {
        await removeFile(cached)
        throw new Error(`Checksum mismatch for ${entry.name}; the download was corrupted`)
      }
    }

    completedBytes = startedAt + entry.packedSize
    downloaded.set(entry.name, cached)
  }

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

  if (!getSettings().disableUpdates) await cleanupOldVersions(versionGuid)

  logger.info(`Installed ${versionGuid} to ${directory}`)
  return versionGuid
}

async function verifyPackage(file: string, entry: PackageEntry): Promise<boolean> {
  if (!(await pathExists(file))) return false
  try {
    const signature = await md5File(file)
    return signature.toLowerCase() === entry.signature.toLowerCase()
  } catch {
    return false
  }
}

/** Removes version directories and cached packages that are no longer current. */
async function cleanupOldVersions(keepVersion: string): Promise<void> {
  const { readdir } = await import('fs/promises')
  const root = installRoot()

  try {
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name === keepVersion) continue
      if (!/^version-[0-9a-f]+$/i.test(entry.name)) continue
      await removeDir(join(root, entry.name))
      logger.info(`Removed stale version ${entry.name}`)
    }
  } catch {
    // Nothing to clean.
  }

  try {
    const entries = await readdir(paths.downloads, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (entry.name.startsWith(`${keepVersion}-`)) continue
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
    return {
      ok: false,
      version: null,
      launched: false,
      message: 'A bootstrapper run is already in progress'
    }
  }

  running = true
  controller = new AbortController()
  const signal = controller.signal

  try {
    const versionGuid = await ensureInstalled({ force: options.force, signal })
    const directory = installDirectoryFor(versionGuid)
    const settings = getSettings()

    // Revert the previous run's mod files so disabled mods stop applying.
    const state = getRobloxState()
    if (state.modManifest.length > 0) {
      report({ stage: 'applying-mods', message: 'Reverting previous mods', progress: null })
      await revertMods(directory, state.modManifest)
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

    const binaryType = binaryTypeFor(settings.preferredLaunchMode)
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

  child.on('error', (error) => {
    logger.error(`Failed to spawn the Roblox client: ${error.message}`)
    emit('bootstrapper:error', {
      message: 'Roblox could not be started',
      detail: error.message
    })
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

  await removeDir(installRoot())
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
