import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { release } from 'os'
import type {
  IpcMainInvokeEvent,
  OpenDialogOptions,
  OpenDialogReturnValue,
  SaveDialogOptions,
  SaveDialogReturnValue
} from 'electron'
import type { InvokeChannel, InvokeMap } from '@shared/ipc'
import { INVOKE_CHANNELS } from '@shared/ipc'
import type {
  ArtRequest,
  BooruSearchRequest,
  ColorModRequest,
  LaunchRequest,
  OperationResult,
  SaveProfileRequest,
  SystemInfo
} from '@shared/models'
import type { AppSettings } from '@shared/settings'
import { paths, stockRobloxRoot } from '../utils/paths'
import { createLogger, currentLogFile } from '../utils/logger'
import { ensureDir, pathExists } from '../utils/fs'
import { openExternal } from '../app/csp'
import * as settingsStore from '../services/settingsStore'
import * as stateStore from '../services/stateStore'
import * as booru from '../services/booru'
import * as fastflags from '../services/fastflags'
import * as mods from '../services/mods'
import * as activity from '../services/activity'
import * as bootstrapper from '../core/bootstrapper'
import {
  ValidationError,
  optionalBoolean,
  optionalInteger,
  optionalString,
  requireBoolean,
  requireHexColor,
  requireInteger,
  requireNonEmptyString,
  requireObject,
  requireString,
  requireStringArray
} from './validate'

/**
 * Every IPC handler in one place.
 *
 * Handlers are registered from the shared channel list, so a channel that
 * exists in the contract but has no implementation is a startup error rather
 * than a silent "no handler registered" failure at runtime.
 */

const logger = createLogger('IPC')

type Handler<C extends InvokeChannel> = (
  request: InvokeMap[C]['request'],
  event: IpcMainInvokeEvent
) => InvokeMap[C]['response'] | Promise<InvokeMap[C]['response']>

type HandlerMap = { [C in InvokeChannel]: Handler<C> }

/** Deep-link URI captured before the renderer was ready to receive it. */
let pendingUri: string | null = null

export function setPendingUri(uri: string | null): void {
  pendingUri = uri
}

export function takePendingUri(): string | null {
  const uri = pendingUri
  pendingUri = null
  return uri
}

function windowFor(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

/**
 * `dialog.show*Dialog` is overloaded: passing a parent window makes the dialog
 * sheet-modal on macOS, while the parentless overload is a separate signature
 * that does not accept `undefined`. These wrappers pick the right overload
 * instead of lying to the type system with a non-null assertion.
 */
function saveDialog(
  parent: BrowserWindow | null,
  options: SaveDialogOptions
): Promise<SaveDialogReturnValue> {
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options)
}

function openDialog(
  parent: BrowserWindow | null,
  options: OpenDialogOptions
): Promise<OpenDialogReturnValue> {
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options)
}

function ok<T>(data?: T): OperationResult<T> {
  return data === undefined ? { ok: true } : { ok: true, data }
}

function failed(error: string): OperationResult<never> {
  return { ok: false, error }
}

/** Opens a directory in the OS file manager, creating it when missing. */
async function revealDirectory(directory: string): Promise<OperationResult> {
  try {
    await ensureDir(directory)
    const error = await shell.openPath(directory)
    return error ? failed(error) : ok()
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error))
  }
}

async function systemInfo(): Promise<SystemInfo> {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron ?? 'unknown',
    chromeVersion: process.versions.chrome ?? 'unknown',
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    isWindows: process.platform === 'win32',
    paths: {
      appData: paths.root,
      logs: paths.logs,
      mods: paths.mods,
      cache: paths.cache,
      versions: paths.versions,
      downloads: paths.downloads
    },
    robloxSupported: process.platform === 'win32'
  }
}

const handlers: HandlerMap = {
  /* ---------------------------------------------------------- settings */

  'settings:load': async () => settingsStore.getSettings(),

  'settings:save': async (request) => {
    const patch = requireObject(request, 'settings') as Partial<AppSettings>
    return settingsStore.saveSettings(patch)
  },

  'settings:reset': async () => settingsStore.resetSettings(),

  'settings:export': async (_request, event) => {
    const result = await saveDialog(windowFor(event), {
      title: 'Export settings',
      defaultPath: 'RemielleStrap-Settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) return failed('Export cancelled')

    try {
      await settingsStore.exportSettingsTo(result.filePath)
      return ok(result.filePath)
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }
  },

  'settings:import': async (_request, event) => {
    const result = await openDialog(windowFor(event), {
      title: 'Import settings',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return failed('Import cancelled')

    try {
      const settings = await settingsStore.importSettingsFrom(result.filePaths[0])
      return ok(settings)
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }
  },

  /* ------------------------------------------------------ bootstrapper */

  'bootstrapper:checkUpdate': async () => bootstrapper.checkForUpdates(),

  'bootstrapper:install': async (request) => {
    const force = request ? optionalBoolean(requireObject(request).force, 'force') : false
    return bootstrapper.install(force ?? false)
  },

  'bootstrapper:launch': async (request) => {
    let payload: LaunchRequest | null = null

    if (request) {
      const raw = requireObject(request, 'launch')
      payload = {
        uri: optionalString(raw.uri, 'uri', 8192),
        mode: raw.mode === 'studio' ? 'studio' : 'player',
        force: optionalBoolean(raw.force, 'force')
      }
    }

    return bootstrapper.launch(payload)
  },

  'bootstrapper:cancel': async () => (bootstrapper.cancel() ? ok() : failed('Nothing to cancel')),

  'bootstrapper:forceReinstall': async () => bootstrapper.forceReinstall(),

  'bootstrapper:getProgress': async () => bootstrapper.currentProgress(),

  'bootstrapper:getPendingUri': async () => takePendingUri(),

  'bootstrapper:killRoblox': async () => {
    const killed = await activity.killRoblox()
    return killed ? ok() : failed('Roblox is not running')
  },

  /* ---------------------------------------------------------- booru */

  'booru:search': async (request) => {
    const raw = requireObject(request, 'search')
    const payload: BooruSearchRequest = {
      tags: requireString(raw.tags, 'tags', 512),
      page: optionalInteger(raw.page, 'page', 0, 2000),
      limit: optionalInteger(raw.limit, 'limit', 1, 100)
    }
    return booru.searchPosts(payload)
  },

  'booru:getArtForSlot': async (request) => {
    const raw = requireObject(request, 'art')
    const payload: ArtRequest = {
      slot: requireNonEmptyString(raw.slot, 'slot', 64),
      shuffle: optionalBoolean(raw.shuffle, 'shuffle'),
      tags: optionalString(raw.tags, 'tags', 512)
    }

    return booru.getArtForSlot(payload)
  },

  'booru:clearCache': async () => booru.clearCache(),

  'booru:getCacheStats': async () => booru.getCacheStats(),

  'booru:openPost': async (request) => {
    const raw = requireObject(request, 'post')
    const postId = requireInteger(raw.postId, 'postId', 1)
    const opened = await openExternal(booru.postUrlFor(postId))
    return opened ? ok() : failed('That link is not allowed')
  },

  /* ------------------------------------------------------- fastflags */

  'fastflags:getProfiles': async () => fastflags.getProfiles(),

  'fastflags:saveProfile': async (request) => {
    const raw = requireObject(request, 'profile')
    const payload: SaveProfileRequest = {
      name: requireNonEmptyString(raw.name, 'name', 64),
      flags: requireObject(raw.flags, 'flags') as SaveProfileRequest['flags'],
      setActive: optionalBoolean(raw.setActive, 'setActive')
    }
    return fastflags.saveProfile(payload)
  },

  'fastflags:deleteProfile': async (request) => {
    const raw = requireObject(request, 'profile')
    return fastflags.deleteProfile(requireNonEmptyString(raw.name, 'name', 64))
  },

  'fastflags:setActive': async (request) => {
    const raw = requireObject(request, 'profile')
    return fastflags.setActiveProfile(requireNonEmptyString(raw.name, 'name', 64))
  },

  'fastflags:duplicateProfile': async (request) => {
    const raw = requireObject(request, 'profile')
    return fastflags.duplicateProfile(
      requireNonEmptyString(raw.name, 'name', 64),
      requireNonEmptyString(raw.newName, 'newName', 64)
    )
  },

  'fastflags:renameProfile': async (request) => {
    const raw = requireObject(request, 'profile')
    return fastflags.renameProfile(
      requireNonEmptyString(raw.name, 'name', 64),
      requireNonEmptyString(raw.newName, 'newName', 64)
    )
  },

  'fastflags:importJson': async (request) => {
    const raw = request ? requireObject(request, 'profile') : {}
    return fastflags.importFromJson(optionalString(raw.name, 'name', 64))
  },

  'fastflags:exportJson': async (request) => {
    const raw = requireObject(request, 'profile')
    return fastflags.exportToJson(requireNonEmptyString(raw.name, 'name', 64))
  },

  'fastflags:preview': async () => fastflags.activeFlags(),

  /* ------------------------------------------------------------ mods */

  'mods:list': async () => mods.listMods(),

  'mods:importZip': async () => mods.importZip(),

  'mods:importFolder': async () => mods.importFolder(),

  'mods:toggle': async (request) => {
    const raw = requireObject(request, 'mod')
    return mods.toggleMod(
      requireNonEmptyString(raw.id, 'id', 128),
      requireBoolean(raw.enabled, 'enabled')
    )
  },

  'mods:delete': async (request) => {
    const raw = requireObject(request, 'mod')
    return mods.deleteMod(requireNonEmptyString(raw.id, 'id', 128))
  },

  'mods:reorder': async (request) => {
    const raw = requireObject(request, 'mod')
    return mods.reorderMods(requireStringArray(raw.ids, 'ids', 500, 128))
  },

  'mods:openFolder': async (request) => {
    const raw = request ? requireObject(request, 'mod') : {}
    return mods.openModsFolder(optionalString(raw.id, 'id', 128))
  },

  'mods:generateColorMod': async (request) => {
    const raw = requireObject(request, 'colorMod')
    const payload: ColorModRequest = {
      name: requireNonEmptyString(raw.name, 'name', 64),
      color: requireHexColor(raw.color, 'color'),
      accent: raw.accent === undefined ? undefined : requireHexColor(raw.accent, 'accent')
    }
    return mods.generateColorMod(payload)
  },

  /* ---------------------------------------------------------- system */

  'system:getInfo': async () => systemInfo(),

  'system:openLogs': async () => {
    const current = currentLogFile()
    if (current && (await pathExists(current))) {
      shell.showItemInFolder(current)
      return ok()
    }
    return revealDirectory(paths.logs)
  },

  'system:openAppData': async () => revealDirectory(paths.root),

  'system:openRobloxDir': async () => {
    const state = stateStore.getRobloxState()
    const target =
      state.installPath && (await pathExists(state.installPath))
        ? state.installPath
        : (await pathExists(paths.versions))
          ? paths.versions
          : stockRobloxRoot()

    if (!(await pathExists(target))) return failed('No Roblox installation was found')
    return revealDirectory(target)
  },

  'system:uninstall': async (request) => {
    const raw = requireObject(request, 'uninstall')
    const keepSettings = requireBoolean(raw.keepSettings, 'keepSettings')

    try {
      await bootstrapper.uninstall(keepSettings)
      return ok()
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error))
    }
  },

  'system:openExternal': async (request) => {
    const raw = requireObject(request, 'external')
    const url = requireNonEmptyString(raw.url, 'url', 2048)
    const opened = await openExternal(url)
    return opened ? ok() : failed('That link is not allowed')
  },

  'system:getState': async () => stateStore.getState(),

  'system:getRobloxState': async () => stateStore.getRobloxState(),

  'system:chooseInstallLocation': async (_request, event) => {
    const result = await openDialog(windowFor(event), {
      title: 'Choose install location',
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) return failed('Selection cancelled')
    return ok(result.filePaths[0])
  },

  'system:copyToClipboard': async (request) => {
    const raw = requireObject(request, 'clipboard')
    // Capped well above any realistic flag map but far below anything that
    // would let a compromised renderer wedge the clipboard.
    const text = requireString(raw.text, 'text', 200_000)
    clipboard.writeText(text)
    return ok()
  },

  /* ---------------------------------------------------------- window */

  'window:minimize': async (_request, event) => {
    windowFor(event)?.minimize()
  },

  'window:maximize': async (_request, event) => {
    const window = windowFor(event)
    if (!window) return false

    if (window.isMaximized()) window.unmaximize()
    else window.maximize()

    return window.isMaximized()
  },

  'window:close': async (_request, event) => {
    windowFor(event)?.close()
  },

  'window:isMaximized': async (_request, event) => windowFor(event)?.isMaximized() ?? false,

  /* -------------------------------------------------------- activity */

  'activity:get': async () => activity.currentActivity(),

  'activity:rejoin': async () => {
    const uri = activity.rejoinUri()
    if (!uri) return failed('There is no server to rejoin')

    const result = await bootstrapper.launch({ uri, force: true })
    return result.ok ? ok() : failed(result.message)
  },

  'activity:copyJoinScript': async () => {
    const current = activity.currentActivity().activity
    if (!current) return failed('You are not in an experience')

    const script = current.jobId
      ? `Roblox.GameLauncher.followPlayerIntoGame("${current.placeId}")\n-- place ${current.placeId}, job ${current.jobId}\ngame:GetService("TeleportService"):TeleportToPlaceInstance(${current.placeId}, "${current.jobId}")`
      : `game:GetService("TeleportService"):Teleport(${current.placeId})`

    clipboard.writeText(script)
    return ok()
  },

  'activity:openGamePage': async () => {
    const current = activity.currentActivity().activity
    if (!current) return failed('You are not in an experience')

    const opened = await openExternal(`https://www.roblox.com/games/${current.placeId}`)
    return opened ? ok() : failed('That link is not allowed')
  }
}

/** Wraps a handler so validation and unexpected errors are logged and typed. */
function wrap<C extends InvokeChannel>(channel: C, handler: Handler<C>) {
  return async (event: IpcMainInvokeEvent, request: unknown): Promise<unknown> => {
    try {
      return await handler(request as InvokeMap[C]['request'], event)
    } catch (error) {
      if (error instanceof ValidationError) {
        logger.warn(`${channel}: ${error.message}`)
        throw error
      }

      const message = error instanceof Error ? error.message : String(error)
      logger.error(`${channel} failed: ${message}`)
      throw new Error(message)
    }
  }
}

function register<C extends InvokeChannel>(channel: C): void {
  const handler = handlers[channel] as Handler<C> | undefined

  if (typeof handler !== 'function') {
    throw new Error(`No IPC handler implemented for channel "${channel}"`)
  }

  ipcMain.handle(channel, wrap(channel, handler))
}

/** Registers every channel declared in the shared contract. */
export function registerIpcHandlers(): void {
  for (const channel of INVOKE_CHANNELS) {
    // The per-channel types are correlated but TypeScript widens them to a
    // union across the loop, so narrow through a single-channel generic.
    register(channel)
  }

  logger.info(`Registered ${INVOKE_CHANNELS.length} IPC handlers`)
}

/** Removes every handler; used when the app is quitting. */
export function disposeIpcHandlers(): void {
  for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel)
}

/** Re-export so the app layer can react to settings-driven RPC changes. */
