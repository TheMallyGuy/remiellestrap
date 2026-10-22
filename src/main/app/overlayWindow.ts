import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import type { OverlayAnchor, OverlayRect } from '@shared/models'
import { createLogger } from '../utils/logger'
import { getSettings } from '../services/settingsStore'
import { hardenWindow } from './csp'

/**
 * The in-game overlay window.
 *
 * This file owns the window and nothing else: transparency, always-on-top,
 * click-through and the arithmetic that puts the card where the user asked for
 * it. What the overlay shows, and when it is shown, belongs to
 * `services/overlay.ts`.
 *
 * Three choices are worth spelling out:
 *
 *  * **`focusable: false`.** An overlay that takes focus would steal the
 *    keyboard from the game, which is the one thing it must never do.
 *  * **`transparent: true` with no shadow.** Only the card the renderer draws
 *    is visible; the rest of the window is nothing at all.
 *  * **The window is sized to the card, not to a guess.** The renderer measures
 *    what it actually drew and reports it back, so the invisible margin cannot
 *    swallow clicks while the overlay is being moved.
 */

const logger = createLogger('OverlayWindow')

/** Used until the renderer reports a real measurement. */
const DEFAULT_CARD_SIZE = { width: 248, height: 132 }

/** Hard limits on what the renderer may claim its card measures. */
const MIN_CARD_WIDTH = 120
const MAX_CARD_WIDTH = 640
const MIN_CARD_HEIGHT = 28
const MAX_CARD_HEIGHT = 640

let overlayWindow: BrowserWindow | null = null
let cardSize = { ...DEFAULT_CARD_SIZE }
let lastBounds: OverlayRect | null = null

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null
}

export function overlayCardSize(): { width: number; height: number } {
  return { ...cardSize }
}

/** Records the card size the overlay window measured for itself. */
export function setOverlayCardSize(width: number, height: number): void {
  const next = {
    width: Math.min(Math.max(Math.round(width), MIN_CARD_WIDTH), MAX_CARD_WIDTH),
    height: Math.min(Math.max(Math.round(height), MIN_CARD_HEIGHT), MAX_CARD_HEIGHT)
  }

  if (next.width === cardSize.width && next.height === cardSize.height) return

  cardSize = next
  // A card that grew or shrank has to be re-pinned to its corner.
  lastBounds = null
}

export function createOverlayWindow(): BrowserWindow {
  const existing = getOverlayWindow()
  if (existing) return existing

  const settings = getSettings()

  const window = new BrowserWindow({
    ...DEFAULT_CARD_SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    focusable: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    roundedCorners: false,
    // The overlay lives outside the launcher window, so it must not be pulled
    // into a parent/child relationship that would hide it with the app.
    enableLargerThanScreen: true,
    title: 'RemielleStrap Overlay',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false,
      // Without this an unfocused overlay throttles its own timers and the
      // session clock visibly stutters while the game has focus.
      backgroundThrottling: false
    }
  })

  overlayWindow = window

  // 'screen-saver' is the level that survives a fullscreen client on Windows
  // and sits above the menu bar on macOS.
  window.setAlwaysOnTop(true, 'screen-saver')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  applyClickThrough(settings.overlayClickThrough)

  window.on('closed', () => {
    overlayWindow = null
    lastBounds = null
  })

  hardenWindow(window)

  window.webContents.on('render-process-gone', (_event, details) => {
    logger.error(`Overlay renderer process gone: ${details.reason}`)
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    const url = new URL(process.env['ELECTRON_RENDERER_URL'])
    url.searchParams.set('view', 'overlay')
    void window.loadURL(url.toString())
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'), { query: { view: 'overlay' } })
  }

  logger.info('Overlay window created')
  return window
}

/**
 * Click-through is a whole-window property, so it is the setting that decides
 * it: while clicks pass through, the overlay cannot be dragged, and while it
 * can be dragged, its rectangle belongs to it rather than to the game. The
 * Overlays page says exactly that next to the switch.
 */
export function applyClickThrough(value: boolean): void {
  const window = getOverlayWindow()
  if (!window) return

  // `forward: true` keeps mouse-move events arriving, so the card can still
  // highlight what is under the cursor even while clicks fall through.
  window.setIgnoreMouseEvents(value, { forward: true })
}

export function showOverlayWindow(): void {
  const window = getOverlayWindow() ?? createOverlayWindow()

  if (!window.isVisible()) window.showInactive()
  window.moveTop()
}

export function hideOverlayWindow(): void {
  const window = getOverlayWindow()
  if (window?.isVisible()) window.hide()
  lastBounds = null
}

export function destroyOverlayWindow(): void {
  const window = getOverlayWindow()
  if (!window) return

  lastBounds = null
  window.destroy()
  overlayWindow = null
}

/**
 * Where the card should sit.
 *
 * The client window is the frame of reference when we have one, so the overlay
 * follows the game between displays and through a resize. Without one — off
 * Windows, or before the watcher has read anything — the display's work area
 * stands in, and the caller reports that honestly in the overlay's state.
 */
export function placeOverlay(
  reference: OverlayRect | null,
  anchor: OverlayAnchor,
  margin: number,
  offset: { x: number; y: number }
): OverlayRect | null {
  const window = getOverlayWindow()
  if (!window) return null

  const frame = reference ?? workArea()
  const { width, height } = cardSize

  let x: number
  let y: number

  switch (anchor) {
    case 'top-left':
      x = frame.x + margin
      y = frame.y + margin
      break
    case 'bottom-left':
      x = frame.x + margin
      y = frame.y + frame.height - height - margin
      break
    case 'bottom-right':
      x = frame.x + frame.width - width - margin
      y = frame.y + frame.height - height - margin
      break
    case 'custom':
      x = frame.x + offset.x
      y = frame.y + offset.y
      break
    case 'top-right':
    default:
      x = frame.x + frame.width - width - margin
      y = frame.y + margin
      break
  }

  x = Math.round(x)
  y = Math.round(y)

  // Keep the whole card on the display that holds the frame: an overlay dragged
  // off-screen is invisible *and* unreachable, which is worse than either.
  const area = displayAreaFor(frame)
  x = Math.min(Math.max(x, area.x), area.x + area.width - width)
  y = Math.min(Math.max(y, area.y), area.y + area.height - height)

  const bounds: OverlayRect = { x, y, width, height }

  // Setting bounds every tick makes the window flicker on some drivers, so it
  // only happens when the rectangle actually moved.
  if (
    !lastBounds ||
    lastBounds.x !== bounds.x ||
    lastBounds.y !== bounds.y ||
    lastBounds.width !== bounds.width ||
    lastBounds.height !== bounds.height
  ) {
    window.setBounds(bounds)
    lastBounds = bounds
  }

  return bounds
}

function workArea(): OverlayRect {
  const area = screen.getPrimaryDisplay().workArea
  return { x: area.x, y: area.y, width: area.width, height: area.height }
}

function displayAreaFor(frame: OverlayRect): OverlayRect {
  try {
    const area = screen.getDisplayMatching(frame).workArea
    return { x: area.x, y: area.y, width: area.width, height: area.height }
  } catch {
    return workArea()
  }
}
