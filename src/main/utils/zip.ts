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

/* ------------------------------------------------------------------ Writing */

export interface ZipEntryInput {
  /** Path inside the archive, using forward slashes. */
  name: string
  data: Buffer | string
}

/** DOS timestamp for a zip entry, in local time as the format requires. */
function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Builds a zip archive in memory.
 *
 * Entries are *stored*, not deflated: these archives hold settings, mod lists
 * and credential blobs (already encrypted), so deflate would cost CPU for very
 * little gain and would drag in a compressor for every entry.
 */
export function createZip(entries: ZipEntryInput[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  const { time, date } = dosDateTime(new Date())

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '').slice(0, 200)
    if (name.length === 0 || name.includes('..')) continue

    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const nameBuffer = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(0, 8) // stored
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBuffer, data)

    const entryHeader = Buffer.alloc(46)
    entryHeader.writeUInt32LE(0x02014b50, 0)
    entryHeader.writeUInt16LE(20, 4)
    entryHeader.writeUInt16LE(20, 6)
    entryHeader.writeUInt16LE(0x0800, 8)
    entryHeader.writeUInt16LE(0, 10)
    entryHeader.writeUInt16LE(time, 12)
    entryHeader.writeUInt16LE(date, 14)
    entryHeader.writeUInt32LE(crc, 16)
    entryHeader.writeUInt32LE(data.length, 20)
    entryHeader.writeUInt32LE(data.length, 24)
    entryHeader.writeUInt16LE(nameBuffer.length, 28)
    entryHeader.writeUInt16LE(0, 30)
    entryHeader.writeUInt16LE(0, 32)
    entryHeader.writeUInt16LE(0, 34)
    entryHeader.writeUInt16LE(0, 36)
    entryHeader.writeUInt32LE(0, 38)
    entryHeader.writeUInt32LE(offset, 42)

    central.push(entryHeader, nameBuffer)
    offset += local.length + nameBuffer.length + data.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(central.length / 2, 8)
  end.writeUInt16LE(central.length / 2, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, centralBuffer, end])
}
