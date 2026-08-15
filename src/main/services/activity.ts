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
import * as rpc from './rpc'

/**
 * Activity tracking.
 *
 * Roblox writes a per-session log to %LOCALAPPDATA%\Roblox\logs. We tail the
 * newest file and match the same markers Froststrap/Bloxstrap's
 * `ActivityWatcher` looks for, so the join/leave/teleport/private/reserved
 * transitions and in-game `[BloxstrapRPC]` messages behave identically.
 */

const logger = createLogger('Activity')
const execAsync = promisify(exec)

/* ------------------------------------------------------------------ Markers
 * These entries are technically volatile: they only appear depending on the
 * client's configured FLog level. The set below is the minimum needed to track
 * a session the way the reference ActivityWatcher does.
 * ------------------------------------------------------------------------ */
const GAME_JOINING_ENTRY = '[FLog::Output] ! Joining game'
const GAME_TELEPORTING_ENTRY = '[FLog::GameJoinUtil] GameJoinUtil::initiateTeleportToPlace'
const GAME_JOINING_PRIVATE_SERVER_ENTRY =
  '[FLog::GameJoinUtil] GameJoinUtil::joinGamePostPrivateServer'
const GAME_JOINING_RESERVED_SERVER_ENTRY =
  '[FLog::GameJoinUtil] GameJoinUtil::initiateTeleportToReservedServer'
const GAME_JOINING_UNIVERSE_ENTRY = '[FLog::GameJoinLoadTime] Report game_join_loadtime:'
const GAME_JOINING_UDMUX_ENTRY = '[FLog::Network] UDMUX Address = '
const GAME_JOINED_ENTRY = '[FLog::Network] serverId:'
const GAME_DISCONNECTED_ENTRY = '[FLog::Network] Time to disconnect replication data:'
const GAME_LEAVING_ENTRY = '[FLog::SingleSurfaceApp] leaveUGCGameInternal'
const GAME_DISCONNECT_REASON_ENTRY = '[FLog::Network] Sending disconnect with reason:'
const GAME_MESSAGE_ENTRY = '[FLog::Output] [BloxstrapRPC]'

/* ----------------------------------------------------------------- Patterns */
const GAME_JOINING_ENTRY_PATTERN = /! Joining game '([0-9a-f-]{36})' place ([0-9]+) at ([0-9.]+)/
const GAME_JOINING_PRIVATE_SERVER_PATTERN = /"accessCode":"([0-9a-f-]{36})"/
const GAME_JOINING_UNIVERSE_PATTERN = /universeid:([0-9]+).*userid:([0-9]+)/
const GAME_JOINING_UDMUX_PATTERN =
  /UDMUX Address = ([0-9.]+), Port = [0-9]+ \| RCC Server Address = ([0-9.]+), Port = [0-9]+/
const GAME_JOINED_ENTRY_PATTERN = /serverId: ([0-9.]+)\|[0-9]+/
const GAME_DISCONNECT_REASON_PATTERN = /Sending disconnect with reason: (\d+)/
const GAME_MESSAGE_ENTRY_PATTERN = /\[BloxstrapRPC\] (.*)/

const POLL_INTERVAL_MS = 1000
const PROCESS_POLL_MS = 3000

interface WatcherState {
  logFile: string | null
  offset: number
  buffer: string
  activity: ActivityEntry | null
  inGame: boolean
  robloxRunning: boolean
  /** Server type applied to the next activity, set by the private marker. */
  pendingServerType: ServerType
  /** Private-server access code, parsed from the join marker. */
  accessCode: string | null
  /** Set when a teleport has been initiated but not yet joined. */
  isTeleport: boolean
  /** Set when the teleport targets a reserved server. */
  reservedMarker: boolean
}

const state: WatcherState = {
  logFile: null,
  offset: 0,
  buffer: '',
  activity: null,
  inGame: false,
  robloxRunning: false,
  pendingServerType: 'public',
  accessCode: null,
  isTeleport: false,
  reservedMarker: false
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

/**
 * Mirrors `ActivityWatcher::ProcessPlayerLogEntry` — the same three states
 * (idle / joining / in-game) with the same markers in the same order.
 */
async function handleLine(line: string): Promise<void> {
  if (!line) return

  // Checked before the state machine, exactly like the reference.
  if (line.includes(GAME_LEAVING_ENTRY)) {
    logger.info('User is back into the desktop app')

    if (state.activity && state.activity.placeId !== '0' && !state.inGame) {
      logger.info('User appears to be leaving from a cancelled/errored join')
      state.activity = null
      state.pendingServerType = 'public'
      state.accessCode = null
      state.isTeleport = false
      state.reservedMarker = false
      publish()
    }

    return
  }

  const reason = GAME_DISCONNECT_REASON_PATTERN.exec(line)
  if (reason && line.includes(GAME_DISCONNECT_REASON_ENTRY)) {
    const code = Number(reason[1])
    if (code === 1) logger.info(`Inactivity timeout detected (reason code: ${code})`)
    else if (code === 277) logger.info(`Internet disconnection detected (reason code: ${code})`)
    else logger.info(`Disconnect reason code: ${code}`)
  }

  if (!state.inGame && !state.activity) {
    // We are not in a game, nor in the process of joining one.
    if (line.includes(GAME_JOINING_PRIVATE_SERVER_ENTRY)) {
      state.pendingServerType = 'private'

      const match = GAME_JOINING_PRIVATE_SERVER_PATTERN.exec(line)
      if (match) state.accessCode = match[1]
      return
    }

    const joining = GAME_JOINING_ENTRY_PATTERN.exec(line)
    if (joining && line.includes(GAME_JOINING_ENTRY)) {
      const [, jobId, placeId, address] = joining

      state.activity = {
        placeId,
        universeId: null,
        jobId,
        gameName: null,
        gameThumbnailUrl: null,
        serverType: state.pendingServerType,
        machineAddress: address,
        accessCode: state.accessCode,
        isTeleport: state.isTeleport,
        joinedAt: Date.now(),
        leftAt: null
      }

      state.inGame = false
      state.isTeleport = false

      if (state.reservedMarker) {
        state.activity.serverType = 'reserved'
        state.reservedMarker = false
      }

      logger.info(`Joining game (place ${state.activity.placeId}, job ${jobId})`)
      publish()
      void enrich(state.activity)
    }
  } else if (!state.inGame && state.activity) {
    // We are not confirmed to be in a game, but we are joining one.
    const universe = GAME_JOINING_UNIVERSE_PATTERN.exec(line)
    if (universe && line.includes(GAME_JOINING_UNIVERSE_ENTRY)) {
      state.activity.universeId = universe[1]
      logger.info(`Joining universe ${universe[1]} as user ${universe[2]}`)
      return
    }

    const udmux = GAME_JOINING_UDMUX_PATTERN.exec(line)
    if (udmux && line.includes(GAME_JOINING_UDMUX_ENTRY)) {
      if (udmux[2] === state.activity.machineAddress) {
        state.activity.machineAddress = udmux[1]
        logger.info(`Server is UDMUX protected (place ${state.activity.placeId})`)
      }
      return
    }

    const joined = GAME_JOINED_ENTRY_PATTERN.exec(line)
    if (joined && line.includes(GAME_JOINED_ENTRY)) {
      if (joined[1] !== state.activity.machineAddress) return

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
  } else if (state.inGame && state.activity) {
    // We are confirmed to be in a game.
    if (line.includes(GAME_DISCONNECTED_ENTRY)) {
      logger.info(`Disconnected from game (place ${state.activity.placeId})`)

      const finished = { ...state.activity, leftAt: Date.now() }
      await updateLastActivity({ leftAt: finished.leftAt })
      emit('activity:leave', { activity: finished })

      state.activity = null
      state.inGame = false
      state.pendingServerType = 'public'
      state.accessCode = null
      publish()
      return
    }

    if (line.includes(GAME_TELEPORTING_ENTRY)) {
      logger.info(`Initiating teleport to server (place ${state.activity.placeId})`)
      state.isTeleport = true
      return
    }

    if (line.includes(GAME_JOINING_RESERVED_SERVER_ENTRY)) {
      state.isTeleport = true
      state.reservedMarker = true
      return
    }

    const message = GAME_MESSAGE_ENTRY_PATTERN.exec(line)
    if (message && line.includes(GAME_MESSAGE_ENTRY)) {
      handleGameMessage(message[1])
    }
  }
}

/**
 * Handles `[BloxstrapRPC]` messages emitted by experiences that support rich
 * presence. The payload is JSON (`{ command, data }`); malformed messages are
 * ignored. `SetRichPresence` is relayed to Discord, matching the reference.
 */
function handleGameMessage(payload: string): void {
  let parsed: { command?: unknown; data?: unknown }

  try {
    parsed = JSON.parse(payload) as { command?: unknown; data?: unknown }
  } catch {
    logger.warn('Ignored malformed BloxstrapRPC message')
    return
  }

  if (typeof parsed.command !== 'string' || parsed.command.length === 0) {
    logger.warn('Ignored BloxstrapRPC message without a command')
    return
  }

  logger.info(`Received RPC message: '${parsed.command}'`)

  if (parsed.command === 'SetRichPresence' && parsed.data) {
    rpc.setRichPresence(parsed.data)

    // Keep the in-app preview in step with what Discord is now showing.
    const data = parsed.data as {
      details?: unknown
      state?: unknown
    }
    emit('rpc:update', {
      connected: true,
      details: typeof data.details === 'string' ? data.details : null,
      state: typeof data.state === 'string' ? data.state : null,
      largeImage: null,
      since: state.activity?.joinedAt ?? null
    })
  }
}

/** Looks up the experience name and icon so the UI has something to show. */
async function enrich(activity: ActivityEntry): Promise<void> {
  try {
    // Prefer the universe id read straight from the log; fall back to the
    // places -> universe lookup when the client never printed it.
    if (!activity.universeId) {
      const universe = await getJson<{ universeId?: number }>(
        `https://apis.roblox.com/universes/v1/places/${activity.placeId}/universe`,
        { retries: 1, timeoutMs: 8000 }
      )
      if (!universe?.universeId) return
      if (state.activity !== activity) return
      activity.universeId = String(universe.universeId)
    }

    const details = await getJson<{ data?: Array<{ name?: string }> }>(
      `https://games.roblox.com/v1/games?universeIds=${activity.universeId}`,
      { retries: 1, timeoutMs: 8000 }
    )
    const name = details?.data?.[0]?.name
    if (name && state.activity === activity) activity.gameName = name

    const icons = await getJson<{ data?: Array<{ imageUrl?: string; state?: string }> }>(
      `https://thumbnails.roblox.com/v1/games/icons?universeIds=${activity.universeId}&size=128x128&format=Png&isCircular=false`,
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

  if (activity.serverType === 'private' && activity.accessCode) {
    return `roblox://experiences/start?placeId=${activity.placeId}&linkCode=${activity.accessCode}`
  }
  if (activity.serverType !== 'public' || !activity.jobId) {
    return `roblox://experiences/start?placeId=${activity.placeId}`
  }
  return `roblox://experiences/start?placeId=${activity.placeId}&gameInstanceId=${activity.jobId}`
}
