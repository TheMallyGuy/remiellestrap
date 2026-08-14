import { exec } from 'child_process'
import { createReadStream, type Stats } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { promisify } from 'util'
import type { ActivityUpdate } from '@shared/models'
import type { ActivityEntry, ServerType } from '@shared/state'
import { createLogger } from '../utils/logger'
import { robloxLogsDirectory } from '../utils/paths'
import { pathExists } from '../utils/fs'
import { getJson } from './http'
import { emit } from './events'
import { getSettings } from './settingsStore'
import { getRobloxState, recordActivity, updateLastActivity } from './stateStore'

/**
 * Activity tracking.
 *
 * Roblox writes a per-session log to %LOCALAPPDATA%\Roblox\logs. We tail the
 * newest file and match the same markers the stock bootstrapper looks for to
 * work out which experience the user joined and when they left.
 */

const logger = createLogger('Activity')
const execAsync = promisify(exec)

/* Log markers, mirroring Bloxstrap's ActivityWatcher. */
const GAME_JOINING_ENTRY = /! Joining game '([0-9a-f-]{36})' place ([0-9]+) at ([0-9.]+)/
const GAME_JOINING_UDMUX = /UDMUX Address = ([0-9.]+), Port = [0-9]+ \| RCC Server Address/
const GAME_JOINED_ENTRY = /Connection accepted from ([0-9.]+)\|[0-9]+ with response/
const GAME_DISCONNECTED = /\[FLog::Network\] Time to disconnect replication data:/
const GAME_TELEPORTING = /\[FLog::SingleSurfaceApp\] initiateTeleport/
const GAME_LEAVING = /\[FLog::SingleSurfaceApp\] leaveUGCGameInternal/
const GAME_MESSAGE_ENTRY = /\[FLog::Output\] \[BloxstrapRPC\] (.*)/
const PLACE_LAUNCHER_REQUEST =
  /! Joining game.*|makePlaceLauncherRequest(ForTeleport)?: requestCount: [0-9], url: https:\/\/gamejoin\.roblox\.com\/v1\/([^\s/]+)/

const POLL_INTERVAL_MS = 1000
const PROCESS_POLL_MS = 3000

interface WatcherState {
  logFile: string | null
  offset: number
  buffer: string
  activity: ActivityEntry | null
  inGame: boolean
  robloxRunning: boolean
  pendingServerType: ServerType
  isTeleport: boolean
}

const state: WatcherState = {
  logFile: null,
  offset: 0,
  buffer: '',
  activity: null,
  inGame: false,
  robloxRunning: false,
  pendingServerType: 'public',
  isTeleport: false
}

let logTimer: NodeJS.Timeout | null = null
let processTimer: NodeJS.Timeout | null = null
let started = false

export function currentActivity(): ActivityUpdate {
  return {
    activity: state.activity,
    inGame: state.inGame,
    robloxRunning: state.robloxRunning
  }
}

function publish(): void {
  emit('activity:update', currentActivity())
}

export function start(): void {
  if (started) return
  started = true

  logger.info('Activity watcher started')
  logTimer = setInterval(() => {
    void tick()
  }, POLL_INTERVAL_MS)
  processTimer = setInterval(() => {
    void pollProcess()
  }, PROCESS_POLL_MS)

  void pollProcess()
}

export function stop(): void {
  if (!started) return
  started = false

  if (logTimer) clearInterval(logTimer)
  if (processTimer) clearInterval(processTimer)
  logTimer = null
  processTimer = null
  logger.info('Activity watcher stopped')
}

/** Finds the most recently modified Roblox log file. */
async function newestLogFile(): Promise<string | null> {
  const directory = robloxLogsDirectory()
  if (!(await pathExists(directory))) return null

  try {
    const entries = await readdir(directory)
    const candidates: Array<{ file: string; info: Stats }> = []

    for (const entry of entries) {
      if (!entry.endsWith('.log')) continue
      const file = join(directory, entry)
      try {
        candidates.push({ file, info: await stat(file) })
      } catch {
        // Skip files that vanished between readdir and stat.
      }
    }

    if (candidates.length === 0) return null
    candidates.sort((a, b) => b.info.mtimeMs - a.info.mtimeMs)
    return candidates[0].file
  } catch (error) {
    logger.warn(`Could not enumerate Roblox logs: ${String(error)}`)
    return null
  }
}

async function tick(): Promise<void> {
  if (!getSettings().enableActivityTracking) return

  try {
    const newest = await newestLogFile()
    if (!newest) return

    if (newest !== state.logFile) {
      logger.info(`Following log file ${newest}`)
      state.logFile = newest
      state.offset = 0
      state.buffer = ''
    }

    const info = await stat(newest)
    if (info.size < state.offset) {
      // The file was truncated or rotated; start over.
      state.offset = 0
      state.buffer = ''
    }
    if (info.size === state.offset) return

    const chunk = await readRange(newest, state.offset, info.size - 1)
    state.offset = info.size
    state.buffer += chunk

    const lines = state.buffer.split(/\r?\n/)
    state.buffer = lines.pop() ?? ''

    for (const line of lines) await handleLine(line)
  } catch (error) {
    logger.warn(`Log tail failed: ${String(error)}`)
  }
}

function readRange(file: string, start: number, end: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    const stream = createReadStream(file, { start, end, encoding: undefined })
    stream.on('data', (chunk) => chunks.push(chunk as Buffer))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

async function handleLine(line: string): Promise<void> {
  if (!line) return

  const launcher = PLACE_LAUNCHER_REQUEST.exec(line)
  if (launcher && launcher[2]) {
    state.pendingServerType = serverTypeFor(launcher[2])
  }

  if (GAME_TELEPORTING.test(line)) {
    state.isTeleport = true
    return
  }

  const joining = GAME_JOINING_ENTRY.exec(line)
  if (joining) {
    const [, jobId, placeId, address] = joining
    state.activity = {
      placeId,
      universeId: null,
      jobId,
      gameName: null,
      gameThumbnailUrl: null,
      serverType: state.pendingServerType,
      machineAddress: address,
      isTeleport: state.isTeleport,
      joinedAt: Date.now(),
      leftAt: null
    }
    state.inGame = false
    state.isTeleport = false
    publish()
    void enrich(state.activity)
    return
  }

  const udmux = GAME_JOINING_UDMUX.exec(line)
  if (udmux && state.activity) {
    state.activity.machineAddress = udmux[1]
    publish()
    return
  }

  const joined = GAME_JOINED_ENTRY.exec(line)
  if (joined) {
    if (state.activity) {
      state.activity.machineAddress = joined[1]
      state.inGame = true
      await recordActivity(state.activity)
      logger.info(
        `Joined place ${state.activity.placeId} (job ${state.activity.jobId ?? 'unknown'})`
      )
      publish()

      if (getSettings().notifyOnActivityJoin) {
        emit('toast:show', {
          kind: 'info',
          title: 'Joined experience',
          message: state.activity.gameName ?? `Place ${state.activity.placeId}`
        })
      }
    }
    return
  }

  const message = GAME_MESSAGE_ENTRY.exec(line)
  if (message) {
    handleGameMessage(message[1])
    return
  }

  if (GAME_LEAVING.test(line) || GAME_DISCONNECTED.test(line)) {
    if (state.activity) {
      const finished = { ...state.activity, leftAt: Date.now() }
      await updateLastActivity({ leftAt: finished.leftAt })
      logger.info(`Left place ${finished.placeId}`)
      emit('activity:leave', { activity: finished })
    }
    state.activity = null
    state.inGame = false
    publish()
  }
}

function serverTypeFor(endpoint: string): ServerType {
  const lower = endpoint.toLowerCase()
  if (lower.includes('join-private-game')) return 'private'
  if (lower.includes('join-reserved-game')) return 'reserved'
  return 'public'
}

/**
 * Handles [BloxstrapRPC] messages emitted by experiences that support rich
 * presence. The payload is JSON; malformed messages are ignored.
 */
function handleGameMessage(payload: string): void {
  try {
    const parsed = JSON.parse(payload) as { command?: string; data?: Record<string, unknown> }
    if (parsed.command !== 'SetRichPresence' || !parsed.data) return

    emit('rpc:update', {
      connected: true,
      details: typeof parsed.data.details === 'string' ? parsed.data.details : null,
      state: typeof parsed.data.state === 'string' ? parsed.data.state : null,
      largeImage: null,
      since: state.activity?.joinedAt ?? null
    })
  } catch {
    logger.warn('Ignored malformed BloxstrapRPC message')
  }
}

/** Looks up the experience name and icon so the UI has something to show. */
async function enrich(activity: ActivityEntry): Promise<void> {
  try {
    const universe = await getJson<{ universeId?: number }>(
      `https://apis.roblox.com/universes/v1/places/${activity.placeId}/universe`,
      { retries: 1, timeoutMs: 8000 }
    )
    if (!universe?.universeId) return
    if (state.activity !== activity) return

    activity.universeId = String(universe.universeId)

    const details = await getJson<{ data?: Array<{ name?: string }> }>(
      `https://games.roblox.com/v1/games?universeIds=${universe.universeId}`,
      { retries: 1, timeoutMs: 8000 }
    )
    const name = details?.data?.[0]?.name
    if (name && state.activity === activity) activity.gameName = name

    const icons = await getJson<{ data?: Array<{ imageUrl?: string; state?: string }> }>(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${universe.universeId}&size=128x128&format=Png&isCircular=false`,
      { retries: 1, timeoutMs: 8000 }
    )
    const icon = icons?.data?.[0]
    if (icon?.state === 'Completed' && icon.imageUrl && state.activity === activity) {
      activity.gameThumbnailUrl = icon.imageUrl
    }

    if (state.activity === activity) {
      await updateLastActivity({
        universeId: activity.universeId,
        gameName: activity.gameName,
        gameThumbnailUrl: activity.gameThumbnailUrl
      })
      publish()
    }
  } catch (error) {
    logger.warn(`Could not enrich activity for place ${activity.placeId}: ${String(error)}`)
  }
}

/** Polls for the Roblox client process so the UI knows when it exits. */
async function pollProcess(): Promise<void> {
  const wasRunning = state.robloxRunning
  state.robloxRunning = await isRobloxRunning()

  if (wasRunning && !state.robloxRunning) {
    logger.info('Roblox has exited')

    const exitedAt = Date.now()
    const playtimeMs = state.activity ? exitedAt - state.activity.joinedAt : 0

    if (state.activity) {
      await updateLastActivity({ leftAt: exitedAt })
      emit('activity:leave', { activity: { ...state.activity, leftAt: exitedAt } })
    }

    state.activity = null
    state.inGame = false
    emit('roblox:exit', {
      code: null,
      version: getRobloxState().installedVersion,
      playtimeMs
    })
    emit('rpc:update', {
      connected: false,
      details: null,
      state: null,
      largeImage: null,
      since: null
    })
    publish()
  } else if (!wasRunning && state.robloxRunning) {
    logger.info('Roblox is running')
    publish()
  }
}

export async function isRobloxRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  try {
    const { stdout } = await execAsync(
      'tasklist /FI "IMAGENAME eq RobloxPlayerBeta.exe" /NH /FO CSV',
      { windowsHide: true, timeout: 5000 }
    )
    return stdout.toLowerCase().includes('robloxplayerbeta.exe')
  } catch {
    return false
  }
}

/** Terminates the Roblox client, used by the tray menu. */
export async function killRoblox(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  try {
    await execAsync('taskkill /F /IM RobloxPlayerBeta.exe', { windowsHide: true, timeout: 5000 })
    logger.info('Terminated the Roblox client')
    return true
  } catch {
    return false
  }
}

/** The URI needed to rejoin the last known server, if any. */
export function rejoinUri(): string | null {
  const activity = state.activity
  if (!activity) return null
  if (activity.serverType !== 'public' || !activity.jobId) {
    return `roblox://experiences/start?placeId=${activity.placeId}`
  }
  return `roblox://experiences/start?placeId=${activity.placeId}&gameInstanceId=${activity.jobId}`
}
