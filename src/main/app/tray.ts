import { app, Menu, nativeImage, Tray } from 'electron'
import { join } from 'path'
import type { MenuItemConstructorOptions } from 'electron'
import { createLogger } from '../utils/logger'
import { onEvent } from '../services/events'
import * as activity from '../services/activity'
import * as bootstrapper from '../core/bootstrapper'
import * as accounts from '../services/accounts'
import * as servers from '../services/servers'
import { getState } from '../services/stateStore'
import type { RobloxAccount } from '@shared/models'
import { getSettings, saveSettings } from '../services/settingsStore'
import { REGION_CATALOG, regionById } from '@shared/catalog'
import { navigateTo, setQuitting, showMainWindow } from './window'

/**
 * System tray icon and menu.
 *
 * The menu is rebuilt whenever activity changes so "Rejoin last server" and
 * the current-experience line stay accurate.
 */

const logger = createLogger('Tray')

/**
 * The tray menu is built synchronously, so the account list is cached and kept
 * fresh by the `accounts:changed` event rather than fetched per menu build.
 */
let accountCache: RobloxAccount[] = []

async function refreshAccountCache(): Promise<void> {
  try {
    accountCache = await accounts.listAccounts()
  } catch {
    accountCache = []
  }
}

/** Regions offered directly in the tray, in the order they are listed. */
const REGION_CHOICES = REGION_CATALOG.filter((entry) => entry.id !== 'any').map((entry) => ({
  id: entry.id,
  label: entry.label
}))

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

/**
 * The account quick-switcher.
 *
 * Switching from the tray writes `activeAccountId` immediately — that is the
 * whole point of it — and marks the choice with a tick so the current account
 * is obvious without opening the window.
 */
function accountSubmenu(): MenuItemConstructorOptions[] {
  const settings = getSettings()
  const users = accountCache

  if (users.length === 0) {
    return [{ label: 'No accounts stored', enabled: false }]
  }

  const items: MenuItemConstructorOptions[] = users.map((account) => ({
    label: `${account.displayName} (@${account.username})${account.valid ? '' : ' — signed out'}`,
    type: 'radio',
    checked: account.id === settings.activeAccountId,
    click: () => {
      void accounts.setActive(account.id).catch((error) => {
        logger.warn(`Could not switch accounts from the tray: ${String(error)}`)
      })
    }
  }))

  items.push(
    { type: 'separator' },
    {
      label: 'Not signed in',
      type: 'radio',
      checked: settings.activeAccountId === null,
      click: () => {
        void saveSettings({ activeAccountId: null })
      }
    },
    { type: 'separator' },
    {
      label: 'Manage accounts…',
      click: () => {
        showMainWindow()
        navigateTo('accounts')
      }
    }
  )

  return items
}

/**
 * "Join a server in <region>".
 *
 * The region is taken from settings, and the place is whatever the client is
 * playing or last played: a tray join is for continuing what you were doing,
 * not for choosing a new game.
 */
function regionJoin(regionId: string): void {
  const current = activity.currentActivity()

  void (async () => {
    const placeId = current.activity?.placeId ?? getState().lastActivity?.placeId

    if (!placeId) {
      showMainWindow()
      navigateTo('servers')
      return
    }

    try {
      const result = await servers.joinServer({
        placeId,
        region: regionId === 'any' ? undefined : regionId,
        accountId: getSettings().activeAccountId ?? null
      })

      if (!result.launched) logger.warn(`Tray region join did not launch: ${result.message}`)
    } catch (error) {
      logger.error(`Tray region join failed: ${String(error)}`)
    }
  })()
}

function buildMenu(): Menu {
  const current = activity.currentActivity()
  const running = current.robloxRunning
  const inGame = current.inGame && current.activity !== null
  const canRejoin = activity.rejoinUri() !== null
  const region = regionById(getSettings().preferredRegion)

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
      label: 'Join region server…',
      enabled: !inGame,
      submenu: [
        {
          label: region.label,
          click: () => regionJoin(getSettings().preferredRegion)
        },
        { type: 'separator' },
        ...REGION_CHOICES.filter((choice) => choice.id !== getSettings().preferredRegion).map(
          (choice) => ({
            label: choice.label,
            click: () => regionJoin(choice.id)
          })
        ),
        { type: 'separator' },
        {
          label: 'Choose another region…',
          click: () => {
            showMainWindow()
            navigateTo('servers')
          }
        }
      ]
    },
    {
      label: 'Launch as…',
      submenu: accountSubmenu()
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
    {
      label: 'Logs',
      enabled: getSettings().trayShowLogs,
      click: () => {
        showMainWindow()
        navigateTo('utilities')
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

  // Seed the account list and keep it in step with the main process.
  void refreshAccountCache()
  disposers.push(
    onEvent('accounts:changed', (state) => {
      accountCache = state.accounts
      refresh()
    })
  )

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
