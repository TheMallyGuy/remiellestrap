/**
 * Settings model shared between the main process (which owns persistence) and
 * the renderer (which renders the forms). Keep this file free of any Node or
 * Electron imports so it can be consumed from every layer.
 */

export type ThemeMode =
  'dark' | 'light' | 'system' | 'prism-night' | 'ivory-cathedral' | 'gold-ember'

export type AccentMode = 'gold' | 'prism'
export type LaunchMode = 'player' | 'studio'
export type ProcessPriority = 'normal' | 'abovenormal' | 'high'
export type SidebarMode = 'full' | 'compact' | 'icons'
export type WindowEffect = 'none' | 'auto' | 'mica' | 'acrylic' | 'blur'
export type BackgroundStyle = 'none' | 'solid' | 'gradient' | 'image' | 'art'
export type LauncherStyle = 'fluent' | 'classic' | 'byfron' | 'minimal' | 'custom'

/** Where a mod's files are allowed to land. */
export type ModTarget = 'player' | 'studio' | 'both'

/** How loudly to complain about FastFlags that are not on the allowlist. */
export type AllowlistSeverity = 'off' | 'warn' | 'block'

export type ServerSizePreference = 'any' | 'small' | 'big'
export type ServerSortKey = 'players' | 'ping' | 'region' | 'uptime'

/** How a launch authenticates as a stored account. */
export type AccountLaunchStrategy = 'ticket' | 'plain'

export type CleanerCategory =
  | 'roblox-logs'
  | 'roblox-cache'
  | 'roblox-crash-dumps'
  | 'roblox-temp'
  | 'roblox-versions'
  | 'strap-logs'
  | 'strap-cache'
  | 'strap-downloads'
  | 'strap-versions'
  | 'strap-art'

export type CleanerSchedule = 'manual' | 'launch' | 'daily' | 'weekly'

/** What the launcher's Discord presence says while you browse. */
export type RpcStatusMode = 'game' | 'generic'

/** A bootstrapper icon set: the window/tray icon, not the client's. */
export type IconStyle = 'remielle' | 'classic' | 'modern'

export const ART_SLOTS = [
  'splash',
  'home_banner',
  'sidebar',
  'about_header',
  'bootstrapper',
  'background'
] as const
export type ArtSlot = (typeof ART_SLOTS)[number]

/** Which image board the runtime artwork pipeline searches. */
export type BooruProvider = 'safebooru' | 'danbooru'

export const BOORU_PROVIDERS: {
  value: BooruProvider
  label: string
  hint: string
  homeUrl: string
}[] = [
  {
    value: 'safebooru',
    label: 'Safebooru',
    hint: 'Safe-for-work only. No account needed.',
    homeUrl: 'https://safebooru.org/'
  },
  {
    value: 'danbooru',
    label: 'Danbooru',
    hint: 'Larger pool. Sign-in details raise the rate limit.',
    homeUrl: 'https://danbooru.donmai.us/'
  }
]

export function booruProviderLabel(provider: string | null | undefined): string {
  return BOORU_PROVIDERS.find((entry) => entry.value === provider)?.label ?? 'Safebooru'
}

export function booruProviderHome(provider: string | null | undefined): string {
  return (
    BOORU_PROVIDERS.find((entry) => entry.value === provider)?.homeUrl ?? 'https://safebooru.org/'
  )
}

export type BooruTagMap = Record<ArtSlot, string>

export interface AppSettings {
  theme: ThemeMode
  accentMode: AccentMode
  channel: string
  autoCloseBootstrapper: boolean
  confirmLaunches: boolean
  multiInstanceLaunching: boolean
  preferredLaunchMode: LaunchMode
  processPriority: ProcessPriority
  enableDiscordRpc: boolean
  /** Discord application client id used for rich presence. */
  discordClientId: string
  enableActivityTracking: boolean
  showAccountOnRpc: boolean
  enabledMods: string[]
  activeFlagProfile: string
  flagProfiles: Record<string, Record<string, unknown>>
  disableUpdates: boolean
  autoRejoinOnDisconnect: boolean
  closeOnRobloxLaunch: boolean
  lastOpenedPage: string
  booruTags: BooruTagMap
  chosenBooruPosts: Record<string, number | null>
  /** Which image board the artwork pipeline searches. */
  booruProvider: BooruProvider
  /** Danbooru username, sent only to Danbooru to raise API rate limits. */
  danbooruLogin: string
  /** Danbooru API key, sent only to Danbooru alongside the login above. */
  danbooruApiKey: string
  /** Keep Danbooru searches to general/sensitive posts. Safebooru is always safe-only. */
  danbooruSafeOnly: boolean
  /* Extended options beyond the base contract. */
  reduceMotion: boolean
  showBootstrapperArt: boolean
  installLocation: string | null
  parallelDownloads: number
  notifyOnInstallComplete: boolean
  notifyOnRobloxExit: boolean
  notifyOnActivityJoin: boolean
  minimizeToTray: boolean
  launchArguments: string
  robloxLocale: string
  gameLocale: string
  windowBounds: WindowBounds | null

  /* ---------------------------------------------------------- Accounts */

  /** Id of the account used for the next launch, or null for "not signed in". */
  activeAccountId: string | null
  /** How launches authenticate as the selected account. */
  accountLaunchStrategy: AccountLaunchStrategy
  /** Refresh presence/friend counts in the background. */
  accountBackgroundRefresh: boolean
  /** Minutes between background presence refreshes. */
  accountRefreshMinutes: number
  /** Show the selected account's avatar in the titlebar. */
  showAccountInTitlebar: boolean

  /* ----------------------------------------------------------- Servers */

  /** Preferred Roblox region id, e.g. "europe". "any" means no preference. */
  preferredRegion: string
  serverSizePreference: ServerSizePreference
  autoSortServers: boolean
  /** Endpoint template for datacenter lookups; empty disables the lookup. */
  serverRegionApi: string
  /** Seconds a fetched server list stays warm. */
  serverCacheSeconds: number
  /** Rejoin the same region after an unexpected disconnect. */
  autoRejoinRegionAware: boolean
  /** Number of servers requested per page. */
  serverPageSize: number

  /* -------------------------------------------------------------- Mods */

  defaultModTarget: ModTarget
  /** Re-apply mods immediately after an import instead of waiting for launch. */
  applyModsImmediately: boolean
  /** Index URL for the community mod browser. */
  communityModIndexUrl: string
  /** Automatically re-download community mods that changed upstream. */
  communityModAutoUpdate: boolean

  /* --------------------------------------------------------- FastFlags */

  /** Remote allowlist URL; the built-in list is used when unreachable. */
  flagAllowlistUrl: string
  flagAllowlistSeverity: AllowlistSeverity
  flagAllowlistAutoUpdate: boolean
  lastAllowlistUpdate: number
  /** Turn Roblox's screenshot and video capture off via flags. */
  disableCaptureFeatures: boolean
  /** Keep Roblox's voice chat capability flags on. */
  enableVoiceChat: boolean

  /* ------------------------------------------------------------ Discord */

  /** Mention the page or dialog you are looking at while in the launcher. */
  rpcShowPage: boolean
  /** Show session playtime in the presence state line. */
  rpcShowPlaytime: boolean
  /** What the second presence line says while idle. */
  rpcStatusMode: RpcStatusMode
  /** Publish a Studio presence while Studio is running. */
  studioRpc: boolean
  /** Local bridge port a companion Studio plugin can post to. */
  studioBridgeEnabled: boolean
  studioBridgePort: number

  /* ---------------------------------------------------------- Playtime */

  trackPlaytime: boolean
  /** Notify when a session ends, with how long it lasted. */
  notifyPlaytimeOnExit: boolean

  /* ----------------------------------------------------------- Cleaner */

  cleanerSchedule: CleanerSchedule
  cleanerTargets: CleanerCategory[]
  /** Ask for the newest client version after a clean. */
  crashHandlerAutoClose: boolean
  /** Periodically trim the Roblox working set while it runs. */
  memoryTrimEnabled: boolean
  memoryTrimMinutes: number

  /* -------------------------------------------------------- Bootstrapper */

  /** Install into a stable folder name instead of `version-<guid>`. */
  fixedVersionFolder: boolean
  fixedVersionFolderName: string
  /** Write AppSettings.xml / flag files for Studio as well as the player. */
  applySettingsToStudio: boolean

  /* --------------------------------------------------------- Appearance */

  sidebarMode: SidebarMode
  windowEffect: WindowEffect
  /** CSS font family applied to the whole app; empty means the default. */
  fontFamily: string
  /** A user font file to load before the family is applied. */
  fontFile: string | null
  backgroundStyle: BackgroundStyle
  backgroundSolid: string
  backgroundGradientFrom: string
  backgroundGradientTo: string
  backgroundGradientAngle: number
  backgroundImage: string | null
  backgroundOpacity: number
  backgroundAnimate: boolean
  backgroundBlur: number
  launcherStyle: LauncherStyle
  /** Serialised LauncherDefinition used when launcherStyle is "custom". */
  launcherCustom: string
  iconStyle: IconStyle

  /* ---------------------------------------------------------- Utilities */

  /** Windows power plan to switch to on launch; empty means leave it alone. */
  powerPlanOnLaunch: string
  /** CPU cores the client may use, e.g. "0-3"; empty means all cores. */
  cpuAffinity: string
  /** GPU preference hint applied to the client's registry key. */
  gpuPreference: 'auto' | 'power-saving' | 'high-performance'
  /** Show the Roblox log viewer in the tray menu. */
  trayShowLogs: boolean
  /** How many log lines the viewer keeps in memory. */
  logBufferLines: number
  /** Language tag for the app's own UI strings. */
  language: string
}

export interface WindowBounds {
  x: number | null
  y: number | null
  width: number
  height: number
  maximized: boolean
}

/** Default Safebooru tag queries per art slot. */
export const DEFAULT_BOORU_TAGS: BooruTagMap = {
  splash: 'remielle_dan',
  home_banner: 'remielle_dan wide_image',
  sidebar: 'remielle_dan solo',
  about_header: 'remielle_dan',
  bootstrapper: 'remielle_dan solo',
  background: 'remielle_dan scenery'
}

export const DEFAULT_FLAG_PROFILE = 'Default'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  accentMode: 'gold',
  channel: 'LIVE',
  autoCloseBootstrapper: true,
  confirmLaunches: false,
  multiInstanceLaunching: false,
  preferredLaunchMode: 'player',
  processPriority: 'normal',
  enableDiscordRpc: true,
  discordClientId: '1005469189907173486',
  enableActivityTracking: true,
  showAccountOnRpc: false,
  enabledMods: [],
  activeFlagProfile: DEFAULT_FLAG_PROFILE,
  flagProfiles: { [DEFAULT_FLAG_PROFILE]: {} },
  disableUpdates: false,
  autoRejoinOnDisconnect: false,
  closeOnRobloxLaunch: false,
  lastOpenedPage: 'home',
  booruTags: { ...DEFAULT_BOORU_TAGS },
  chosenBooruPosts: {
    splash: null,
    home_banner: null,
    sidebar: null,
    about_header: null,
    bootstrapper: null,
    background: null
  },
  booruProvider: 'safebooru',
  danbooruLogin: '',
  danbooruApiKey: '',
  danbooruSafeOnly: true,
  reduceMotion: false,
  showBootstrapperArt: true,
  installLocation: null,
  parallelDownloads: 4,
  notifyOnInstallComplete: true,
  notifyOnRobloxExit: true,
  notifyOnActivityJoin: false,
  minimizeToTray: true,
  launchArguments: '',
  robloxLocale: 'en_us',
  gameLocale: 'en_us',
  windowBounds: null,

  activeAccountId: null,
  accountLaunchStrategy: 'ticket',
  accountBackgroundRefresh: true,
  accountRefreshMinutes: 5,
  showAccountInTitlebar: true,

  preferredRegion: 'any',
  serverSizePreference: 'any',
  autoSortServers: true,
  serverRegionApi: 'https://apis.rovalra.com/v1/server_details',
  serverCacheSeconds: 45,
  autoRejoinRegionAware: true,
  serverPageSize: 50,

  defaultModTarget: 'player',
  applyModsImmediately: false,
  communityModIndexUrl:
    'https://raw.githubusercontent.com/TheMallyGuy/remiellestrap/main/community-mods.json',
  communityModAutoUpdate: false,

  flagAllowlistUrl:
    'https://raw.githubusercontent.com/Froststrap/Froststrap/main/Froststrap/Resources/FAFlags.json',
  flagAllowlistSeverity: 'warn',
  flagAllowlistAutoUpdate: false,
  lastAllowlistUpdate: 0,
  disableCaptureFeatures: false,
  enableVoiceChat: false,

  rpcShowPage: true,
  rpcShowPlaytime: true,
  rpcStatusMode: 'game',
  studioRpc: true,
  studioBridgeEnabled: true,
  studioBridgePort: 39457,

  trackPlaytime: true,
  notifyPlaytimeOnExit: true,

  cleanerSchedule: 'manual',
  cleanerTargets: ['roblox-logs', 'roblox-crash-dumps', 'strap-logs'],
  crashHandlerAutoClose: false,
  memoryTrimEnabled: false,
  memoryTrimMinutes: 15,

  fixedVersionFolder: false,
  fixedVersionFolderName: 'RobloxPlayer',
  applySettingsToStudio: false,

  sidebarMode: 'full',
  windowEffect: 'none',
  fontFamily: '',
  fontFile: null,
  backgroundStyle: 'none',
  backgroundSolid: '#0a0a0b',
  backgroundGradientFrom: '#0a0a0b',
  backgroundGradientTo: '#1b1526',
  backgroundGradientAngle: 155,
  backgroundImage: null,
  backgroundOpacity: 0.6,
  backgroundAnimate: false,
  backgroundBlur: 0,
  launcherStyle: 'fluent',
  launcherCustom: '',
  iconStyle: 'remielle',

  powerPlanOnLaunch: '',
  cpuAffinity: '',
  gpuPreference: 'auto',
  trayShowLogs: true,
  logBufferLines: 2000,
  language: 'en'
}

/** Update channels commonly used by Roblox deployments. */
export const KNOWN_CHANNELS = [
  'LIVE',
  'ZLive',
  'ZCanary',
  'ZIntegration',
  'ZFlagOnly',
  'ZNextLive',
  'ZPreview',
  'ZLIVE_QA',
  'ZStudioOnly'
] as const

/** Channels that are documented but not part of the shipped default list. */
export const CANDIDATE_CHANNELS = [
  ...KNOWN_CHANNELS,
  'ZAndroid',
  'ZiOS',
  'ZMac',
  'ZPlaystation',
  'ZXbox',
  'ZUniversalApp'
] as const

/** Languages the UI can be rendered in. Translation dictionaries may lag. */
export const SUPPORTED_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Espa\u00f1ol' },
  { value: 'fr', label: 'Fran\u00e7ais' },
  { value: 'ja', label: '\u65e5\u672c\u8a9e' },
  { value: 'pt-BR', label: 'Portugu\u00eas (Brasil)' }
] as const
