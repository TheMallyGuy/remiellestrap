import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import type { ClientLogEvent, LogFileInfo, LogLine, LogReadRequest, LogReadResult } from '@shared/models'
import { createLogger } from '../utils/logger'
import { paths, robloxLogsDirectory } from '../utils/paths'
import { pathExists } from '../utils/fs'
import { emit } from './events'

/**
 * Log viewing.
 *
 * Two sources are exposed: the Roblox client's own logs (which the client
 * writes under `%LOCALAPPDATA%\Roblox\logs`, one file per session) and this
 * app's rolling log.
 *
 * Reading is deliberately streaming-tolerant: a log being written to can end
 * mid-line, so the last line of a tail read is dropped unless the file has
 * stopped growing. Following a file re-reads only what was appended, which is
 * what makes the live view cheap enough to leave open.
 */

const logger = createLogger('Logs')

const LOG_EXTENSIONS = /\.(log|txt|json)$/i
const DEFAULT_TAIL = 400
const MAX_TAIL = 5000

interface LogSource {
  directory: string
  kind: LogFileInfo['kind']
}

function sources(): LogSource[] {
  return [
    { directory: robloxLogsDirectory(), kind: 'roblox' },
    { directory: paths.logs, kind: 'strap' }
  ]
}

/** All log files, newest first. */
export async function listLogFiles(): Promise<LogFileInfo[]> {
  const files: LogFileInfo[] = []

  for (const source of sources()) {
    if (!(await pathExists(source.directory))) continue

    try {
      const entries = await readdir(source.directory, { withFileTypes: true })

      for (const entry of entries) {
        if (!entry.isFile() || !LOG_EXTENSIONS.test(entry.name)) continue
        const info = await stat(join(source.directory, entry.name)).catch(() => null)
        if (!info) continue

        files.push({
          name: entry.name,
          path: join(source.directory, entry.name),
          size: info.size,
          modifiedAt: info.mtimeMs,
          kind: source.kind
        })
      }
    } catch (error) {
      logger.warn(`Could not list ${source.directory}: ${String(error)}`)
    }
  }

  return files.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

/* ------------------------------------------------------------------ Parsing */

/**
 * Roblox log lines look like:
 *   2024-05-02T18:31:00.123Z,0012,1234 [FLog::Output] some message
 * and this app's own logger writes:
 *   2024-05-02T18:31:00.123Z [INFO] [Bootstrapper] some message
 *
 * Anything that matches neither shape is kept as a plain line rather than
 * discarded: an unparsed line is still evidence.
 */
const ROBLOX_PREFIX = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)[^ ]*\s+\[([^\]]+)\]\s?(.*)$/
const STRAP_PREFIX = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+\[([A-Z]+)\]\s+\[([^\]]+)\]\s?(.*)$/

export function parseLine(raw: string, kind: LogFileInfo['kind']): LogLine {
  if (kind === 'strap') {
    const match = STRAP_PREFIX.exec(raw)
    if (match) {
      return {
        at: Number.isNaN(Date.parse(match[1])) ? null : Date.parse(match[1]),
        level: match[2].toLowerCase(),
        scope: match[3],
        text: match[4] ?? ''
      }
    }
  }

  const roblox = ROBLOX_PREFIX.exec(raw)
  if (roblox) {
    return {
      at: Number.isNaN(Date.parse(roblox[1])) ? null : Date.parse(roblox[1]),
      level: null,
      scope: roblox[2],
      text: roblox[3] ?? ''
    }
  }

  return { at: null, level: null, scope: null, text: raw }
}

interface ReadResult {
  text: string
  complete: boolean
}

function readTail(file: string, maxBytes: number, from?: number): Promise<ReadResult> {
  return new Promise((resolve, reject) => {
    void stat(file).then(
      (info) => {
        const start = from ?? Math.max(0, info.size - maxBytes)
        const chunks: Buffer[] = []

        const stream = createReadStream(file, { start, end: Math.max(start, info.size - 1) })
        stream.on('data', (chunk) => chunks.push(chunk as Buffer))
        stream.on('error', reject)
        stream.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          const complete = info.size === 0 || text.endsWith('\n')
          resolve({ text, complete })
        })
      },
      (error) => reject(error)
    )
  })
}

export interface ReadOptions extends LogReadRequest {
  /** Byte offset to start reading from, for incremental updates. */
  from?: number
}

export async function readLog(request: ReadOptions = {}): Promise<LogReadResult> {
  const target = request.path ?? (await listLogFiles())[0]?.path ?? null

  if (!target) {
    return { file: null, lines: [], error: 'There are no log files to show yet' }
  }

  const info = await listLogFiles().then((files) => files.find((file) => file.path === target) ?? null)

  const file: LogFileInfo =
    info ?? {
      name: target.split(/[\\/]/).pop() ?? 'log',
      path: target,
      size: await stat(target).then((value) => value.size).catch(() => 0),
      modifiedAt: await stat(target).then((value) => value.mtimeMs).catch(() => 0),
      kind: target.startsWith(paths.logs) ? 'strap' : 'roblox'
    }

  const tail = Math.min(Math.max(request.tailLines ?? DEFAULT_TAIL, 1), MAX_TAIL)

  try {
    // Read a slice, then keep the last `tail` lines. A byte estimate is used
    // rather than reading the whole file, which can be tens of megabytes.
    const { text, complete } = await readTail(file.path, Math.max(64 * 1024, tail * 220), request.from)

    let lines = text.split(/\r?\n/)

    // A file being appended to can end mid-line; that fragment is not shown
    // until it is finished.
    if (!complete && lines.length > 0) lines = lines.slice(0, -1)

    lines = lines.filter((line) => line.length > 0)

    const filter = request.filter?.trim().toLowerCase()
    const filtered = filter ? lines.filter((line) => line.toLowerCase().includes(filter)) : lines

    return {
      file,
      lines: filtered.slice(-tail).map((line) => parseLine(line, file.kind)),
      error: null
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Could not read ${file.path}: ${message}`)
    return { file, lines: [], error: message }
  }
}

/* -------------------------------------------------------------- Following */

let followTimer: NodeJS.Timeout | null = null
let followState: { path: string; offset: number } | null = null

/** Starts pushing new lines from a log over `logs:line`. */
export async function follow(request: LogReadRequest = {}): Promise<LogReadResult> {
  unfollow()

  const initial = await readLog({ ...request, tailLines: request.tailLines ?? 200 })
  if (!initial.file) return initial

  followState = { path: initial.file.path, offset: initial.file.size }
  followTimer = setInterval(() => {
    void tick()
  }, 1000)

  logger.info(`Following ${initial.file.path}`)
  return initial
}

export function unfollow(): void {
  if (followTimer) clearInterval(followTimer)
  followTimer = null
  followState = null
}

async function tick(): Promise<void> {
  const state = followState
  if (!state) return

  try {
    const info = await stat(state.path)

    // Truncation (log rotation) resets the offset rather than skipping a file.
    if (info.size < state.offset) state.offset = 0
    if (info.size === state.offset) return

    const { text, complete } = await readTail(state.path, info.size - state.offset, state.offset)
    state.offset = info.size

    let lines = text.split(/\r?\n/)
    if (!complete && lines.length > 0) lines = lines.slice(0, -1)
    if (lines.length === 0) return

    const kind: LogFileInfo['kind'] = state.path.startsWith(paths.logs) ? 'strap' : 'roblox'

    for (const line of lines) {
      if (line.length === 0) continue
      emit('logs:line', { path: state.path, line: parseLine(line, kind) })
    }
  } catch {
    // The file was rotated away; stop following it.
    unfollow()
  }
}

/* ------------------------------------------------------- Client log events */

/**
 * Pulls the interesting events out of a client log.
 *
 * The patterns are the ones Bloxstrap established, kept in one place so a
 * Roblox change only needs a fix here. Chat is *not* logged by the client in
 * normal play, so "chat" entries only appear when an experience logs them.
 */
export function parseClientEvents(lines: string[], limit = 300): ClientLogEvent[] {
  const events: ClientLogEvent[] = []
  let placeId: string | null = null
  let jobId: string | null = null

  const push = (kind: ClientLogEvent['kind'], text: string, extra: Partial<ClientLogEvent> = {}): void => {
    events.push({ kind, at: Date.now(), text, placeId, jobId, player: null, ...extra })
  }

  for (const line of lines) {
    if (line.length === 0) continue

    const joining = /! Joining game '([0-9a-f-]{36})' place (\d+)/.exec(line)
    if (joining) {
      jobId = joining[1]
      placeId = joining[2]
      push('join', `Joining place ${placeId}`, { placeId, jobId })
      continue
    }

    const universe = /\[FLog::GameJoinUtil\] .* universe (\d+)/.exec(line)
    if (universe) {
      push('info', `Universe ${universe[1]}`)
      continue
    }

    if (/NetworkClient:Remove\(\)|Disconnected from server|disconnect reason/i.test(line)) {
      push('leave', line.replace(/^\s*\[[^\]]+\]\s*/, '').slice(0, 200))
      continue
    }

    const chat = /\[LogService\]\s*(.+)/.exec(line)
    if (chat) {
      push('chat', chat[1].slice(0, 240))
      continue
    }

    const player = /Player '([^']+)' (joined|left)/i.exec(line)
    if (player) {
      push('player', `${player[1]} ${player[2].toLowerCase()} the server`, { player: player[1] })
      continue
    }

    if (/\[FLog::Error\]|\[FLog::Warning\]/.test(line)) {
      push('error', line.slice(0, 240))
    }
  }

  return events.slice(-limit)
}

export async function clientEvents(request: { path?: string; tailLines?: number } = {}): Promise<ClientLogEvent[]> {
  const result = await readLog({ path: request.path, tailLines: request.tailLines ?? 1200 })
  if (!result.file) return []

  const raw = await readTail(result.file.path, Math.max(64 * 1024, 1200 * 220))
  const lines = raw.text.split(/\r?\n/).filter((line) => line.length > 0)

  return parseClientEvents(lines)
}

/** True when a log has been modified in the last two minutes. */
export async function isLive(file: string): Promise<boolean> {
  const info = await stat(file).catch(() => null)
  return info ? Date.now() - info.mtimeMs < 120_000 : false
}
