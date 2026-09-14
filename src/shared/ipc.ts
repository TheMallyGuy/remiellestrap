/**
 * The single source of truth for the IPC surface.
 *
 * `InvokeMap` describes request/response pairs handled with ipcMain.handle and
 * called with ipcRenderer.invoke. `EventMap` describes push events sent from
 * the main process to the renderer. Both main and preload derive their types
 * from here, so a channel cannot be added on one side only.
 */

import type { AppSettings, CleanerCategory, WindowEffect } from './settings'
import type { AppState, RobloxState, UiState } from './state'
import type {
  AccountAddRequest,
  AccountState,
  AccountBrowserLoginRequest,
  AccountFriend,
  AccountProfile,
  AccountProfileRequest,
  ActivityUpdate,
  AppUpdateState,
  ArtAsset,
  ArtRequest,
  BackupImportResult,
  BackupRequest,
  BackupResult,
  BooruPost,
  BooruSearchRequest,
  BootstrapperProgress,
  BootstrapperResult,
  CacheStats,
  ChannelInfo,
  CleanerHistoryEntry,
  CleanerResult,
  CleanerRunRequest,
  CleanerScan,
  ClientLogEvent,
  ClientSettingsPatch,
  ClientSettingsState,
  ColorModRequest,
  CommunityIndex,
  CommunityInstallRequest,
  CursorSetRequest,
  FileReplacementRequest,
  FileReplacementResult,
  FlagAllowlist,
  FlagAllowlistRequest,
  FlagAudit,
  FlagCleanResult,
  FlagPreset,
  FlagPresetApplyRequest,
  FlagProfile,
  FlagValue,
  FontCatalog,
  GameDetailsRequest,
  GameListRequest,
  GameSearchRequest,
  GameSummary,
  InstalledVersion,
  JoinAsRequest,
  LaunchRequest,
  LogFileInfo,
  LogLine,
  LogReadRequest,
  LogReadResult,
  ModConflict,
  ModEntry,
  ModTargetRequest,
  OperationResult,
  PlaytimeSummary,
  PowerPlan,
  ProcessTweakRequest,
  ProcessTweakState,
  RichModRequest,
  RobloxAccount,
  RobloxExitPayload,
  RpcUpdate,
  SaveProfileRequest,
  ServerJoinRequest,
  ServerJoinResult,
  ServerListRequest,
  ServerListResult,
  ServerPingSample,
  ShortcutRequest,
  ShortcutResult,
  StrapDetection,
  StrapImportRequest,
  StrapImportResult,
  StudioBridgeInfo,
  SystemInfo,
  ToastPayload,
  UpdateCheckResult,
  VersionActionRequest,
  WindowEffectState
} from './models'

export interface InvokeMap {
  /* settings */
  'settings:load': { request: void; response: AppSettings }
  'settings:save': { request: Partial<AppSettings>; response: AppSettings }
  'settings:reset': { request: void; response: AppSettings }
  'settings:export': { request: void; response: OperationResult<string> }
  'settings:import': { request: void; response: OperationResult<AppSettings> }

  /* persisted state */
  'state:getUi': { request: void; response: UiState }
  'state:saveUi': { request: Partial<UiState>; response: UiState }
  'onboarding:complete': { request: void; response: AppState }

  /* accounts */
  'accounts:get': { request: void; response: AccountState }
  'accounts:addFromCookie': { request: AccountAddRequest; response: OperationResult<AccountState> }
  'accounts:browserLogin': {
    request: AccountBrowserLoginRequest | void
    response: OperationResult<AccountState>
  }
  'accounts:reauthenticate': { request: { id: string }; response: OperationResult<AccountState> }
  'accounts:remove': { request: { id: string }; response: OperationResult<AccountState> }
  'accounts:setActive': { request: { id: string | null }; response: AccountState }
  'accounts:refresh': {
    request: { id?: string; profile?: boolean } | void
    response: AccountState
  }
  'accounts:getProfile': { request: AccountProfileRequest; response: OperationResult<AccountProfile> }
  'accounts:getFriends': {
    request: { accountId: string; refresh?: boolean }
    response: OperationResult<AccountFriend[]>
  }
  'accounts:searchGames': {
    request: GameSearchRequest
    response: OperationResult<GameSummary[]>
  }
  'accounts:getGameDetails': {
    request: GameDetailsRequest
    response: OperationResult<GameSummary>
  }
  'accounts:getGameList': { request: GameListRequest; response: OperationResult<GameSummary[]> }
  'accounts:joinAs': { request: JoinAsRequest; response: BootstrapperResult }
  'accounts:updateNotes': { request: { id: string; notes: string }; response: AccountState }
  'accounts:list': { request: void; response: RobloxAccount[] }

  /* servers */
  'servers:list': { request: ServerListRequest; response: ServerListResult }
  'servers:join': { request: ServerJoinRequest; response: ServerJoinResult }
  'servers:ping': {
    request: { placeId: string; servers: { id: string; datacenter: string | null }[] }
    response: ServerPingSample[]
  }

  /* bootstrapper */
  'bootstrapper:checkUpdate': { request: void; response: UpdateCheckResult }
  'bootstrapper:install': { request: { force?: boolean } | void; response: BootstrapperResult }
  'bootstrapper:launch': { request: LaunchRequest | void; response: BootstrapperResult }
  'bootstrapper:cancel': { request: void; response: OperationResult }
  'bootstrapper:forceReinstall': { request: void; response: BootstrapperResult }
  'bootstrapper:getProgress': { request: void; response: BootstrapperProgress }
  'bootstrapper:getPendingUri': { request: void; response: string | null }
  'bootstrapper:killRoblox': { request: void; response: OperationResult }
  'bootstrapper:applyNow': {
    request: void
    response: OperationResult<{ files: number; flags: number }>
  }

  /* channels and versions */
  'channels:list': { request: { refresh?: boolean } | void; response: ChannelInfo[] }
  'channels:set': { request: { name: string }; response: ChannelInfo[] }
  'versions:list': { request: void; response: InstalledVersion[] }
  'versions:setCurrent': { request: VersionActionRequest; response: InstalledVersion[] }
  'versions:delete': { request: VersionActionRequest; response: InstalledVersion[] }
  'versions:downgrade': { request: VersionActionRequest; response: BootstrapperResult }
  'versions:openFolder': { request: void; response: OperationResult }

  /* booru */
  'booru:search': { request: BooruSearchRequest; response: BooruPost[] }
  'booru:getArtForSlot': { request: ArtRequest; response: ArtAsset | null }
  'booru:clearCache': { request: void; response: CacheStats }
  'booru:getCacheStats': { request: void; response: CacheStats }
  'booru:openPost': { request: { postId: number }; response: OperationResult }

  /* fastflags */
  'fastflags:getProfiles': { request: void; response: FlagProfile[] }
  'fastflags:saveProfile': { request: SaveProfileRequest; response: FlagProfile[] }
  'fastflags:deleteProfile': { request: { name: string }; response: FlagProfile[] }
  'fastflags:setActive': { request: { name: string }; response: FlagProfile[] }
  'fastflags:duplicateProfile': {
    request: { name: string; newName: string }
    response: FlagProfile[]
  }
  'fastflags:renameProfile': {
    request: { name: string; newName: string }
    response: FlagProfile[]
  }
  'fastflags:importJson': { request: { name?: string }; response: OperationResult<FlagProfile[]> }
  'fastflags:exportJson': { request: { name: string }; response: OperationResult<string> }
  'fastflags:preview': { request: void; response: Record<string, FlagValue> }
  'fastflags:allowlist': { request: FlagAllowlistRequest | void; response: FlagAllowlist }
  'fastflags:audit': { request: { name?: string } | void; response: FlagAudit }
  'fastflags:clean': { request: { name?: string; dryRun?: boolean } | void; response: FlagCleanResult }
  'fastflags:presets': { request: void; response: FlagPreset[] }
  'fastflags:applyPreset': { request: FlagPresetApplyRequest; response: FlagProfile[] }

  /* mods */
  'mods:list': { request: void; response: ModEntry[] }
  'mods:importZip': { request: void; response: OperationResult<ModEntry[]> }
  'mods:importFolder': { request: void; response: OperationResult<ModEntry[]> }
  'mods:toggle': { request: { id: string; enabled: boolean }; response: ModEntry[] }
  'mods:delete': { request: { id: string }; response: ModEntry[] }
  'mods:reorder': { request: { ids: string[] }; response: ModEntry[] }
  'mods:openFolder': { request: { id?: string } | void; response: OperationResult }
  'mods:generateColorMod': { request: ColorModRequest; response: OperationResult<ModEntry[]> }
  'mods:setTarget': { request: ModTargetRequest; response: ModEntry[] }
  'mods:generateRichMod': { request: RichModRequest; response: OperationResult<ModEntry[]> }
  'mods:replaceFile': {
    request: FileReplacementRequest
    response: OperationResult<FileReplacementResult>
  }
  'mods:createCursorSet': { request: CursorSetRequest; response: OperationResult<ModEntry[]> }
  'mods:communityIndex': {
    request: { refresh?: boolean; query?: string } | void
    response: CommunityIndex
  }
  'mods:installCommunity': {
    request: CommunityInstallRequest
    response: OperationResult<ModEntry[]>
  }
  'mods:conflicts': { request: void; response: ModConflict[] }
  'mods:applyNow': {
    request: void
    response: OperationResult<{ files: number; flags: number }>
  }

  /* cleaner */
  'cleaner:scan': { request: { targets?: CleanerCategory[] } | void; response: CleanerScan }
  'cleaner:run': { request: CleanerRunRequest; response: CleanerResult }
  'cleaner:history': { request: void; response: CleanerHistoryEntry[] }

  /* logs */
  'logs:list': { request: void; response: LogFileInfo[] }
  'logs:read': { request: LogReadRequest; response: LogReadResult }
  'logs:events': { request: { path?: string; tailLines?: number }; response: ClientLogEvent[] }
  'logs:unfollow': { request: void; response: OperationResult }

  /* client settings (GlobalBasicSettings) */
  'clientSettings:read': { request: void; response: ClientSettingsState }
  'clientSettings:write': { request: ClientSettingsPatch; response: ClientSettingsState }

  /* application updates */
  'app:getUpdateState': { request: void; response: AppUpdateState }
  'app:checkForUpdates': { request: void; response: AppUpdateState }
  'app:downloadUpdate': { request: void; response: OperationResult }
  'app:restartToUpdate': { request: void; response: OperationResult }

  /* system */
  'system:getInfo': { request: void; response: SystemInfo }
  'system:openLogs': { request: void; response: OperationResult }
  'system:openAppData': { request: void; response: OperationResult }
  'system:openRobloxDir': { request: void; response: OperationResult }
  'system:uninstall': { request: { keepSettings: boolean }; response: OperationResult }
  'system:openExternal': { request: { url: string }; response: OperationResult }
  'system:getState': { request: void; response: AppState }
  'system:getRobloxState': { request: void; response: RobloxState }
  'system:chooseInstallLocation': { request: void; response: OperationResult<string> }
  'system:copyToClipboard': { request: { text: string }; response: OperationResult }
  'system:listFonts': { request: void; response: FontCatalog }
  'system:chooseFile': {
    request: { title?: string; extensions?: string[] } | void
    response: OperationResult<string>
  }
  'system:chooseImage': { request: void; response: OperationResult<string> }
  'system:chooseFont': { request: void; response: OperationResult<string> }
  'system:revealPath': { request: { path: string }; response: OperationResult }

  /* window */
  'window:minimize': { request: void; response: void }
  'window:maximize': { request: void; response: boolean }
  'window:close': { request: void; response: void }
  'window:isMaximized': { request: void; response: boolean }
  'window:getEffect': { request: void; response: WindowEffectState }
  'window:setEffect': { request: { effect: WindowEffect }; response: WindowEffectState }

  /* activity, rpc, playtime */
  'activity:get': { request: void; response: ActivityUpdate }
  'activity:rejoin': { request: void; response: OperationResult }
  'activity:copyJoinScript': { request: void; response: OperationResult }
  'activity:openGamePage': { request: void; response: OperationResult }
  'rpc:get': { request: void; response: RpcUpdate }
  'rpc:setPage': { request: { page: string; label?: string }; response: void }
  'playtime:summary': { request: void; response: PlaytimeSummary }
  'playtime:reset': { request: void; response: PlaytimeSummary }

  /* studio bridge */
  'studio:getBridge': { request: void; response: StudioBridgeInfo }
  'studio:installPlugin': { request: void; response: OperationResult<StudioBridgeInfo> }

  /* utilities */
  'shortcuts:create': { request: ShortcutRequest; response: OperationResult<ShortcutResult> }
  'backup:export': { request: BackupRequest; response: OperationResult<BackupResult> }
  'backup:import': {
    request: { password: string } | void
    response: OperationResult<BackupImportResult>
  }
  'straps:detect': { request: void; response: StrapDetection[] }
  'straps:import': { request: StrapImportRequest; response: OperationResult<StrapImportResult> }
  'tweaks:getProcessState': { request: void; response: ProcessTweakState }
  'tweaks:apply': { request: ProcessTweakRequest; response: ProcessTweakState }
  'tweaks:listPowerPlans': { request: void; response: PowerPlan[] }
  'tweaks:setPowerPlan': { request: { guid: string }; response: OperationResult<PowerPlan[]> }
}

export interface EventMap {
  'bootstrapper:progress': BootstrapperProgress
  'bootstrapper:complete': BootstrapperResult
  'bootstrapper:error': { message: string; detail?: string }
  'activity:update': ActivityUpdate
  'activity:leave': { activity: ActivityUpdate['activity'] }
  'rpc:update': RpcUpdate
  'roblox:exit': RobloxExitPayload
  'theme:artUpdated': { slot: string; asset: ArtAsset | null }
  'toast:show': ToastPayload
  'settings:changed': AppSettings
  'app:update': AppUpdateState
  'window:state': { maximized: boolean; focused: boolean }
  'window:effect': WindowEffectState
  'navigate:page': { page: string }
  'accounts:changed': AccountState
  'playtime:update': PlaytimeSummary
  'cleaner:progress': {
    target: CleanerCategory
    fileCount: number
    bytes: number
    done: boolean
  }
  'logs:line': { path: string; line: LogLine }
  'mods:changed': ModEntry[]
  'studio:bridge': StudioBridgeInfo
}

export type InvokeChannel = keyof InvokeMap
export type EventChannel = keyof EventMap

export type InvokeRequest<C extends InvokeChannel> = InvokeMap[C]['request']
export type InvokeResponse<C extends InvokeChannel> = InvokeMap[C]['response']

export const INVOKE_CHANNELS = [
  'settings:load',
  'settings:save',
  'settings:reset',
  'settings:export',
  'settings:import',
  'state:getUi',
  'state:saveUi',
  'onboarding:complete',
  'accounts:get',
  'accounts:addFromCookie',
  'accounts:browserLogin',
  'accounts:reauthenticate',
  'accounts:remove',
  'accounts:setActive',
  'accounts:refresh',
  'accounts:getProfile',
  'accounts:getFriends',
  'accounts:searchGames',
  'accounts:getGameDetails',
  'accounts:getGameList',
  'accounts:joinAs',
  'accounts:updateNotes',
  'accounts:list',
  'servers:list',
  'servers:join',
  'servers:ping',
  'bootstrapper:checkUpdate',
  'bootstrapper:install',
  'bootstrapper:launch',
  'bootstrapper:cancel',
  'bootstrapper:forceReinstall',
  'bootstrapper:getProgress',
  'bootstrapper:getPendingUri',
  'bootstrapper:killRoblox',
  'bootstrapper:applyNow',
  'channels:list',
  'channels:set',
  'versions:list',
  'versions:setCurrent',
  'versions:delete',
  'versions:downgrade',
  'versions:openFolder',
  'booru:search',
  'booru:getArtForSlot',
  'booru:clearCache',
  'booru:getCacheStats',
  'booru:openPost',
  'fastflags:getProfiles',
  'fastflags:saveProfile',
  'fastflags:deleteProfile',
  'fastflags:setActive',
  'fastflags:duplicateProfile',
  'fastflags:renameProfile',
  'fastflags:importJson',
  'fastflags:exportJson',
  'fastflags:preview',
  'fastflags:allowlist',
  'fastflags:audit',
  'fastflags:clean',
  'fastflags:presets',
  'fastflags:applyPreset',
  'mods:list',
  'mods:importZip',
  'mods:importFolder',
  'mods:toggle',
  'mods:delete',
  'mods:reorder',
  'mods:openFolder',
  'mods:generateColorMod',
  'mods:setTarget',
  'mods:generateRichMod',
  'mods:replaceFile',
  'mods:createCursorSet',
  'mods:communityIndex',
  'mods:installCommunity',
  'mods:conflicts',
  'mods:applyNow',
  'cleaner:scan',
  'cleaner:run',
  'cleaner:history',
  'logs:list',
  'logs:read',
  'logs:events',
  'logs:unfollow',
  'clientSettings:read',
  'clientSettings:write',
  'app:getUpdateState',
  'app:checkForUpdates',
  'app:downloadUpdate',
  'app:restartToUpdate',
  'system:getInfo',
  'system:openLogs',
  'system:openAppData',
  'system:openRobloxDir',
  'system:uninstall',
  'system:openExternal',
  'system:getState',
  'system:getRobloxState',
  'system:chooseInstallLocation',
  'system:copyToClipboard',
  'system:listFonts',
  'system:chooseFile',
  'system:chooseImage',
  'system:chooseFont',
  'system:revealPath',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:isMaximized',
  'window:getEffect',
  'window:setEffect',
  'activity:get',
  'activity:rejoin',
  'activity:copyJoinScript',
  'activity:openGamePage',
  'rpc:get',
  'rpc:setPage',
  'playtime:summary',
  'playtime:reset',
  'studio:getBridge',
  'studio:installPlugin',
  'shortcuts:create',
  'backup:export',
  'backup:import',
  'straps:detect',
  'straps:import',
  'tweaks:getProcessState',
  'tweaks:apply',
  'tweaks:listPowerPlans',
  'tweaks:setPowerPlan'
] as const satisfies readonly InvokeChannel[]

// A compile-time check that the runtime list is exhaustive: if a channel is
// added to InvokeMap but forgotten here it would never be registered.
type MissingInvoke = Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>
const _invokeChannelsAreExhaustive: MissingInvoke extends never ? true : never = true
void _invokeChannelsAreExhaustive

export const EVENT_CHANNELS = [
  'bootstrapper:progress',
  'bootstrapper:complete',
  'bootstrapper:error',
  'activity:update',
  'activity:leave',
  'rpc:update',
  'roblox:exit',
  'theme:artUpdated',
  'toast:show',
  'settings:changed',
  'app:update',
  'window:state',
  'window:effect',
  'navigate:page',
  'accounts:changed',
  'playtime:update',
  'cleaner:progress',
  'logs:line',
  'mods:changed',
  'studio:bridge'
] as const satisfies readonly EventChannel[]

type MissingEvent = Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>
const _eventChannelsAreExhaustive: MissingEvent extends never ? true : never = true
void _eventChannelsAreExhaustive

const invokeSet: ReadonlySet<string> = new Set(INVOKE_CHANNELS)
const eventSet: ReadonlySet<string> = new Set(EVENT_CHANNELS)

export function isInvokeChannel(channel: string): channel is InvokeChannel {
  return invokeSet.has(channel)
}

export function isEventChannel(channel: string): channel is EventChannel {
  return eventSet.has(channel)
}
