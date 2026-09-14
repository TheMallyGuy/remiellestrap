import { spawn } from 'child_process'
import type { OperationResult } from '@shared/models'
import { createLogger } from '../utils/logger'
import { getSettings } from './settingsStore'

/**
 * Multi-instance launching.
 *
 * Roblox enforces one running client per user through two named kernel objects,
 * `ROBLOX_singletonMutex` and `ROBLOX_singletonEvent`. Whoever creates them
 * first wins: if a *non-Roblox* process gets there first, the client's own
 * check fails open and a second client starts happily.
 *
 * So this pre-creates both, then hands them to a detached watcher that holds
 * them until every client has exited and releases them afterwards — which is
 * what keeps normal behaviour intact once you are done playing. The watcher is
 * a PowerShell process rather than a native module: it costs nothing, it shows
 * up in the task manager as `powershell`, and it disappears on its own.
 *
 * Everything here degrades to single-instance launching: if PowerShell is
 * unavailable or blocked, the failure is logged and the launch continues.
 */

const logger = createLogger('MultiInstance')

const MUTEX_NAME = 'ROBLOX_singletonMutex'
const EVENT_NAME = 'ROBLOX_singletonEvent'

/** How long the watcher waits between process-list checks. */
const POLL_SECONDS = 5

/** Set while a watcher is alive, so repeated launches do not stack them. */
let armed = false

function watcherScript(): string {
  // Blocks until no RobloxPlayerBeta process remains, then disposes the objects
  // so a later launch behaves exactly as it would without any of this.
  return `
$ErrorActionPreference = 'Stop'

$mutex = New-Object System.Threading.Mutex($true, '${MUTEX_NAME}')
$event = New-Object System.Threading.EventWaitHandle(
  $true,
  [System.Threading.EventResetMode]::ManualReset,
  '${EVENT_NAME}'
)

try {
  while ($true) {
    Start-Sleep -Seconds ${POLL_SECONDS}
    $running = Get-Process -Name 'RobloxPlayerBeta' -ErrorAction SilentlyContinue
    if (-not $running) { break }
  }
} finally {
  try { $mutex.ReleaseMutex() } catch { }
  $mutex.Dispose()
  $event.Dispose()
}
`.trim()
}

/**
 * Starts the singleton watcher. Safe to call before every launch: an already
 * running watcher makes this a no-op.
 */
export async function arm(): Promise<OperationResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Multi-instance launching is a Windows-only feature' }
  }

  if (armed && (await watcherRunning())) return { ok: true }

  try {
    // -EncodedCommand avoids every quoting question on the way to PowerShell.
    const encoded = Buffer.from(watcherScript(), 'utf16le').toString('base64')

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { detached: true, stdio: 'ignore', windowsHide: true }
    )

    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })

    child.unref()
    armed = true
    logger.info('Multi-instance watcher armed; a second client can now start')

    return { ok: true }
  } catch (error) {
    armed = false
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Could not arm the multi-instance watcher: ${message}`)
    return { ok: false, error: message }
  }
}

/** True when a watcher process is alive. */
async function watcherRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  const { execFile } = await import('child_process')

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "(Get-Process -Name powershell -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*${MUTEX_NAME}*' } | Measure-Object).Count"
      ],
      { timeout: 8000, windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(false)
          return
        }
        resolve(Number.parseInt(String(stdout).trim(), 10) > 0)
      }
    )
  })
}

/** Whether the feature should be offered at all. */
export function supported(): boolean {
  return process.platform === 'win32'
}

/** Diagnostics for the settings page. */
export async function status(): Promise<{ enabled: boolean; supported: boolean; armed: boolean }> {
  return {
    enabled: getSettings().multiInstanceLaunching,
    supported: supported(),
    armed: armed && (await watcherRunning())
  }
}

/**
 * Forgets the local arm flag.
 *
 * The detached watcher releases the singleton objects by itself once the last
 * client exits, so this only clears our bookkeeping — used when the app quits
 * so a later run re-checks rather than trusting a stale flag.
 */
export function disarm(): void {
  armed = false
}
