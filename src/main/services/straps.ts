import { readdir, readFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type {
  FlagValue,
  OperationResult,
  StrapDetection,
  StrapId,
  StrapImportResult
} from '@shared/models'
import type { ThemeMode } from '@shared/settings'
import { createLogger } from '../utils/logger'
import { copyDir, ensureDir, listFiles, pathExists, readJson, sanitizeName } from '../utils/fs'
import { getSettings, saveSettings } from './settingsStore'
import { paths } from '../utils/paths'

/**
 * Importing configuration from the bootstrappers this one descends from.
 *
 * Detection is path-based: each strap keeps its data in a folder named after
 * itself under `%APPDATA%` (or the platform equivalent). The import maps the
 * fields we understand onto our own settings and reports everything it did not
 * recognise rather than guessing — a silently mis-mapped flag is worse than an
 * unimported one.
 */

const logger = createLogger('StrapImport')

interface StrapSpec {
  id: StrapId
  name: string
  /** Folder names to look for under the app-data root. */
  folders: string[]
  settingsFile: string
  modsFolder: string
  versionsFolder: string
}

const SPECS: StrapSpec[] = [
  {
    id: 'bloxstrap',
    name: 'Bloxstrap',
    folders: ['Bloxstrap'],
    settingsFile: 'Settings.json',
    modsFolder: 'Mods',
    versionsFolder: 'Versions'
  },
  {
    id: 'fishstrap',
    name: 'Fishstrap',
    folders: ['Fishstrap'],
    settingsFile: 'Settings.json',
    modsFolder: 'Mods',
    versionsFolder: 'Versions'
  },
  {
    id: 'froststrap',
    name: 'Froststrap',
    folders: ['Froststrap'],
    settingsFile: 'Settings.json',
    modsFolder: 'Mods',
    versionsFolder: 'Versions'
  },
  {
    id: 'remiellestrap',
    name: 'RemielleStrap',
    folders: ['RemielleStrap'],
    settingsFile: 'Settings.json',
    modsFolder: 'Mods',
    versionsFolder: 'Versions'
  }
]

function appDataRoots(): string[] {
  const roots: string[] = []

  if (process.platform === 'win32') {
    if (process.env.APPDATA) roots.push(process.env.APPDATA)
    if (process.env.LOCALAPPDATA) roots.push(process.env.LOCALAPPDATA)
  } else if (process.platform === 'darwin') {
    roots.push(join(homedir(), 'Library', 'Application Support'))
  } else {
    roots.push(join(homedir(), '.config'), join(homedir(), '.local', 'share'))
  }

  return roots
}

export async function detect(): Promise<StrapDetection[]> {
  const roots = appDataRoots()
  const found: StrapDetection[] = []

  for (const spec of SPECS) {
    let matched: string | null = null

    for (const root of roots) {
      for (const folder of spec.folders) {
        const candidate = join(root, folder)
        if (await pathExists(join(candidate, spec.settingsFile))) {
          matched = candidate
          break
        }
      }
      if (matched) break
    }

    found.push({
      id: spec.id,
      name: spec.name,
      detected: matched !== null,
      settingsFile: matched ? join(matched, spec.settingsFile) : null,
      modsFolder: matched ? join(matched, spec.modsFolder) : null,
      versionsFolder: matched ? join(matched, spec.versionsFolder) : null,
      detail: matched ? `Found at ${matched}` : null
    })
  }

  return found
}

type LegacySettings = Record<string, unknown>

function str(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (typeof value === 'number') return String(value)
  return null
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function themeFrom(value: unknown): ThemeMode | null {
  const raw = str(value)?.toLowerCase()
  if (!raw) return null
  if (raw.startsWith('light')) return 'light'
  if (raw.startsWith('dark')) return 'dark'
  if (raw.includes('system')) return 'system'
  return null
}

/** Maps a legacy settings document onto the parts of ours that line up. */
function mapSettings(legacy: LegacySettings): { patch: Record<string, unknown>; applied: string[] } {
  const patch: Record<string, unknown> = {}
  const applied: string[] = []

  const channel = str(legacy.Channel ?? legacy.channel)
  if (channel) {
    patch.channel = channel
    applied.push('channel')
  }

  const theme = themeFrom(legacy.Theme ?? legacy.theme)
  if (theme) {
    patch.theme = theme
    applied.push('theme')
  }

  const launchMode = str(legacy.LaunchMode ?? legacy.preferredLaunchMode)?.toLowerCase()
  if (launchMode === 'player' || launchMode === 'studio') {
    patch.preferredLaunchMode = launchMode
    applied.push('preferredLaunchMode')
  }

  const mappings: [string, string | null, string][] = [
    ['EnableDiscordRichPresence', 'enableDiscordRpc', 'enableDiscordRpc'],
    ['AutoCloseBootstrapper', 'autoCloseBootstrapper', 'autoCloseBootstrapper'],
    ['ConfirmLaunches', 'confirmLaunches', 'confirmLaunches'],
    ['CloseOnLaunch', 'closeOnRobloxLaunch', 'closeOnRobloxLaunch'],
    ['MinimizeToTray', 'minimizeToTray', 'minimizeToTray'],
    ['NotifyOnRobloxExit', 'notifyOnRobloxExit', 'notifyOnRobloxExit'],
    ['EnableActivityTracking', 'enableActivityTracking', 'enableActivityTracking'],
    ['ShowAccountOnRpc', 'showAccountOnRpc', 'showAccountOnRpc']
  ]

  for (const [legacyKey, target, label] of mappings) {
    if (!target) continue
    const value = bool(legacy[legacyKey])
    if (value === null) continue
    patch[label] = value
    applied.push(label)
  }

  const locale = str(legacy.RobloxLocale)
  if (locale) {
    patch.robloxLocale = locale
    applied.push('robloxLocale')
  }

  return { patch, applied }
}

/** Flag profiles: Bloxstrap keeps them under `FlagProfiles`, keyed by name. */
function mapFlags(legacy: LegacySettings): {
  profiles: Record<string, Record<string, FlagValue>>
  active: string | null
} {
  const raw = legacy.FlagProfiles ?? legacy.flagProfiles
  const profiles: Record<string, Record<string, FlagValue>> = {}

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const cleaned: Record<string, FlagValue> = {}
      for (const [flag, flagValue] of Object.entries(value as Record<string, unknown>)) {
        if (!/^[A-Za-z0-9_.]{1,128}$/.test(flag)) continue
        if (
          typeof flagValue === 'string' ||
          typeof flagValue === 'number' ||
          typeof flagValue === 'boolean'
        ) {
          cleaned[flag] = flagValue
        }
      }
      if (Object.keys(cleaned).length > 0) profiles[name.slice(0, 64)] = cleaned
    }
  }

  const active = str(legacy.ActiveFlagProfile ?? legacy.activeFlagProfile)

  return { profiles, active }
}

/** Also picks up a ClientAppSettings.json that a legacy strap left behind. */
async function flagFileProfiles(root: string | null): Promise<Record<string, Record<string, FlagValue>>> {
  if (!root) return {}

  const profiles: Record<string, Record<string, FlagValue>> = {}

  const candidates = [
    join(root, 'Modifications', 'ClientSettings', 'ClientAppSettings.json'),
    join(root, 'ClientSettings', 'ClientAppSettings.json')
  ]

  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) continue
    const parsed = await readJson<Record<string, unknown> | null>(candidate, null)
    if (!parsed) continue

    const cleaned: Record<string, FlagValue> = {}
    for (const [flag, value] of Object.entries(parsed)) {
      if (!/^[A-Za-z0-9_.]{1,128}$/.test(flag)) continue
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        cleaned[flag] = value
      }
    }

    if (Object.keys(cleaned).length > 0) profiles['Imported flags'] = cleaned
  }

  return profiles
}

async function importMods(source: string | null): Promise<number> {
  if (!source || !(await pathExists(source))) return 0

  await ensureDir(paths.mods)

  let imported = 0
  const entries = await readdir(source, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const target = join(paths.mods, sanitizeName(entry.name, `imported-${imported + 1}`))
    if (await pathExists(target)) continue

    const files = await listFiles(join(source, entry.name))
    if (files.length === 0) continue

    await copyDir(join(source, entry.name), target)
    imported += 1
  }

  return imported
}

export async function runImport(request: {
  id: StrapId
  settings: boolean
  flagProfiles: boolean
  mods: boolean
}): Promise<OperationResult<StrapImportResult>> {
  const detections = await detect()
  const detection = detections.find((entry) => entry.id === request.id)

  if (!detection?.detected || !detection.settingsFile) {
    return { ok: false, error: `${detection?.name ?? request.id} was not found on this machine` }
  }

  const result: StrapImportResult = {
    settingsApplied: [],
    flagProfiles: [],
    modsImported: 0,
    skipped: []
  }

  let legacy: LegacySettings = {}

  try {
    legacy = JSON.parse(await readFile(detection.settingsFile, 'utf8')) as LegacySettings
  } catch (error) {
    return {
      ok: false,
      error: `Could not read ${detection.settingsFile}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  if (request.settings) {
    const { patch, applied } = mapSettings(legacy)
    if (Object.keys(patch).length > 0) {
      await saveSettings(patch as never)
      result.settingsApplied = applied
    } else {
      result.skipped.push('No recognisable settings were found in that file')
    }

    const unrecognised = Object.keys(legacy).filter(
      (key) => !/^(Channel|Theme|LaunchMode|RobloxLocale|FlagProfiles|ActiveFlagProfile)/i.test(key)
    )
    if (unrecognised.length > 0) {
      result.skipped.push(`${unrecognised.length} setting(s) have no equivalent and were left alone`)
    }
  }

  if (request.flagProfiles) {
    const { profiles, active } = mapFlags(legacy)
    const fromFiles = await flagFileProfiles(detection.versionsFolder ?? detection.modsFolder)

    const merged = { ...fromFiles, ...profiles }
    const names = Object.keys(merged)

    if (names.length === 0) {
      result.skipped.push('No flag profiles were found')
    } else {
      const settings = getSettings()
      await saveSettings({
        flagProfiles: { ...settings.flagProfiles, ...merged },
        activeFlagProfile: active && merged[active] ? active : settings.activeFlagProfile
      })
      result.flagProfiles = names
    }
  }

  if (request.mods) {
    result.modsImported = await importMods(detection.modsFolder)
    if (result.modsImported === 0) {
      result.skipped.push('No mod folders were available to copy')
    }
  }

  logger.info(
    `${detection.name} import: ${result.settingsApplied.length} settings, ${result.flagProfiles.length} profiles, ${result.modsImported} mods`
  )

  return { ok: true, data: result }
}

/* --------------------------------------------------------------- Helpers */

/** Human summary of what an import would bring over, shown before it runs. */
export async function preview(id: StrapId): Promise<{ settings: number; flagProfiles: number; mods: number }> {
  const detections = await detect()
  const detection = detections.find((entry) => entry.id === id)

  if (!detection?.detected || !detection.settingsFile) {
    return { settings: 0, flagProfiles: 0, mods: 0 }
  }

  try {
    const legacy = JSON.parse(await readFile(detection.settingsFile, 'utf8')) as Record<string, unknown>
    const { applied } = mapSettings(legacy)
    const { profiles } = mapFlags(legacy)
    const extra = await flagFileProfiles(detection.versionsFolder ?? detection.modsFolder)

    let mods = 0
    if (detection.modsFolder && (await pathExists(detection.modsFolder))) {
      const entries = await readdir(detection.modsFolder, { withFileTypes: true })
      mods = entries.filter((entry) => entry.isDirectory()).length
    }

    return {
      settings: applied.length,
      flagProfiles: Object.keys({ ...extra, ...profiles }).length,
      mods
    }
  } catch {
    return { settings: 0, flagProfiles: 0, mods: 0 }
  }
}
