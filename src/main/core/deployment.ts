import { createLogger } from '../utils/logger'
import { getJson, getText, testConnection } from '../services/http'

/**
 * Roblox deployment system.
 *
 * Mirrors the stock bootstrapper: resolve the latest version GUID from the
 * client-version API, then fetch manifests/packages from a CDN base URL. The
 * balanced CDN is preferred, with the documented mirrors used as redundancy.
 */

const logger = createLogger('Deployment')

/** Ordered by preference; the balancer first, then the individual mirrors. */
export const BASE_URLS = [
  'https://setup.rbxcdn.com',
  'https://setup-aws.rbxcdn.com',
  'https://setup-ak.rbxcdn.com',
  'https://setup-cfly.rbxcdn.com',
  'https://roblox-setup.cachefly.net',
  'https://s3.amazonaws.com/setup.roblox.com'
] as const

const CLIENT_SETTINGS_HOSTS = [
  'https://clientsettingscdn.roblox.com',
  'https://clientsettings.roblox.com'
] as const

export type BinaryType = 'WindowsPlayer' | 'WindowsStudio64'

export interface ClientVersion {
  version: string
  clientVersionUpload: string
  bootstrapperVersion: string | null
}

export interface DeploymentTarget {
  baseUrl: string
  channel: string
  versionGuid: string
}

let cachedBaseUrl: string | null = null

/** Finds the fastest reachable CDN base URL, caching the result. */
export async function resolveBaseUrl(force = false): Promise<string> {
  if (cachedBaseUrl && !force) return cachedBaseUrl

  for (const base of BASE_URLS) {
    logger.info(`Testing connection to '${base}'`)
    if (await testConnection(`${base}/version`)) {
      logger.info(`Got ${base} as the optimal base URL`)
      cachedBaseUrl = base
      return base
    }
  }

  throw new Error(
    'Unable to reach any Roblox deployment CDN. Check your internet connection, VPN or firewall.'
  )
}

/**
 * Channel-aware URL prefix. The LIVE/production channel lives at the root of
 * the CDN, every other channel is namespaced under /channel/<name>.
 */
export function channelPath(baseUrl: string, channel: string): string {
  const normalised = channel.trim()
  if (normalised.length === 0 || /^(live|production)$/i.test(normalised)) return baseUrl
  return `${baseUrl}/channel/${normalised.toLowerCase()}`
}

function clientVersionUrl(host: string, binaryType: BinaryType, channel: string): string {
  const normalised = channel.trim()
  if (normalised.length === 0 || /^(live|production)$/i.test(normalised)) {
    return `${host}/v2/client-version/${binaryType}`
  }
  return `${host}/v2/client-version/${binaryType}/channel/${normalised}`
}

/** Fetches the latest client version metadata for a binary type/channel. */
export async function getLatestClientVersion(
  binaryType: BinaryType,
  channel: string,
  signal?: AbortSignal
): Promise<ClientVersion> {
  let lastError: unknown = null

  for (const host of CLIENT_SETTINGS_HOSTS) {
    const url = clientVersionUrl(host, binaryType, channel)
    try {
      logger.info(`GET ${url}`)
      const payload = await getJson<{
        version?: string
        clientVersionUpload?: string
        bootstrapperVersion?: string
      }>(url, { signal, retries: 1 })

      if (!payload?.clientVersionUpload) {
        throw new Error('Response did not include clientVersionUpload')
      }

      return {
        version: payload.version ?? payload.clientVersionUpload,
        clientVersionUpload: payload.clientVersionUpload,
        bootstrapperVersion: payload.bootstrapperVersion ?? null
      }
    } catch (error) {
      lastError = error
      logger.warn(`Client version lookup failed on ${host}: ${String(error)}`)
    }
  }

  // Last resort: the CDN's plain /version file always holds the LIVE GUID.
  try {
    const base = await resolveBaseUrl()
    const guid = (await getText(`${channelPath(base, channel)}/version`, { signal })).trim()
    if (/^version-[0-9a-f]+$/i.test(guid)) {
      logger.info(`Fell back to ${base}/version -> ${guid}`)
      return { version: guid, clientVersionUpload: guid, bootstrapperVersion: null }
    }
  } catch (error) {
    logger.warn(`Fallback version lookup failed: ${String(error)}`)
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Unable to determine the latest Roblox version')
}

export interface PackageEntry {
  name: string
  signature: string
  packedSize: number
  size: number
}

/**
 * Parses rbxPkgManifest.txt.
 *
 * Format: a version line ("v0"), then repeating groups of four lines —
 * file name, MD5 checksum, compressed size, uncompressed size.
 */
export function parsePackageManifest(content: string): PackageEntry[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) throw new Error('Package manifest is empty')

  const version = lines[0]
  if (!/^v\d+$/i.test(version)) {
    throw new Error(`Unexpected package manifest version line: "${version}"`)
  }

  const packages: PackageEntry[] = []

  for (let i = 1; i + 3 < lines.length; i += 4) {
    const name = lines[i]
    const signature = lines[i + 1]
    const packedSize = Number.parseInt(lines[i + 2] ?? '', 10)
    const size = Number.parseInt(lines[i + 3] ?? '', 10)

    if (!name || !signature) break
    if (!Number.isFinite(packedSize) || !Number.isFinite(size)) continue

    packages.push({ name, signature, packedSize, size })
  }

  if (packages.length === 0) throw new Error('Package manifest did not contain any packages')
  return packages
}

export async function getPackageManifest(
  target: DeploymentTarget,
  signal?: AbortSignal
): Promise<PackageEntry[]> {
  const url = `${channelPath(target.baseUrl, target.channel)}/${target.versionGuid}-rbxPkgManifest.txt`
  logger.info(`GET ${url}`)
  const content = await getText(url, { signal, timeoutMs: 30_000 })
  const packages = parsePackageManifest(content)
  logger.info(`Manifest lists ${packages.length} package(s)`)
  return packages
}

export function packageUrl(target: DeploymentTarget, packageName: string): string {
  return `${channelPath(target.baseUrl, target.channel)}/${target.versionGuid}-${packageName}`
}

/**
 * Package -> extraction directory map, taken from the stock bootstrapper's
 * hardcoded table (see Bloxstrap's PackageMap.cs). Paths are relative to the
 * version directory; an empty string means the version root.
 */
const COMMON_PACKAGES: Record<string, string> = {
  'Libraries.zip': '',
  'shaders.zip': 'shaders',
  'ssl.zip': 'ssl',
  'WebView2.zip': '',
  'WebView2RuntimeInstaller.zip': 'WebView2RuntimeInstaller',
  'content-avatar.zip': 'content/avatar',
  'content-configs.zip': 'content/configs',
  'content-fonts.zip': 'content/fonts',
  'content-sky.zip': 'content/sky',
  'content-sounds.zip': 'content/sounds',
  'content-textures2.zip': 'content/textures',
  'content-models.zip': 'content/models',
  'content-textures3.zip': 'PlatformContent/pc/textures',
  'content-terrain.zip': 'PlatformContent/pc/terrain',
  'content-platform-fonts.zip': 'PlatformContent/pc/fonts',
  'content-platform-dictionaries.zip': 'PlatformContent/pc/shared_compression_dictionaries',
  'extracontent-luapackages.zip': 'ExtraContent/LuaPackages',
  'extracontent-translations.zip': 'ExtraContent/translations',
  'extracontent-models.zip': 'ExtraContent/models',
  'extracontent-textures.zip': 'ExtraContent/textures',
  'extracontent-places.zip': 'ExtraContent/places'
}

const PLAYER_PACKAGES: Record<string, string> = {
  'RobloxApp.zip': ''
}

const STUDIO_PACKAGES: Record<string, string> = {
  'RobloxStudio.zip': '',
  'ApplicationConfig.zip': 'ApplicationConfig',
  'content-studio_svg_textures.zip': 'content/studio_svg_textures',
  'content-qt_translations.zip': 'content/qt_translations',
  'content-api-docs.zip': 'content/api_docs',
  'extracontent-scripts.zip': 'ExtraContent/scripts',
  'BuiltInPlugins.zip': 'BuiltInPlugins',
  'BuiltInStandalonePlugins.zip': 'BuiltInStandalonePlugins',
  'LibrariesQt5.zip': '',
  'Plugins.zip': 'Plugins',
  'Qml.zip': 'Qml',
  'StudioFonts.zip': 'StudioFonts',
  'redist.zip': ''
}

export function packageDirectoryMap(binaryType: BinaryType): Record<string, string> {
  return binaryType === 'WindowsStudio64'
    ? { ...COMMON_PACKAGES, ...STUDIO_PACKAGES }
    : { ...COMMON_PACKAGES, ...PLAYER_PACKAGES }
}

/**
 * WebView2RuntimeInstaller is only extracted when the runtime is missing, so
 * it is excluded from the normal package set.
 */
export const CONDITIONAL_PACKAGES = new Set(['WebView2RuntimeInstaller.zip'])

export function executableName(binaryType: BinaryType): string {
  return binaryType === 'WindowsStudio64' ? 'RobloxStudioBeta.exe' : 'RobloxPlayerBeta.exe'
}

export function processName(binaryType: BinaryType): string {
  return binaryType === 'WindowsStudio64' ? 'RobloxStudioBeta' : 'RobloxPlayerBeta'
}

export function binaryTypeFor(mode: 'player' | 'studio'): BinaryType {
  return mode === 'studio' ? 'WindowsStudio64' : 'WindowsPlayer'
}

/** AppSettings.xml content written next to the client, as Roblox expects. */
export function appSettingsXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Settings>',
    '\t<ContentFolder>content</ContentFolder>',
    '\t<BaseUrl>http://www.roblox.com</BaseUrl>',
    '</Settings>',
    ''
  ].join('\r\n')
}
