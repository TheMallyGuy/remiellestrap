import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { WindowBounds } from '@shared/settings'
import { createLogger } from '../utils/logger'
import { getSettings, saveSettingsQuiet } from '../services/settingsStore'
import { emit } from '../services/events'
import { hardenWindow } from './csp'

/**
 * Main window lifecycle: a frameless window with a custom titlebar, remembered
 * geometry, and close-to-tray behaviour.
 */

const logger = createLogger('Window')

const MIN_WIDTH = 940
const MIN_HEIGHT = 640
const DEFAULT_WIDTH = 1120
const DEFAULT_HEIGHT = 740

let mainWindow: BrowserWindow | null = null
let saveTimer: NodeJS.Timeout | null = null
/** Set when the user really wants to exit, so close is not swallowed by tray. */
let quitting = false

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

export function setQuitting(value: boolean): void {
  quitting = value
}

export function isQuitting(): boolean {
  return quitting
}

/** Clamps remembered geometry so the window can never open off-screen. */
function restoreBounds(bounds: WindowBounds | null): Partial<Electron.BrowserWindowConstructorOptions> {
  if (!bounds) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }

  const width = Math.max(MIN_WIDTH, Math.round(bounds.width) || DEFAULT_WIDTH)
  const height = Math.max(MIN_HEIGHT, Math.round(bounds.height) || DEFAULT_HEIGHT)

  if (bounds.x === null || bounds.y === null) return { width, height }

  // Electron itself will not place a window on a display that no longer
  // exists, but a stale negative origin can still hide the titlebar.
  const displays = screen.getAllDisplays()
  const visible = displays.some((display) => {
    const area = display.workArea
    return (
      bounds.x! < area.x + area.width &&
      bounds.x! + width > area.x &&
      bounds.y! < area.y + area.height &&
      bounds.y! + height > area.y
    )
  })

  return visible
    ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height }
    : { width, height }
}

function persistBounds(): void {
  const window = getMainWindow()
  if (!window) return

  // Debounced: resize fires continuously while dragging.
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    const current = getMainWindow()
    if (!current) return

    const maximized = current.isMaximized()
    // Persist the restored size, not the maximised one, so unmaximising works.
    const rect = maximized ? current.getNormalBounds() : current.getBounds()

    void saveSettingsQuiet({
      windowBounds: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        maximized
      }
    }).catch(() => {
      /* geometry is a nicety; never surface a failure */
    })
  }, 400)
}

function publishWindowState(): void {
  const window = getMainWindow()
  if (!window) return

  emit('window:state', {
    maximized: window.isMaximized(),
    focused: window.isFocused()
  })
}

export function createMainWindow(): BrowserWindow {
  const existing = getMainWindow()
  if (existing) return existing

  const settings = getSettings()
  const bounds = restoreBounds(settings.windowBounds)

  const window = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    frame: false,
    // The custom titlebar is drawn by the renderer; keep the OS chrome away
    // but let Windows keep its native rounded corners and shadow.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    backgroundColor: '#0a0a0b',
    autoHideMenuBar: true,
    title: 'RemielleStrap',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  mainWindow = window

  if (settings.windowBounds?.maximized) window.maximize()

  window.on('ready-to-show', () => {
    window.show()
    if (settings.windowBounds?.maximized) window.maximize()
  })

  window.on('resize', persistBounds)
  window.on('move', persistBounds)

  window.on('maximize', () => {
    persistBounds()
    publishWindowState()
  })
  window.on('unmaximize', () => {
    persistBounds()
    publishWindowState()
  })
  window.on('focus', publishWindowState)
  window.on('blur', publishWindowState)

  window.on('close', (event) => {
    // Closing to tray keeps activity tracking and rich presence alive.
    if (!quitting && getSettings().minimizeToTray) {
      event.preventDefault()
      window.hide()
      logger.info('Window hidden to tray')
      return
    }

    // Flush geometry synchronously-ish before teardown.
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }

    const maximized = window.isMaximized()
    const rect = maximized ? window.getNormalBounds() : window.getBounds()
    void saveSettingsQuiet({
      windowBounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, maximized }
    }).catch(() => undefined)
  })

  window.on('closed', () => {
    mainWindow = null
  })

  hardenWindow(window)

  // Anything that slips past the window-open handler still goes nowhere.
  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Renderer process gone: ${details.reason}`)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  logger.info('Main window created')
  return window
}

/** Brings the window back from tray/minimised state and focuses it. */
export function showMainWindow(): BrowserWindow {
  const window = getMainWindow() ?? createMainWindow()

  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()

  return window
}

/** Asks the renderer to navigate; used by the tray and deep links. */
export function navigateTo(page: string): void {
  const window = getMainWindow()
  if (!window) return

  window.webContents.send('navigate:page', { page })
}

export function openLogsFolderFor(path: string): void {
  void shell.openPath(path)
}
