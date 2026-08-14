import { app } from 'electron'
import { homedir } from 'os'
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
  get logs(): string {
    return join(dataRoot(), 'Logs')
  },
  get cache(): string {
    return join(dataRoot(), 'Cache')
  },
  get artCache(): string {
    return join(dataRoot(), 'Cache', 'Art')
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
  }
}

/**
 * Where Roblox itself keeps its logs. Only meaningful on Windows; on other
 * platforms we return a best-effort path so code paths stay uniform.
 */
export function robloxLogsDirectory(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, 'Roblox', 'logs')
  }
  return join(homedir(), '.local', 'share', 'Roblox', 'logs')
}

/** The stock Roblox player install root (%LOCALAPPDATA%\Roblox). */
export function stockRobloxRoot(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
    return join(localAppData, 'Roblox')
  }
  return join(homedir(), '.local', 'share', 'Roblox')
}

/** Directory a specific version GUID is installed into. */
export function versionDirectory(installRoot: string, versionGuid: string): string {
  return join(installRoot, 'Versions', versionGuid)
}
