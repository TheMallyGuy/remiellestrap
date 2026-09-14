import { readdir } from 'fs/promises'
import { basename, join } from 'path'
import type { BootstrapperResult, InstalledVersion, VersionActionRequest } from '@shared/models'
import { createLogger } from '../utils/logger'
import { pathExists, removeDir, sanitizeName } from '../utils/fs'
import { dirStats } from '../utils/fs'
import {
  appSettingsXml,
  binaryTypeFor,
  executableName,
  getLatestClientVersion,
  getPackageManifest,
  packageDirectoryMap,
  resolveBaseUrl,
  type BinaryType
} from '../core/deployment'
import {
  latestEntry,
  loadVersions,
  reindexVersions,
  saveVersion,
  saveVersions,
  type AppType
} from '../core/versions'
import { downloadToFile } from './http'
import { emit } from './events'
import { getSettings } from './settingsStore'
import { getRobloxState, saveRobloxState } from './stateStore'
import { extractZip } from '../utils/zip'
import { md5File } from '../utils/hash'
import { ensureDir, removeFile } from '../utils/fs'
import { paths } from '../utils/paths'

/**
 * The version manager.
 *
 * It lists every install this app has made, lets one be made current, deletes
 * the ones that are not, and can pin an older client by asking Roblox's
 * deployment for a specific version GUID.
 *
 * Roblox keeps exactly one "current" player version on the CDN at a time, but
 * version folders stay downloadable — `version-<guid>` directories are kept for
 * a while after an update, which is what makes a simple downgrade possible.
 * When the CDN has aged a version out, the failure is reported verbatim rather
 * than silently reinstalling the newest one.
 */

const logger = createLogger('Versions')

function versionsDirectory(): string {
  return join(getSettings().installLocation ?? paths.root, 'Versions')
}

function binaryFor(appType: AppType): BinaryType {
  return appType === 'studio' ? 'WindowsStudio64' : 'WindowsPlayer'
}

export async function list(): Promise<InstalledVersion[]> {
  await reindexVersions(versionsDirectory(), getSettings().channel || 'LIVE').catch(() => undefined)

  const store = await loadVersions()

  const out: InstalledVersion[] = []

  for (const entry of store.versions) {
    const directory = join(versionsDirectory(), entry.versionHash)
    const executable = join(directory, executableName(binaryFor(entry.appType)))
    const exists = await pathExists(directory)
    const stats = exists ? await dirStats(directory) : { fileCount: 0, totalBytes: 0 }

    out.push({
      id: entry.versionHash,
      versionHash: entry.versionHash,
      appType: entry.appType,
      channel: entry.channel,
      installedAt: entry.installedAt,
      sizeBytes: stats.totalBytes,
      fileCount: stats.fileCount,
      isCurrent: entry.versionHash === getRobloxState().installedVersion,
      path: directory,
      executable: (await pathExists(executable)) ? executable : null,
      missing: !exists
    })
  }

  return out.sort((a, b) => Date.parse(b.installedAt) - Date.parse(a.installedAt))
}

export async function setCurrent(request: VersionActionRequest): Promise<InstalledVersion[]> {
  const store = await loadVersions()
  const entry = store.versions.find((item) => item.versionHash === request.versionHash)

  if (!entry) throw new Error('That version is not in the install list any more')

  const directory = join(versionsDirectory(), entry.versionHash)
  const executable = join(directory, executableName(binaryFor(entry.appType)))

  if (!(await pathExists(executable))) {
    throw new Error('That version is incomplete: its executable is missing. Reinstall it first.')
  }

  await saveVersions({
    versions: [
      entry,
      ...store.versions.filter((item) => item.versionHash !== entry.versionHash)
    ]
  })

  await saveRobloxState({
    installedVersion: entry.versionHash,
    installedChannel: entry.channel,
    installPath: directory,
    modManifest: []
  })

  logger.info(`Current version set to ${entry.versionHash}`)
  return list()
}

export async function remove(request: VersionActionRequest): Promise<InstalledVersion[]> {
  const store = await loadVersions()
  const entry = store.versions.find((item) => item.versionHash === request.versionHash)

  if (!entry) throw new Error('That version is not in the install list any more')

  if (entry.versionHash === getRobloxState().installedVersion) {
    throw new Error('That version is in use. Switch to another one before deleting it.')
  }

  await removeDir(join(versionsDirectory(), entry.versionHash))
  await saveVersions({
    versions: store.versions.filter((item) => item.versionHash !== entry.versionHash)
  })

  // Cached packages for that version are dead weight now.
  try {
    const cached = await readdir(paths.downloads)
    for (const file of cached) {
      if (file.startsWith(entry.versionHash)) {
        await removeFile(join(paths.downloads, file))
      }
    }
  } catch {
    // Nothing cached.
  }

  logger.info(`Deleted version ${entry.versionHash}`)
  return list()
}

/**
 * Installs a specific version GUID.
 *
 * Used by "downgrade": the GUID is supplied by the caller (usually picked from
 * the deployment's own version history), and the same package pipeline as a
 * normal install is run against it.
 */
export async function installSpecific(versionGuid: string, appType: AppType = 'player'): Promise<BootstrapperResult> {
  const binaryType = binaryFor(appType)
  const settings = getSettings()

  if (!/^version-[0-9a-f]{16,}$/i.test(versionGuid)) {
    return { ok: false, version: null, launched: false, message: `'${versionGuid}' is not a version id` }
  }

  const baseUrl = await resolveBaseUrl()
  const target = { baseUrl, channel: settings.channel || 'LIVE', versionGuid }
  const directory = join(versionsDirectory(), versionGuid)

  try {
    const manifest = await getPackageManifest(target)
    const directoryMap = packageDirectoryMap(binaryType)
    const packages = manifest.filter(
      (entry) => entry.name.toLowerCase().endsWith('.zip') && directoryMap[entry.name] !== undefined
    )

    if (packages.length === 0) {
      return {
        ok: false,
        version: null,
        launched: false,
        message: `Roblox no longer serves ${versionGuid}: the deployment manifest is empty`
      }
    }

    await ensureDir(directory)
    await ensureDir(paths.downloads)

    let done = 0
    for (const entry of packages) {
      const cached = join(paths.downloads, `${versionGuid}-${entry.name}`)
      const valid = await md5File(cached).then(
        (hash) => hash.toLowerCase() === entry.signature.toLowerCase(),
        () => false
      )

      if (!valid) {
        const { packageUrls } = await import('../core/deployment')
        const urls = packageUrls(target, entry.name)
        let ok = false

        for (const url of urls) {
          try {
            await downloadToFile(url, cached, { expectedBytes: entry.packedSize, retries: 0 })
            const hash = await md5File(cached)
            if (hash.toLowerCase() === entry.signature.toLowerCase()) {
              ok = true
              break
            }
          } catch (error) {
            logger.warn(`Package ${entry.name} failed: ${String(error)}`)
          }
        }

        if (!ok) {
          await removeFile(cached)
          return {
            ok: false,
            version: null,
            launched: false,
            message: `Package ${entry.name} could not be downloaded intact. This version may have been withdrawn by Roblox.`
          }
        }
      }

      const relative = directoryMap[entry.name] ?? ''
      const destination = relative ? join(directory, ...relative.split('/')) : directory
      await ensureDir(destination)
      await extractZip(cached, destination)

      done += 1
      emit('bootstrapper:progress', {
        stage: 'extracting',
        progress: done / packages.length,
        message: `Installing ${versionGuid}`,
        detail: entry.name,
        packagesDone: done,
        packagesTotal: packages.length,
        version: versionGuid,
        cancellable: false
      })
    }

    await writeFile(join(directory, 'AppSettings.xml'), appSettingsXml(), 'utf8')
    await saveVersion(versionGuid, appType, settings.channel || 'LIVE')

    await saveRobloxState({
      installedVersion: versionGuid,
      installedChannel: settings.channel || 'LIVE',
      installedAt: Date.now(),
      installPath: directory,
      modManifest: []
    })

    logger.info(`Installed specific version ${versionGuid}`)
    return { ok: true, version: versionGuid, launched: false, message: `${versionGuid} is ready` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Installing ${versionGuid} failed: ${message}`)
    return { ok: false, version: null, launched: false, message }
  }
}

async function writeFile(path: string, data: string, encoding: 'utf8'): Promise<void> {
  const { writeFile: write } = await import('fs/promises')
  await write(path, data, encoding)
}

/**
 * A downgrade helper: the previous install is the newest entry that is not the
 * current one, which is exactly what a user means by "go back".
 */
export async function previousVersion(): Promise<InstalledVersion | null> {
  const installed = await list()
  const current = getRobloxState().installedVersion
  return installed.find((version) => version.versionHash !== current && !version.missing) ?? null
}

/** Latest version on the configured channel, for the "restore" action. */
export async function latestVersionOnChannel(): Promise<string | null> {
  const settings = getSettings()
  const binaryType = binaryTypeFor(settings.preferredLaunchMode)

  try {
    const latest = await getLatestClientVersion(binaryType, settings.channel || 'LIVE')
    return latest.clientVersionUpload
  } catch (error) {
    logger.warn(`Could not resolve the latest version: ${String(error)}`)
    return null
  }
}

export async function summary(): Promise<{ count: number; bytes: number; directory: string }> {
  const versions = await list()
  return {
    count: versions.length,
    bytes: versions.reduce((sum, version) => sum + version.sizeBytes, 0),
    directory: versionsDirectory()
  }
}

/** Folder name of the newest install, used by diagnostics. */
export async function currentFolder(): Promise<string | null> {
  const entry = await latestEntry('player')
  return entry ? basename(entry.versionHash) : null
}

export { sanitizeName }
