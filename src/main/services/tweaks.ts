import { execFile, spawn, type ChildProcess } from 'child_process'
import { availableParallelism } from 'os'
import { screen } from 'electron'
import type {
  OperationResult,
  OverlayRect,
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
 *  * GPU preference  — per-app `GpuPreference` under HKCU;
 *  * window tracking — `GetWindowRect` on the client's main window, which is
 *    what lets the in-game overlay sit on the game rather than near it.
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

/* ------------------------------------------------- Client window tracking */

/**
 * One reading of the client's main window and process.
 *
 * Every field is nullable and the whole sample carries its own timestamp, so a
 * consumer can tell "not measured yet" from "measured and unavailable" rather
 * than drawing a zero.
 */
export interface ClientWindowSample {
  /** Pid of the client process whose window was measured. */
  pid: number | null
  /** Window rectangle in screen coordinates. */
  bounds: OverlayRect | null
  /** True when that rectangle covers an entire display. */
  fullscreen: boolean
  workingSetBytes: number | null
  /** Total processor seconds the process has consumed since it started. */
  cpuSeconds: number | null
  /**
   * Share of every core, derived from two consecutive samples. Null until the
   * second reading exists, because a single `TotalProcessorTime` cannot yield
   * a rate.
   */
  cpuPercent: number | null
  sampledAt: number
  /** True while the watcher process is alive and reporting. */
  live: boolean
}

const EMPTY_SAMPLE: ClientWindowSample = {
  pid: null,
  bounds: null,
  fullscreen: false,
  workingSetBytes: null,
  cpuSeconds: null,
  cpuPercent: null,
  sampledAt: 0,
  live: false
}

/** How often the watcher itself reads the window, independent of consumers. */
const WATCHER_INTERVAL_MS = 400
/** Safety net: the watcher ends itself after this long even if we forget. */
const WATCHER_MAX_HOURS = 12

let watcher: ChildProcess | null = null
let latest: ClientWindowSample = { ...EMPTY_SAMPLE }
/** Previous cpu reading, keyed by pid, for the derived percentage. */
let previousCpu: { pid: number; seconds: number; at: number } | null = null
let stdoutBuffer = ''

/** True where a client window can be measured at all. */
export function windowTrackingSupported(): boolean {
  return process.platform === 'win32'
}

/**
 * The watcher script.
 *
 * `Add-Type` compiles a small C# shim around `user32.dll`, which costs a second
 * or two — far too slow to pay on every poll. So the shim is compiled once in a
 * process that stays alive and prints one line per tick, exactly like the
 * multi-instance watcher. It exits by itself when this app's process is gone, so
 * a crash cannot leave it behind.
 */
function watcherScript(parentPid: number): string {
  return `
$ErrorActionPreference = 'SilentlyContinue'
$parent = ${parentPid}
$interval = ${WATCHER_INTERVAL_MS}
$invariant = [System.Globalization.CultureInfo]::InvariantCulture

$signature = @'
using System;
using System.Runtime.InteropServices;
namespace Remielle {
  public struct WinRect { public int Left; public int Top; public int Right; public int Bottom; }
  public static class Win32 {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out WinRect rect);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  }
}
'@

try { Add-Type -TypeDefinition $signature | Out-Null }
catch { Write-Output 'error'; exit 0 }

$deadline = (Get-Date).AddHours(${WATCHER_MAX_HOURS})

while ((Get-Date) -lt $deadline) {
  if (-not (Get-Process -Id $parent)) { break }

  $best = $null

  foreach ($p in (Get-Process -Name 'RobloxPlayerBeta')) {
    if ($p.MainWindowHandle -eq [IntPtr]::Zero) { continue }
    if (-not [Remielle.Win32]::IsWindowVisible($p.MainWindowHandle)) { continue }

    $rect = New-Object Remielle.WinRect
    if (-not [Remielle.Win32]::GetWindowRect($p.MainWindowHandle, [ref]$rect)) { continue }

    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -le 0 -or $height -le 0) { continue }

    # Multi-instance runs have several clients; the largest window is the one
    # somebody is looking at, which is the only sensible thing to overlay.
    if ($null -eq $best -or ($width * $height) -gt ($best.Width * $best.Height)) {
      $cpu = 0.0
      try { $cpu = $p.TotalProcessorTime.TotalSeconds } catch { }

      $best = [pscustomobject]@{
        Pid = $p.Id
        Left = $rect.Left
        Top = $rect.Top
        Width = $width
        Height = $height
        WorkingSet = $p.WorkingSet64
        Cpu = $cpu
      }
    }
  }

  if ($null -eq $best) {
    Write-Output 'none'
  } else {
    Write-Output ([string]::Format($invariant, '{0};{1};{2};{3};{4};{5};{6}',
      $best.Pid, $best.Left, $best.Top, $best.Width, $best.Height, $best.WorkingSet,
      [math]::Round($best.Cpu, 3)))
  }

  Start-Sleep -Milliseconds $interval
}
`.trim()
}

/** True when a rectangle covers a whole display, i.e. the client is fullscreen. */
function coversDisplay(bounds: OverlayRect): boolean {
  try {
    return screen.getAllDisplays().some((display) => {
      const area = display.bounds
      return (
        Math.abs(area.x - bounds.x) <= 2 &&
        Math.abs(area.y - bounds.y) <= 2 &&
        Math.abs(area.width - bounds.width) <= 2 &&
        Math.abs(area.height - bounds.height) <= 2
      )
    })
  } catch {
    // `screen` is unavailable before the app is ready; treat it as windowed.
    return false
  }
}

/** Folds one watcher line into the current sample. */
function ingest(line: string): void {
  const trimmed = line.trim()
  if (trimmed.length === 0) return

  if (trimmed === 'error') {
    logger.warn('The window watcher could not load user32; tracking is unavailable')
    latest = { ...EMPTY_SAMPLE, sampledAt: Date.now(), live: true }
    return
  }

  if (trimmed === 'none') {
    previousCpu = null
    latest = { ...EMPTY_SAMPLE, sampledAt: Date.now(), live: true }
    return
  }

  const parts = trimmed.split(';')
  if (parts.length < 7) return

  const [pid, x, y, width, height, workingSet, cpuSeconds] = parts.map((part) =>
    Number.parseFloat(part)
  )

  if (![pid, x, y, width, height].every((value) => Number.isFinite(value))) return

  const bounds: OverlayRect = {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height)
  }

  const at = Date.now()
  const seconds = Number.isFinite(cpuSeconds) ? cpuSeconds : null

  // A rate needs two readings of the same process; the first one is only stored.
  let cpuPercent: number | null = null
  if (seconds !== null && previousCpu && previousCpu.pid === pid) {
    const elapsed = (at - previousCpu.at) / 1000
    if (elapsed > 0.2) {
      const share = (seconds - previousCpu.seconds) / elapsed / availableParallelism()
      cpuPercent = Math.min(100, Math.max(0, Math.round(share * 1000) / 10))
    }
  }
  if (seconds !== null) previousCpu = { pid, seconds, at }

  latest = {
    pid,
    bounds,
    fullscreen: coversDisplay(bounds),
    workingSetBytes: Number.isFinite(workingSet) ? Math.max(0, Math.round(workingSet)) : null,
    cpuSeconds: seconds,
    cpuPercent,
    sampledAt: at,
    live: true
  }
}

/**
 * Starts watching the client window. Idempotent, and a no-op off Windows.
 *
 * The watcher is only alive while something needs it — the overlay starts and
 * stops it — because a process that polls the window station forever would be
 * rude for a feature most people never switch on.
 */
export function startClientWindowWatcher(): boolean {
  if (!windowTrackingSupported()) return false
  if (watcher && !watcher.killed) return true

  try {
    const script = watcherScript(process.pid)
    const encoded = Buffer.from(script, 'utf16le').toString('base64')

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    )

    watcher = child
    stdoutBuffer = ''
    previousCpu = null
    latest = { ...EMPTY_SAMPLE, live: true }

    // `stdio` above asks for a pipe, so stdout exists; the guard keeps the type
    // honest rather than asserting it.
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) ingest(line)
    })

    child.on('error', (error) => {
      logger.warn(`The window watcher could not start: ${error.message}`)
      watcher = null
      latest = { ...EMPTY_SAMPLE }
    })

    child.on('exit', (code) => {
      // Only log the unexpected exits: stopping it ourselves is normal.
      if (watcher === child) logger.info(`Window watcher exited with code ${code}`)
      if (watcher === child) watcher = null
      latest = { ...latest, live: false }
    })

    logger.info('Client window watcher started')
    return true
  } catch (error) {
    logger.warn(`Client window watcher failed to start: ${String(error)}`)
    watcher = null
    return false
  }
}

export function stopClientWindowWatcher(): void {
  const child = watcher
  watcher = null

  if (child && !child.killed) {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }

  previousCpu = null
  latest = { ...EMPTY_SAMPLE }
}

/** The most recent reading. Never blocks and never spawns anything. */
export function clientWindowSample(): ClientWindowSample {
  if (!windowTrackingSupported()) return { ...EMPTY_SAMPLE }

  // A watcher that died — a machine sleeping can do it — leaves `live` false
  // and clears its own handle, so the next `syncWatcher` starts a fresh one.
  return { ...latest }
}
