import { promises as fs } from 'fs'
import {
  ART_SLOTS,
  DEFAULT_BOORU_TAGS,
  DEFAULT_FLAG_PROFILE,
  DEFAULT_SETTINGS,
  KNOWN_CHANNELS,
  type AppSettings,
  type ArtSlot,
  type BooruTagMap
} from '@shared/settings'
import { paths } from '../utils/paths'
import { ensureDir, readJson, writeJson } from '../utils/fs'
import { createLogger } from '../utils/logger'
import { emit } from './events'

const logger = createLogger('SettingsStore')

/**
 * Owns Settings.json. All values coming from the renderer pass through
 * `coerceSettings`, which drops unknown keys and clamps every field to a legal
 * value — the renderer can never write an arbitrary object into app state.
 */

let cached: AppSettings | null = null
let saveQueue: Promise<void> = Promise.resolve()

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function str(value: unknown, fallback: string, maxLength = 512): string {
  if (typeof value !== 'string') return fallback
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f]/g, '').slice(0, maxLength)
}

function stringArray(value: unknown, maxItems = 200): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string').slice(0, maxItems)
}

function coerceTags(value: unknown): BooruTagMap {
  const source = (value ?? {}) as Record<string, unknown>
  const out = {} as BooruTagMap
  for (const slot of ART_SLOTS) {
    const raw = str(source[slot], DEFAULT_BOORU_TAGS[slot], 200).trim()
    out[slot] = raw.length > 0 ? raw : DEFAULT_BOORU_TAGS[slot]
  }
  return out
}

function coerceChosenPosts(value: unknown): Record<string, number | null> {
  const source = (value ?? {}) as Record<string, unknown>
  const out: Record<string, number | null> = {}
  for (const slot of ART_SLOTS) {
    const raw = source[slot]
    out[slot] = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null
  }
  return out
}

function coerceFlagValue(value: unknown): string | number | boolean | null {
  if (typeof value === 'string') return value.slice(0, 2048)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return value
  return null
}

function coerceFlagProfiles(value: unknown): Record<string, Record<string, unknown>> {
  const source = (value ?? {}) as Record<string, unknown>
  const out: Record<string, Record<string, unknown>> = {}

  for (const [name, flags] of Object.entries(source).slice(0, 50)) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 64) continue
    if (typeof flags !== 'object' || flags === null) continue

    const cleanFlags: Record<string, unknown> = {}
    for (const [flagName, flagValue] of Object.entries(flags as Record<string, unknown>).slice(0, 2000)) {
      if (!/^[A-Za-z0-9_.]{1,128}$/.test(flagName)) continue
      const coerced = coerceFlagValue(flagValue)
      if (coerced !== null) cleanFlags[flagName] = coerced
    }
    out[name] = cleanFlags
  }

  if (Object.keys(out).length === 0) out[DEFAULT_FLAG_PROFILE] = {}
  return out
}

function coerceBounds(value: unknown): AppSettings['windowBounds'] {
  if (typeof value !== 'object' || value === null) return null
  const source = value as Record<string, unknown>
  const width = typeof source.width === 'number' ? source.width : NaN
  const height = typeof source.height === 'number' ? source.height : NaN
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null

  return {
    x: typeof source.x === 'number' && Number.isFinite(source.x) ? Math.round(source.x) : null,
    y: typeof source.y === 'number' && Number.isFinite(source.y) ? Math.round(source.y) : null,
    width: Math.min(Math.max(Math.round(width), 940), 4096),
    height: Math.min(Math.max(Math.round(height), 620), 4096),
    maximized: bool(source.maximized, false)
  }
}

/** Normalises any untrusted object into a complete, valid AppSettings. */
export function coerceSettings(input: unknown, base: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>

  const flagProfiles = coerceFlagProfiles(
    'flagProfiles' in source ? source.flagProfiles : base.flagProfiles
  )
  const activeCandidate = str(
    'activeFlagProfile' in source ? source.activeFlagProfile : base.activeFlagProfile,
    DEFAULT_FLAG_PROFILE,
    64
  )
  const activeFlagProfile = Object.prototype.hasOwnProperty.call(flagProfiles, activeCandidate)
    ? activeCandidate
    : Object.keys(flagProfiles)[0]

  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(source, key)
  const value = <K extends keyof AppSettings>(key: K): unknown => (has(key) ? source[key] : base[key])

  return {
    theme: pick(value('theme'), ['dark', 'light', 'system'] as const, base.theme),
    accentMode: pick(value('accentMode'), ['gold', 'prism'] as const, base.accentMode),
    channel: str(value('channel'), base.channel, 40) || 'LIVE',
    autoCloseBootstrapper: bool(value('autoCloseBootstrapper'), base.autoCloseBootstrapper),
    confirmLaunches: bool(value('confirmLaunches'), base.confirmLaunches),
    multiInstanceLaunching: bool(value('multiInstanceLaunching'), base.multiInstanceLaunching),
    preferredLaunchMode: pick(
      value('preferredLaunchMode'),
      ['player', 'studio'] as const,
      base.preferredLaunchMode
    ),
    processPriority: pick(
      value('processPriority'),
      ['normal', 'abovenormal', 'high'] as const,
      base.processPriority
    ),
    enableDiscordRpc: bool(value('enableDiscordRpc'), base.enableDiscordRpc),
    enableActivityTracking: bool(value('enableActivityTracking'), base.enableActivityTracking),
    showAccountOnRpc: bool(value('showAccountOnRpc'), base.showAccountOnRpc),
    enabledMods: has('enabledMods') ? stringArray(source.enabledMods) : base.enabledMods,
    activeFlagProfile,
    flagProfiles,
    disableUpdates: bool(value('disableUpdates'), base.disableUpdates),
    autoRejoinOnDisconnect: bool(value('autoRejoinOnDisconnect'), base.autoRejoinOnDisconnect),
    closeOnRobloxLaunch: bool(value('closeOnRobloxLaunch'), base.closeOnRobloxLaunch),
    lastOpenedPage: str(value('lastOpenedPage'), base.lastOpenedPage, 40),
    booruTags: has('booruTags') ? coerceTags(source.booruTags) : coerceTags(base.booruTags),
    chosenBooruPosts: has('chosenBooruPosts')
      ? coerceChosenPosts(source.chosenBooruPosts)
      : coerceChosenPosts(base.chosenBooruPosts),
    reduceMotion: bool(value('reduceMotion'), base.reduceMotion),
    showBootstrapperArt: bool(value('showBootstrapperArt'), base.showBootstrapperArt),
    installLocation: (() => {
      const raw = value('installLocation')
      if (raw === null || raw === undefined) return base.installLocation ?? null
      const asString = str(raw, '', 1024).trim()
      return asString.length > 0 ? asString : null
    })(),
    notifyOnInstallComplete: bool(value('notifyOnInstallComplete'), base.notifyOnInstallComplete),
    notifyOnRobloxExit: bool(value('notifyOnRobloxExit'), base.notifyOnRobloxExit),
    notifyOnActivityJoin: bool(value('notifyOnActivityJoin'), base.notifyOnActivityJoin),
    minimizeToTray: bool(value('minimizeToTray'), base.minimizeToTray),
    launchArguments: str(value('launchArguments'), base.launchArguments, 512),
    robloxLocale: str(value('robloxLocale'), base.robloxLocale, 16) || 'en_us',
    gameLocale: str(value('gameLocale'), base.gameLocale, 16) || 'en_us',
    windowBounds: has('windowBounds') ? coerceBounds(source.windowBounds) : base.windowBounds
  }
}

export async function loadSettings(): Promise<AppSettings> {
  if (cached) return cached

  await ensureDir(paths.root)
  const raw = await readJson<unknown>(paths.settingsFile, null)

  if (raw === null) {
    logger.info('No settings file found, writing defaults')
    cached = { ...DEFAULT_SETTINGS, booruTags: { ...DEFAULT_BOORU_TAGS } }
    await persist(cached)
    return cached
  }

  cached = coerceSettings(raw)
  logger.info(`Loaded settings from ${paths.settingsFile}`)
  return cached
}

export function getSettings(): AppSettings {
  return cached ?? { ...DEFAULT_SETTINGS, booruTags: { ...DEFAULT_BOORU_TAGS } }
}

async function persist(settings: AppSettings): Promise<void> {
  saveQueue = saveQueue
    .then(() => writeJson(paths.settingsFile, settings))
    .catch((error) => logger.error(`Failed to persist settings: ${String(error)}`))
  await saveQueue
}

/** Applies a validated patch, persists it and notifies the renderer. */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  const merged = coerceSettings({ ...current, ...patch }, current)
  cached = merged
  await persist(merged)
  emit('settings:changed', merged)
  return merged
}

/** Writes without emitting a change event (used for window bounds churn). */
export async function saveSettingsQuiet(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  const merged = coerceSettings({ ...current, ...patch }, current)
  cached = merged
  await persist(merged)
  return merged
}

export async function resetSettings(): Promise<AppSettings> {
  cached = { ...DEFAULT_SETTINGS, booruTags: { ...DEFAULT_BOORU_TAGS } }
  await persist(cached)
  emit('settings:changed', cached)
  logger.info('Settings reset to defaults')
  return cached
}

export async function exportSettingsTo(file: string): Promise<void> {
  const settings = await loadSettings()
  await fs.writeFile(file, JSON.stringify(settings, null, 2), 'utf8')
}

export async function importSettingsFrom(file: string): Promise<AppSettings> {
  const raw = await fs.readFile(file, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  const coerced = coerceSettings(parsed)
  cached = coerced
  await persist(coerced)
  emit('settings:changed', coerced)
  return coerced
}

export function knownChannels(): readonly string[] {
  return KNOWN_CHANNELS
}

export function artSlots(): readonly ArtSlot[] {
  return ART_SLOTS
}
