import { app, Notification } from 'electron'
import { join } from 'path'
import { createLogger } from '../utils/logger'
import { onEvent } from '../services/events'
import { getSettings } from '../services/settingsStore'
import { showMainWindow } from './window'

/**
 * Desktop notifications.
 *
 * Each notification is opt-in through settings, mirrors an event that already
 * exists on the bus, and clicking one brings the window forward.
 */

const logger = createLogger('Notifications')

let disposers: Array<() => void> = []

function iconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(__dirname, '../../resources/icon.png')
}

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return

  try {
    const notification = new Notification({
      title,
      body,
      icon: iconPath(),
      silent: false
    })

    notification.on('click', () => showMainWindow())
    notification.show()
  } catch (error) {
    logger.warn(`Failed to show notification: ${String(error)}`)
  }
}

function formatPlaytime(ms: number): string {
  if (ms <= 0) return ''

  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${Math.floor(ms / 1000)}s`
}

export function registerNotifications(): void {
  disposers = [
    onEvent('bootstrapper:complete', (result) => {
      if (!getSettings().notifyOnInstallComplete) return
      if (!result.ok || result.launched) return

      notify(
        'Roblox is ready',
        result.version ? `Installed ${result.version}` : 'Installation finished'
      )
    }),

    onEvent('activity:update', (update) => {
      if (!getSettings().notifyOnActivityJoin) return
      if (!update.inGame || !update.activity) return

      const name = update.activity.gameName ?? `Place ${update.activity.placeId}`
      notify('Joined an experience', name)
    }),

    onEvent('roblox:exit', (payload) => {
      if (!getSettings().notifyOnRobloxExit) return

      const played = formatPlaytime(payload.playtimeMs)
      notify('Roblox closed', played ? `You played for ${played}` : 'Your session has ended')
    })
  ]

  logger.info('Notification listeners registered')
}

export function disposeNotifications(): void {
  for (const dispose of disposers) dispose()
  disposers = []
}
