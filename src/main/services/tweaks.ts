import { execFile } from 'child_process'
import { availableParallelism } from 'os'
import type {
  OperationResult,
  PowerPlan,
  ProcessTweakRequest,
  ProcessTweakState
} from '@shared/models'
import { createLogger } from '../utils/logger'
import { getSettings } from './settingsStore'
import { currentActivity, isRobloxRunning } from './activity'

/**
 * PC tweaks.
 *
 * Everything here is Windows-only and best-effort: a locked-down machine will
 * refuse some of it, and that must never block a launch. Each helper is a thin,
 * readable wrapper over a documented Windows facility:
 *
 *  * process priority — `PriorityClass` on the client process;
 *  * CPU affinity    — the process's `ProcessorAffinity` bitmask;
 *  * memory trim     — `EmptyWorkingSet` from psapi.dll;
 *  * power plan      — `powercfg /setactive`;
 *  * GPU preference  — per-app `GpuPreference` under HKCU.
 */

const logger = createLogger('Tweaks')

/** Runs a command and resolves with its stdout (empty on failure). */
function run(command: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true }, (error, stdout) => {
      if (error) {
        logger.info(`${command} exited with an error: ${error.message}`)
        resolve('')
        return
      }
      resolve(String(stdout))
    })
  })
}

function powershell(script: string, timeout = 20_000): Promise<string> {
  if (process.platform !== 'win32') return Promise.resolve('')
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], timeout)
}

/* --------------------------------------------------------------- Process */

/**
 * Pids of the running client processes.
 *
 * `tasklist` is used rather than the activity service's own detection because
 * the tweaks need every match (multi-instance runs have several) and no
 * assumptions about which log a process belongs to.
 */
export async function robloxProcessIds(): Promise<number[]> {
  if (process.platform !== 'win32') return []

  const output = await run('tasklist', [
    '/FI',
    'IMAGENAME eq RobloxPlayerBeta.exe',
    '/FO',
    'CSV',
    '/NH'
  ])

  return output
    .split(/\r?\n/)
    .map((line) => /^"[^"]+","(\d+)"/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => Number.parseInt(match[1], 10))
    .filter((pid) => Number.isFinite(pid))
}

const PRIORITY_CLASS: Record<string, string> = {
  normal: 'Normal',
  abovenormal: 'AboveNormal',
  high: 'High'
}

export async function processState(): Promise<ProcessTweakState> {
  const cpuCount = availableParallelism()
  const running = await isRobloxRunning()

  if (!running || process.platform !== 'win32') {
    return { running, pid: null, priority: null, affinity: null, workingSetBytes: null, cpuCount }
  }

  const pids = await robloxProcessIds()
  const pid = pids[0] ?? null
  if (pid === null) {
    return { running, pid: null, priority: null, affinity: null, workingSetBytes: null, cpuCount }
  }

  const info = await powershell(
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { "$($p.PriorityClass);$($p.ProcessorAffinity);$($p.WorkingSet64)" }`
  )

  const [priority, affinityMask, workingSet] = info.trim().split(';')

  return {
    running,
    pid,
    priority: priority || null,
    affinity: affinityMask ? maskToCores(Number(affinityMask)) : null,
    workingSetBytes: workingSet ? Number.parseInt(workingSet, 10) : null,
    cpuCount
  }
}

/** Turns a bitmask into the list of core indices it selects. */
export function maskToCores(mask: number): number[] {
  const cores: number[] = []
  for (let bit = 0; bit < 64; bit += 1) {
    if ((mask & (1 << bit)) !== 0) cores.push(bit)
  }
  return cores
}

export function coresToMask(cores: number[]): number {
  return cores.reduce((mask, core) => mask | (1 << core), 0)
}

export async function applyProcessTweaks(request: ProcessTweakRequest): Promise<ProcessTweakState> {
  if (process.platform !== 'win32') {
    return { ...(await processState()), priority: null, affinity: null }
  }

  const pids = await robloxProcessIds()
  if (pids.length === 0) {
    return { ...(await processState()), running: false }
  }

  const idList = pids.join(',')

  if (request.priority && PRIORITY_CLASS[request.priority]) {
    await powershell(
      `Get-Process -Id ${idList} -ErrorAction SilentlyContinue | ForEach-Object { try { $_.PriorityClass = '${PRIORITY_CLASS[request.priority]}' } catch { } }`
    )
    logger.info(`Client priority set to ${request.priority}`)
  }

  if (request.affinity !== undefined) {
    const mask = request.affinity === null ? 0 : coresToMask(request.affinity)

    if (mask === 0) {
      // All cores: -1 is the documented "every processor" value.
      await powershell(
        `Get-Process -Id ${idList} -ErrorAction SilentlyContinue | ForEach-Object { try { $_.ProcessorAffinity = [IntPtr]::new(-1) } catch { } }`
      )
    } else {
      await powershell(
        `Get-Process -Id ${idList} -ErrorAction SilentlyContinue | ForEach-Object { try { $_.ProcessorAffinity = [IntPtr]::new(${mask}) } catch { } }`
      )
      logger.info(`Client affinity set to cores ${request.affinity?.join(', ') ?? 'all'}`)
    }
  }

  if (request.trim) await trimWorkingSet()

  return processState()
}

/**
 * Asks Windows to page out as much of the client as it can.
 *
 * `EmptyWorkingSet` is the same call every "memory optimiser" uses; it is safe
 * (the pages come back lazily) but only meaningful when the client has been
 * idle, which is why the scheduled version checks that it is not in a game.
 */
export async function trimWorkingSet(): Promise<boolean> {
  if (process.platform !== 'win32') return false

  const pids = await robloxProcessIds()
  if (pids.length === 0) return false

  const script = `
$signature = '[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr handle);'
$api = Add-Type -MemberDefinition $signature -Name RemiellePsapi -Namespace Remielle -PassThru
$done = 0
Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object {
  try { if ($api::EmptyWorkingSet($_.Handle)) { $done++ } } catch { }
}
$done
`.trim()

  const output = await powershell(script)
  const trimmed = Number.parseInt(output.trim() || '0', 10)

  if (trimmed > 0) logger.info(`Trimmed the working set of ${trimmed} client process(es)`)
  return trimmed > 0
}

/* ----------------------------------------------------------- Power plans */

export async function listPowerPlans(): Promise<PowerPlan[]> {
  if (process.platform !== 'win32') return []

  const output = await run('powercfg', ['/list'])
  const plans: PowerPlan[] = []

  for (const line of output.split(/\r?\n/)) {
    const match = /Power Scheme GUID:\s*([0-9a-f-]{36})\s*\(([^)]*)\)(\s*\*)?/i.exec(line)
    if (!match) continue

    plans.push({
      guid: match[1],
      name: match[2].trim(),
      active: Boolean(match[3])
    })
  }

  return plans
}

export async function setPowerPlan(guid: string): Promise<OperationResult<PowerPlan[]>> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Power plans are a Windows feature' }
  }

  if (!/^[0-9a-f-]{36}$/i.test(guid)) {
    return { ok: false, error: 'That is not a power plan identifier' }
  }

  const output = await run('powercfg', ['/setactive', guid])
  if (output === '' && !(await isPlanActive(guid))) {
    return { ok: false, error: 'Windows refused to switch power plan' }
  }

  logger.info(`Active power plan set to ${guid}`)
  return { ok: true, data: await listPowerPlans() }
}

async function isPlanActive(guid: string): Promise<boolean> {
  const plans = await listPowerPlans()
  return plans.some((plan) => plan.guid === guid && plan.active)
}

/* ------------------------------------------------------- GPU preference */

export async function setGpuPreference(
  preference: 'auto' | 'power-saving' | 'high-performance'
): Promise<OperationResult> {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Per-app GPU preference is a Windows feature' }
  }

  // 1 = power saving, 2 = high performance; removing the value restores the
  // system default, which is what "automatic" means.
  if (preference === 'auto') {
    await powershell(
      `Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences' -Name 'RobloxPlayerBeta.exe' -ErrorAction SilentlyContinue`
    )
    return { ok: true }
  }

  const value = preference === 'high-performance' ? 2 : 1

  await powershell(
    [
      `$path = 'HKCU:\\Software\\Microsoft\\DirectX\\UserGpuPreferences'`,
      `if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }`,
      `Set-ItemProperty -Path $path -Name 'RobloxPlayerBeta.exe' -Value 'GpuPreference=${value};'`
    ].join('; ')
  )

  logger.info(`GPU preference set to ${preference}`)
  return { ok: true }
}

/* --------------------------------------------------------- Launch tweaks */

/**
 * Applies the launch-time tweaks the settings ask for. Called by the
 * bootstrapper right after the client is spawned, so the process exists by the
 * time the first PowerShell command runs.
 */
export async function applyLaunchTweaks(): Promise<void> {
  const settings = getSettings()

  if (process.platform !== 'win32') return

  // Give Windows a moment to create the process.
  await new Promise((resolve) => setTimeout(resolve, 2000))

  const state = await processState()
  if (!state.running) {
    logger.info('No client process was found; skipping launch tweaks')
    return
  }

  if (settings.processPriority !== 'normal') {
    await applyProcessTweaks({ priority: settings.processPriority })
  }

  const cores = parseAffinity(settings.cpuAffinity)
  if (cores.length > 0) {
    await applyProcessTweaks({ affinity: cores })
  }

  if (settings.powerPlanOnLaunch) {
    await setPowerPlan(settings.powerPlanOnLaunch)
  }

  if (settings.memoryTrimEnabled) {
    startMemoryTrim()
  }
}

/** Parses "0-3,6" (or "0,1,2,3") into core indices. */
export function parseAffinity(spec: string): number[] {
  const cores = new Set<number>()

  for (const part of spec.split(',')) {
    const trimmed = part.trim()
    if (trimmed.length === 0) continue

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed)
    if (range) {
      const start = Number.parseInt(range[1], 10)
      const end = Number.parseInt(range[2], 10)
      const [low, high] = start <= end ? [start, end] : [end, start]

      for (let core = low; core <= high && core < 64; core += 1) cores.add(core)
      continue
    }

    const single = Number.parseInt(trimmed, 10)
    if (Number.isFinite(single) && single >= 0 && single < 64) cores.add(single)
  }

  return [...cores].sort((a, b) => a - b)
}

/** Renders core indices back into the compact range form. */
export function formatAffinity(cores: number[]): string {
  if (cores.length === 0) return ''

  const sorted = [...new Set(cores)].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let previous = sorted[0]

  for (const core of sorted.slice(1)) {
    if (core === previous + 1) {
      previous = core
      continue
    }
    parts.push(start === previous ? `${start}` : `${start}-${previous}`)
    start = core
    previous = core
  }

  parts.push(start === previous ? `${start}` : `${start}-${previous}`)
  return parts.join(',')
}

/* ------------------------------------------------------- Memory trimming */

let trimTimer: NodeJS.Timeout | null = null

/** Starts (or restarts) the periodic trim the settings ask for. */
export function startMemoryTrim(): void {
  stopMemoryTrim()

  const settings = getSettings()
  if (!settings.memoryTrimEnabled || process.platform !== 'win32') return

  const interval = Math.min(Math.max(settings.memoryTrimMinutes, 1), 240) * 60_000

  trimTimer = setInterval(() => {
    void (async () => {
      // Never trim mid-session: paging out a client that is actively streaming
      // geometry is exactly the wrong moment for it.
      const active = currentActivity()
      if (!active.robloxRunning) {
        stopMemoryTrim()
        return
      }
      if (active.inGame) return

      await trimWorkingSet()
    })()
  }, interval)

  logger.info(`Memory trimming every ${interval / 60_000} minute(s)`)
}

export function stopMemoryTrim(): void {
  if (trimTimer) clearInterval(trimTimer)
  trimTimer = null
}

export function syncMemoryTrim(): void {
  if (getSettings().memoryTrimEnabled) startMemoryTrim()
  else stopMemoryTrim()
}
