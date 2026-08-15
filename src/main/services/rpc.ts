import { connect, type Socket } from 'net'
import { randomUUID } from 'crypto'
import type { RpcUpdate } from '@shared/models'
import type { ActivityEntry } from '@shared/state'
import { createLogger } from '../utils/logger'
import { emit } from './events'
import { getSettings } from './settingsStore'
import { getJson } from './http'

/**
 * Discord Rich Presence.
 *
 * Speaks Discord's local IPC protocol directly over the named pipe/unix socket
 * that the desktop client exposes, so no third-party dependency is required.
 *
 * Frame format: [op: uint32 LE][length: uint32 LE][JSON payload]
 *
 * The presence is built in two layers, mirroring Bloxstrap: a base activity
 * (idle or in-game) and an optional override pushed by the experience through
 * the `[BloxstrapRPC] SetRichPresence` message. The override is merged on top
 * and reset whenever the base activity changes.
 */

const logger = createLogger('DiscordRPC')

/** Discord application client id. Defaults to Bloxstrap's so asset keys resolve. */
const DEFAULT_CLIENT_ID = '1005469189907173486'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

const RECONNECT_DELAY_MS = 15_000

interface Presence {
  details?: string
  state?: string
  timestamps?: { start?: number; end?: number }
  assets?: {
    large_image?: string
    large_text?: string
    small_image?: string
    small_text?: string
  }
  buttons?: Array<{ label: string; url: string }>
}

/** The subset of `SetRichPresence` data a game can push through BloxstrapRPC. */
interface RichPresenceOverride {
  details?: string
  state?: string
  timestampStart?: number | null
  timestampEnd?: number | null
  largeImageKey?: string
  largeImageText?: string
  smallImageKey?: string
  smallImageText?: string
}

interface BloxstrapRpcImage {
  assetId?: unknown
  hoverText?: unknown
  clear?: unknown
  reset?: unknown
}

let socket: Socket | null = null
let connected = false
let connecting = false
let reconnectTimer: NodeJS.Timeout | null = null
let readBuffer = Buffer.alloc(0)
let enabled = false
let inGame = false
let clientId = DEFAULT_CLIENT_ID
let baseActivity: Presence | null = null
let override: RichPresenceOverride | null = null
let pendingActivity: object | null = null

let current: RpcUpdate = {
  connected: false,
  details: null,
  state: null,
  largeImage: null,
  since: null
}

export function currentRpc(): RpcUpdate {
  return current
}

function socketPath(attempt: number): string {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${attempt}`

  const base =
    process.env.XDG_RUNTIME_DIR ??
    process.env.TMPDIR ??
    process.env.TMP ??
    process.env.TEMP ??
    '/tmp'

  return `${base.replace(/\/$/, '')}/discord-ipc-${attempt}`
}

function encode(op: number, payload: unknown): Buffer {
  const data = Buffer.from(JSON.stringify(payload), 'utf8')
  const header = Buffer.alloc(8)
  header.writeInt32LE(op, 0)
  header.writeInt32LE(data.length, 4)
  return Buffer.concat([header, data])
}

function send(op: number, payload: unknown): void {
  if (!socket || socket.destroyed) return
  try {
    socket.write(encode(op, payload))
  } catch (error) {
    logger.warn(`Failed to write RPC frame: ${String(error)}`)
  }
}

/** Attempts each of Discord's candidate sockets in turn. */
function tryConnect(attempt = 0): void {
  if (attempt > 9) {
    connecting = false
    logger.info('No Discord client found; rich presence is unavailable')
    scheduleReconnect()
    return
  }

  const path = socketPath(attempt)
  const candidate = connect(path)

  const onError = (): void => {
    candidate.removeAllListeners()
    candidate.destroy()
    tryConnect(attempt + 1)
  }

  candidate.once('error', onError)
  candidate.once('connect', () => {
    candidate.removeListener('error', onError)
    socket = candidate
    connecting = false
    readBuffer = Buffer.alloc(0)

    logger.info(`Connected to Discord on ${path}`)
    attachHandlers(candidate)
    send(OP_HANDSHAKE, { v: 1, client_id: clientId })
  })
}

function attachHandlers(target: Socket): void {
  target.on('data', (chunk) => {
    readBuffer = Buffer.concat([readBuffer, chunk])
    drain()
  })

  target.on('close', () => handleDisconnect('closed'))
  target.on('end', () => handleDisconnect('ended'))
  target.on('error', (error) => {
    logger.warn(`Discord socket error: ${error.message}`)
    handleDisconnect('error')
  })
}

function drain(): void {
  while (readBuffer.length >= 8) {
    const op = readBuffer.readInt32LE(0)
    const length = readBuffer.readInt32LE(4)
    if (readBuffer.length < 8 + length) return

    const body = readBuffer.subarray(8, 8 + length).toString('utf8')
    readBuffer = readBuffer.subarray(8 + length)

    handleFrame(op, body)
  }
}

function handleFrame(op: number, body: string): void {
  if (op === OP_PING) {
    send(OP_PONG, {})
    return
  }
  if (op === OP_CLOSE) {
    handleDisconnect('server close')
    return
  }
  if (op !== OP_FRAME) return

  try {
    const frame = JSON.parse(body) as { evt?: string; data?: { code?: number; message?: string } }
    if (frame.evt === 'READY') {
      connected = true
      current = { ...current, connected: true }
      logger.info('Discord rich presence is ready')
      if (pendingActivity) flush(pendingActivity)
      publish()
    } else if (frame.evt === 'ERROR') {
      logger.warn(
        `Discord rejected the connection (${frame.data?.code ?? 'unknown'}): ${
          frame.data?.message ?? 'unknown error'
        }`
      )
    }
  } catch {
    // Non-JSON frames are not interesting.
  }
}

function handleDisconnect(reason: string): void {
  if (!connected && !socket) return

  logger.info(`Discord connection ${reason}`)
  connected = false

  if (socket) {
    socket.removeAllListeners()
    socket.destroy()
    socket = null
  }

  current = { ...current, connected: false }
  publish()
  scheduleReconnect()
}

/** Tears the socket down without touching presence state or the enable flag. */
function teardownSocket(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (socket) {
    socket.removeAllListeners()
    socket.destroy()
    socket = null
  }

  connected = false
  connecting = false
  current = { ...current, connected: false }
  publish()
}

function scheduleReconnect(): void {
  if (!enabled || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (enabled && !connected && !connecting) {
      connecting = true
      tryConnect()
    }
  }, RECONNECT_DELAY_MS)
}

function publish(): void {
  emit('rpc:update', current)
}

/** Low-level SET_ACTIVITY. `activity === null` clears the presence. */
function flush(activity: object | null): void {
  pendingActivity = activity
  if (!connected) return

  send(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity },
    nonce: randomUUID()
  })
}

/** Merges the game's `SetRichPresence` override over the base activity. */
function buildPresence(): Presence | null {
  if (!baseActivity) return null
  if (!override) return baseActivity

  const presence: Presence = { ...baseActivity }

  if (override.details !== undefined) {
    presence.details = override.details === '<reset>' ? baseActivity.details : override.details
  }
  if (override.state !== undefined) {
    presence.state = override.state === '<reset>' ? baseActivity.state : override.state
  }

  const timestamps: Presence['timestamps'] = { ...(baseActivity.timestamps ?? {}) }
  if (override.timestampStart !== undefined) {
    if (override.timestampStart === null || override.timestampStart === 0) delete timestamps.start
    else timestamps.start = override.timestampStart
  }
  if (override.timestampEnd !== undefined) {
    if (override.timestampEnd === null || override.timestampEnd === 0) delete timestamps.end
    else timestamps.end = override.timestampEnd
  }
  if (Object.keys(timestamps).length > 0) presence.timestamps = timestamps
  else delete presence.timestamps

  const assets: Presence['assets'] = { ...(baseActivity.assets ?? {}) }
  if (override.largeImageKey !== undefined) assets.large_image = override.largeImageKey
  if (override.largeImageText !== undefined) assets.large_text = override.largeImageText
  if (override.smallImageKey !== undefined) assets.small_image = override.smallImageKey
  if (override.smallImageText !== undefined) assets.small_text = override.smallImageText
  if (Object.keys(assets).length > 0) presence.assets = assets
  else delete presence.assets

  return presence
}

/** Recomputes the merged presence and pushes it to Discord. */
function commit(): void {
  const activity = buildPresence()
  flush(activity)
}

export function start(): void {
  if (!getSettings().enableDiscordRpc) {
    logger.info('Discord rich presence is disabled in settings')
    return
  }
  if (enabled) return

  enabled = true
  clientId = getSettings().discordClientId || DEFAULT_CLIENT_ID
  connecting = true
  logger.info(`Starting Discord rich presence (client id ${clientId})`)
  tryConnect()
}

export function stop(): void {
  if (!enabled) return
  enabled = false

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  if (socket) {
    flush(null)
    socket.removeAllListeners()
    socket.destroy()
    socket = null
  }

  connected = false
  connecting = false
  inGame = false
  baseActivity = null
  override = null
  current = { connected: false, details: null, state: null, largeImage: null, since: null }
  publish()
  logger.info('Stopped Discord rich presence')
}

/** Applies the settings toggle and client id at runtime. */
export function refresh(): void {
  const settings = getSettings()
  const wanted = settings.enableDiscordRpc
  const nextId = settings.discordClientId || DEFAULT_CLIENT_ID

  if (!wanted) {
    if (enabled) stop()
    return
  }

  if (!enabled) {
    start()
    return
  }

  // The client id changed underneath us; reconnect with the new application
  // while keeping the current presence so it is re-pushed once READY arrives.
  if (nextId !== clientId) {
    logger.info(`Discord client id changed (${clientId} -> ${nextId}); reconnecting`)
    clientId = nextId
    teardownSocket()
    connecting = true
    tryConnect()
  }
}

/** Presence shown while the user is browsing the launcher. */
export function setIdle(): void {
  if (!enabled) return

  inGame = false
  override = null
  baseActivity = {
    details: 'RemielleStrap',
    state: 'In the launcher',
    assets: { large_text: 'RemielleStrap' }
  }

  current = {
    connected,
    details: 'RemielleStrap',
    state: 'In the launcher',
    largeImage: null,
    since: null
  }

  commit()
  publish()
}

/** Presence shown while the user is in an experience. */
export function setPlaying(activity: ActivityEntry): void {
  if (!enabled) return

  const settings = getSettings()
  const details = activity.gameName ?? `Place ${activity.placeId}`
  const serverTypeLine =
    activity.serverType === 'private'
      ? 'In a private server'
      : activity.serverType === 'reserved'
        ? 'In a reserved server'
        : 'In a public server'

  // "Include the server type" controls the second presence line.
  const state = settings.showAccountOnRpc ? serverTypeLine : undefined

  inGame = true
  override = null
  baseActivity = {
    details,
    state,
    timestamps: { start: Math.floor(activity.joinedAt / 1000) },
    assets: {
      large_image: activity.gameThumbnailUrl ?? 'roblox',
      large_text: details,
      small_image: 'roblox',
      small_text: 'RemielleStrap'
    },
    buttons: [
      {
        label: 'View experience',
        url: `https://www.roblox.com/games/${activity.placeId}`
      }
    ]
  }

  current = {
    connected,
    details,
    state: state ?? null,
    largeImage: activity.gameThumbnailUrl ?? null,
    since: activity.joinedAt
  }

  commit()
  publish()
}

/**
 * Applies a game-pushed `SetRichPresence` payload over the current in-game
 * presence. Details/state/timestamps/images override the base activity until
 * the next join/leave. `assetId`s are resolved to Roblox thumbnails.
 */
export function setRichPresence(data: unknown): void {
  if (!enabled || !inGame) return

  const raw = (data ?? {}) as {
    details?: unknown
    state?: unknown
    timeStart?: unknown
    timeEnd?: unknown
    smallImage?: BloxstrapRpcImage
    largeImage?: BloxstrapRpcImage
  }

  const next: RichPresenceOverride = { ...(override ?? {}) }

  if (typeof raw.details === 'string' && raw.details.length <= 128) next.details = raw.details
  if (typeof raw.state === 'string' && raw.state.length <= 128) next.state = raw.state

  if (typeof raw.timeStart === 'number')
    next.timestampStart = raw.timeStart > 0 ? raw.timeStart : null
  if (typeof raw.timeEnd === 'number') next.timestampEnd = raw.timeEnd > 0 ? raw.timeEnd : null

  applyRichPresenceImage(next, raw.smallImage, 'small')
  applyRichPresenceImage(next, raw.largeImage, 'large')

  override = next
  commit()
  publish()

  // Images need a network round-trip; fetch and re-commit when they resolve.
  if (raw.largeImage?.assetId) void resolveImageAsset(raw.largeImage, 'large')
  if (raw.smallImage?.assetId) void resolveImageAsset(raw.smallImage, 'small')
}

function applyRichPresenceImage(
  next: RichPresenceOverride,
  image: BloxstrapRpcImage | undefined,
  slot: 'small' | 'large'
): void {
  if (!image) return

  const keyField = slot === 'large' ? 'largeImageKey' : 'smallImageKey'
  const textField = slot === 'large' ? 'largeImageText' : 'smallImageText'

  if (image.clear === true) {
    next[keyField] = ''
    return
  }

  if (image.reset === true) {
    delete next[keyField]
    delete next[textField]
    return
  }

  if (typeof image.hoverText === 'string') next[textField] = image.hoverText
}

async function resolveImageAsset(image: BloxstrapRpcImage, slot: 'small' | 'large'): Promise<void> {
  const assetId = image.assetId
  if (typeof assetId !== 'number' && typeof assetId !== 'string') return

  const url = await fetchAssetThumbnail(String(assetId))
  if (!url) return

  const next: RichPresenceOverride = { ...(override ?? {}) }
  if (slot === 'large') next.largeImageKey = url
  else next.smallImageKey = url
  override = next
  commit()
}

async function fetchAssetThumbnail(assetId: string): Promise<string | null> {
  try {
    const res = await getJson<{ data?: Array<{ imageUrl?: string; state?: string }> }>(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${encodeURIComponent(assetId)}&size=512x512&format=Png&isCircular=false`,
      { retries: 1, timeoutMs: 8000 }
    )
    const first = res?.data?.[0]
    return first && first.state === 'Completed' && first.imageUrl ? first.imageUrl : null
  } catch {
    return null
  }
}

export function clearPresence(): void {
  if (!enabled) return

  inGame = false
  baseActivity = null
  override = null
  current = { connected, details: null, state: null, largeImage: null, since: null }
  flush(null)
  publish()
}
