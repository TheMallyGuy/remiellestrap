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
  SaveProfileRequest,
  SystemInfo,
  UpdateCheckResult
} from '@shared/models'
import type { AppSettings } from '@shared/settings'
import type { AppState, RobloxState } from '@shared/state'

/**
 * The single bridge between the renderer and the main process.
 *
 * The renderer never sees `ipcRenderer`, `shell`, `fs` or any Node primitive:
 * it gets one frozen object of typed functions. Channel names are validated
 * against the shared contract here too, so a bug in renderer code cannot
 * reach an arbitrary channel.
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
    killRoblox: (): Promise<OperationResult> => invoke('bootstrapper:killRoblox')
  },

  booru: {
    search: (request: BooruSearchRequest): Promise<BooruPost[]> => invoke('booru:search', request),
    getArtForSlot: (request: ArtRequest): Promise<ArtAsset | null> =>
      invoke('booru:getArtForSlot', request),
    clearCache: (): Promise<CacheStats> => invoke('booru:clearCache'),
    getCacheStats: (): Promise<CacheStats> => invoke('booru:getCacheStats'),
    openPost: (postId: number): Promise<OperationResult> => invoke('booru:openPost', { postId })
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
    preview: (): Promise<Record<string, FlagValue>> => invoke('fastflags:preview')
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
      invoke('mods:generateColorMod', request)
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
      invoke('system:chooseInstallLocation')
  },

  window: {
    minimize: (): Promise<void> => invoke('window:minimize'),
    maximize: (): Promise<boolean> => invoke('window:maximize'),
    close: (): Promise<void> => invoke('window:close'),
    isMaximized: (): Promise<boolean> => invoke('window:isMaximized')
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
