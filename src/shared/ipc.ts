/**
 * The single source of truth for the IPC surface.
 *
 * `InvokeMap` describes request/response pairs handled with ipcMain.handle and
 * called with ipcRenderer.invoke. `EventMap` describes push events sent from
 * the main process to the renderer. Both main and preload derive their types
 * from here, so a channel cannot be added on one side only.
 */

import type { AppSettings } from './settings'
import type { AppState, RobloxState } from './state'
import type {
  ActivityUpdate,
  ArtAsset,
  ArtRequest,
  BooruPost,
  BooruSearchRequest,
  BootstrapperProgress,
  BootstrapperResult,
  CacheStats,
  ColorModRequest,
  FlagProfile,
  FlagValue,
  LaunchRequest,
  ModEntry,
  OperationResult,
  RobloxExitPayload,
  RpcUpdate,
  SaveProfileRequest,
  SystemInfo,
  ToastPayload,
  UpdateCheckResult
} from './models'

export interface InvokeMap {
  /* settings */
  'settings:load': { request: void; response: AppSettings }
  'settings:save': { request: Partial<AppSettings>; response: AppSettings }
  'settings:reset': { request: void; response: AppSettings }
  'settings:export': { request: void; response: OperationResult<string> }
  'settings:import': { request: void; response: OperationResult<AppSettings> }

  /* bootstrapper */
  'bootstrapper:checkUpdate': { request: void; response: UpdateCheckResult }
  'bootstrapper:install': { request: { force?: boolean } | void; response: BootstrapperResult }
  'bootstrapper:launch': { request: LaunchRequest | void; response: BootstrapperResult }
  'bootstrapper:cancel': { request: void; response: OperationResult }
  'bootstrapper:forceReinstall': { request: void; response: BootstrapperResult }
  'bootstrapper:getProgress': { request: void; response: BootstrapperProgress }
  'bootstrapper:getPendingUri': { request: void; response: string | null }
  'bootstrapper:killRoblox': { request: void; response: OperationResult }

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

  /* mods */
  'mods:list': { request: void; response: ModEntry[] }
  'mods:importZip': { request: void; response: OperationResult<ModEntry[]> }
  'mods:importFolder': { request: void; response: OperationResult<ModEntry[]> }
  'mods:toggle': { request: { id: string; enabled: boolean }; response: ModEntry[] }
  'mods:delete': { request: { id: string }; response: ModEntry[] }
  'mods:reorder': { request: { ids: string[] }; response: ModEntry[] }
  'mods:openFolder': { request: { id?: string } | void; response: OperationResult }
  'mods:generateColorMod': { request: ColorModRequest; response: OperationResult<ModEntry[]> }

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

  /* window controls */
  'window:minimize': { request: void; response: void }
  'window:maximize': { request: void; response: boolean }
  'window:close': { request: void; response: void }
  'window:isMaximized': { request: void; response: boolean }

  /* activity */
  'activity:get': { request: void; response: ActivityUpdate }
  'activity:rejoin': { request: void; response: OperationResult }
  'activity:copyJoinScript': { request: void; response: OperationResult }
  'activity:openGamePage': { request: void; response: OperationResult }
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
  'window:state': { maximized: boolean; focused: boolean }
  'navigate:page': { page: string }
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
  'bootstrapper:checkUpdate',
  'bootstrapper:install',
  'bootstrapper:launch',
  'bootstrapper:cancel',
  'bootstrapper:forceReinstall',
  'bootstrapper:getProgress',
  'bootstrapper:getPendingUri',
  'bootstrapper:killRoblox',
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
  'mods:list',
  'mods:importZip',
  'mods:importFolder',
  'mods:toggle',
  'mods:delete',
  'mods:reorder',
  'mods:openFolder',
  'mods:generateColorMod',
  'system:getInfo',
  'system:openLogs',
  'system:openAppData',
  'system:openRobloxDir',
  'system:uninstall',
  'system:openExternal',
  'system:getState',
  'system:getRobloxState',
  'system:chooseInstallLocation',
  'window:minimize',
  'window:maximize',
  'window:close',
  'window:isMaximized',
  'activity:get',
  'activity:rejoin',
  'activity:copyJoinScript',
  'activity:openGamePage'
] as const satisfies readonly InvokeChannel[]

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
  'window:state',
  'navigate:page'
] as const satisfies readonly EventChannel[]

const invokeSet: ReadonlySet<string> = new Set(INVOKE_CHANNELS)
const eventSet: ReadonlySet<string> = new Set(EVENT_CHANNELS)

export function isInvokeChannel(channel: string): channel is InvokeChannel {
  return invokeSet.has(channel)
}

export function isEventChannel(channel: string): channel is EventChannel {
  return eventSet.has(channel)
}
