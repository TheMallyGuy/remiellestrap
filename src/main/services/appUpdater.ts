import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'
import type { AppUpdateState, OperationResult } from '@shared/models'
import { createLogger } from '../utils/logger'
import { emit, toast } from './events'

/**
 * Application self-update.
 *
 * The published GitHub release is the source of truth. electron-updater checks
 * latest-mac.yml / latest-linux.yml / latest.yml, downloads the matching asset
 * in the background, and hands the OS installer the new package on restart.
 */

const logger = createLogger('AppUpdater')
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const DEV_UPDATE_URL = 'https://github.com/TheMallyGuy/remiellestrap'

let started = false
let timer: NodeJS.Timeout | null = null
let downloaded = false
let manualCheck = false
let checking = false
let lastStatus: AppUpdateState['status'] = 'idle'

function initialState(): AppUpdateState {
  return {
    status: isAutoUpdateSupported() ? 'idle' : 'not-supported',
    currentVersion: app.getVersion(),
    latestVersion: null,
    progress: null,
    bytesPerSecond: 0,
    bytesDownloaded: 0,
    bytesTotal: 0,
    releaseName: null,
    releaseNotes: null,
    releaseUrl: null,
    checkedAt: null,
    error: null
  }
}

let state: AppUpdateState = initialState()
lastStatus = state.status

function publish(patch: Partial<AppUpdateState>): void {
  state = { ...state, ...patch, currentVersion: app.getVersion() }
  lastStatus = state.status
  emit('app:update', state)
}

export function getUpdateState(): AppUpdateState {
  return { ...state, currentVersion: app.getVersion() }
}

/**
 * electron-updater only supports updating packaged installations. Development
 * builds, unpacked directories and targets without an updater (deb, for
 * example) should show a clean "open releases" fallback instead of throwing.
 */
export function isAutoUpdateSupported(): boolean {
  return app.isPackaged
}

function configureUpdater(): void {
  autoUpdater.logger = {
    info: (message: unknown) => logger.info(String(message)),
    warn: (message: unknown) => logger.warn(String(message)),
    error: (message: unknown) => logger.error(String(message)),
    debug: (message: unknown) => logger.debug(String(message))
  }

  // Do not interrupt a launch: the service decides when to download/install.
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.disableDifferentialDownload = false

  // In dev there is no generated update metadata, but point at the repository
  // so a force-checked release still resolves a real provider configuration.
  if (!app.isPackaged) {
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'TheMallyGuy',
      repo: 'remiellestrap'
    })
    // electron-updater ignores dev app-update.yml; keep the URL visible for debugging.
    logger.debug(`Development updater feed set to ${DEV_UPDATE_URL}`)
  }

  autoUpdater.on('checking-for-update', () => {
    checking = true
    publish({ status: 'checking', progress: null, error: null })
  })

  autoUpdater.on('update-available', (info) => {
    checking = false
    logger.info(`App update available: ${info.version}`)
    publish({
      status: 'available',
      latestVersion: info.version,
      releaseName: info.releaseName?.toString() ?? null,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
      releaseUrl: resolveReleaseUrl(info.version),
      checkedAt: Date.now(),
      progress: null,
      error: null
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    checking = false
    logger.info('App is up to date')
    publish({
      status: 'up-to-date',
      latestVersion: info?.version ?? app.getVersion(),
      releaseName: info?.releaseName?.toString() ?? null,
      releaseNotes: typeof info?.releaseNotes === 'string' ? info.releaseNotes : null,
      releaseUrl: info?.version ? resolveReleaseUrl(info.version) : null,
      checkedAt: Date.now(),
      progress: null,
      error: null
    })

    if (manualCheck) toast('success', 'RemielleStrap is up to date')
  })

  autoUpdater.on('download-progress', (progress) => {
    publish({
      status: 'downloading',
      progress: progress.percent ? progress.percent / 100 : null,
      bytesPerSecond: progress.bytesPerSecond,
      bytesDownloaded: progress.transferred,
      bytesTotal: progress.total,
      latestVersion: state.latestVersion,
      error: null
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    downloaded = true
    logger.info(`App update ${info.version} downloaded; it will install on restart`)
    publish({
      status: 'downloaded',
      latestVersion: info.version,
      releaseName: info.releaseName?.toString() ?? null,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null,
      releaseUrl: resolveReleaseUrl(info.version),
      progress: 1,
      error: null
    })

    toast(
      'success',
      'RemielleStrap update ready',
      `Version ${info.version} will install when you restart.`
    )
  })

  autoUpdater.on('error', (error) => {
    checking = false
    const message = error == null ? 'Unknown update error' : (error.stack ?? error.message)
    logger.error(`App update failed: ${message}`)
    publish({ status: 'error', error: message, progress: null })

    if (manualCheck) toast('error', 'Could not check for updates', error?.message)
  })
}

function resolveReleaseUrl(version: string): string {
  return `https://github.com/TheMallyGuy/remiellestrap/releases/tag/v${version}`
}

async function performCheck(autoDownload: boolean): Promise<AppUpdateState> {
  if (!isAutoUpdateSupported()) {
    publish({ status: 'not-supported', error: null, progress: null })
    return state
  }

  if (checking) return state

  try {
    checking = true
    manualCheck = !autoDownload
    autoUpdater.autoDownload = autoDownload

    publish({ status: 'checking', progress: null, error: null })
    await autoUpdater.checkForUpdates()
    return state
  } catch (error) {
    checking = false
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Update check failed: ${message}`)
    publish({ status: 'error', error: message, progress: null })
    if (manualCheck) toast('error', 'Could not check for updates', message)
    return state
  }
}

export async function checkForAppUpdates(): Promise<AppUpdateState> {
  return performCheck(false)
}

export async function downloadAppUpdate(): Promise<OperationResult> {
  if (!isAutoUpdateSupported()) {
    return { ok: false, error: 'Automatic updates are not available in this build' }
  }

  try {
    if (lastStatus !== 'available' && lastStatus !== 'error') {
      const result = await autoUpdater.checkForUpdates()
      if (!result?.updateInfo || result.updateInfo.version === app.getVersion()) {
        return { ok: true }
      }
    }

    publish({ status: 'downloading', progress: null, error: null })
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Update download failed: ${message}`)
    publish({ status: 'error', error: message })
    return { ok: false, error: message }
  }
}

export function restartAndInstall(): OperationResult {
  if (!downloaded) return { ok: false, error: 'No downloaded update is ready' }

  try {
    // isSilent keeps NSIS quiet; isForceRunAfter relaunches the new app.
    autoUpdater.quitAndInstall(true, true)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Restart to install failed: ${message}`)
    return { ok: false, error: message }
  }
}

function scheduleNextCheck(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void checkOnSchedule()
  }, CHECK_INTERVAL_MS)
}

async function checkOnSchedule(): Promise<void> {
  if (downloaded) {
    scheduleNextCheck()
    return
  }

  await performCheck(true)
  scheduleNextCheck()
}

/** Starts background update checks after the app is ready. */
export function startAppUpdater(): void {
  if (started) return
  started = true

  if (!isAutoUpdateSupported()) {
    if (is.dev) logger.info('Automatic app updates are disabled in development')
    publish({ status: 'not-supported' })
    return
  }

  configureUpdater()

  setTimeout(() => {
    void performCheck(true).finally(scheduleNextCheck)
  }, 8_000)

  logger.info('Application auto-updater started')
}

export function disposeAppUpdater(): void {
  if (timer) clearTimeout(timer)
  timer = null
  autoUpdater.removeAllListeners()
  started = false
}
