import { app } from 'electron'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

/**
 * Central path resolution. Everything the app writes lives under a single
 * app-data root so that uninstall/reset can reason about it as one tree.
 */

let rootOverride: string | null = null

export function setDataRoot(dir: string): void {
  rootOverride = dir
}

export function dataRoot(): string {
  if (rootOverride) return rootOverride
  // app.getPath('userData') already points at <appData>/RemielleStrap
  return app.getPath('userData')
}

export const paths = {
  get root(): string {
    return dataRoot()
  },
  get settingsFile(): string {
    return join(dataRoot(), 'Settings.json')
  },
  get stateFile(): string {
    return join(dataRoot(), 'State.json')
  },
  get robloxStateFile(): string {
    return join(dataRoot(), 'RobloxState.json')
  },
  get versionsFile(): string {
    return join(dataRoot(), 'versions.json')
  },
  get accountsFile(): string {
    return join(dataRoot(), 'Accounts.json')
  },
  get credentials(): string {
    return join(dataRoot(), 'Credentials')
  },
  get serverCacheFile(): string {
    return join(dataRoot(), 'ServerCache.json')
  },
  get logs(): string {
    return join(dataRoot(), 'Logs')
  },
  get cache(): string {
    return join(dataRoot(), 'Cache')
  },
  /** Background images the user chose, copied here so app:// can serve them. */
  get backgrounds(): string {
    return join(this.cache, 'Background')
  },

  /** Font files the user supplied for the UI. */
  get userFonts(): string {
    return join(this.root, 'Fonts')
  },

  get artCache(): string {
    return join(dataRoot(), 'Cache', 'Art')
  },
  get apiCache(): string {
    return join(dataRoot(), 'Cache', 'Api')
  },
  get communityCache(): string {
    return join(dataRoot(), 'Cache', 'Community')
  },
  get modifications(): string {
    return join(dataRoot(), 'Modifications')
  },
  get clientSettings(): string {
    return join(dataRoot(), 'Modifications', 'ClientSettings')
  },
  get mods(): string {
    return join(dataRoot(), 'Mods')
  },
  get modsIndex(): string {
    return join(dataRoot(), 'Mods', 'index.json')
  },
  get downloads(): string {
    return join(dataRoot(), 'Downloads')
  },
  get versions(): string {
    return join(dataRoot(), 'Versions')
  },
  get backups(): string {
    return join(dataRoot(), 'Backups')
  }
}

/** Local Roblox data directory (`%LOCALAPPDATA%\Roblox` on Windows). */
export function localRobloxRoot(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, 'Roblox')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Roblox')
  }
  return join(homedir(), '.local', 'share', 'Roblox')
}

/**
 * Where Roblox itself keeps its logs. Only meaningful on Windows; on other
 * platforms we return a best-effort path so code paths stay uniform.
 */
export function robloxLogsDirectory(): string {
  return join(localRobloxRoot(), 'logs')
}

/** Where Roblox keeps Studio/user plugins, used by the Studio bridge plugin. */
export function robloxPluginsDirectory(): string {
  return join(localRobloxRoot(), 'Plugins')
}

/** Stock Roblox install root for the "stock" version of the client. */
export function stockRobloxRoot(): string {
  return localRobloxRoot()
}

/** Directories the cleaner knows about that live outside our own tree. */
export const robloxCleanablePaths = {
  get logs(): string {
    return robloxLogsDirectory()
  },
  /** Rotated copies of older client log files. */
  get logsArchive(): string {
    return join(this.logs, 'archive')
  },

  /** Crash handler output directories. */
  get crashDumps(): string {
    return join(this.crashes, 'dumps')
  },

  /** The crash handler's own archive folder. */
  get archives(): string {
    return join(localRobloxRoot(), 'Archives')
  },

  /** Analytics/telemetry files the client may leave behind. */
  get analytics(): string {
    return join(localRobloxRoot(), 'Analytics')
  },

  get crashes(): string {
    return join(robloxLogsDirectory(), 'archive')
  },
  get http(): string {
    return join(localRobloxRoot(), 'http')
  },
  get cache(): string {
    return join(localRobloxRoot(), 'cache')
  },
  get temp(): string {
    return join(tmpdir(), 'Roblox')
  },
  get versions(): string {
    return join(localRobloxRoot(), 'Versions')
  }
}

/** GlobalBasicSettings files, keyed by the client that owns them. */
export function globalBasicSettingsCandidates(): string[] {
  const root = localRobloxRoot()
  return [
    join(root, 'GlobalBasicSettings_13.xml'),
    join(root, 'GlobalBasicSettings_13_Studio.xml'),
    join(root, 'GlobalBasicSettings.xml')
  ]
}
