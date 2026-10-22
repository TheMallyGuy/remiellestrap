import { globalShortcut } from 'electron'
import type {
  OverlayPositionRequest,
  OverlayRect,
  OverlayState,
  OverlayStats
} from '@shared/models'
import { acceleratorLabel } from '@shared/catalog'
import { createLogger } from '../utils/logger'
import { emit, onEvent } from './events'
import { getSettings, saveSettings } from './settingsStore'
import { getState } from './stateStore'
import { currentActivity } from './activity'
import { activeAccount } from './accounts'
import { listServers } from './servers'
import {
  clientWindowSample,
  startClientWindowWatcher,
  stopClientWindowWatcher,
  windowTrackingSupported
} from './tweaks'
import {
  applyClickThrough,
  createOverlayWindow,
  destroyOverlayWindow,
  getOverlayWindow,
  overlayCardSize,
  placeOverlay,
  setOverlayCardSize,
  showOverlayWindow
} from '../app/overlayWindow'

/**
 * The in-game overlay.
 *
 * A small card drawn on top of the Roblox client, showing how the session is
 * going. Everything it knows comes from somewhere else in this app — the
 * activity watcher, the playtime ledger, the server browser, the process
 * watcher — so this service is a sampler and a scheduler rather than a second
 * source of truth.
 *
 * The rule it holds itself to is the one the rest of the app follows: no figure
 * is invented. Roblox publishes an average framerate and an average ping per
 * server, reported by the clients connected to it, and those numbers are useful
 * — but they are labelled as what they are, and a value that could not be
 * obtained is drawn as absent with the reason attached.
 */

const logger = createLogger('Overlay')

/** Never sample faster than this, whatever the setting says. */
const TICK_FLOOR_MS = 500

let pollTimer: NodeJS.Timeout | null = null
let started = false

let visible = false
let preview = false
let hotkeyRegistered: string | null = null
let hotkeyError: string | null = null

let lastStats: OverlayStats | null = null
let lastPublishedState = ''
let disposers: Array<() => void> = []

/**
 * Set while the card is being dragged, so the tick does not re-pin it to its
 * corner underneath the cursor. It expires on its own: a drag that ends without
 * a commit (a crash, an alt-tab) must not leave the overlay unplaceable.
 */
let draggingUntil = 0
const DRAG_GRACE_MS = 1500

/**
 * Set when an on-demand sample starts the window watcher, so it is stopped
 * again once the page has stopped asking rather than running for the session.
 */
let watcherGraceUntil = 0
let watcherGraceTimer: NodeJS.Timeout | null = null
const WATCHER_GRACE_MS = 15_000

/** Server-list figures, refreshed on their own slower cadence. */
interface ServerFigures {
  placeId: string | null
  jobId: string | null
  fetchedAt: number
  fps: number | null
  ping: number | null
  region: string | null
  datacenter: string | null
  players: number | null
  maxPlayers: number | null
  /** True when the job we are in was found on the list we fetched. */
  found: boolean
  error: string | null
}

const NO_SERVER_FIGURES: ServerFigures = {
  placeId: null,
  jobId: null,
  fetchedAt: 0,
  fps: null,
  ping: null,
  region: null,
  datacenter: null,
  players: null,
  maxPlayers: null,
  found: false,
  error: null
}

let serverFigures: ServerFigures = { ...NO_SERVER_FIGURES }

/** Display name of the account this session was launched as. */
let accountName: string | null = null

/* ------------------------------------------------------------------ State */

/** The rectangle the overlay is pinned to, or null when nothing was measured. */
function referenceRect(): OverlayRect | null {
  return getSettings().overlayFollowWindow ? clientWindowSample().bounds : null
}

export function state(): OverlayState {
  const settings = getSettings()
  const window = getOverlayWindow()
  const tracking = settings.overlayFollowWindow && clientWindowSample().bounds !== null

  return {
    enabled: settings.overlayEnabled,
    visible: Boolean(window?.isVisible()) && (visible || preview),
    supported: windowTrackingSupported(),
    reason: stateReason(tracking),
    clickThrough: settings.overlayClickThrough,
    anchor: settings.overlayAnchor,
    bounds: window && !window.isDestroyed() ? window.getBounds() : null,
    tracking,
    hotkey: hotkeyRegistered,
    hotkeyError,
    preview,
    contentSize: overlayCardSize(),
    stats: lastStats
  }
}

/** The one sentence that explains what the overlay is doing, or why it cannot. */
function stateReason(tracking: boolean): string | null {
  const settings = getSettings()

  if (preview) return 'Preview: placeholder figures, drawn while nothing is running.'
  if (!visible)
    return settings.overlayEnabled ? 'Hidden until a game session starts.' : 'Switched off.'
  if (!settings.overlayFollowWindow)
    return 'Following is off, so the overlay stays where you left it.'
  if (!windowTrackingSupported()) {
    return 'Window tracking is Windows-only, so the overlay is pinned to the primary display.'
  }

  return tracking ? null : 'The client window has not been found yet.'
}

function publishState(): void {
  const next = state()

  // Only a real difference is published: the page polls this into a card, and
  // emitting six times a second would redraw it for nothing.
  const signature = JSON.stringify({
    enabled: next.enabled,
    visible: next.visible,
    supported: next.supported,
    reason: next.reason,
    clickThrough: next.clickThrough,
    anchor: next.anchor,
    bounds: next.bounds,
    tracking: next.tracking,
    hotkey: next.hotkey,
    hotkeyError: next.hotkeyError,
    preview: next.preview,
    contentSize: next.contentSize
  })

  if (signature === lastPublishedState) return
  lastPublishedState = signature
  emit('overlay:state', next)
}

/* -------------------------------------------------------------- Sampling */

/** The account name is cached and refreshed by events, not read every tick. */
async function refreshAccountName(): Promise<void> {
  try {
    const account = await activeAccount()
    accountName = account?.displayName ?? account?.username ?? null
  } catch {
    accountName = null
  }
}

/**
 * Pulls the current server's figures out of the public server list.
 *
 * Roblox reports an average framerate and an average ping per server there,
 * collected from the clients connected to it. That is the only framerate or
 * latency figure an outside process can honestly obtain, and the server browser
 * already caches the list, so asking again is nearly free.
 */
async function refreshServerFigures(placeId: string, jobId: string | null): Promise<void> {
  const settings = getSettings()
  const ttl = Math.max(settings.overlayServerStatsSeconds, 5) * 1000

  const fresh =
    serverFigures.placeId === placeId &&
    serverFigures.jobId === jobId &&
    Date.now() - serverFigures.fetchedAt < ttl

  if (fresh) return

  try {
    // A wider page than the browser shows: the server we are in is not
    // necessarily among the first fifty, and missing it would report "unknown"
    // for a server we could perfectly well have found.
    const list = await listServers({ placeId, limit: 100 })
    const match = jobId ? (list.servers.find((server) => server.id === jobId) ?? null) : null

    serverFigures = {
      placeId,
      jobId,
      fetchedAt: Date.now(),
      fps: match?.fps ?? null,
      ping: match?.ping ?? null,
      region: match?.region ?? null,
      datacenter: match?.datacenter ?? null,
      players: match?.playing ?? null,
      maxPlayers: match?.maxPlayers ?? null,
      found: match !== null,
      error: list.error
    }
  } catch (error) {
    serverFigures = {
      ...NO_SERVER_FIGURES,
      placeId,
      jobId,
      fetchedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/** Reads everything the overlay draws, from the services that already own it. */
async function buildStats(): Promise<OverlayStats> {
  const settings = getSettings()
  const activity = currentActivity()
  const entry = activity.activity
  const sample = clientWindowSample()

  const inGame = activity.inGame && entry !== null
  const sessionMs = entry ? Math.max(0, Date.now() - entry.joinedAt) : null

  if (inGame && entry) await refreshServerFigures(entry.placeId, entry.jobId)

  // The playtime ledger is the fallback while the client is open but the
  // activity watcher has not attributed an experience yet.
  const openSession = getState().playtime?.openSessionStartedAt ?? null
  const fallbackSession =
    sessionMs === null && openSession ? Math.max(0, Date.now() - openSession) : null

  const notices: string[] = []
  const widgets = settings.overlayWidgets

  if (inGame && (widgets.includes('fps') || widgets.includes('ping'))) {
    if (serverFigures.fps !== null || serverFigures.ping !== null) {
      notices.push(
        'Framerate and ping are averages other players reported for this server, not measurements of this machine.'
      )
    } else if (!serverFigures.found && !serverFigures.error) {
      notices.push('This server was not on the public list we fetched, so its figures are absent.')
    }
  }

  if (serverFigures.error && inGame) {
    notices.push(`The server list could not be read: ${serverFigures.error}`)
  }

  if (sample.bounds === null && (visible || preview)) {
    notices.push(
      windowTrackingSupported()
        ? 'The client window has not been found, so the overlay is pinned to the display.'
        : 'Window tracking is Windows-only, so the overlay is pinned to the primary display.'
    )
  } else if (sample.fullscreen) {
    notices.push(
      'The client fills the whole screen. In exclusive fullscreen the overlay may be drawn behind it.'
    )
  }

  if (sample.workingSetBytes === null && !windowTrackingSupported()) {
    notices.push('Memory and CPU come from the client process watcher, which needs Windows.')
  }

  return {
    sampledAt: Date.now(),
    clientRunning: activity.robloxRunning,
    inGame,
    gameName: entry?.gameName ?? null,
    placeId: entry?.placeId ?? null,
    jobId: entry?.jobId ?? null,
    serverType: entry?.serverType ?? null,
    sessionMs: sessionMs ?? fallbackSession,
    fps: inGame ? serverFigures.fps : null,
    fpsSource: inGame && serverFigures.fps !== null ? 'server-reported' : 'none',
    ping: inGame ? serverFigures.ping : null,
    pingSource: inGame && serverFigures.ping !== null ? 'server-reported' : 'none',
    region: inGame ? serverFigures.region : null,
    datacenter: inGame ? serverFigures.datacenter : null,
    players: inGame ? serverFigures.players : null,
    maxPlayers: inGame ? serverFigures.maxPlayers : null,
    workingSetBytes: sample.workingSetBytes,
    cpuPercent: sample.cpuPercent,
    accountName,
    windowTracked: sample.bounds !== null,
    clientFullscreen: sample.fullscreen,
    notices
  }
}

/**
 * Placeholder figures for the preview.
 *
 * The client is *not* reported as running: the card is filled in so it can be
 * arranged and read, while the state and the first notice say plainly that
 * nothing is being measured.
 */
async function previewStats(): Promise<OverlayStats> {
  const settings = getSettings()
  const real = await buildStats()

  return {
    ...real,
    gameName: real.gameName ?? 'Remielle’s Prism Garden',
    placeId: real.placeId ?? '0000000000',
    jobId: real.jobId ?? 'preview',
    serverType: real.serverType ?? 'public',
    sessionMs: real.sessionMs ?? 42 * 60_000 + 17_000,
    fps: real.fps ?? 60,
    fpsSource: real.fps === null ? 'server-reported' : real.fpsSource,
    ping: real.ping ?? 38,
    pingSource: real.ping === null ? 'server-reported' : real.pingSource,
    region:
      real.region ?? (settings.preferredRegion === 'any' ? 'europe' : settings.preferredRegion),
    players: real.players ?? 18,
    maxPlayers: real.maxPlayers ?? 30,
    workingSetBytes: real.workingSetBytes ?? 1_470_000_000,
    cpuPercent: real.cpuPercent ?? 23.4,
    accountName: real.accountName ?? 'Not signed in',
    notices: ['Preview: every figure here is a placeholder.', ...real.notices]
  }
}

/** One tick: sample, re-pin the window, and tell the renderer what we saw. */
async function tick(): Promise<void> {
  try {
    const settings = getSettings()
    syncWatcher()

    lastStats =
      preview && !currentActivity().robloxRunning ? await previewStats() : await buildStats()

    // Never re-pin while the user is holding the card, or it jumps out from
    // under the cursor every tick.
    if (Date.now() >= draggingUntil) {
      placeOverlay(referenceRect(), settings.overlayAnchor, settings.overlayMargin, {
        x: settings.overlayOffsetX,
        y: settings.overlayOffsetY
      })
    }

    emit('overlay:stats', lastStats)
    publishState()
  } catch (error) {
    logger.warn(`Overlay tick failed: ${String(error)}`)
  }
}

function startTicking(): void {
  stopTicking()

  const interval = Math.max(getSettings().overlayRefreshMs, TICK_FLOOR_MS)
  pollTimer = setInterval(() => {
    void tick()
  }, interval)

  void tick()
}

function stopTicking(): void {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

/**
 * Keeps the window watcher alive exactly as long as something wants it: while
 * the overlay is up, or briefly after an on-demand sample asked for one.
 *
 * The second case matters. The Overlays page can ask for a sample while the
 * feature is switched off, and starting a background PowerShell for that is
 * reasonable; leaving it running for the rest of the session, for a feature
 * nobody turned on, is not.
 */
function syncWatcher(): void {
  if (!windowTrackingSupported()) return

  const wanted = visible || preview || Date.now() < watcherGraceUntil

  if (wanted && !clientWindowSample().live) startClientWindowWatcher()
  else if (!wanted) stopClientWindowWatcher()
}

/* ------------------------------------------------------------ Visibility */

/**
 * Shows the overlay.
 *
 * The window is created on first use and kept afterwards, because building a
 * transparent always-on-top window on every join would flash on screen.
 */
export function show(): OverlayState {
  const settings = getSettings()

  if (!settings.overlayEnabled && !preview) return state()

  try {
    createOverlayWindow()
    applyClickThrough(settings.overlayClickThrough)
    // Pin it before the window appears, so it never flashes in a default spot.
    placeOverlay(referenceRect(), settings.overlayAnchor, settings.overlayMargin, {
      x: settings.overlayOffsetX,
      y: settings.overlayOffsetY
    })
    showOverlayWindow()
    visible = true

    syncWatcher()
    void refreshAccountName()
    startTicking()

    logger.info(preview ? 'Overlay preview shown' : 'Overlay shown')
  } catch (error) {
    visible = false
    logger.error(`The overlay could not be shown: ${String(error)}`)
  }

  publishState()
  return state()
}

export function hide(): OverlayState {
  const wasUp = visible || preview

  visible = false
  preview = false
  stopTicking()

  const window = getOverlayWindow()
  if (window && !window.isDestroyed()) window.hide()

  serverFigures = { ...NO_SERVER_FIGURES }

  if (wasUp) {
    syncWatcher()
    logger.info('Overlay hidden')
  }

  publishState()
  return state()
}

export function toggle(): OverlayState {
  return visible || preview ? hide() : show()
}

export function setVisible(next: boolean): OverlayState {
  return next ? show() : hide()
}

/**
 * Draws the overlay with placeholder figures so it can be arranged without a
 * game running. A real client appearing ends the preview on its own.
 */
export function setPreview(enabled: boolean): OverlayState {
  preview = enabled
  return enabled ? show() : getSettings().overlayEnabled && visible ? show() : hide()
}

/* ---------------------------------------------------------------- Hotkey */

function unregisterHotkey(): void {
  if (!hotkeyRegistered) return

  try {
    globalShortcut.unregister(hotkeyRegistered)
  } catch {
    /* already gone */
  }

  hotkeyRegistered = null
}

/**
 * Registers the toggle shortcut.
 *
 * A global shortcut is a shared resource: another application may already own
 * it, in which case `register` answers false. That is reported rather than
 * swallowed, because a hotkey that silently does nothing is worse than none.
 */
function registerHotkey(): void {
  unregisterHotkey()
  hotkeyError = null

  const accelerator = getSettings().overlayHotkey.trim()
  if (accelerator.length === 0) return

  try {
    const registered = globalShortcut.register(accelerator, () => {
      toggle()
    })

    hotkeyRegistered = registered ? accelerator : null
    if (!registered) {
      hotkeyError = `${acceleratorLabel(accelerator)} is already used by another application.`
      logger.warn(`Overlay shortcut ${accelerator} could not be registered`)
    }
  } catch (error) {
    hotkeyRegistered = null
    hotkeyError = `${acceleratorLabel(accelerator)} could not be registered.`
    logger.warn(`Overlay shortcut failed: ${String(error)}`)
  }
}

/* --------------------------------------------------------------- Requests */

/**
 * Moves the overlay to an absolute screen position.
 *
 * While dragging, the window moves and nothing is written. On release the
 * renderer sets `commit`, and the position is stored as an offset from the
 * client window — so the overlay still follows the game, only from a corner of
 * the user's choosing rather than ours.
 */
export async function setPosition(request: OverlayPositionRequest): Promise<OverlayState> {
  const window = getOverlayWindow()
  if (!window) return state()

  const frame = referenceRect()
  const size = overlayCardSize()
  const position = {
    x: Math.round(request.x),
    y: Math.round(request.y),
    width: size.width,
    height: size.height
  }

  window.setBounds(position)

  if (request.commit) {
    draggingUntil = 0

    const offset = frame
      ? { x: position.x - frame.x, y: position.y - frame.y }
      : { x: position.x, y: position.y }

    // `saveSettings` rather than the quiet variant: the Overlays page mirrors
    // settings and has to see the anchor turn into "custom".
    await saveSettings({
      overlayAnchor: 'custom',
      overlayOffsetX: offset.x,
      overlayOffsetY: offset.y
    })
  } else {
    draggingUntil = Date.now() + DRAG_GRACE_MS
  }

  publishState()
  return state()
}

/** The overlay window reporting how large its card actually rendered. */
export function setContentSize(width: number, height: number): void {
  const settings = getSettings()

  setOverlayCardSize(width, height)
  placeOverlay(referenceRect(), settings.overlayAnchor, settings.overlayMargin, {
    x: settings.overlayOffsetX,
    y: settings.overlayOffsetY
  })

  publishState()
}

/** Forces a fresh sample; used by the Overlays page's live panel. */
export async function sample(): Promise<OverlayStats> {
  // Borrow the window watcher for a little while, so the page can show real
  // process figures even before the feature is switched on — and so the
  // watcher goes away again once the page stops asking.
  if (!visible && !preview) {
    watcherGraceUntil = Date.now() + WATCHER_GRACE_MS

    if (watcherGraceTimer) clearTimeout(watcherGraceTimer)
    watcherGraceTimer = setTimeout(() => {
      watcherGraceTimer = null
      syncWatcher()
    }, WATCHER_GRACE_MS + 500)
  }

  syncWatcher()

  const stats =
    preview && !currentActivity().robloxRunning ? await previewStats() : await buildStats()
  lastStats = stats
  emit('overlay:stats', stats)
  return stats
}

/* ------------------------------------------------------------- Lifecycle */

/** Re-pins the window immediately, without waiting for the next tick. */
function replace(): void {
  const settings = getSettings()

  placeOverlay(referenceRect(), settings.overlayAnchor, settings.overlayMargin, {
    x: settings.overlayOffsetX,
    y: settings.overlayOffsetY
  })
}

/**
 * Applies the settings at runtime.
 *
 * Called at start-up and on every `settings:changed`, which is what makes the
 * page's switches take effect immediately — including switching the feature off,
 * which tears the window down rather than leaving it hidden.
 */
export function sync(): void {
  const settings = getSettings()

  if (!settings.overlayEnabled) {
    if (started) stop()
    else publishState()
    return
  }

  started = true
  registerHotkey()
  void refreshAccountName()

  if (disposers.length === 0) {
    // Follow the session: appear when a game starts, stay while the client is
    // open, and disappear when it exits. Appearing the moment the client opens
    // would contradict what the switch says it does.
    disposers.push(
      onEvent('activity:update', (update) => {
        if (!getSettings().overlayEnabled) return

        if (preview && update.robloxRunning) preview = false

        if (update.inGame) {
          if (getSettings().overlayAutoShow && !visible) show()
          else if (visible) void tick()
        } else if (visible && !preview && !update.robloxRunning) {
          hide()
        }
      }),

      onEvent('roblox:exit', () => {
        if (visible && !preview) hide()
        else syncWatcher()
      }),

      onEvent('accounts:changed', () => {
        void refreshAccountName()
      })
    )
  }

  if (visible || preview) {
    applyClickThrough(settings.overlayClickThrough)
    replace()
    // The cadence is a setting, so a change has to rebuild the timer.
    startTicking()
  } else {
    syncWatcher()
  }

  publishState()
}

export function start(): void {
  sync()
}

export function stop(): void {
  started = false
  visible = false
  preview = false

  stopTicking()
  unregisterHotkey()

  for (const dispose of disposers) dispose()
  disposers = []

  if (watcherGraceTimer) {
    clearTimeout(watcherGraceTimer)
    watcherGraceTimer = null
  }
  watcherGraceUntil = 0

  stopClientWindowWatcher()
  destroyOverlayWindow()
  serverFigures = { ...NO_SERVER_FIGURES }
  lastPublishedState = ''
}

/** Tear-down at quit: the global shortcut in particular must not outlive us. */
export function dispose(): void {
  stop()
}
