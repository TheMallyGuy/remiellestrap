import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  EventChannel,
  EventMap,
  InvokeChannel,
  InvokeRequest,
  InvokeResponse
} from '@shared/ipc'
import { isEventChannel, isInvokeChannel } from '@shared/ipc'
import type {
  AccountAddRequest,
  AccountBrowserLoginRequest,
  AccountFriend,
  AccountProfile,
  AccountProfileRequest,
  AccountState,
  ActivityUpdate,
  AppUpdateState,
  ArtAsset,
  ArtRequest,
  BackupImportResult,
  BackupRequest,
  BackupResult,
  BootstrapperProgress,
  BootstrapperResult,
  BooruPost,
  BooruSearchRequest,
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
  UpdateCheckResult,
  VersionActionRequest,
  WindowEffectState
} from '@shared/models'
import type { AppSettings, BooruProvider, CleanerCategory, WindowEffect } from '@shared/settings'
import type { AppState, RobloxState, UiState } from '@shared/state'

/**
 * The single bridge between the renderer and the main process.
 *
 * The renderer never sees `ipcRenderer`, `shell`, `fs` or any Node primitive:
 * it gets one frozen object of typed functions. Channel names are validated
 * against the shared contract here too, so a bug in renderer code cannot
 * reach an arbitrary channel.
 *
 * The `invoke`/`on` pair is the general door — typed directly by the shared
 * contract — and the namespaces below are readable shorthands for the calls
 * the UI makes most often. Anything without a shorthand can still be reached
 * through `invoke`, which is what keeps this file from having to grow a method
 * per channel every time a feature lands.
 */

class ChannelError extends Error {
  constructor(channel: string) {
    super(`Unknown IPC channel: ${channel}`)
    this.name = 'ChannelError'
  }
}

async function invoke<C extends InvokeChannel>(
  channel: C,
  request?: InvokeRequest<C>
): Promise<InvokeResponse<C>> {
  if (!isInvokeChannel(channel)) throw new ChannelError(channel)

  try {
    return (await ipcRenderer.invoke(channel, request)) as InvokeResponse<C>
  } catch (error) {
    // Electron prefixes IPC errors with the remote stack; keep the message.
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message.replace(/^Error invoking remote method '[^']+':\s*/, ''))
  }
}

type Listener<C extends EventChannel> = (payload: EventMap[C]) => void

/** Wrapper functions are kept so `off` can find the registered listener. */
const wrappers = new WeakMap<Listener<EventChannel>, (...args: unknown[]) => void>()

function on<C extends EventChannel>(channel: C, listener: Listener<C>): () => void {
  if (!isEventChannel(channel)) throw new ChannelError(channel)
  if (typeof listener !== 'function') throw new TypeError('Listener must be a function')

  const wrapper = (_event: IpcRendererEvent, payload: unknown): void => {
    listener(payload as EventMap[C])
  }

  wrappers.set(listener as Listener<EventChannel>, wrapper as (...args: unknown[]) => void)
  ipcRenderer.on(channel, wrapper)

  return () => off(channel, listener)
}

function once<C extends EventChannel>(channel: C, listener: Listener<C>): void {
  if (!isEventChannel(channel)) throw new ChannelError(channel)

  ipcRenderer.once(channel, (_event, payload) => listener(payload as EventMap[C]))
}

function off<C extends EventChannel>(channel: C, listener: Listener<C>): void {
  if (!isEventChannel(channel)) throw new ChannelError(channel)

  const wrapper = wrappers.get(listener as Listener<EventChannel>)
  if (wrapper) {
    ipcRenderer.removeListener(channel, wrapper)
    wrappers.delete(listener as Listener<EventChannel>)
  }
}

const api = {
  invoke,
  on,
  once,
  off,

  settings: {
    load: (): Promise<AppSettings> => invoke('settings:load'),
    save: (patch: Partial<AppSettings>): Promise<AppSettings> => invoke('settings:save', patch),
    reset: (): Promise<AppSettings> => invoke('settings:reset'),
    export: (): Promise<OperationResult<string>> => invoke('settings:export'),
    import: (): Promise<OperationResult<AppSettings>> => invoke('settings:import')
  },

  state: {
    getUi: (): Promise<UiState> => invoke('state:getUi'),
    saveUi: (patch: Partial<UiState>): Promise<UiState> => invoke('state:saveUi', patch),
    completeOnboarding: (): Promise<AppState> => invoke('onboarding:complete'),
    get: (): Promise<AppState> => invoke('system:getState'),
    getRoblox: (): Promise<RobloxState> => invoke('system:getRobloxState')
  },

  accounts: {
    get: (): Promise<AccountState> => invoke('accounts:get'),
    list: (): Promise<RobloxAccount[]> => invoke('accounts:list'),
    addFromCookie: (request: AccountAddRequest): Promise<OperationResult<AccountState>> =>
      invoke('accounts:addFromCookie', request),
    browserLogin: (request?: AccountBrowserLoginRequest): Promise<OperationResult<AccountState>> =>
      invoke('accounts:browserLogin', request),
    reauthenticate: (id: string): Promise<OperationResult<AccountState>> =>
      invoke('accounts:reauthenticate', { id }),
    remove: (id: string): Promise<OperationResult<AccountState>> =>
      invoke('accounts:remove', { id }),
    setActive: (id: string | null): Promise<AccountState> => invoke('accounts:setActive', { id }),
    refresh: (request?: { id?: string; profile?: boolean }): Promise<AccountState> =>
      invoke('accounts:refresh', request),
    getProfile: (request: AccountProfileRequest): Promise<OperationResult<AccountProfile>> =>
      invoke('accounts:getProfile', request),
    getFriends: (accountId: string, refresh = false): Promise<OperationResult<AccountFriend[]>> =>
      invoke('accounts:getFriends', { accountId, refresh }),
    searchGames: (request: GameSearchRequest): Promise<OperationResult<GameSummary[]>> =>
      invoke('accounts:searchGames', request),
    getGameDetails: (request: GameDetailsRequest): Promise<OperationResult<GameSummary>> =>
      invoke('accounts:getGameDetails', request),
    getGameList: (request: GameListRequest): Promise<OperationResult<GameSummary[]>> =>
      invoke('accounts:getGameList', request),
    joinAs: (request: JoinAsRequest): Promise<BootstrapperResult> =>
      invoke('accounts:joinAs', request),
    updateNotes: (id: string, notes: string): Promise<AccountState> =>
      invoke('accounts:updateNotes', { id, notes })
  },

  servers: {
    list: (request: ServerListRequest = {}): Promise<ServerListResult> =>
      invoke('servers:list', request),
    join: (request: ServerJoinRequest): Promise<ServerJoinResult> =>
      invoke('servers:join', request),
    ping: (
      placeId: string,
      servers: { id: string; datacenter: string | null }[]
    ): Promise<ServerPingSample[]> => invoke('servers:ping', { placeId, servers })
  },

  bootstrapper: {
    checkUpdate: (): Promise<UpdateCheckResult> => invoke('bootstrapper:checkUpdate'),
    install: (force?: boolean): Promise<BootstrapperResult> =>
      invoke('bootstrapper:install', { force }),
    launch: (request?: LaunchRequest): Promise<BootstrapperResult> =>
      invoke('bootstrapper:launch', request),
    cancel: (): Promise<OperationResult> => invoke('bootstrapper:cancel'),
    forceReinstall: (): Promise<BootstrapperResult> => invoke('bootstrapper:forceReinstall'),
    getProgress: (): Promise<BootstrapperProgress> => invoke('bootstrapper:getProgress'),
    getPendingUri: (): Promise<string | null> => invoke('bootstrapper:getPendingUri'),
    killRoblox: (): Promise<OperationResult> => invoke('bootstrapper:killRoblox'),
    applyNow: (): Promise<OperationResult<{ files: number; flags: number }>> =>
      invoke('bootstrapper:applyNow')
  },

  channels: {
    list: (refresh = false): Promise<ChannelInfo[]> => invoke('channels:list', { refresh }),
    set: (name: string): Promise<ChannelInfo[]> => invoke('channels:set', { name })
  },

  versions: {
    list: (): Promise<InstalledVersion[]> => invoke('versions:list'),
    setCurrent: (request: VersionActionRequest): Promise<InstalledVersion[]> =>
      invoke('versions:setCurrent', request),
    delete: (request: VersionActionRequest): Promise<InstalledVersion[]> =>
      invoke('versions:delete', request),
    downgrade: (request: VersionActionRequest): Promise<BootstrapperResult> =>
      invoke('versions:downgrade', request),
    openFolder: (): Promise<OperationResult> => invoke('versions:openFolder')
  },

  booru: {
    search: (request: BooruSearchRequest): Promise<BooruPost[]> => invoke('booru:search', request),
    getArtForSlot: (request: ArtRequest): Promise<ArtAsset | null> =>
      invoke('booru:getArtForSlot', request),
    clearCache: (): Promise<CacheStats> => invoke('booru:clearCache'),
    getCacheStats: (): Promise<CacheStats> => invoke('booru:getCacheStats'),
    openPost: (postId: number, source?: BooruProvider): Promise<OperationResult> =>
      invoke('booru:openPost', { postId, source })
  },

  fastflags: {
    getProfiles: (): Promise<FlagProfile[]> => invoke('fastflags:getProfiles'),
    saveProfile: (request: SaveProfileRequest): Promise<FlagProfile[]> =>
      invoke('fastflags:saveProfile', request),
    deleteProfile: (name: string): Promise<FlagProfile[]> =>
      invoke('fastflags:deleteProfile', { name }),
    setActive: (name: string): Promise<FlagProfile[]> => invoke('fastflags:setActive', { name }),
    duplicateProfile: (name: string, newName: string): Promise<FlagProfile[]> =>
      invoke('fastflags:duplicateProfile', { name, newName }),
    renameProfile: (name: string, newName: string): Promise<FlagProfile[]> =>
      invoke('fastflags:renameProfile', { name, newName }),
    importJson: (name?: string): Promise<OperationResult<FlagProfile[]>> =>
      invoke('fastflags:importJson', { name }),
    exportJson: (name: string): Promise<OperationResult<string>> =>
      invoke('fastflags:exportJson', { name }),
    preview: (): Promise<Record<string, FlagValue>> => invoke('fastflags:preview'),
    allowlist: (refresh = false): Promise<FlagAllowlist> =>
      invoke('fastflags:allowlist', { refresh } satisfies FlagAllowlistRequest),
    audit: (name?: string): Promise<FlagAudit> => invoke('fastflags:audit', { name }),
    clean: (request?: { name?: string; dryRun?: boolean }): Promise<FlagCleanResult> =>
      invoke('fastflags:clean', request),
    presets: (): Promise<FlagPreset[]> => invoke('fastflags:presets'),
    applyPreset: (request: FlagPresetApplyRequest): Promise<FlagProfile[]> =>
      invoke('fastflags:applyPreset', request)
  },

  mods: {
    list: (): Promise<ModEntry[]> => invoke('mods:list'),
    importZip: (): Promise<OperationResult<ModEntry[]>> => invoke('mods:importZip'),
    importFolder: (): Promise<OperationResult<ModEntry[]>> => invoke('mods:importFolder'),
    toggle: (id: string, enabled: boolean): Promise<ModEntry[]> =>
      invoke('mods:toggle', { id, enabled }),
    delete: (id: string): Promise<ModEntry[]> => invoke('mods:delete', { id }),
    reorder: (ids: string[]): Promise<ModEntry[]> => invoke('mods:reorder', { ids }),
    openFolder: (id?: string): Promise<OperationResult> => invoke('mods:openFolder', { id }),
    generateColorMod: (request: ColorModRequest): Promise<OperationResult<ModEntry[]>> =>
      invoke('mods:generateColorMod', request),
    setTarget: (request: ModTargetRequest): Promise<ModEntry[]> =>
      invoke('mods:setTarget', request),
    generateRichMod: (request: RichModRequest): Promise<OperationResult<ModEntry[]>> =>
      invoke('mods:generateRichMod', request),
    replaceFile: (
      request: FileReplacementRequest
    ): Promise<OperationResult<FileReplacementResult>> => invoke('mods:replaceFile', request),
    createCursorSet: (request: CursorSetRequest): Promise<OperationResult<ModEntry[]>> =>
      invoke('mods:createCursorSet', request),
    communityIndex: (request?: { refresh?: boolean; query?: string }): Promise<CommunityIndex> =>
      invoke('mods:communityIndex', request),
    installCommunity: (request: CommunityInstallRequest): Promise<OperationResult<ModEntry[]>> =>
      invoke('mods:installCommunity', request),
    conflicts: (): Promise<ModConflict[]> => invoke('mods:conflicts'),
    applyNow: (): Promise<OperationResult<{ files: number; flags: number }>> =>
      invoke('mods:applyNow')
  },

  cleaner: {
    scan: (targets?: CleanerCategory[]): Promise<CleanerScan> =>
      invoke('cleaner:scan', { targets }),
    run: (request: CleanerRunRequest): Promise<CleanerResult> => invoke('cleaner:run', request),
    history: (): Promise<CleanerHistoryEntry[]> => invoke('cleaner:history')
  },

  logs: {
    list: (): Promise<LogFileInfo[]> => invoke('logs:list'),
    read: (request: LogReadRequest): Promise<LogReadResult> => invoke('logs:read', request),
    events: (request?: { path?: string; tailLines?: number }): Promise<ClientLogEvent[]> =>
      invoke('logs:events', request),
    unfollow: (): Promise<OperationResult> => invoke('logs:unfollow'),
    line: (listener: (payload: { path: string; line: LogLine }) => void): (() => void) =>
      on('logs:line', listener)
  },

  clientSettings: {
    read: (): Promise<ClientSettingsState> => invoke('clientSettings:read'),
    write: (values: ClientSettingsPatch['values']): Promise<ClientSettingsState> =>
      invoke('clientSettings:write', { values } as ClientSettingsPatch)
  },

  playtime: {
    summary: (): Promise<PlaytimeSummary> => invoke('playtime:summary'),
    reset: (): Promise<PlaytimeSummary> => invoke('playtime:reset')
  },

  studio: {
    getBridge: (): Promise<StudioBridgeInfo> => invoke('studio:getBridge'),
    installPlugin: (): Promise<OperationResult<StudioBridgeInfo>> => invoke('studio:installPlugin')
  },

  rpc: {
    get: () => invoke('rpc:get'),
    setPage: (page: string, label?: string): Promise<void> => invoke('rpc:setPage', { page, label })
  },

  tweaks: {
    getProcessState: (): Promise<ProcessTweakState> => invoke('tweaks:getProcessState'),
    apply: (request: ProcessTweakRequest): Promise<ProcessTweakState> =>
      invoke('tweaks:apply', request),
    listPowerPlans: (): Promise<PowerPlan[]> => invoke('tweaks:listPowerPlans'),
    setPowerPlan: (guid: string): Promise<OperationResult<PowerPlan[]>> =>
      invoke('tweaks:setPowerPlan', { guid })
  },

  shortcuts: {
    create: (request: ShortcutRequest): Promise<OperationResult<ShortcutResult>> =>
      invoke('shortcuts:create', request)
  },

  backup: {
    export: (request: BackupRequest): Promise<OperationResult<BackupResult>> =>
      invoke('backup:export', request),
    import: (password: string): Promise<OperationResult<BackupImportResult>> =>
      invoke('backup:import', { password })
  },

  straps: {
    detect: (): Promise<StrapDetection[]> => invoke('straps:detect'),
    import: (request: StrapImportRequest): Promise<OperationResult<StrapImportResult>> =>
      invoke('straps:import', request)
  },

  app: {
    getUpdateState: (): Promise<AppUpdateState> => invoke('app:getUpdateState'),
    checkForUpdates: (): Promise<AppUpdateState> => invoke('app:checkForUpdates'),
    downloadUpdate: (): Promise<OperationResult> => invoke('app:downloadUpdate'),
    restartToUpdate: (): Promise<OperationResult> => invoke('app:restartToUpdate')
  },

  system: {
    getInfo: (): Promise<SystemInfo> => invoke('system:getInfo'),
    openLogs: (): Promise<OperationResult> => invoke('system:openLogs'),
    openAppData: (): Promise<OperationResult> => invoke('system:openAppData'),
    openRobloxDir: (): Promise<OperationResult> => invoke('system:openRobloxDir'),
    uninstall: (keepSettings: boolean): Promise<OperationResult> =>
      invoke('system:uninstall', { keepSettings }),
    openExternal: (url: string): Promise<OperationResult> => invoke('system:openExternal', { url }),
    getState: (): Promise<AppState> => invoke('system:getState'),
    getRobloxState: (): Promise<RobloxState> => invoke('system:getRobloxState'),
    chooseInstallLocation: (): Promise<OperationResult<string>> =>
      invoke('system:chooseInstallLocation'),
    copyToClipboard: (text: string): Promise<OperationResult> =>
      invoke('system:copyToClipboard', { text }),
    listFonts: (): Promise<FontCatalog> => invoke('system:listFonts'),
    chooseFile: (title?: string, extensions?: string[]): Promise<OperationResult<string>> =>
      invoke('system:chooseFile', { title, extensions }),
    chooseImage: (): Promise<OperationResult<string>> => invoke('system:chooseImage'),
    chooseFont: (): Promise<OperationResult<string>> => invoke('system:chooseFont'),
    revealPath: (path: string): Promise<OperationResult> => invoke('system:revealPath', { path })
  },

  window: {
    minimize: (): Promise<void> => invoke('window:minimize'),
    maximize: (): Promise<boolean> => invoke('window:maximize'),
    close: (): Promise<void> => invoke('window:close'),
    isMaximized: (): Promise<boolean> => invoke('window:isMaximized'),
    getEffect: (): Promise<WindowEffectState> => invoke('window:getEffect'),
    setEffect: (effect: WindowEffect): Promise<WindowEffectState> =>
      invoke('window:setEffect', { effect })
  },

  activity: {
    get: (): Promise<ActivityUpdate> => invoke('activity:get'),
    rejoin: (): Promise<OperationResult> => invoke('activity:rejoin'),
    copyJoinScript: (): Promise<OperationResult> => invoke('activity:copyJoinScript'),
    openGamePage: (): Promise<OperationResult> => invoke('activity:openGamePage')
  }
} as const

export type RemielleApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('remielle', api)
  } catch (error) {
    // Nothing can recover from a failed bridge; surface it loudly in the log.
    console.error('Failed to expose the RemielleStrap API', error)
  }
} else {
  // contextIsolation is always on in this app; this branch only exists so a
  // misconfigured window fails visibly rather than silently.
  ;(globalThis as unknown as { remielle: RemielleApi }).remielle = api
}
