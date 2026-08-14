import { app } from 'electron'
import { createLogger } from '../utils/logger'
import { findLaunchUri, sanitizeLaunchUri } from '../utils/uri'
import { emit } from '../services/events'
import { getMainWindow, showMainWindow } from './window'
import { setPendingUri } from '../ipc/index'
import * as bootstrapper from '../core/bootstrapper'

/**
 * Deep-link handling for the `roblox:` and `roblox-player:` protocols.
 *
 * Three paths must all work:
 *   cold start      — argv contains the URI before any window exists
 *   warm start      — the app is already open and Windows re-invokes it,
 *                     which arrives as second-instance argv
 *   macOS/Linux     — the `open-url` event
 *
 * In every case the URI is sanitised, then the renderer is told to show the
 * bootstrapper overlay immediately rather than landing on a settings page.
 */

const logger = createLogger('DeepLink')

export const PROTOCOLS = ['roblox', 'roblox-player'] as const

/** Registers the app as the handler for the Roblox protocols. */
export function registerProtocols(): void {
  for (const scheme of PROTOCOLS) {
    // In dev the executable is electron.exe, so the argv form is required for
    // Windows to build a working registry command.
    const registered =
      process.defaultApp && process.argv.length >= 2
        ? app.setAsDefaultProtocolClient(scheme, process.execPath, [process.argv[1]])
        : app.setAsDefaultProtocolClient(scheme)

    if (registered) logger.info(`Registered protocol handler for ${scheme}:`)
    else logger.warn(`Could not register protocol handler for ${scheme}:`)
  }
}

/** Removes the protocol registrations (used by uninstall). */
export function unregisterProtocols(): void {
  for (const scheme of PROTOCOLS) {
    app.removeAsDefaultProtocolClient(scheme)
  }
}

/**
 * Acts on a launch URI. When no window exists yet the URI is stashed so the
 * renderer can collect it via `bootstrapper:getPendingUri` once it mounts.
 */
export function handleLaunchUri(rawUri: string | null | undefined, source: string): void {
  const uri = sanitizeLaunchUri(rawUri)

  if (!uri) {
    if (rawUri) logger.warn(`Ignored unsafe launch URI from ${source}`)
    return
  }

  logger.info(`Launch URI from ${source}: ${uri.slice(0, 120)}`)

  if (!getMainWindow()) {
    // Cold start: the renderer will ask for this as soon as it is ready.
    setPendingUri(uri)
    return
  }

  // The bootstrapper window is the single progress surface now, so there is no
  // need to surface the main window first. Give any open window an immediate
  // "preparing" state, then hand off to the bootstrapper run.
  emit('bootstrapper:progress', {
    ...bootstrapper.currentProgress(),
    stage: 'connecting',
    message: 'Preparing to launch Roblox…',
    cancellable: true
  })

  void bootstrapper.launch({ uri, force: true }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Deep-link launch failed: ${message}`)
    emit('bootstrapper:error', { message: 'Launch failed', detail: message })
  })
}

/** Extracts a launch URI from a process argv array, if present. */
export function uriFromArgv(argv: readonly string[]): string | null {
  return findLaunchUri(argv)
}

/**
 * Wires the single-instance lock. Returns false when another instance already
 * owns the lock, in which case the caller must quit immediately.
 */
export function acquireSingleInstanceLock(): boolean {
  const gotLock = app.requestSingleInstanceLock()

  if (!gotLock) {
    logger.info('Another instance is already running; forwarding arguments and exiting')
    return false
  }

  app.on('second-instance', (_event, argv) => {
    logger.info('Second instance detected')

    const uri = uriFromArgv(argv)
    if (uri) handleLaunchUri(uri, 'second-instance')
    else showMainWindow()
  })

  return true
}

/** macOS/Linux protocol delivery. */
export function registerOpenUrlHandler(): void {
  app.on('open-url', (event, url) => {
    event.preventDefault()
    handleLaunchUri(url, 'open-url')
  })
}
