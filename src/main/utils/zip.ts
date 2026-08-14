import { promises as fs, createWriteStream } from 'fs'
import { dirname, join, normalize } from 'path'
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
        if (err || !zipfile) reject(err ?? new Error(`Unable to open archive: ${file}`))
        else resolve(zipfile)
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

  await ensureDir(destination)

  return new Promise<string[]>((resolve, reject) => {
    let settled = false

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
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

/** True when the file exists and starts with the PK zip signature. */
export async function isZipFile(file: string): Promise<boolean> {
  let handle: import('fs').promises.FileHandle | null = null
  try {
    handle = await fs.open(file, 'r')
    const buffer = Buffer.alloc(2)
    const { bytesRead } = await handle.read(buffer, 0, 2, 0)
    return bytesRead === 2 && buffer[0] === 0x50 && buffer[1] === 0x4b
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
