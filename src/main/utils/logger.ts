import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  WriteStream
} from 'fs'
import { join } from 'path'
import { paths } from './paths'

/**
 * Structured, rolling file logger. Mirrors Bloxstrap's log style:
 * `2024-11-21T22:29:39Z [Scope::Method] message`
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const MAX_LOG_FILES = 15

let stream: WriteStream | null = null
let currentFile: string | null = null
const buffered: string[] = []

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function fileStamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

export function initLogger(): string {
  try {
    mkdirSync(paths.logs, { recursive: true })
  } catch {
    /* logging must never crash startup */
  }

  currentFile = join(paths.logs, `RemielleStrap_${fileStamp()}.log`)

  try {
    stream = createWriteStream(currentFile, { flags: 'a', encoding: 'utf8' })
    for (const line of buffered) stream.write(line)
    buffered.length = 0
  } catch {
    stream = null
  }

  cleanupOldLogs()
  return currentFile
}

function cleanupOldLogs(): void {
  try {
    if (!existsSync(paths.logs)) return
    const files = readdirSync(paths.logs)
      .filter((f) => f.startsWith('RemielleStrap_') && f.endsWith('.log'))
      .map((f) => {
        const full = join(paths.logs, f)
        return { full, mtime: statSync(full).mtimeMs }
      })
      .sort((a, b) => b.mtime - a.mtime)

    for (const file of files.slice(MAX_LOG_FILES)) {
      try {
        unlinkSync(file.full)
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function write(level: LogLevel, scope: string, message: string): void {
  const line = `${timestamp()} [${level.toUpperCase()}] [${scope}] ${message}\n`

  if (stream) {
    stream.write(line)
  } else {
    buffered.push(line)
    if (buffered.length > 500) buffered.shift()
  }

  if (level === 'error') process.stderr.write(line)
  else if (process.env.NODE_ENV !== 'production' || level === 'warn') process.stdout.write(line)
}

function format(value: unknown): string {
  if (value instanceof Error) return `${value.message}\n${value.stack ?? ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export interface ScopedLogger {
  debug(message: unknown): void
  info(message: unknown): void
  warn(message: unknown): void
  error(message: unknown): void
  child(sub: string): ScopedLogger
}

export function createLogger(scope: string): ScopedLogger {
  return {
    debug: (m) => write('debug', scope, format(m)),
    info: (m) => write('info', scope, format(m)),
    warn: (m) => write('warn', scope, format(m)),
    error: (m) => write('error', scope, format(m)),
    child: (sub) => createLogger(`${scope}::${sub}`)
  }
}

export function currentLogFile(): string | null {
  return currentFile
}

export function closeLogger(): void {
  try {
    stream?.end()
  } catch {
    /* ignore */
  }
  stream = null
}

export const log = createLogger('App')
