import { execFile } from 'child_process'
import { chmod, mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { OperationResult, ShortcutRequest, ShortcutResult } from '@shared/models'
import { createLogger } from '../utils/logger'
import { ensureDir, sanitizeName } from '../utils/fs'
import { resolveJoinUri } from './accounts'
import { localRobloxRoot } from '../utils/paths'

/**
 * Desktop and Start-menu shortcuts.
 *
 * A shortcut always points back at *this* executable with a Roblox launch URI
 * as its argument, never at the client directly: that way a shortcut inherits
 * everything the launcher does — the mods, the FastFlags, the chosen account
 * and, for a region shortcut, the server pick — instead of launching a bare
 * client.
 *
 * When an account is named, the URI is resolved through the account manager
 * first so the shortcut carries a real join ticket. Tickets expire, so the
 * shortcut also records the account and region in its name; re-creating it is a
 * click on the same button.
 */

const logger = createLogger('Shortcuts')

interface ShortcutPlan {
  name: string
  uri: string
  args: string[]
}

function desktopDirectory(): string {
  return join(homedir(), 'Desktop')
}

function startMenuDirectory(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
    return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  }

  if (process.platform === 'darwin') {
    return join(homedir(), 'Applications')
  }

  return join(homedir(), '.local', 'share', 'applications')
}

function iconPath(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          join(process.resourcesPath ?? '', 'icon.ico'),
          join(process.resourcesPath ?? '', 'icon.png')
        ]
      : [join(process.resourcesPath ?? '', 'icon.png')]

  return candidates.find((candidate) => candidate.length > 0) ?? null
}

/** Runs a command, resolving with its stdout rather than rejecting. */
function run(command: string, args: string[], timeout = 20_000): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout, windowsHide: true }, (error, stdout) => {
      resolve(error ? '' : String(stdout))
    })
  })
}

async function plan(request: ShortcutRequest): Promise<ShortcutPlan> {
  const placeId = request.placeId.trim()

  let uri = `roblox://experiences/start?placeId=${encodeURIComponent(placeId)}`
  let accountSuffix = ''

  if (request.accountId) {
    try {
      const resolved = await resolveJoinUri({ placeId, accountId: request.accountId })
      uri = resolved.uri
      accountSuffix = resolved.accountName ? ` (${resolved.accountName})` : ''
    } catch (error) {
      // A ticket could not be minted; the shortcut still works as a plain join.
      logger.warn(`Shortcut for ${placeId} was created without an account ticket: ${String(error)}`)
    }
  }

  const regionSuffix = request.region && request.region !== 'any' ? ` · ${request.region}` : ''

  return {
    name:
      sanitizeName(request.name || `Roblox ${placeId}`, `Roblox ${placeId}`) +
      accountSuffix +
      regionSuffix,
    uri,
    args: [uri]
  }
}

export async function create(request: ShortcutRequest): Promise<OperationResult<ShortcutResult>> {
  const planResult = await plan(request)
  const created: string[] = []
  const errors: string[] = []

  const locations = request.locations.length > 0 ? request.locations : (['desktop'] as const)

  for (const location of locations) {
    const directory = location === 'desktop' ? desktopDirectory() : startMenuDirectory()

    try {
      await ensureDir(directory)
      const file = await writeShortcut(directory, planResult, location)
      if (file) created.push(file)
      else errors.push(`${location}: the shortcut could not be written`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${location}: ${message}`)
      logger.warn(`Could not create a shortcut in ${directory}: ${message}`)
    }
  }

  if (created.length === 0) {
    return { ok: false, error: errors.join('\n') || 'No shortcut could be created' }
  }

  logger.info(`Created ${created.length} shortcut(s) for place ${request.placeId}`)
  return { ok: true, data: { created, errors } }
}

async function writeShortcut(
  directory: string,
  plan: ShortcutPlan,
  location: 'desktop' | 'start-menu'
): Promise<string | null> {
  const executable = process.execPath
  const icon = iconPath()

  if (process.platform === 'win32') {
    const file = join(directory, `${plan.name}.lnk`)

    const escaped = (value: string): string => value.replace(/'/g, "''")
    const script = [
      `$shell = New-Object -ComObject WScript.Shell`,
      `$shortcut = $shell.CreateShortcut('${escaped(file)}')`,
      `$shortcut.TargetPath = '${escaped(executable)}'`,
      `$shortcut.Arguments = '${escaped(plan.args.join(' '))}'`,
      `$shortcut.WorkingDirectory = '${escaped(join(executable, '..'))}'`,
      icon ? `$shortcut.IconLocation = '${escaped(icon)}'` : '',
      `$shortcut.Description = 'Launch Roblox through RemielleStrap'`,
      `$shortcut.Save()`
    ]
      .filter(Boolean)
      .join('; ')

    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
    return file
  }

  if (process.platform === 'darwin') {
    // A .command file is the honest macOS equivalent: it is executable, it
    // opens in Terminal, and it passes the URI through untouched.
    const file = join(directory, `${plan.name}.command`)
    await writeFile(
      file,
      [
        '#!/bin/sh',
        `exec "${executable}" ${plan.args.map((arg) => `"${arg}"`).join(' ')}`,
        ''
      ].join('\n'),
      'utf8'
    )
    await chmod(file, 0o755)
    return file
  }

  const file = join(directory, `${plan.name.replace(/\s+/g, '-').toLowerCase()}.desktop`)
  await ensureDir(directory)

  const body = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${plan.name}`,
    'Comment=Launch Roblox through RemielleStrap',
    `Exec="${executable}" ${plan.args.map((arg) => `"${arg}"`).join(' ')}`,
    'Terminal=false',
    location === 'desktop' ? '' : 'Categories=Game;Utility;',
    'StartupWMClass=RemielleStrap',
    ''
  ]
    .filter((line) => line.length > 0)
    .join('\n')

  await writeFile(file, `${body}\n`, 'utf8')
  await chmod(file, 0o755)
  return file
}

/**
 * The client's own "Play" shortcut, if the user wants one that skips the
 * launcher entirely (no mods, no flags, no account) — offered next to the
 * launcher shortcut so the difference is explicit.
 */
export async function createClientShortcut(
  name: string,
  executable?: string
): Promise<OperationResult<ShortcutResult>> {
  const target =
    executable ?? join(localRobloxRoot(), 'Versions', 'current', 'RobloxPlayerBeta.exe')
  const directory = desktopDirectory()
  await ensureDir(directory)

  if (process.platform !== 'win32') {
    return { ok: false, error: 'Direct client shortcuts are only created on Windows' }
  }

  const file = join(directory, `${sanitizeName(name, 'Roblox')}.lnk`)
  const escaped = (value: string): string => value.replace(/'/g, "''")

  await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    [
      `$shell = New-Object -ComObject WScript.Shell`,
      `$shortcut = $shell.CreateShortcut('${escaped(file)}')`,
      `$shortcut.TargetPath = '${escaped(target)}'`,
      `$shortcut.Save()`
    ].join('; ')
  ])

  return { ok: true, data: { created: [file], errors: [] } }
}

/** Reads a file back, used by tests and the About diagnostics. */
export async function readShortcut(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch {
    return null
  }
}

export { mkdir }
