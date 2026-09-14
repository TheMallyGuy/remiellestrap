import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { release } from 'os'
import { join } from 'path'
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
  CommunityInstallRequest,
  CursorSetRequest,
  FileReplacementRequest,
  FlagAllowlistRequest,
  FlagPresetApplyRequest,
  GameDetailsRequest,
  GameListRequest,
  GameSearchRequest,
  JoinAsRequest,
  LaunchRequest,
  LogReadRequest,
  ModTargetRequest,
  OperationResult,
  RichModRequest,
  SaveProfileRequest,
  ServerJoinRequest,
  ServerListRequest,
  ShortcutRequest,
  StrapImportRequest,
  SystemInfo,
  VersionActionRequest
} from '@shared/models'
import type { AppSettings, BooruProvider, CleanerCategory, WindowEffect } from '@shared/settings'
import type { UiState } from '@shared/state'
import { paths, stockRobloxRoot } from '../utils/paths'
import { createLogger, currentLogFile } from '../utils/logger'
import { ensureDir, formatBytes } from '../utils/fs'
import { openExternal } from '../app/csp'
import { applyEffect, effectState, fontCatalog, importBackground, importFont } from '../app/effects'
import { navigateTo, showMainWindow } from '../app/window'
import * as settingsStore from '../services/settingsStore'
import * as stateStore from '../services/stateStore'
import * as booru from '../services/booru'
import * as fastflags from '../services/fastflags'
import * as mods from '../services/mods'
import * as servers from '../services/servers'
import * as accounts from '../services/accounts'
import * as cleaner from '../services/cleaner'
import * as clientSettings from '../services/clientSettings'
import * as logs from '../services/logs'
import * as playtime from '../services/playtime'
import * as tweaks from '../services/tweaks'
import * as shortcuts from '../services/shortcuts'
import * as backup from '../services/backup'
import * as straps from '../services/straps'
import * as studio from '../services/studio'
import * as rpc from '../services/rpc'
import * as activity from '../services/activity'
import * as appUpdater from '../services/appUpdater'
import * as bootstrapper from '../core/bootstrapper'
import * as channels from '../core/channels'
import * as versions from '../services/versionManager'
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
 *
 * The rule for this file: it validates, delegates, and converts failures into
 * either an `OperationResult` or a thrown `Error`. Domain logic lives in
 * `src/main/services`, never here.
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

/** Narrows an untrusted provider string to a board id, or rejects it. */
function coerceBooruProvider(value: string | undefined): BooruProvider | undefined {
  if (value === undefined) return undefined
  if (value === 'safebooru' || value === 'danbooru') return value
  throw new ValidationError('The image board must be safebooru or danbooru')
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
    const patch = requireObject(request, 'settings') as unknown as Partial<AppSettings>
    return settingsStore.saveSettings(patch)
  },

  'settings:reset': async () => settingsStore.resetSettings(),

  'settings:export': async (_request, event) => {
    const result = await saveDialog(windowFor(event), {
      title: 'Export RemielleStrap settings',
      defaultPath: 'RemielleStrap-Settings.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (result.canceled || !result.filePath) return failed('Export cancelled')

    try {
      await settingsStore.exportSettingsTo(result.filePath)
      return ok(result.filePath)
    } catch (error) {
      return failed(error instanceof Error ? error.message : 'Settings could not be exported')
    }
  },

  'settings:import': async (_request, event) => {
    const result = await openDialog(windowFor(event), {
      title: 'Import RemielleStrap settings',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return failed('Import cancelled')

    try {
      return ok(await settingsStore.importSettingsFrom(result.filePaths[0]))
    } catch (error) {
      return failed(error instanceof Error ? error.message : 'Settings could not be imported')
    }
  },

  /* ------------------------------------------------- persisted UI state */

  'state:getUi': async () => stateStore.getState().ui,

  'state:saveUi': async (request) => {
    const patch = requireObject(request, 'ui state') as unknown as Partial<UiState>
    const current = stateStore.getState().ui

    const next: UiState = {
      openSections: Array.isArray(patch.openSections)
        ? requireStringArray(patch.openSections, 'openSections', 200).map((value) =>
            value.slice(0, 80)
          )
        : current.openSections,
      tabs:
        patch.tabs && typeof patch.tabs === 'object'
          ? Object.fromEntries(
              Object.entries(patch.tabs)
                .slice(0, 40)
                .map(([key, value]) => [key.slice(0, 40), String(value).slice(0, 40)])
            )
          : current.tabs,
      scroll:
        patch.scroll && typeof patch.scroll === 'object'
          ? Object.fromEntries(
              Object.entries(patch.scroll)
                .slice(0, 40)
                .map(([key, value]) => [key.slice(0, 40), Math.max(0, Number(value) || 0)])
            )
          : current.scroll
    }

    await stateStore.saveState({ ui: next })
    return next
  },

  'onboarding:complete': async () => stateStore.saveState({ onboardingComplete: true }),

  /* ---------------------------------------------------------- accounts */

  'accounts:get': async () => accounts.state(),

  'accounts:list': async () => accounts.listAccounts(),

  'accounts:addFromCookie': async (request) => {
    const raw = requireObject(request, 'account')
    const cookie = requireNonEmptyString(raw.cookie, 'cookie', 8192)
    const notes = optionalString(raw.notes, 'notes', 500)

    return accounts.addFromCookie({ cookie, notes })
  },

  'accounts:browserLogin': async (request) => {
    const raw = (request ?? {}) as { timeoutSeconds?: unknown; mode?: unknown }
    const timeoutSeconds = optionalInteger(raw.timeoutSeconds, 'timeoutSeconds', 30, 900)
    const mode = raw.mode === 'quick' ? ('quick' as const) : ('login' as const)

    return accounts.browserLogin({ timeoutSeconds, mode })
  },

  'accounts:reauthenticate': async (request) => {
    const raw = requireObject(request, 'account')
    return accounts.reauthenticate(requireNonEmptyString(raw.id, 'id', 64))
  },

  'accounts:remove': async (request) => {
    const raw = requireObject(request, 'account')
    return accounts.remove(requireNonEmptyString(raw.id, 'id', 64))
  },

  'accounts:setActive': async (request) => {
    const raw = requireObject(request, 'account')
    const id = raw.id === null ? null : requireNonEmptyString(raw.id, 'id', 64)

    return accounts.setActive(id)
  },

  'accounts:refresh': async (request) => {
    const raw = (request ?? {}) as { id?: unknown; profile?: unknown }
    const id = optionalString(raw.id, 'id', 64)
    const profile = optionalBoolean(raw.profile, 'profile') ?? false

    return accounts.refresh({ id, profile })
  },

  'accounts:getProfile': async (request) => {
    const raw = requireObject(request, 'profile')
    return accounts.profile(
      requireNonEmptyString(raw.accountId, 'accountId', 64),
      optionalBoolean(raw.refresh, 'refresh') ?? false
    )
  },

  'accounts:getFriends': async (request) => {
    const raw = requireObject(request, 'friends')
    return accounts.friends(
      requireNonEmptyString(raw.accountId, 'accountId', 64),
      optionalBoolean(raw.refresh, 'refresh') ?? false
    )
  },

  'accounts:searchGames': async (request) => {
    const raw = requireObject(request, 'search') as unknown as GameSearchRequest
    const query = requireString(raw.query, 'query', 200).trim()

    if (query.length === 0) return failed('Type something to search for')

    return accounts.searchGames({ query, limit: optionalInteger(raw.limit, 'limit', 1, 50) })
  },

  'accounts:getGameDetails': async (request) => {
    const raw = requireObject(request, 'game') as unknown as GameDetailsRequest
    const universeId = optionalInteger(raw.universeId, 'universeId', 1)
    const placeId = optionalInteger(raw.placeId, 'placeId', 1)

    if (!universeId && !placeId) return failed('A universe or place id is required')

    return accounts.gameDetailsByRef({ universeId, placeId })
  },

  'accounts:getGameList': async (request) => {
    const raw = requireObject(request, 'list') as unknown as GameListRequest
    const kind = raw.kind

    if (kind !== 'continue-playing' && kind !== 'favorites' && kind !== 'recommendations') {
      return failed('Unknown list type')
    }

    return accounts.gameList({
      accountId: requireNonEmptyString(raw.accountId, 'accountId', 64),
      kind,
      limit: optionalInteger(raw.limit, 'limit', 1, 50)
    })
  },

  'accounts:joinAs': async (request) => {
    const raw = requireObject(request, 'join') as unknown as JoinAsRequest
    const placeId = optionalString(raw.placeId, 'placeId', 32)
    const universeId = optionalInteger(raw.universeId, 'universeId', 1)
    const serverId = optionalString(raw.serverId, 'serverId', 64)
    const accessCode = optionalString(raw.accessCode, 'accessCode', 64)
    const accountId = optionalString(raw.accountId ?? undefined, 'accountId', 64)

    if (!placeId && !universeId) {
      return { ok: false, version: null, launched: false, message: 'A place id is required' }
    }

    try {
      const resolved = await accounts.resolveJoinUri({
        placeId: placeId ?? undefined,
        universeId,
        serverId,
        accessCode,
        accountId
      })

      const result = await bootstrapper.run({
        launch: true,
        rawUri: resolved.uri,
        accountId: resolved.accountId
      })

      return {
        ...result,
        message: resolved.accountName
          ? `${result.message} as ${resolved.accountName}`
          : result.message
      }
    } catch (error) {
      return {
        ok: false,
        version: null,
        launched: false,
        message: error instanceof Error ? error.message : 'The join could not be started'
      }
    }
  },

  'accounts:updateNotes': async (request) => {
    const raw = requireObject(request, 'notes')
    return accounts.updateNotes(
      requireNonEmptyString(raw.id, 'id', 64),
      requireString(raw.notes, 'notes', 500)
    )
  },

  /* ----------------------------------------------------------- servers */

  'servers:list': async (request) => {
    const raw = (request ?? {}) as ServerListRequest
    return servers.listServers({
      placeId: optionalString(raw.placeId, 'placeId', 32),
      universeId: optionalInteger(raw.universeId, 'universeId', 1),
      sort: raw.sort,
      region: optionalString(raw.region, 'region', 40),
      size: raw.size,
      refresh: optionalBoolean(raw.refresh, 'refresh') ?? false,
      limit: optionalInteger(raw.limit, 'limit', 10, 100)
    })
  },

  'servers:join': async (request) => {
    const raw = requireObject(request, 'join') as unknown as ServerJoinRequest
    return servers.joinServer({
      placeId: requireNonEmptyString(raw.placeId, 'placeId', 32),
      serverId: optionalString(raw.serverId, 'serverId', 64) ?? undefined,
      accountId: optionalString(raw.accountId ?? undefined, 'accountId', 64) ?? null,
      region: optionalString(raw.region, 'region', 40),
      size: raw.size,
      sort: raw.sort,
      force: optionalBoolean(raw.force, 'force') ?? true
    })
  },

  'servers:ping': async (request) => {
    const raw = requireObject(request, 'ping')
    const placeId = requireNonEmptyString(raw.placeId, 'placeId', 32)

    const list = Array.isArray(raw.servers) ? raw.servers.slice(0, 100) : []
    const targets = list
      .filter(
        (entry): entry is { id: string; datacenter: string | null } =>
          Boolean(entry) && typeof (entry as { id?: unknown }).id === 'string'
      )
      .map((entry) => ({
        id: entry.id.slice(0, 64),
        datacenter: typeof entry.datacenter === 'string' ? entry.datacenter.slice(0, 40) : null
      }))

    return servers.pingServers(placeId, targets)
  },

  /* ------------------------------------------------------ bootstrapper */

  'bootstrapper:checkUpdate': async () => bootstrapper.checkForUpdates(),

  'bootstrapper:install': async (request) => {
    const raw = (request ?? {}) as { force?: unknown }
    return bootstrapper.install(optionalBoolean(raw.force, 'force') ?? false)
  },

  'bootstrapper:launch': async (request) => {
    const raw = (request ?? {}) as LaunchRequest
    const uri = optionalString(raw.uri, 'uri', 4096)

    if (uri && !/^roblox(-player)?:/i.test(uri)) {
      return {
        ok: false,
        version: null,
        launched: false,
        message: 'That is not a Roblox launch link'
      }
    }

    return bootstrapper.launch({
      uri,
      mode: raw.mode === 'studio' ? 'studio' : 'player',
      force: optionalBoolean(raw.force, 'force') ?? false,
      accountId: optionalString(raw.accountId ?? undefined, 'accountId', 64) ?? null
    })
  },

  'bootstrapper:cancel': async () => (bootstrapper.cancel() ? ok() : failed('Nothing is running')),

  'bootstrapper:forceReinstall': async () => bootstrapper.forceReinstall(),

  'bootstrapper:getProgress': async () => bootstrapper.currentProgress(),

  'bootstrapper:getPendingUri': async () => takePendingUri(),

  'bootstrapper:killRoblox': async () => {
    const killed = await activity.killRoblox()
    return killed ? ok() : failed('Roblox is not running (or could not be closed)')
  },

  'bootstrapper:applyNow': async () => mods.applyNow(),

  /* ------------------------------------------------- channels / versions */

  'channels:list': async (request) => {
    const raw = (request ?? {}) as { refresh?: unknown }
    return channels.listChannels({ refresh: optionalBoolean(raw.refresh, 'refresh') ?? false })
  },

  'channels:set': async (request) => {
    const raw = requireObject(request, 'channel')
    return channels.setChannel(requireNonEmptyString(raw.name, 'name', 40))
  },

  'versions:list': async () => versions.list(),

  'versions:setCurrent': async (request) => {
    const raw = requireObject(request, 'version') as unknown as VersionActionRequest
    return versions.setCurrent({
      versionHash: requireNonEmptyString(raw.versionHash, 'versionHash', 80),
      appType: raw.appType
    })
  },

  'versions:delete': async (request) => {
    const raw = requireObject(request, 'version') as unknown as VersionActionRequest
    return versions.remove({
      versionHash: requireNonEmptyString(raw.versionHash, 'versionHash', 80),
      appType: raw.appType
    })
  },

  'versions:downgrade': async (request) => {
    const raw = requireObject(request, 'version') as unknown as VersionActionRequest
    const target = requireNonEmptyString(raw.versionHash, 'versionHash', 80)

    // Explicit target, or the previous install when the renderer just says
    // "go back one".
    if (/^version-[0-9a-f]{16,}$/i.test(target)) {
      return versions.installSpecific(target, raw.appType === 'studio' ? 'studio' : 'player')
    }

    const previous = await versions.previousVersion()
    if (!previous) {
      return {
        ok: false,
        version: null,
        launched: false,
        message: 'There is no earlier version to go back to'
      }
    }

    return versions.installSpecific(previous.versionHash, previous.appType)
  },

  'versions:openFolder': async () => revealDirectory(paths.versions),

  /* ------------------------------------------------------------- booru */

  'booru:search': async (request) => {
    const raw = requireObject(request, 'search') as unknown as BooruSearchRequest
    const provider = coerceBooruProvider(optionalString(raw.provider, 'provider', 20))
    return booru.searchPosts({
      tags: requireString(raw.tags, 'tags', 400),
      // Board pages are 0-based (`pid` on Safebooru, mapped to 1-based for Danbooru).
      page: optionalInteger(raw.page, 'page', 0, 100),
      limit: optionalInteger(raw.limit, 'limit', 1, 100),
      provider
    })
  },

  'booru:getArtForSlot': async (request) => {
    const raw = requireObject(request, 'art') as unknown as ArtRequest
    return booru.getArtForSlot({
      slot: requireNonEmptyString(raw.slot, 'slot', 40),
      shuffle: optionalBoolean(raw.shuffle, 'shuffle') ?? false,
      tags: optionalString(raw.tags, 'tags', 400)
    })
  },

  'booru:clearCache': async () => booru.clearCache(),

  'booru:getCacheStats': async () => booru.getCacheStats(),

  'booru:openPost': async (request) => {
    const raw = requireObject(request, 'post')
    const postId = requireInteger(raw.postId, 'postId', 1, 100_000_000)
    const source = coerceBooruProvider(optionalString(raw.source, 'source', 20))
    const opened = await openExternal(booru.postUrlFor(postId, source))
    return opened ? ok() : failed('That link is not allowed')
  },

  /* --------------------------------------------------------- fastflags */

  'fastflags:getProfiles': async () => fastflags.getProfiles(),

  'fastflags:saveProfile': async (request) => {
    const raw = requireObject(request, 'profile') as unknown as SaveProfileRequest
    const flags = requireObject(raw.flags, 'flags') as Record<string, unknown>

    return fastflags.saveProfile({
      name: requireNonEmptyString(raw.name, 'name', 64),
      flags: fastflags.sanitizeFlags(flags),
      setActive: optionalBoolean(raw.setActive, 'setActive') ?? false
    })
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
    const raw = (request ?? {}) as { name?: unknown }
    return fastflags.importFromJson(optionalString(raw.name, 'name', 64))
  },

  'fastflags:exportJson': async (request) => {
    const raw = requireObject(request, 'profile')
    return fastflags.exportToJson(requireNonEmptyString(raw.name, 'name', 64))
  },

  'fastflags:preview': async () => fastflags.effectiveFlags(),

  'fastflags:allowlist': async (request) => {
    const raw = (request ?? {}) as FlagAllowlistRequest
    return fastflags.allowlist({ refresh: optionalBoolean(raw.refresh, 'refresh') ?? false })
  },

  'fastflags:audit': async (request) => {
    const raw = (request ?? {}) as { name?: unknown }
    return fastflags.audit(optionalString(raw.name, 'name', 64))
  },

  'fastflags:clean': async (request) => {
    const raw = (request ?? {}) as { name?: unknown; dryRun?: unknown }
    return fastflags.clean({
      name: optionalString(raw.name, 'name', 64),
      dryRun: optionalBoolean(raw.dryRun, 'dryRun') ?? false
    })
  },

  'fastflags:presets': async () => fastflags.presets(),

  'fastflags:applyPreset': async (request) => {
    const raw = requireObject(request, 'preset') as unknown as FlagPresetApplyRequest

    return fastflags.applyPreset({
      presetId: requireNonEmptyString(raw.presetId, 'presetId', 64),
      profile: optionalString(raw.profile, 'profile', 64),
      replace: optionalBoolean(raw.replace, 'replace') ?? false
    })
  },

  /* -------------------------------------------------------------- mods */

  'mods:list': async () => mods.listMods(),

  'mods:importZip': async () => mods.importZip(),

  'mods:importFolder': async () => mods.importFolder(),

  'mods:toggle': async (request) => {
    const raw = requireObject(request, 'mod')
    return mods.toggleMod(
      requireNonEmptyString(raw.id, 'id', 80),
      requireBoolean(raw.enabled, 'enabled')
    )
  },

  'mods:delete': async (request) => {
    const raw = requireObject(request, 'mod')
    return mods.deleteMod(requireNonEmptyString(raw.id, 'id', 80))
  },

  'mods:reorder': async (request) => {
    const raw = requireObject(request, 'mods')
    return mods.reorderMods(requireStringArray(raw.ids, 'ids', 500))
  },

  'mods:openFolder': async (request) => {
    const raw = (request ?? {}) as { id?: unknown }
    return mods.openModsFolder(optionalString(raw.id, 'id', 80))
  },

  'mods:generateColorMod': async (request) => {
    const raw = requireObject(request, 'mod') as unknown as ColorModRequest

    return mods.generateColorMod({
      name: requireNonEmptyString(raw.name, 'name', 80),
      color: requireHexColor(raw.color, 'color'),
      accent: raw.accent ? requireHexColor(raw.accent, 'accent') : undefined
    })
  },

  'mods:setTarget': async (request) => {
    const raw = requireObject(request, 'mod') as unknown as ModTargetRequest
    const target = raw.target

    if (target !== 'player' && target !== 'studio' && target !== 'both') {
      throw new ValidationError('The mod target must be player, studio or both')
    }

    return mods.setTarget(requireNonEmptyString(raw.id, 'id', 80), target)
  },

  'mods:generateRichMod': async (request) => {
    const raw = requireObject(request, 'mod') as unknown as RichModRequest

    return mods.generateRichMod({
      name: requireNonEmptyString(raw.name, 'name', 80),
      color: requireHexColor(raw.color, 'color'),
      accent: requireHexColor(raw.accent, 'accent'),
      gradientTo: raw.gradientTo ? requireHexColor(raw.gradientTo, 'gradientTo') : null,
      targets: {
        uiSurfaces: Boolean(raw.targets?.uiSurfaces),
        cursor: Boolean(raw.targets?.cursor),
        shiftLock: Boolean(raw.targets?.shiftLock),
        emoteWheel: Boolean(raw.targets?.emoteWheel),
        voiceChat: Boolean(raw.targets?.voiceChat)
      },
      target: raw.target === 'studio' || raw.target === 'both' ? raw.target : 'player',
      cursorImage: optionalString(raw.cursorImage, 'cursorImage', 1024) ?? null,
      shiftLockImage: optionalString(raw.shiftLockImage, 'shiftLockImage', 1024) ?? null
    })
  },

  'mods:replaceFile': async (request) => {
    const raw = requireObject(request, 'replacement') as unknown as FileReplacementRequest
    const target = raw.target === 'studio' || raw.target === 'both' ? raw.target : 'player'

    return mods.replaceFile({
      slot: requireNonEmptyString(raw.slot, 'slot', 40),
      name: optionalString(raw.name, 'name', 80),
      target
    })
  },

  'mods:createCursorSet': async (request) => {
    const raw = requireObject(request, 'cursor set') as unknown as CursorSetRequest
    const target = raw.target === 'studio' || raw.target === 'both' ? raw.target : 'player'
    const cursor = await pickFile(null, 'Choose the cursor image', ['png'])

    if (!cursor) return failed('No cursor image was chosen')

    const farCursor = raw.farCursor ? optionalString(raw.farCursor, 'farCursor', 1024) : undefined

    return mods.createCursorSet({
      name: requireNonEmptyString(raw.name, 'name', 80),
      cursor,
      farCursor: farCursor ?? cursor,
      target
    })
  },

  'mods:communityIndex': async (request) => {
    const raw = (request ?? {}) as { refresh?: unknown; query?: unknown }

    return mods.communityIndex({
      refresh: optionalBoolean(raw.refresh, 'refresh') ?? false,
      query: optionalString(raw.query, 'query', 120)
    })
  },

  'mods:installCommunity': async (request) => {
    const raw = requireObject(request, 'install') as unknown as CommunityInstallRequest
    const ids = requireStringArray(raw.ids, 'ids', 50)
    const target = raw.target === 'studio' || raw.target === 'both' ? raw.target : undefined

    return mods.installCommunity({ ids, target })
  },

  'mods:conflicts': async () => mods.conflicts(),

  'mods:applyNow': async () => mods.applyNow(),

  /* ----------------------------------------------------------- cleaner */

  'cleaner:scan': async (request) => {
    const raw = (request ?? {}) as { targets?: unknown }
    const targets = Array.isArray(raw.targets) ? (raw.targets as CleanerCategory[]) : undefined
    return cleaner.scan({ targets })
  },

  'cleaner:run': async (request) => {
    const raw = requireObject(request, 'clean')
    const targets = requireStringArray(raw.targets, 'targets', 20) as CleanerCategory[]

    if (targets.length === 0) throw new ValidationError('Choose at least one thing to clean')

    return cleaner.run({ targets, dryRun: optionalBoolean(raw.dryRun, 'dryRun') ?? false })
  },

  'cleaner:history': async () => cleaner.history(),

  /* -------------------------------------------------------------- logs */

  'logs:list': async () => logs.listLogFiles(),

  'logs:read': async (request) => {
    const raw = (request ?? {}) as LogReadRequest
    const path = optionalString(raw.path, 'path', 2048)
    const filter = optionalString(raw.filter, 'filter', 120)
    const tailLines = optionalInteger(raw.tailLines, 'tailLines', 1, 5000)

    if (raw.follow) return logs.follow({ path, filter, tailLines })
    return logs.readLog({ path, filter, tailLines })
  },

  'logs:events': async (request) => {
    const raw = (request ?? {}) as { path?: unknown; tailLines?: unknown }
    return logs.clientEvents({
      path: optionalString(raw.path, 'path', 2048),
      tailLines: optionalInteger(raw.tailLines, 'tailLines', 1, 5000)
    })
  },

  'logs:unfollow': async () => {
    logs.unfollow()
    return ok()
  },

  /* ---------------------------------------------------- client settings */

  'clientSettings:read': async () => clientSettings.readClientSettings(),

  'clientSettings:write': async (request) => {
    const raw = requireObject(request, 'client settings')
    const values = requireObject(raw.values, 'values') as Record<string, unknown>

    // Only primitive values are accepted; the service ignores anything unknown.
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values).slice(0, 40)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        patch[key.slice(0, 64)] = value
      }
    }

    const result = await clientSettings.writeClientSettings(patch)
    return result
  },

  /* ---------------------------------------------------- app updates */

  'app:getUpdateState': async () => appUpdater.getUpdateState(),

  'app:checkForUpdates': async () => appUpdater.checkForAppUpdates(),

  'app:downloadUpdate': async () => appUpdater.downloadAppUpdate(),

  'app:restartToUpdate': async () => appUpdater.restartAndInstall(),

  /* ------------------------------------------------------------ system */

  'system:getInfo': async () => systemInfo(),

  'system:openLogs': async () => {
    const file = currentLogFile()
    if (file) {
      shell.showItemInFolder(file)
      return ok()
    }
    return revealDirectory(paths.logs)
  },

  'system:openAppData': async () => revealDirectory(paths.root),

  'system:openRobloxDir': async () => revealDirectory(stockRobloxRoot()),

  'system:uninstall': async (request) => {
    const raw = requireObject(request, 'uninstall')
    const keepSettings = requireBoolean(raw.keepSettings, 'keepSettings')

    try {
      await bootstrapper.uninstall(keepSettings)
      return ok()
    } catch (error) {
      return failed(error instanceof Error ? error.message : 'Uninstall failed')
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

  'system:listFonts': async () => fontCatalog(),

  'system:chooseFile': async (request, event) => {
    const raw = (request ?? {}) as { title?: unknown; extensions?: unknown }
    const extensions = Array.isArray(raw.extensions)
      ? raw.extensions
          .filter(
            (value): value is string => typeof value === 'string' && /^[a-z0-9]{1,8}$/i.test(value)
          )
          .slice(0, 10)
      : []

    const result = await openDialog(windowFor(event), {
      title: optionalString(raw.title, 'title', 120) ?? 'Choose a file',
      filters: extensions.length > 0 ? [{ name: 'Supported files', extensions }] : [],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return failed('Selection cancelled')
    return ok(result.filePaths[0])
  },

  'system:chooseImage': async (_request, event) => {
    const result = await openDialog(windowFor(event), {
      title: 'Choose an image',
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp'] }],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return failed('Selection cancelled')

    try {
      // The image is copied into the app's own folder so `app://media` can
      // serve it without the protocol handler having to trust arbitrary paths.
      const stored = await importBackground(result.filePaths[0])
      return ok(stored)
    } catch (error) {
      return failed(error instanceof Error ? error.message : 'That image could not be used')
    }
  },

  'system:chooseFont': async (_request, event) => {
    const result = await openDialog(windowFor(event), {
      title: 'Choose a font file',
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) return failed('Selection cancelled')

    try {
      const imported = await importFont(result.filePaths[0])
      return ok(imported.path)
    } catch (error) {
      return failed(error instanceof Error ? error.message : 'That font could not be loaded')
    }
  },

  'system:revealPath': async (request) => {
    const raw = requireObject(request, 'path')
    const target = requireNonEmptyString(raw.path, 'path', 2048)

    // Only paths the app already owns may be revealed, so a compromised
    // renderer cannot use this to probe the filesystem.
    const allowed = [
      paths.root,
      paths.logs,
      paths.mods,
      paths.downloads,
      paths.versions,
      paths.cache
    ]
    const inside = allowed.some(
      (root) => target === root || target.startsWith(`${root}/`) || target.startsWith(`${root}\\`)
    )

    if (!inside) return failed('That path is outside the app data folder')

    const error = await shell.openPath(target)
    return error ? failed(error) : ok()
  },

  /* ------------------------------------------------------------ window */

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

  'window:getEffect': async () => effectState(),

  'window:setEffect': async (request, event) => {
    const raw = requireObject(request, 'effect')
    const effect = requireNonEmptyString(raw.effect, 'effect', 20) as WindowEffect

    if (!['none', 'auto', 'mica', 'acrylic', 'blur'].includes(effect)) {
      throw new ValidationError('Unknown window material')
    }

    await settingsStore.saveSettings({ windowEffect: effect })
    return applyEffect(windowFor(event) ?? null, effect)
  },

  /* --------------------------------------------------- activity / rpc */

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
      ? `game:GetService("TeleportService"):TeleportToPlaceInstance(${current.placeId}, "${current.jobId}")`
      : `game:GetService("TeleportService"):Teleport(${current.placeId})`

    clipboard.writeText(script)
    return ok()
  },

  'activity:openGamePage': async () => {
    const current = activity.currentActivity().activity
    if (!current) return failed('You are not in an experience')

    const opened = await openExternal(`https://www.roblox.com/games/${current.placeId}`)
    return opened ? ok() : failed('That link is not allowed')
  },

  'rpc:get': async () => rpc.currentRpc(),

  'rpc:setPage': async (request) => {
    const raw = requireObject(request, 'page')
    const page = requireNonEmptyString(raw.page, 'page', 40)
    rpc.setPage(page, optionalString(raw.label, 'label', 60) ?? null)
  },

  'playtime:summary': async () => playtime.summary(),

  'playtime:reset': async () => playtime.reset(),

  /* ----------------------------------------------------- studio bridge */

  'studio:getBridge': async () => studio.bridgeInfo(),

  'studio:installPlugin': async () => studio.installPlugin(),

  /* --------------------------------------------------------- utilities */

  'shortcuts:create': async (request) => {
    const raw = requireObject(request, 'shortcut') as unknown as ShortcutRequest

    if (!Array.isArray(raw.locations) || raw.locations.length === 0) {
      throw new ValidationError('Choose where the shortcut should go')
    }

    return shortcuts.create({
      name: requireNonEmptyString(raw.name, 'name', 80),
      placeId: requireNonEmptyString(raw.placeId, 'placeId', 32),
      accountId: optionalString(raw.accountId ?? undefined, 'accountId', 64) ?? null,
      region: optionalString(raw.region ?? undefined, 'region', 40) ?? null,
      locations: raw.locations.filter((value) => value === 'desktop' || value === 'start-menu')
    })
  },

  'backup:export': async (request) => {
    const raw = requireObject(request, 'backup')

    return backup.exportBackup({
      includeSettings: Boolean(raw.includeSettings),
      includeAccounts: Boolean(raw.includeAccounts),
      includeMods: Boolean(raw.includeMods),
      includeFlags: Boolean(raw.includeFlags),
      includePlaytime: Boolean(raw.includePlaytime),
      password: optionalString(raw.password, 'password', 200) ?? ''
    })
  },

  'backup:import': async (request) => {
    const raw = (request ?? {}) as { password?: unknown }
    const password = optionalString(raw.password, 'password', 200) ?? ''

    const picked = await openDialog(null, {
      title: 'Choose a RemielleStrap backup',
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      properties: ['openFile']
    })

    if (picked.canceled || picked.filePaths.length === 0) return failed('Import cancelled')

    return backup.importBackup(picked.filePaths[0], password)
  },

  'straps:detect': async () => straps.detect(),

  'straps:import': async (request) => {
    const raw = requireObject(request, 'import') as unknown as StrapImportRequest

    if (
      raw.id !== 'bloxstrap' &&
      raw.id !== 'fishstrap' &&
      raw.id !== 'froststrap' &&
      raw.id !== 'remiellestrap'
    ) {
      throw new ValidationError('Unknown bootstrapper')
    }

    return straps.runImport({
      id: raw.id,
      settings: Boolean(raw.settings),
      flagProfiles: Boolean(raw.flagProfiles),
      mods: Boolean(raw.mods)
    })
  },

  'tweaks:getProcessState': async () => tweaks.processState(),

  'tweaks:apply': async (request) => {
    const raw = requireObject(request, 'tweaks')

    const affinity = Array.isArray(raw.affinity)
      ? raw.affinity
          .filter((value): value is number => typeof value === 'number' && value >= 0 && value < 64)
          .slice(0, 64)
      : raw.affinity === null
        ? null
        : undefined

    const priority =
      raw.priority === 'normal' || raw.priority === 'abovenormal' || raw.priority === 'high'
        ? raw.priority
        : undefined

    return tweaks.applyProcessTweaks({
      priority,
      affinity,
      trim: optionalBoolean(raw.trim, 'trim') ?? false
    })
  },

  'tweaks:listPowerPlans': async () => tweaks.listPowerPlans(),

  'tweaks:setPowerPlan': async (request) => {
    const raw = requireObject(request, 'power plan')
    return tweaks.setPowerPlan(requireNonEmptyString(raw.guid, 'guid', 64))
  }
}

/** Opens a native file picker and returns the chosen path, or null. */
async function pickFile(
  parent: BrowserWindow | null,
  title: string,
  extensions: string[]
): Promise<string | null> {
  const result = await openDialog(parent, {
    title,
    filters: [{ name: 'Supported files', extensions }],
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
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
  logs.unfollow()
}

/** Re-exported for the app layer's diagnostics view. */
export { join, formatBytes, showMainWindow, navigateTo }
