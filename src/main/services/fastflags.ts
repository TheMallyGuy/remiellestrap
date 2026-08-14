import { dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import type { FlagProfile, FlagValue, OperationResult, SaveProfileRequest } from '@shared/models'
import { DEFAULT_FLAG_PROFILE } from '@shared/settings'
import { createLogger } from '../utils/logger'
import { ensureDir } from '../utils/fs'
import { getSettings, saveSettings } from './settingsStore'

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
  const flags = activeFlags()
  const directory = join(versionDirectory, 'ClientSettings')
  await ensureDir(directory)

  const file = join(directory, 'ClientAppSettings.json')
  await writeFile(file, JSON.stringify(flags, null, 2), 'utf8')

  const count = Object.keys(flags).length
  logger.info(`Wrote ${count} FastFlag(s) to ${file}`)
  return count
}
