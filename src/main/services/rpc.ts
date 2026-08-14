import { connect, type Socket } from 'net'
import { randomUUID } from 'crypto'
import type { RpcUpdate } from '@shared/models'
import type { ActivityEntry } from '@shared/state'
import { createLogger } from '../utils/logger'
import { emit } from './events'
import { getSettings } from './settingsStore'

/**
 * Discord Rich Presence.
 *
 * Speaks Discord's local IPC protocol directly over the named pipe/unix socket
 * that the desktop client exposes, so no third-party dependency is required.
 *
 * Frame format: [op: uint32 LE][length: uint32 LE][JSON payload]
 */

const logger = createLogger('DiscordRPC')

/** Bloxstrap's public application id, reused so assets resolve. */
const CLIENT_ID = '1005469189907173486'

const OP_HANDSHAKE = 0
const OP_FRAME = 1
const OP_CLOSE = 2
const OP_PING = 3
const OP_PONG = 4

const RECONNECT_DELAY_MS = 15_000

let socket: Socket | null = null
let connected = false
let connecting = false
let reconnectTimer: NodeJS.Timeout | null = null
let readBuffer = Buffer.alloc(0)
let current: RpcUpdate = {
  connected: false,
  details: null,
  state: null,
  largeImage: null,
  since: null
}
let pendingActivity: object | null = null
let enabled = false

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
    send(OP_HANDSHAKE, { v: 1, client_id: CLIENT_ID })
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
    const frame = JSON.parse(body) as { evt?: string; data?: unknown }
    if (frame.evt === 'READY') {
      connected = true
      current = { ...current, connected: true }
      logger.info('Discord rich presence is ready')
      if (pendingActivity) flush(pendingActivity)
      publish()
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

function flush(activity: object | null): void {
  pendingActivity = activity
  if (!connected) return

  send(OP_FRAME, {
    cmd: 'SET_ACTIVITY',
    args: { pid: process.pid, activity },
    nonce: randomUUID()
  })
}

export function start(): void {
  if (!getSettings().enableDiscordRpc) {
    logger.info('Discord rich presence is disabled in settings')
    return
  }
  if (enabled) return

  enabled = true
  connecting = true
  logger.info('Starting Discord rich presence')
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
  current = { connected: false, details: null, state: null, largeImage: null, since: null }
  publish()
  logger.info('Stopped Discord rich presence')
}

/** Applies the settings toggle at runtime. */
export function refresh(): void {
  const wanted = getSettings().enableDiscordRpc
  if (wanted && !enabled) start()
  else if (!wanted && enabled) stop()
}

/** Presence shown while the user is browsing the launcher. */
export function setIdle(): void {
  if (!enabled) return

  current = {
    connected,
    details: 'In the launcher',
    state: null,
    largeImage: 'remielle',
    since: null
  }

  flush({
    details: 'In the launcher',
    assets: { large_image: 'remielle', large_text: 'RemielleStrap' },
    timestamps: {}
  })
  publish()
}

/** Presence shown while the user is in an experience. */
export function setPlaying(activity: ActivityEntry): void {
  if (!enabled) return

  const settings = getSettings()
  const details = activity.gameName ?? `Place ${activity.placeId}`
  const state =
    activity.serverType === 'private'
      ? 'In a private server'
      : activity.serverType === 'reserved'
        ? 'In a reserved server'
        : 'In a public server'

  current = {
    connected,
    details,
    state,
    largeImage: activity.gameThumbnailUrl ?? 'remielle',
    since: activity.joinedAt
  }

  const buttons =
    settings.showAccountOnRpc && activity.placeId
      ? [
          {
            label: 'View experience',
            url: `https://www.roblox.com/games/${activity.placeId}`
          }
        ]
      : undefined

  flush({
    details,
    state,
    timestamps: { start: activity.joinedAt },
    assets: {
      large_image: activity.gameThumbnailUrl ?? 'remielle',
      large_text: details,
      small_image: 'remielle',
      small_text: 'RemielleStrap'
    },
    buttons
  })
  publish()
}

export function clearPresence(): void {
  if (!enabled) return
  current = { connected, details: null, state: null, largeImage: null, since: null }
  flush(null)
  publish()
}
