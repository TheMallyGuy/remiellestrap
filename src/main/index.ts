import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { paths } from './utils/paths'
import { ensureDir } from './utils/fs'
import { closeLogger, createLogger, initLogger } from './utils/logger'
import { loadSettings, getSettings } from './services/settingsStore'
import { loadRobloxState, loadState } from './services/stateStore'
import { onEvent, toast } from './services/events'
import * as activity from './services/activity'
import * as rpc from './services/rpc'
import * as booru from './services/booru'
import { disposeIpcHandlers, registerIpcHandlers } from './ipc/index'
import { installCsp } from './app/csp'
import { registerProtocolHandler, registerSchemes } from './app/protocol'
import { createMainWindow, getMainWindow, isQuitting, setQuitting, showMainWindow } from './app/window'
import { createTray, destroyTray } from './app/tray'
import { disposeNotifications, registerNotifications } from './app/notifications'
import {
  acquireSingleInstanceLock,
  handleLaunchUri,
  registerOpenUrlHandler,
  registerProtocols,
  uriFromArgv
} from './app/deeplink'

/**
 * Application entry point.
 *
 * Order matters here: privileged schemes must be declared before the app is
 * ready, the single-instance lock must be taken before any window is created,
 * and settings/state must be loaded before anything reads them.
 */

const APP_ID = 'com.themallyguy.remiellestrap'

// Must run before `app.whenReady()`.
registerSchemes()

// A second instance forwards its argv to the first one and exits immediately;
// nothing below should run twice.
if (!acquireSingleInstanceLock()) {
  app.quit()
} else {
  registerOpenUrlHandler()
  void bootstrap()
}

async function bootstrap(): Promise<void> {
  await app.whenReady()

  electronApp.setAppUserModelId(APP_ID)

  // Create the data tree before the logger tries to write into it.
  await ensureDir(paths.root)
  await ensureDir(paths.logs)
  initLogger()

  const logger = createLogger('App')
  logger.info(`RemielleStrap ${app.getVersion()} starting on ${process.platform}`)
  logger.info(`Data root: ${paths.root}`)

  try {
    await Promise.all([loadSettings(), loadState(), loadRobloxState()])
  } catch (error) {
    logger.error(`Failed to load persisted data: ${String(error)}`)
  }

  await Promise.all([
    ensureDir(paths.cache),
    ensureDir(paths.artCache),
    ensureDir(paths.mods),
    ensureDir(paths.versions),
    ensureDir(paths.downloads)
  ])

  installCsp()
  registerProtocolHandler()
  registerProtocols()
  registerIpcHandlers()
  registerNotifications()

  app.on('browser-window-created', (_event, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  const settings = getSettings()

  if (settings.enableActivityTracking) activity.start()
  if (settings.enableDiscordRpc) {
    rpc.start()
    rpc.setIdle()
  }

  // Keep rich presence in step with what the user is playing.
  onEvent('activity:update', (update) => {
    if (update.inGame && update.activity) rpc.setPlaying(update.activity)
    else rpc.setIdle()
  })
  onEvent('activity:leave', () => rpc.setIdle())

  // Apply runtime toggles the moment settings change.
  onEvent('settings:changed', (next) => {
    rpc.refresh()

    if (next.enableActivityTracking) activity.start()
    else activity.stop()
  })

  createMainWindow()

  // The tray is always created: it is the only way back into the app once
  // close-to-tray is switched on mid-session.
  createTray()

  // Warm the art cache in the background so the UI is not empty on first paint.
  void booru.prefetchAllSlots().catch((error) => {
    logger.warn(`Art prefetch failed: ${String(error)}`)
  })

  // Cold start: a URI may already be sitting in argv.
  const coldUri = uriFromArgv(process.argv)
  if (coldUri) {
    logger.info('Cold start with a launch URI')
    handleLaunchUri(coldUri, 'cold-start')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else showMainWindow()
  })

  logger.info('Startup complete')
}

app.on('window-all-closed', () => {
  // With close-to-tray on, the window is hidden rather than closed, so this
  // only fires on a real exit.
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  setQuitting(true)
})

app.on('will-quit', () => {
  const logger = createLogger('App')
  logger.info('Shutting down')

  activity.stop()
  rpc.stop()
  disposeNotifications()
  destroyTray()
  disposeIpcHandlers()
  closeLogger()
})

// A crash in an async handler must not take the whole process down silently.
process.on('uncaughtException', (error) => {
  try {
    createLogger('Process').error(`Uncaught exception: ${error.stack ?? error.message}`)
    if (getMainWindow() && !isQuitting()) {
      toast('error', 'Something went wrong', error.message)
    }
  } catch {
    /* logging must never throw during crash handling */
  }
})

process.on('unhandledRejection', (reason) => {
  try {
    const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    createLogger('Process').error(`Unhandled rejection: ${message}`)
  } catch {
    /* as above */
  }
})
