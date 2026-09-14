import { dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  FlagAllowlist,
  FlagAllowlistEntry,
  FlagAudit,
  FlagCleanResult,
  FlagPreset,
  FlagPresetApplyRequest,
  FlagProfile,
  FlagValue,
  OperationResult,
  SaveProfileRequest
} from '@shared/models'
import { DEFAULT_FLAG_PROFILE } from '@shared/settings'
import { DISABLE_CAPTURE_FLAGS, VOICE_CHAT_FLAGS } from '@shared/catalog'
import { createLogger } from '../utils/logger'
import { paths } from '../utils/paths'
import { ensureDir, readJson, writeJson } from '../utils/fs'
import { getJson } from './http'
import { getSettings, saveSettings } from './settingsStore'
import {
  BUILTIN_ALLOWLIST,
  FLAG_PRESETS,
  parseRemoteAllowlist,
  mergeAllowlist
} from '../core/allowlist'

/**
 * FastFlag management.
 *
 * Profiles are stored in Settings.json; the active profile is materialised to
 * <version>/ClientSettings/ClientAppSettings.json before each launch, which is
 * how the Roblox client picks flags up.
 */

const logger = createLogger('FastFlags')

/** Roblox flag names are alphanumeric with dots/underscores, no spaces. */
const FLAG_NAME_PATTERN = /^[A-Za-z0-9_.]{1,128}$/
const MAX_PROFILES = 50
const MAX_FLAGS_PER_PROFILE = 2000

/** Prefixes the client recognises; used to warn on obviously bogus names. */
const KNOWN_PREFIXES = [
  'FFlag',
  'DFFlag',
  'SFFlag',
  'FInt',
  'DFInt',
  'FString',
  'DFString',
  'FLog',
  'DFLog'
]

export function isValidFlagName(name: string): boolean {
  return FLAG_NAME_PATTERN.test(name)
}

export function hasKnownPrefix(name: string): boolean {
  return KNOWN_PREFIXES.some((prefix) => name.startsWith(prefix))
}

/**
 * Coerces a raw JSON value into a FastFlag value. Roblox accepts strings,
 * numbers and booleans; everything else is rejected.
 */
export function coerceFlagValue(value: unknown): FlagValue | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    // Roblox writes every flag as a string in ClientAppSettings.json, so keep
    // the raw text but strip control characters.
    return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 512)
  }
  return null
}

/** Validates and normalises a flag map, dropping anything unusable. */
export function sanitizeFlags(input: unknown): Record<string, FlagValue> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}

  const out: Record<string, FlagValue> = {}
  let count = 0

  for (const [rawName, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_FLAGS_PER_PROFILE) break
    const name = rawName.trim()
    if (!isValidFlagName(name)) {
      logger.warn(`Dropping invalid flag name '${rawName}'`)
      continue
    }
    const value = coerceFlagValue(rawValue)
    if (value === null) {
      logger.warn(`Dropping flag '${name}' with unsupported value type`)
      continue
    }
    out[name] = value
    count += 1
  }

  return out
}

function sanitizeProfileName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 64)
}

function toProfiles(raw: Record<string, Record<string, unknown>>, active: string): FlagProfile[] {
  return Object.entries(raw)
    .map(([name, flags]) => {
      const sanitized = sanitizeFlags(flags)
      return {
        name,
        flags: sanitized,
        isActive: name === active,
        flagCount: Object.keys(sanitized).length
      }
    })
    .sort((a, b) => {
      if (a.name === DEFAULT_FLAG_PROFILE) return -1
      if (b.name === DEFAULT_FLAG_PROFILE) return 1
      return a.name.localeCompare(b.name)
    })
}

export function getProfiles(): FlagProfile[] {
  const settings = getSettings()
  return toProfiles(settings.flagProfiles, settings.activeFlagProfile)
}

export async function saveProfile(request: SaveProfileRequest): Promise<FlagProfile[]> {
  const name = sanitizeProfileName(request.name)
  if (!name) throw new Error('Profile name cannot be empty')

  const settings = getSettings()
  const profiles = { ...settings.flagProfiles }

  if (!(name in profiles) && Object.keys(profiles).length >= MAX_PROFILES) {
    throw new Error(`Profile limit reached (${MAX_PROFILES})`)
  }

  profiles[name] = sanitizeFlags(request.flags)
  const activeFlagProfile = request.setActive ? name : settings.activeFlagProfile

  logger.info(`Saved profile '${name}' with ${Object.keys(profiles[name]).length} flag(s)`)
  const updated = await saveSettings({ flagProfiles: profiles, activeFlagProfile })
  return toProfiles(updated.flagProfiles, updated.activeFlagProfile)
}

export async function deleteProfile(name: string): Promise<FlagProfile[]> {
  const settings = getSettings()
  if (name === DEFAULT_FLAG_PROFILE) throw new Error('The default profile cannot be deleted')

  const profiles = { ...settings.flagProfiles }
  if (!(name in profiles)) throw new Error(`No profile named '${name}'`)
  delete profiles[name]

  const activeFlagProfile =
    settings.activeFlagProfile === name ? DEFAULT_FLAG_PROFILE : settings.activeFlagProfile

  if (!(DEFAULT_FLAG_PROFILE in profiles)) profiles[DEFAULT_FLAG_PROFILE] = {}

  logger.info(`Deleted profile '${name}'`)
  const updated = await saveSettings({ flagProfiles: profiles, activeFlagProfile })
  return toProfiles(updated.flagProfiles, updated.activeFlagProfile)
}

export async function setActiveProfile(name: string): Promise<FlagProfile[]> {
  const settings = getSettings()
  if (!(name in settings.flagProfiles)) throw new Error(`No profile named '${name}'`)

  logger.info(`Active profile is now '${name}'`)
  const updated = await saveSettings({ activeFlagProfile: name })
  return toProfiles(updated.flagProfiles, updated.activeFlagProfile)
}

export async function duplicateProfile(name: string, newName: string): Promise<FlagProfile[]> {
  const settings = getSettings()
  const source = settings.flagProfiles[name]
  if (!source) throw new Error(`No profile named '${name}'`)

  const target = sanitizeProfileName(newName)
  if (!target) throw new Error('Profile name cannot be empty')
  if (target in settings.flagProfiles) throw new Error(`A profile named '${target}' already exists`)
  if (Object.keys(settings.flagProfiles).length >= MAX_PROFILES) {
    throw new Error(`Profile limit reached (${MAX_PROFILES})`)
  }

  const profiles = { ...settings.flagProfiles, [target]: { ...source } }
  const updated = await saveSettings({ flagProfiles: profiles })
  return toProfiles(updated.flagProfiles, updated.activeFlagProfile)
}

export async function renameProfile(name: string, newName: string): Promise<FlagProfile[]> {
  const settings = getSettings()
  if (name === DEFAULT_FLAG_PROFILE) throw new Error('The default profile cannot be renamed')

  const source = settings.flagProfiles[name]
  if (!source) throw new Error(`No profile named '${name}'`)

  const target = sanitizeProfileName(newName)
  if (!target) throw new Error('Profile name cannot be empty')
  if (target !== name && target in settings.flagProfiles) {
    throw new Error(`A profile named '${target}' already exists`)
  }

  const profiles = { ...settings.flagProfiles }
  delete profiles[name]
  profiles[target] = source

  const activeFlagProfile =
    settings.activeFlagProfile === name ? target : settings.activeFlagProfile

  const updated = await saveSettings({ flagProfiles: profiles, activeFlagProfile })
  return toProfiles(updated.flagProfiles, updated.activeFlagProfile)
}

/** The flag map that will actually be written on the next launch. */
export function activeFlags(): Record<string, FlagValue> {
  const settings = getSettings()
  return sanitizeFlags(settings.flagProfiles[settings.activeFlagProfile] ?? {})
}

export async function importFromJson(targetName?: string): Promise<OperationResult<FlagProfile[]>> {
  const result = await dialog.showOpenDialog({
    title: 'Import FastFlag profile',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'Import cancelled' }
  }

  const file = result.filePaths[0]

  try {
    const contents = await readFile(file, 'utf8')
    const parsed = JSON.parse(contents) as unknown
    const flags = sanitizeFlags(parsed)

    if (Object.keys(flags).length === 0) {
      return { ok: false, error: 'That file did not contain any valid FastFlags' }
    }

    const baseName =
      sanitizeProfileName(targetName ?? '') ||
      sanitizeProfileName(
        file
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.json$/i, '') ?? ''
      ) ||
      'Imported'

    const settings = getSettings()
    let name = baseName
    let suffix = 2
    while (name in settings.flagProfiles) {
      name = `${baseName} ${suffix}`
      suffix += 1
    }

    const profiles = await saveProfile({ name, flags, setActive: true })
    logger.info(`Imported ${Object.keys(flags).length} flag(s) from ${file} as '${name}'`)
    return { ok: true, data: profiles }
  } catch (error) {
    logger.error(`FastFlag import failed: ${String(error)}`)
    return { ok: false, error: error instanceof Error ? error.message : 'Could not read that file' }
  }
}

export async function exportToJson(name: string): Promise<OperationResult<string>> {
  const settings = getSettings()
  const flags = settings.flagProfiles[name]
  if (!flags) return { ok: false, error: `No profile named '${name}'` }

  const result = await dialog.showSaveDialog({
    title: 'Export FastFlag profile',
    defaultPath: `${name}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  })

  if (result.canceled || !result.filePath) return { ok: false, error: 'Export cancelled' }

  try {
    await writeFile(result.filePath, JSON.stringify(sanitizeFlags(flags), null, 2), 'utf8')
    logger.info(`Exported profile '${name}' to ${result.filePath}`)
    return { ok: true, data: result.filePath }
  } catch (error) {
    logger.error(`FastFlag export failed: ${String(error)}`)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not write that file'
    }
  }
}

/**
 * Writes the active profile to <versionDirectory>/ClientSettings/ClientAppSettings.json.
 * Roblox reads this file at startup; an empty profile still writes `{}` so a
 * previously applied set of flags is cleared.
 */
export async function applyFlags(versionDirectory: string): Promise<number> {
  const flags = effectiveFlags()
  const directory = join(versionDirectory, 'ClientSettings')
  await ensureDir(directory)

  const file = join(directory, 'ClientAppSettings.json')
  await writeFile(file, JSON.stringify(flags, null, 2), 'utf8')

  const count = Object.keys(flags).length
  logger.info(`Wrote ${count} FastFlag(s) to ${file}`)
  return count
}


/* ----------------------------------------------------------- Allowlist */

interface AllowlistCache {
  entries: FlagAllowlistEntry[]
  updatedAt: number
  url: string
}

let allowlistCache: FlagAllowlist | null = null

async function readAllowlistCache(): Promise<AllowlistCache | null> {
  return readJson<AllowlistCache | null>(join(paths.apiCache, 'allowlist.json'), null)
}

async function writeAllowlistCache(cache: AllowlistCache): Promise<void> {
  try {
    await ensureDir(paths.apiCache)
    await writeJson(join(paths.apiCache, 'allowlist.json'), cache)
  } catch (error) {
    logger.warn(`Could not cache the allowlist: ${String(error)}`)
  }
}

/**
 * The current allowlist.
 *
 * Precedence: a fresh remote fetch (when `refresh` is set), then the last
 * successful remote fetch from disk, then the built-in snapshot. The result is
 * always a superset that includes every built-in entry, so the UI can never be
 * left with fewer known flags than the app shipped with.
 */
export async function allowlist(options: { refresh?: boolean } = {}): Promise<FlagAllowlist> {
  const settings = getSettings()
  const url = settings.flagAllowlistUrl

  if (options.refresh && url) {
    try {
      const payload = await getJson<unknown>(url, { retries: 1, timeoutMs: 20_000 })
      const parsed = parseRemoteAllowlist(payload)

      if (parsed.length > 0) {
        const entries = mergeAllowlist(parsed)
        const updatedAt = Date.now()
        await writeAllowlistCache({ entries: parsed, updatedAt, url })
        await saveSettings({ lastAllowlistUpdate: updatedAt })
        allowlistCache = { entries, updatedAt, source: 'remote', url, error: null }
        logger.info(`Allowlist refreshed from ${url} (${parsed.length} remote entries)`)
        return allowlistCache
      }

      logger.warn('The allowlist source did not contain any recognisable flags')
      allowlistCache = {
        entries: mergeAllowlist([]),
        updatedAt: Date.now(),
        source: 'builtin',
        url,
        error: 'The remote allowlist did not contain any recognisable flags'
      }
      return allowlistCache
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn(`Allowlist refresh failed: ${message}`)

      const cached = await readAllowlistCache()
      const entries = mergeAllowlist(cached?.entries ?? [])
      allowlistCache = {
        entries,
        updatedAt: cached?.updatedAt ?? 0,
        source: cached ? 'cache' : 'builtin',
        url,
        error: message
      }
      return allowlistCache
    }
  }

  if (allowlistCache) return allowlistCache

  const cached = await readAllowlistCache()
  allowlistCache = {
    entries: mergeAllowlist(cached?.entries ?? []),
    updatedAt: cached?.updatedAt ?? 0,
    source: cached ? 'cache' : 'builtin',
    url,
    error: null
  }

  return allowlistCache
}

function allowlistMap(entries: FlagAllowlistEntry[]): Map<string, FlagAllowlistEntry> {
  return new Map(entries.map((entry) => [entry.name, entry]))
}

/** Compares a profile against the allowlist and reports what is unknown. */
export async function audit(name?: string): Promise<FlagAudit> {
  const settings = getSettings()
  const profileName = name ?? settings.activeFlagProfile
  const flags = sanitizeFlags(settings.flagProfiles[profileName] ?? {})
  const list = await allowlist()
  const known = allowlistMap(list.entries)

  const unknown = Object.keys(flags).filter((flag) => !known.has(flag))

  return {
    profile: profileName,
    total: Object.keys(flags).length,
    allowed: Object.keys(flags).length - unknown.length,
    unknown,
    severity: settings.flagAllowlistSeverity
  }
}

/**
 * Removes every non-allowlisted flag from a profile. With `dryRun` nothing is
 * written — the UI uses that to show what would go before asking.
 */
export async function clean(options: { name?: string; dryRun?: boolean } = {}): Promise<FlagCleanResult> {
  const settings = getSettings()
  const profileName = options.name ?? settings.activeFlagProfile
  const flags = settings.flagProfiles[profileName]
  if (!flags) throw new Error(`No profile named '${profileName}'`)

  const list = await allowlist()
  const known = allowlistMap(list.entries)

  const kept: Record<string, FlagValue> = {}
  const removed: string[] = []

  for (const [name, value] of Object.entries(sanitizeFlags(flags))) {
    if (known.has(name)) kept[name] = value
    else removed.push(name)
  }

  if (removed.length > 0 && !options.dryRun) {
    const profiles = { ...settings.flagProfiles, [profileName]: kept }
    await saveSettings({ flagProfiles: profiles })
    logger.info(`Cleaned ${removed.length} non-allowlisted flag(s) from '${profileName}'`)
  }

  return { profile: profileName, removed, kept: Object.keys(kept).length }
}

/** The presets the UI can offer, each with its flags resolved. */
export function presets(): FlagPreset[] {
  return FLAG_PRESETS.map((preset) => ({ ...preset, flags: { ...preset.flags } }))
}

export function presetById(id: string): FlagPreset | null {
  return FLAG_PRESETS.find((preset) => preset.id === id) ?? null
}

/**
 * Applies a preset to a profile. `replace` removes only the flags the preset
 * itself owns (never the user's other tweaks) before writing its values.
 */
export async function applyPreset(request: FlagPresetApplyRequest): Promise<FlagProfile[]> {
  const preset = presetById(request.presetId)
  if (!preset) throw new Error(`Unknown preset '${request.presetId}'`)

  const settings = getSettings()
  const profileName = request.profile ?? settings.activeFlagProfile
  const current = sanitizeFlags(settings.flagProfiles[profileName] ?? {})

  const next: Record<string, FlagValue> = { ...current }

  if (request.replace) {
    for (const name of Object.keys(preset.flags)) delete next[name]
  }

  Object.assign(next, preset.flags)

  const profiles = { ...settings.flagProfiles, [profileName]: next }
  const updated = await saveSettings({ flagProfiles: profiles })
  logger.info(`Applied preset '${preset.name}' to '${profileName}'`)

  return Object.entries(updated.flagProfiles).map(([name, flags]) => {
    const sanitized = sanitizeFlags(flags)
    return {
      name,
      flags: sanitized,
      isActive: name === updated.activeFlagProfile,
      flagCount: Object.keys(sanitized).length
    }
  })
}

/**
 * Flags contributed by settings toggles rather than by the user's profile.
 *
 * These are merged last, so turning a toggle off really does remove the flag
 * even if it is also present in the profile by hand.
 */
export function settingsFlags(): Record<string, FlagValue> {
  const settings = getSettings()
  const out: Record<string, FlagValue> = {}

  if (settings.disableCaptureFeatures) Object.assign(out, DISABLE_CAPTURE_FLAGS)

  if (settings.enableVoiceChat) {
    // Only add the voice chat flags when they are not already set the other way.
    for (const [name, value] of Object.entries(VOICE_CHAT_FLAGS)) {
      if (!(name in out)) out[name] = value
    }
  }

  return out
}

/** The flag map that will be written on the next launch, including toggles. */
export function effectiveFlags(): Record<string, FlagValue> {
  return { ...activeFlags(), ...settingsFlags() }
}

/** Reports which built-in entries are present in the shipped snapshot. */
export function builtinAllowlistSize(): number {
  return BUILTIN_ALLOWLIST.length
}
