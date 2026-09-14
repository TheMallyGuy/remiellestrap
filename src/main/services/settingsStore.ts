import { promises as fs } from 'fs'
import {
  ART_SLOTS,
  DEFAULT_BOORU_TAGS,
  DEFAULT_FLAG_PROFILE,
  DEFAULT_SETTINGS,
  KNOWN_CHANNELS,
  type AppSettings,
  type ArtSlot,
  type BooruTagMap,
  type CleanerCategory
} from '@shared/settings'
import { CLEANER_TARGETS } from '@shared/catalog'
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

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.round(value), min), max)
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
    for (const [flagName, flagValue] of Object.entries(flags as Record<string, unknown>).slice(
      0,
      2000
    )) {
      if (!/^[A-Za-z0-9_.]{1,128}$/.test(flagName)) continue
      const coerced = coerceFlagValue(flagValue)
      if (coerced !== null) cleanFlags[flagName] = coerced
    }
    out[name] = cleanFlags
  }

  if (Object.keys(out).length === 0) out[DEFAULT_FLAG_PROFILE] = {}
  return out
}

/**
 * Fixed list -> value. Used for every enum-shaped setting so an unknown string
 * can never reach the rest of the app (or, worse, the filesystem).
 */
function pickFrom<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** Clamps a float into a range, falling back when the value is not a number. */
function num(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(value, min), max)
}

/** A #rrggbb colour, or the fallback. */
function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : fallback
}

/** An absolute path string, or null. Rejects obviously bogus values. */
function nullablePath(value: unknown, fallback: string | null): string | null {
  if (value === null || value === undefined) return fallback
  const asString = str(value, '', 1024).trim()
  if (asString.length === 0) return null
  // Control characters are already stripped; refuse relative and protocol-ish
  // values so a "path" can never be interpreted as a URL by a later feature.
  if (!/^([a-zA-Z]:[\\/]|\/|\/\/)/.test(asString)) return fallback
  return asString
}

const CLEANER_IDS = CLEANER_TARGETS.map((target) => target.id)

function coerceCleanerTargets(value: unknown, fallback: CleanerCategory[]): CleanerCategory[] {
  if (!Array.isArray(value)) return [...fallback]
  const allowed = new Set<string>(CLEANER_IDS)
  const out = value.filter(
    (item): item is CleanerCategory => typeof item === 'string' && allowed.has(item)
  )
  return out.length > 0 ? [...new Set(out)] : []
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
  const source = (typeof input === 'object' && input !== null ? input : {}) as Record<
    string,
    unknown
  >

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
  const value = <K extends keyof AppSettings>(key: K): unknown =>
    has(key) ? source[key] : base[key]

  return {
    theme: pickFrom(
      value('theme'),
      ['dark', 'light', 'system', 'prism-night', 'ivory-cathedral', 'gold-ember'] as const,
      base.theme
    ),
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
    discordClientId: (() => {
      const raw = str(value('discordClientId'), base.discordClientId, 32).trim()
      return /^\d{10,30}$/.test(raw) ? raw : base.discordClientId
    })(),
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
    booruProvider: pick(
      value('booruProvider'),
      ['safebooru', 'danbooru'] as const,
      base.booruProvider
    ),
    danbooruLogin: str(value('danbooruLogin'), base.danbooruLogin, 64).trim(),
    danbooruApiKey: str(value('danbooruApiKey'), base.danbooruApiKey, 128).trim(),
    danbooruSafeOnly: bool(value('danbooruSafeOnly'), base.danbooruSafeOnly),
    reduceMotion: bool(value('reduceMotion'), base.reduceMotion),
    showBootstrapperArt: bool(value('showBootstrapperArt'), base.showBootstrapperArt),
    installLocation: nullablePath(value('installLocation'), base.installLocation),
    parallelDownloads: int(value('parallelDownloads'), base.parallelDownloads, 1, 16),
    notifyOnInstallComplete: bool(value('notifyOnInstallComplete'), base.notifyOnInstallComplete),
    notifyOnRobloxExit: bool(value('notifyOnRobloxExit'), base.notifyOnRobloxExit),
    notifyOnActivityJoin: bool(value('notifyOnActivityJoin'), base.notifyOnActivityJoin),
    minimizeToTray: bool(value('minimizeToTray'), base.minimizeToTray),
    launchArguments: str(value('launchArguments'), base.launchArguments, 512),
    robloxLocale: str(value('robloxLocale'), base.robloxLocale, 16) || 'en_us',
    gameLocale: str(value('gameLocale'), base.gameLocale, 16) || 'en_us',
    windowBounds: has('windowBounds') ? coerceBounds(source.windowBounds) : base.windowBounds,

    /* Accounts */
    activeAccountId: (() => {
      const raw = value('activeAccountId')
      if (raw === null || raw === undefined) return null
      const id = str(raw, '', 64).trim()
      return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : null
    })(),
    accountLaunchStrategy: pick(
      value('accountLaunchStrategy'),
      ['ticket', 'plain'] as const,
      base.accountLaunchStrategy
    ),
    accountBackgroundRefresh: bool(
      value('accountBackgroundRefresh'),
      base.accountBackgroundRefresh
    ),
    accountRefreshMinutes: int(value('accountRefreshMinutes'), base.accountRefreshMinutes, 1, 60),
    showAccountInTitlebar: bool(value('showAccountInTitlebar'), base.showAccountInTitlebar),

    /* Servers */
    preferredRegion: str(value('preferredRegion'), base.preferredRegion, 40) || 'any',
    serverSizePreference: pick(
      value('serverSizePreference'),
      ['any', 'small', 'big'] as const,
      base.serverSizePreference
    ),
    autoSortServers: bool(value('autoSortServers'), base.autoSortServers),
    serverRegionApi: (() => {
      const raw = str(value('serverRegionApi'), base.serverRegionApi, 300).trim()
      if (raw.length === 0) return ''
      // Only https endpoints are honoured; this URL is fetched verbatim.
      return /^https:\/\/[^\s]+$/i.test(raw) ? raw : base.serverRegionApi
    })(),
    serverCacheSeconds: int(value('serverCacheSeconds'), base.serverCacheSeconds, 0, 600),
    autoRejoinRegionAware: bool(value('autoRejoinRegionAware'), base.autoRejoinRegionAware),
    serverPageSize: int(value('serverPageSize'), base.serverPageSize, 10, 100),

    /* Mods */
    defaultModTarget: pick(
      value('defaultModTarget'),
      ['player', 'studio', 'both'] as const,
      base.defaultModTarget
    ),
    applyModsImmediately: bool(value('applyModsImmediately'), base.applyModsImmediately),
    communityModIndexUrl: (() => {
      const raw = str(value('communityModIndexUrl'), base.communityModIndexUrl, 400).trim()
      return raw.length === 0 || /^https:\/\/[^\s]+$/i.test(raw) ? raw : base.communityModIndexUrl
    })(),
    communityModAutoUpdate: bool(value('communityModAutoUpdate'), base.communityModAutoUpdate),

    /* FastFlags */
    flagAllowlistUrl: (() => {
      const raw = str(value('flagAllowlistUrl'), base.flagAllowlistUrl, 400).trim()
      return raw.length === 0 || /^https:\/\/[^\s]+$/i.test(raw) ? raw : base.flagAllowlistUrl
    })(),
    flagAllowlistSeverity: pick(
      value('flagAllowlistSeverity'),
      ['off', 'warn', 'block'] as const,
      base.flagAllowlistSeverity
    ),
    flagAllowlistAutoUpdate: bool(value('flagAllowlistAutoUpdate'), base.flagAllowlistAutoUpdate),
    lastAllowlistUpdate: int(
      value('lastAllowlistUpdate'),
      base.lastAllowlistUpdate,
      0,
      Number.MAX_SAFE_INTEGER
    ),
    disableCaptureFeatures: bool(value('disableCaptureFeatures'), base.disableCaptureFeatures),
    enableVoiceChat: bool(value('enableVoiceChat'), base.enableVoiceChat),

    /* Discord */
    rpcShowPage: bool(value('rpcShowPage'), base.rpcShowPage),
    rpcShowPlaytime: bool(value('rpcShowPlaytime'), base.rpcShowPlaytime),
    rpcStatusMode: pick(value('rpcStatusMode'), ['game', 'generic'] as const, base.rpcStatusMode),
    studioRpc: bool(value('studioRpc'), base.studioRpc),
    studioBridgeEnabled: bool(value('studioBridgeEnabled'), base.studioBridgeEnabled),
    studioBridgePort: int(value('studioBridgePort'), base.studioBridgePort, 1024, 65535),

    /* Playtime */
    trackPlaytime: bool(value('trackPlaytime'), base.trackPlaytime),
    notifyPlaytimeOnExit: bool(value('notifyPlaytimeOnExit'), base.notifyPlaytimeOnExit),

    /* Cleaner */
    cleanerSchedule: pick(
      value('cleanerSchedule'),
      ['manual', 'launch', 'daily', 'weekly'] as const,
      base.cleanerSchedule
    ),
    cleanerTargets: has('cleanerTargets')
      ? coerceCleanerTargets(source.cleanerTargets, base.cleanerTargets)
      : [...base.cleanerTargets],
    crashHandlerAutoClose: bool(value('crashHandlerAutoClose'), base.crashHandlerAutoClose),
    memoryTrimEnabled: bool(value('memoryTrimEnabled'), base.memoryTrimEnabled),
    memoryTrimMinutes: int(value('memoryTrimMinutes'), base.memoryTrimMinutes, 1, 240),

    /* Bootstrapper */
    fixedVersionFolder: bool(value('fixedVersionFolder'), base.fixedVersionFolder),
    fixedVersionFolderName: (() => {
      const raw = str(value('fixedVersionFolderName'), base.fixedVersionFolderName, 40).trim()
      // A single, safe path segment: no separators, no traversal.
      return /^[A-Za-z0-9 ._-]{1,40}$/.test(raw) && !/^\.+$/.test(raw)
        ? raw
        : base.fixedVersionFolderName
    })(),
    applySettingsToStudio: bool(value('applySettingsToStudio'), base.applySettingsToStudio),

    /* Appearance */
    sidebarMode: pick(
      value('sidebarMode'),
      ['full', 'compact', 'icons'] as const,
      base.sidebarMode
    ),
    windowEffect: pick(
      value('windowEffect'),
      ['none', 'auto', 'mica', 'acrylic', 'blur'] as const,
      base.windowEffect
    ),
    fontFamily: str(value('fontFamily'), base.fontFamily, 120),
    fontFile: nullablePath(value('fontFile'), base.fontFile),
    backgroundStyle: pick(
      value('backgroundStyle'),
      ['none', 'solid', 'gradient', 'image', 'art'] as const,
      base.backgroundStyle
    ),
    backgroundSolid: hex(value('backgroundSolid'), base.backgroundSolid),
    backgroundGradientFrom: hex(value('backgroundGradientFrom'), base.backgroundGradientFrom),
    backgroundGradientTo: hex(value('backgroundGradientTo'), base.backgroundGradientTo),
    backgroundGradientAngle: int(
      value('backgroundGradientAngle'),
      base.backgroundGradientAngle,
      0,
      360
    ),
    backgroundImage: nullablePath(value('backgroundImage'), base.backgroundImage),
    backgroundOpacity: num(value('backgroundOpacity'), base.backgroundOpacity, 0.05, 1),
    backgroundAnimate: bool(value('backgroundAnimate'), base.backgroundAnimate),
    backgroundBlur: int(value('backgroundBlur'), base.backgroundBlur, 0, 40),
    launcherStyle: pick(
      value('launcherStyle'),
      ['fluent', 'classic', 'byfron', 'minimal', 'custom'] as const,
      base.launcherStyle
    ),
    launcherCustom: str(value('launcherCustom'), base.launcherCustom, 20_000),
    iconStyle: pick(value('iconStyle'), ['remielle', 'classic', 'modern'] as const, base.iconStyle),

    /* Utilities */
    powerPlanOnLaunch: str(value('powerPlanOnLaunch'), base.powerPlanOnLaunch, 64),
    cpuAffinity: (() => {
      const raw = str(value('cpuAffinity'), base.cpuAffinity, 64).replace(/\s+/g, '')
      return /^[0-9,-]*$/.test(raw) ? raw : ''
    })(),
    gpuPreference: pick(
      value('gpuPreference'),
      ['auto', 'power-saving', 'high-performance'] as const,
      base.gpuPreference
    ),
    trayShowLogs: bool(value('trayShowLogs'), base.trayShowLogs),
    logBufferLines: int(value('logBufferLines'), base.logBufferLines, 100, 20_000),
    language: str(value('language'), base.language, 12) || 'en'
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
