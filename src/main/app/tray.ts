import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'
import type { MenuItemConstructorOptions } from 'electron'
import { createLogger } from '../utils/logger'
import { onEvent } from '../services/events'
import * as activity from '../services/activity'
import * as bootstrapper from '../core/bootstrapper'
import { navigateTo, setQuitting, showMainWindow } from './window'

/**
 * System tray icon and menu.
 *
 * The menu is rebuilt whenever activity changes so "Rejoin last server" and
 * the current-experience line stay accurate.
 */

const logger = createLogger('Tray')

let tray: Tray | null = null
let disposers: Array<() => void> = []

function iconPath(): string {
  // Packaged builds keep resources next to the app; dev reads from the repo.
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

function truncate(text: string, max = 42): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function buildMenu(): Menu {
  const current = activity.currentActivity()
  const running = current.robloxRunning
  const inGame = current.inGame && current.activity !== null
  const canRejoin = activity.rejoinUri() !== null

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Open RemielleStrap',
      click: () => {
        showMainWindow()
      }
    },
    { type: 'separator' },
    {
      label: inGame
        ? truncate(`In: ${current.activity?.gameName ?? `Place ${current.activity?.placeId}`}`)
        : running
          ? 'Roblox is running'
          : 'Not playing',
      enabled: false
    },
    {
      label: 'View activity',
      enabled: inGame,
      click: () => {
        showMainWindow()
        navigateTo('home')
      }
    },
    {
      label: 'Rejoin last server',
      enabled: canRejoin && !bootstrapper.isBusy(),
      click: () => {
        const uri = activity.rejoinUri()
        if (!uri) return

        showMainWindow()
        void bootstrapper.launch({ uri, force: true }).catch((error) => {
          logger.error(`Tray rejoin failed: ${String(error)}`)
        })
      }
    },
    {
      label: 'Close Roblox',
      enabled: running,
      click: () => {
        void activity.killRoblox().catch(() => undefined)
      }
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        showMainWindow()
        navigateTo('behaviour')
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        setQuitting(true)
        app.quit()
      }
    }
  ]

  return Menu.buildFromTemplate(template)
}

function refresh(): void {
  if (!tray || tray.isDestroyed()) return

  const current = activity.currentActivity()
  const tooltip =
    current.inGame && current.activity
      ? `RemielleStrap — ${truncate(current.activity.gameName ?? `Place ${current.activity.placeId}`, 60)}`
      : 'RemielleStrap'

  tray.setToolTip(tooltip)
  tray.setContextMenu(buildMenu())
}

export function createTray(): void {
  if (tray && !tray.isDestroyed()) return

  let image = nativeImage.createFromPath(iconPath())
  if (image.isEmpty()) {
    logger.warn('Tray icon could not be loaded; using an empty image')
  } else {
    image = image.resize({ width: 16, height: 16 })
  }

  tray = new Tray(image)
  tray.setToolTip('RemielleStrap')
  tray.setContextMenu(buildMenu())

  // Left-click opens the window on Windows; macOS shows the menu instead.
  tray.on('click', () => {
    if (process.platform === 'win32') showMainWindow()
  })
  tray.on('double-click', () => showMainWindow())

  disposers = [
    onEvent('activity:update', refresh),
    onEvent('activity:leave', refresh),
    onEvent('roblox:exit', refresh),
    onEvent('bootstrapper:complete', refresh)
  ]

  logger.info('Tray created')
}

export function destroyTray(): void {
  for (const dispose of disposers) dispose()
  disposers = []

  if (tray && !tray.isDestroyed()) tray.destroy()
  tray = null
}
