import { createWriteStream } from 'fs'
import { basename, dirname, join, normalize } from 'path'
import { pipeline } from 'stream/promises'
import yauzl from 'yauzl'
import { ensureDir, isInside } from './fs'

/**
 * Zip extraction used for Roblox packages and mod imports.
 *
 * Every entry is validated against the destination root before writing, so a
 * malicious archive cannot escape via `../` entries or absolute paths.
 */

export interface ExtractOptions {
  /** Called with the number of entries written so far. */
  onProgress?: (entriesDone: number, entriesTotal: number) => void
  signal?: AbortSignal
  /**
   * When set, only these entries are extracted. Paths are relative to the
   * archive root and matched case-insensitively, so they can be compared
   * against file paths stored elsewhere (e.g. the mods manifest).
   */
  only?: string[]
}

export class InvalidZipError extends Error {
  constructor(
    file: string,
    public readonly reason?: string
  ) {
    super(`The archive ${basename(file)} is incomplete or is not a valid zip file`)
    this.name = 'InvalidZipError'
  }
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // decodeStrings:false stops yauzl from validating entry names and emitting
    // a fatal 'error' on hostile archives. We decode and vet names ourselves in
    // normaliseEntryName so a single bad entry is skipped, not fatal.
    yauzl.open(
      file,
      { lazyEntries: true, autoClose: true, decodeStrings: false },
      (err, zipfile) => {
        if (err || !zipfile) {
          reject(new InvalidZipError(file, err?.message))
        } else {
          resolve(zipfile)
        }
      }
    )
  })
}

/** Entry names arrive as Buffers because decodeStrings is disabled. */
function entryName(raw: string | Buffer): string {
  return Buffer.isBuffer(raw) ? raw.toString('utf8') : raw
}

function normaliseEntryName(name: string): string | null {
  // Zip entries always use forward slashes; Roblox packages sometimes use
  // backslashes. Normalise both, then reject anything suspicious.
  const unified = name.replace(/\\/g, '/')
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified)) return null
  const normalised = normalize(unified)
  if (normalised.split(/[\\/]/).some((segment) => segment === '..')) return null
  return normalised
}

/**
 * Extracts `zipPath` into `destination`. Returns the list of files written,
 * relative to the destination, which the mods engine uses to track ownership.
 */
export async function extractZip(
  zipPath: string,
  destination: string,
  options: ExtractOptions = {}
): Promise<string[]> {
  const zipfile = await openZip(zipPath)
  const written: string[] = []
  const total = zipfile.entryCount
  const onlySet = options.only
    ? new Set(options.only.map((file) => file.replace(/\\/g, '/').toLowerCase()))
    : null

  await ensureDir(destination)

  return new Promise<string[]>((resolve, reject) => {
    let settled = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abortHandler)
      try {
        zipfile.close()
      } catch {
        /* ignore */
      }
      reject(error)
    }

    const abortHandler = (): void => fail(new Error('Extraction cancelled'))
    if (options.signal) {
      if (options.signal.aborted) {
        fail(new Error('Extraction cancelled'))
        return
      }
      options.signal.addEventListener('abort', abortHandler, { once: true })
    }

    zipfile.on('error', fail)

    zipfile.on('end', () => {
      if (settled) return
      settled = true
      options.signal?.removeEventListener('abort', abortHandler)
      resolve(written)
    })

    zipfile.on('entry', (entry: yauzl.Entry) => {
      if (settled) return

      const rawName = entryName(entry.fileName)
      const safeName = normaliseEntryName(rawName)
      if (safeName === null) {
        // Skip unsafe entries rather than aborting the whole install.
        zipfile.readEntry()
        return
      }

      const target = join(destination, safeName)
      if (!isInside(destination, target)) {
        zipfile.readEntry()
        return
      }

      // Filtered extraction: skip anything not explicitly requested.
      if (onlySet && !onlySet.has(safeName.replace(/\\/g, '/').toLowerCase())) {
        zipfile.readEntry()
        return
      }

      // Directory entries end with a slash.
      if (/\/$/.test(rawName.replace(/\\/g, '/'))) {
        ensureDir(target)
          .then(() => zipfile.readEntry())
          .catch(fail)
        return
      }

      zipfile.openReadStream(entry, (err, readStream) => {
        if (err || !readStream) {
          fail(err ?? new Error(`Unable to read ${rawName}`))
          return
        }

        ensureDir(dirname(target))
          .then(() => pipeline(readStream, createWriteStream(target)))
          .then(() => {
            written.push(safeName)
            options.onProgress?.(written.length, total)
            zipfile.readEntry()
          })
          .catch(fail)
      })
    })

    zipfile.readEntry()
  })
}

/** Lists entry names without extracting, used to preview mod archives. */
export async function listZipEntries(zipPath: string): Promise<string[]> {
  const zipfile = await openZip(zipPath)
  const names: string[] = []

  return new Promise<string[]>((resolve, reject) => {
    zipfile.on('error', reject)
    zipfile.on('end', () => resolve(names))
    zipfile.on('entry', (entry: yauzl.Entry) => {
      names.push(entryName(entry.fileName))
      zipfile.readEntry()
    })
    zipfile.readEntry()
  })
}

/**
 * True only when yauzl can locate and parse the archive's central directory.
 * Checking for a leading `PK` marker is not enough: truncated downloads retain
 * that marker and were the source of the misleading end-of-directory error.
 */
export async function isZipFile(file: string): Promise<boolean> {
  try {
    const zipfile = await openZip(file)
    zipfile.close()
    return true
  } catch {
    return false
  }
}
