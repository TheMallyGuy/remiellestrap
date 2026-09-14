import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import type {
  BackupImportResult,
  BackupRequest,
  BackupResult,
  OperationResult
} from '@shared/models'
import { createLogger } from '../utils/logger'
import { paths } from '../utils/paths'
import { ensureDir, pathExists, readJson, removeDir, sanitizeName } from '../utils/fs'
import { createZip, extractZip } from '../utils/zip'
import { getSettings, saveSettings } from './settingsStore'
import { loadState, saveState } from './stateStore'
import { listMods } from './mods'
import * as accounts from './accounts'

/**
 * Backup export and import.
 *
 * The archive is a plain zip of JSON documents, so it can be inspected with any
 * tool before it is trusted. Account cookies are the one thing that must not
 * travel in the clear: they are sealed with AES-256-GCM under a key derived
 * from a user passphrase with scrypt, and the archive records that it did so.
 *
 * Mod *files* are deliberately not included — they are often hundreds of
 * megabytes, which would make a "quick backup" a long download. What travels is
 * the manifest, so the mods page can list what to install again.
 */

const logger = createLogger('Backup')

const MAGIC = 'RSB1'
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const

interface Manifest {
  app: 'RemielleStrap'
  format: 1
  createdAt: number
  appVersion: string
  platform: string
  sections: string[]
  accountsEncrypted: boolean
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32, SCRYPT_OPTIONS)
}

export function encryptWithPassword(plaintext: string, password: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv)

  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return Buffer.concat([Buffer.from(MAGIC, 'ascii'), salt, iv, cipher.getAuthTag(), body])
}

export function decryptWithPassword(payload: Buffer, password: string): string {
  if (payload.subarray(0, MAGIC.length).toString('ascii') !== MAGIC) {
    throw new Error('This payload is not a RemielleStrap encrypted section')
  }

  const salt = payload.subarray(4, 20)
  const iv = payload.subarray(20, 32)
  const tag = payload.subarray(32, 48)
  const body = payload.subarray(48)

  const decipher = createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

export async function exportBackup(request: BackupRequest): Promise<OperationResult<BackupResult>> {
  const settings = getSettings()
  const state = await loadState()
  const entries: { name: string; data: Buffer | string }[] = []
  const sections: string[] = []

  const include = (flag: boolean, name: string, build: () => string | Buffer): void => {
    if (!flag) return
    sections.push(name)
    entries.push({ name: `${name}.json`, data: build() })
  }

  include(request.includeSettings, 'settings', () =>
    JSON.stringify({ ...settings, installedMods: undefined }, null, 2)
  )

  include(request.includeFlags, 'flags', () =>
    JSON.stringify(
      {
        activeProfile: settings.activeFlagProfile,
        profiles: settings.flagProfiles
      },
      null,
      2
    )
  )

  include(request.includePlaytime, 'playtime', () => JSON.stringify(state.playtime, null, 2))

  if (request.includeMods) {
    sections.push('mods')
    const mods = await listMods()
    entries.push({
      name: 'mods.json',
      data: JSON.stringify(
        mods.map((mod) => ({
          name: mod.name,
          target: mod.target,
          kind: mod.kind,
          author: mod.author,
          version: mod.version,
          sourceUrl: mod.sourceUrl,
          enabled: mod.enabled,
          provides: mod.provides
        })),
        null,
        2
      )
    })
  }

  if (request.includeAccounts) {
    const accountsState = await accounts.state()

    if (accountsState.accounts.length === 0) {
      sections.push('accounts')
      entries.push({ name: 'accounts.enc', data: encryptWithPassword('[]', request.password) })
    } else if (request.password.trim().length < 8) {
      return {
        ok: false,
        error:
          'Account cookies need a passphrase of at least 8 characters. Either set one or export without accounts.'
      }
    } else {
      const cookies = await Promise.all(
        accountsState.accounts.map(async (account) => ({
          id: account.id,
          userId: account.userId,
          username: account.username,
          notes: account.notes,
          cookie: await accounts.cookieForBackup(account.id)
        }))
      )

      sections.push('accounts')
      entries.push({
        name: 'accounts.enc',
        data: encryptWithPassword(JSON.stringify(cookies), request.password)
      })
    }
  }

  const manifest: Manifest = {
    app: 'RemielleStrap',
    format: 1,
    createdAt: Date.now(),
    appVersion: '1.0.0',
    platform: process.platform,
    sections,
    accountsEncrypted: request.includeAccounts
  }

  entries.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) })
  // An empty password still needs a placeholder so the format stays uniform.
  if (request.includeAccounts && !sections.includes('accounts')) sections.push('accounts')

  try {
    const archive = createZip(entries)
    const file = join(
      paths.backups,
      `RemielleStrap-Backup-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}.zip`
    )

    await ensureDir(paths.backups)
    await writeFile(file, archive)
    logger.info(`Backup written to ${file} (${archive.byteLength} bytes)`)

    return { ok: true, data: { path: file, bytes: archive.byteLength, sections } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Backup export failed: ${message}`)
    return { ok: false, error: message }
  }
}

export async function importBackup(archive: string, password: string): Promise<OperationResult<BackupImportResult>> {
  const staging = join(paths.cache, 'import', sanitizeName(Date.now().toString(36), 'import'))

  try {
    if (!(await pathExists(archive))) return { ok: false, error: 'That backup file no longer exists' }

    await ensureDir(staging)
    await extractZip(archive, staging)

    const manifest = await readJson<Manifest | null>(join(staging, 'manifest.json'), null)

    if (!manifest || manifest.app !== 'RemielleStrap') {
      return { ok: false, error: 'That archive is not a RemielleStrap backup' }
    }

    const result: BackupImportResult = {
      settings: false,
      accounts: 0,
      mods: 0,
      flagProfiles: [],
      skipped: []
    }

    const settingsFile = join(staging, 'settings.json')
    if (await pathExists(settingsFile)) {
      const document = await readJson<Record<string, unknown> | null>(settingsFile, null)
      if (document) {
        // `saveSettings` coerces every field, so a hand-edited archive cannot
        // introduce a value the rest of the app does not expect.
        await saveSettings(document as never)
        result.settings = true
      }
    }

    const flagsFile = join(staging, 'flags.json')
    if (await pathExists(flagsFile)) {
      const document = await readJson<{
        activeProfile?: string
        profiles?: Record<string, Record<string, unknown>>
      } | null>(flagsFile, null)

      if (document?.profiles) {
        const profileNames = Object.keys(document.profiles)

        await saveSettings({
          flagProfiles: document.profiles as never,
          activeFlagProfile: document.activeProfile ?? profileNames[0]
        })

        result.flagProfiles = profileNames
      }
    }

    const playtimeFile = join(staging, 'playtime.json')
    if (await pathExists(playtimeFile)) {
      const document = await readJson<Record<string, unknown> | null>(playtimeFile, null)
      if (document) {
        await saveState({
          playtime: {
            totalMs: Number(document.totalMs ?? 0),
            sessions: Number(document.sessions ?? 0),
            firstLaunchAt: typeof document.firstLaunchAt === 'number' ? document.firstLaunchAt : null,
            games:
              document.games && typeof document.games === 'object'
                ? (document.games as Record<string, never>)
                : {},
            openSessionStartedAt: null,
            openSessionPlaceId: null
          }
        })
      }
    }

    const modsFile = join(staging, 'mods.json')
    if (await pathExists(modsFile)) {
      const document = await readJson<unknown[] | null>(modsFile, null)
      if (Array.isArray(document)) {
        result.mods = document.length
        result.skipped.push(
          'Mod files are not part of a backup — reinstall them from the Mods page, or from the community list.'
        )
      }
    }

    const accountsFile = join(staging, 'accounts.enc')
    if (await pathExists(accountsFile)) {
      const { readFile } = await import('fs/promises')
      const payload = await readFile(accountsFile)

      if (password.trim().length === 0) {
        result.skipped.push('Accounts were skipped because no passphrase was given')
      } else {
        try {
          const decoded = JSON.parse(decryptWithPassword(payload, password)) as {
            userId: number
            username?: string
            notes?: string
            cookie: string | null
          }[]

          result.accounts = await accounts.importEntries(decoded)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const wrongPassword = /authenticate|unable to/i.test(message)

          result.skipped.push(
            wrongPassword
              ? 'The accounts section could not be decrypted — the passphrase is probably wrong'
              : `The accounts section could not be read: ${message}`
          )
        }
      }
    }

    logger.info('Backup imported')
    return { ok: true, data: result }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Backup import failed: ${message}`)
    return { ok: false, error: message }
  } finally {
    await removeDir(staging).catch(() => undefined)
  }
}

/** Lists archives this app has exported, newest first. */
export async function listBackups(): Promise<{ name: string; path: string; bytes: number; createdAt: number }[]> {
  const { readdir, stat } = await import('fs/promises')
  if (!(await pathExists(paths.backups))) return []

  try {
    const entries = await readdir(paths.backups)
    const files: { name: string; path: string; bytes: number; createdAt: number }[] = []

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.zip')) continue
      const info = await stat(join(paths.backups, entry)).catch(() => null)
      if (!info) continue
      files.push({ name: entry, path: join(paths.backups, entry), bytes: info.size, createdAt: info.mtimeMs })
    }

    return files.sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    return []
  }
}
