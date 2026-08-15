/**
 * Settings model shared between the main process (which owns persistence) and
 * the renderer (which renders the forms). Keep this file free of any Node or
 * Electron imports so it can be consumed from every layer.
 */

export type ThemeMode = 'dark' | 'light' | 'system'
export type AccentMode = 'gold' | 'prism'
export type LaunchMode = 'player' | 'studio'
export type ProcessPriority = 'normal' | 'abovenormal' | 'high'

export const ART_SLOTS = [
  'splash',
  'home_banner',
  'sidebar',
  'about_header',
  'bootstrapper'
] as const
export type ArtSlot = (typeof ART_SLOTS)[number]

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
  bootstrapper: 'remielle_dan solo'
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
    bootstrapper: null
  },
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
  windowBounds: null
}

/** Update channels commonly used by Roblox deployments. */
export const KNOWN_CHANNELS = ['LIVE', 'ZLive', 'ZCanary', 'ZIntegration'] as const
