import { execFile } from 'child_process'
import { createLogger } from '../utils/logger'
import { getSettings } from './settingsStore'
import { isRobloxRunning } from './activity'

/**
 * Crash handler auto-close.
 *
 * When the client crashes, Roblox opens its own crash reporter — a small window
 * asking whether to send a report. Playtesting means seeing it often, and it
 * has to be dismissed by hand every time.
 *
 * This watches for the process while a client is running (or just after it
 * stopped, which is exactly when the handler appears) and closes it. It is off
 * by default, because some people do want to send crash reports and hiding the
 * window would silently deny them the chance.
 */

const logger = createLogger('CrashHandler')

const PROCESS_NAMES = ['RobloxCrashHandler.exe', 'RobloxStudioBetaCrashHandler.exe']
const POLL_INTERVAL_MS = 3000
/** How long the watcher keeps looking after the last client exited. */
const LINGER_MS = 90_000

let timer: NodeJS.Timeout | null = null
let lastClientSeenAt = 0
let closedCount = 0

function run(command: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true }, (error, stdout) => {
      resolve(error ? '' : String(stdout))
    })
  })
}

/** Pids for every crash-handler process that is currently running. */
async function handlerPids(): Promise<number[]> {
  if (process.platform !== 'win32') return []

  const pids: number[] = []

  for (const name of PROCESS_NAMES) {
    const output = await run('tasklist', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'])

    for (const line of output.split(/\r?\n/)) {
      const match = /^"[^"]+","(\d+)"/.exec(line.trim())
      if (match) pids.push(Number.parseInt(match[1], 10))
    }
  }

  return pids.filter((pid) => Number.isFinite(pid))
}

/** Closes every crash handler window that is open right now. */
export async function close(): Promise<number> {
  if (process.platform !== 'win32') return 0

  const pids = await handlerPids()
  if (pids.length === 0) return 0

  // taskkill without /F asks the window to close first, which lets the crash
  // handler finish writing its dump before it goes away.
  await run('taskkill', ['/PID', pids.join(' /PID ')])

  closedCount += pids.length
  logger.info(`Closed ${pids.length} crash handler window(s)`)
  return pids.length
}

async function tick(): Promise<void> {
  const running = await isRobloxRunning()

  if (running) lastClientSeenAt = Date.now()

  // Only look while a client is alive or has just gone: the crash handler is
  // meaningless the rest of the time, and polling forever would be rude.
  if (!running && Date.now() - lastClientSeenAt > LINGER_MS) {
    stop()
    return
  }

  await close()
}

/** Starts watching. Safe to call repeatedly. */
export function start(): void {
  stop()

  const settings = getSettings()
  if (!settings.crashHandlerAutoClose || process.platform !== 'win32') return

  lastClientSeenAt = Date.now()
  timer = setInterval(() => {
    void tick()
  }, POLL_INTERVAL_MS)

  logger.info('Watching for the Roblox crash handler')
}

export function stop(): void {
  if (timer) clearInterval(timer)
  timer = null
}

/** Applies the setting at runtime. */
export function sync(): void {
  if (getSettings().crashHandlerAutoClose) start()
  else stop()
}

export async function status(): Promise<{ enabled: boolean; supported: boolean; closed: number }> {
  return {
    enabled: getSettings().crashHandlerAutoClose,
    supported: process.platform === 'win32',
    closed: closedCount
  }
}
