import { dialog, shell } from 'electron'
import { copyFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, join, sep } from 'path'
import type { ColorModRequest, ModEntry, OperationResult } from '@shared/models'
import { createLogger } from '../utils/logger'
import { paths } from '../utils/paths'
import {
  copyDir,
  dirStats,
  ensureDir,
  listFiles,
  pathExists,
  readJson,
  removeDir,
  sanitizeName,
  safeJoin,
  writeJson
} from '../utils/fs'
import { extractZip, isZipFile } from '../utils/zip'
import { shortId } from '../utils/hash'
import { getSettings, saveSettings } from './settingsStore'
import { saveRobloxState } from './stateStore'

/**
 * Mod management.
 *
 * A mod is a folder under <appdata>/Mods/<id>/ whose contents mirror the
 * Roblox version directory (e.g. content/sounds/ouch.ogg). Enabled mods are
 * merged into the version directory before launch, in priority order, and the
 * files they wrote are tracked so they can be reverted on the next update.
 */

const logger = createLogger('Mods')

interface ModIndexEntry {
  id: string
  name: string
  priority: number
  addedAt: number
  description: string | null
}

interface ModIndex {
  mods: ModIndexEntry[]
}

const EMPTY_INDEX: ModIndex = { mods: [] }

/** Files that must never be overwritten by a mod. */
const PROTECTED_PATHS = new Set([
  'robloxplayerbeta.exe',
  'robloxstudiobeta.exe',
  'robloxplayerlauncher.exe',
  'appsettings.xml'
])

async function readIndex(): Promise<ModIndex> {
  const index = await readJson<ModIndex>(paths.modsIndex, EMPTY_INDEX)
  if (!index || !Array.isArray(index.mods)) return { mods: [] }
  return { mods: index.mods.filter((mod) => mod && typeof mod.id === 'string') }
}

async function writeIndex(index: ModIndex): Promise<void> {
  await ensureDir(paths.mods)
  await writeJson(paths.modsIndex, index)
}

function modDirectory(id: string): string {
  return safeJoin(paths.mods, id)
}

/**
 * Reconciles the index with what is actually on disk, so mods dropped into the
 * folder manually are picked up and deleted folders disappear.
 */
async function reconcile(): Promise<ModIndex> {
  await ensureDir(paths.mods)
  const index = await readIndex()

  let directories: string[] = []
  try {
    const entries = await readdir(paths.mods, { withFileTypes: true })
    directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    directories = []
  }

  const known = new Set(index.mods.map((mod) => mod.id))
  const present = new Set(directories)

  const mods = index.mods.filter((mod) => present.has(mod.id))
  let nextPriority = mods.reduce((max, mod) => Math.max(max, mod.priority), 0)

  for (const directory of directories) {
    if (known.has(directory)) continue
    nextPriority += 1
    mods.push({
      id: directory,
      name: directory.replace(/-[a-f0-9]{6,}$/i, '').replace(/[-_]+/g, ' ').trim() || directory,
      priority: nextPriority,
      addedAt: Date.now(),
      description: null
    })
    logger.info(`Discovered mod folder '${directory}'`)
  }

  mods.sort((a, b) => a.priority - b.priority)
  mods.forEach((mod, i) => {
    mod.priority = i + 1
  })

  await writeIndex({ mods })
  return { mods }
}

export async function listMods(): Promise<ModEntry[]> {
  const index = await reconcile()
  const enabled = new Set(getSettings().enabledMods)

  const entries = await Promise.all(
    index.mods.map(async (mod): Promise<ModEntry> => {
      const path = modDirectory(mod.id)
      const stats = await dirStats(path)
      return {
        id: mod.id,
        name: mod.name,
        enabled: enabled.has(mod.id),
        priority: mod.priority,
        fileCount: stats.fileCount,
        sizeBytes: stats.totalBytes,
        path,
        addedAt: mod.addedAt,
        description: mod.description
      }
    })
  )

  return entries
}

async function registerMod(
  id: string,
  name: string,
  description: string | null
): Promise<void> {
  const index = await readIndex()
  const priority = index.mods.reduce((max, mod) => Math.max(max, mod.priority), 0) + 1
  index.mods.push({ id, name, priority, addedAt: Date.now(), description })
  await writeIndex(index)

  // Newly imported mods are enabled by default, matching user expectation.
  const settings = getSettings()
  if (!settings.enabledMods.includes(id)) {
    await saveSettings({ enabledMods: [...settings.enabledMods, id] })
  }
}

function newModId(name: string): string {
  return `${sanitizeName(name, 'mod').toLowerCase().replace(/\s+/g, '-')}-${shortId(
    `${name}:${Date.now()}:${Math.random()}`,
    6
  )}`
}

/**
 * Many mod archives are published with a single wrapper folder inside. If the
 * extracted tree is exactly one directory deep, flatten it so the layout lines
 * up with the version directory.
 */
async function flattenSingleRoot(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })
  if (entries.length !== 1 || !entries[0].isDirectory()) return

  const inner = join(directory, entries[0].name)
  const innerEntries = await readdir(inner)

  // Only flatten when the wrapper isn't itself a meaningful content folder.
  const meaningful = new Set(['content', 'extracontent', 'platformcontent', 'shaders', 'sounds'])
  if (meaningful.has(entries[0].name.toLowerCase())) return

  for (const entry of innerEntries) {
    await rename(join(inner, entry), join(directory, entry))
  }
  await rm(inner, { recursive: true, force: true })
  logger.info(`Flattened wrapper folder '${entries[0].name}'`)
}

export async function importZip(): Promise<OperationResult<ModEntry[]>> {
  const result = await dialog.showOpenDialog({
    title: 'Import mod archive',
    filters: [{ name: 'Zip archives', extensions: ['zip'] }],
    properties: ['openFile', 'multiSelections']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'Import cancelled' }
  }

  try {
    for (const file of result.filePaths) {
      if (!(await isZipFile(file))) {
        return { ok: false, error: `${basename(file)} is not a valid zip archive` }
      }

      const name = basename(file).replace(/\.zip$/i, '')
      const id = newModId(name)
      const destination = modDirectory(id)
      await ensureDir(destination)

      const written = await extractZip(file, destination)
      if (written.length === 0) {
        await removeDir(destination)
        return { ok: false, error: `${basename(file)} was empty` }
      }

      await flattenSingleRoot(destination)
      await registerMod(id, name, `Imported from ${basename(file)}`)
      logger.info(`Imported mod '${name}' (${written.length} files)`)
    }

    return { ok: true, data: await listMods() }
  } catch (error) {
    logger.error(`Mod zip import failed: ${String(error)}`)
    return { ok: false, error: error instanceof Error ? error.message : 'Import failed' }
  }
}

export async function importFolder(): Promise<OperationResult<ModEntry[]>> {
  const result = await dialog.showOpenDialog({
    title: 'Import mod folder',
    properties: ['openDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'Import cancelled' }
  }

  try {
    const source = result.filePaths[0]
    const name = basename(source)
    const id = newModId(name)
    const destination = modDirectory(id)

    const copied = await copyDir(source, destination)
    if (copied === 0) {
      await removeDir(destination)
      return { ok: false, error: 'That folder was empty' }
    }

    await registerMod(id, name, `Imported from ${source}`)
    logger.info(`Imported mod folder '${name}' (${copied} files)`)
    return { ok: true, data: await listMods() }
  } catch (error) {
    logger.error(`Mod folder import failed: ${String(error)}`)
    return { ok: false, error: error instanceof Error ? error.message : 'Import failed' }
  }
}

export async function toggleMod(id: string, enabled: boolean): Promise<ModEntry[]> {
  const settings = getSettings()
  const current = new Set(settings.enabledMods)

  if (enabled) current.add(id)
  else current.delete(id)

  await saveSettings({ enabledMods: [...current] })
  logger.info(`Mod '${id}' ${enabled ? 'enabled' : 'disabled'}`)
  return listMods()
}

export async function deleteMod(id: string): Promise<ModEntry[]> {
  const directory = modDirectory(id)
  await removeDir(directory)

  const index = await readIndex()
  await writeIndex({ mods: index.mods.filter((mod) => mod.id !== id) })

  const settings = getSettings()
  await saveSettings({ enabledMods: settings.enabledMods.filter((mod) => mod !== id) })

  logger.info(`Deleted mod '${id}'`)
  return listMods()
}

export async function reorderMods(ids: string[]): Promise<ModEntry[]> {
  const index = await readIndex()
  const byId = new Map(index.mods.map((mod) => [mod.id, mod]))
  const ordered: ModIndexEntry[] = []

  for (const id of ids) {
    const mod = byId.get(id)
    if (mod) {
      ordered.push(mod)
      byId.delete(id)
    }
  }
  // Anything the renderer didn't mention keeps its relative order at the end.
  ordered.push(...byId.values())
  ordered.forEach((mod, i) => {
    mod.priority = i + 1
  })

  await writeIndex({ mods: ordered })
  return listMods()
}

export async function openModsFolder(id?: string): Promise<OperationResult> {
  try {
    const target = id ? modDirectory(id) : paths.mods
    await ensureDir(target)
    const error = await shell.openPath(target)
    if (error) return { ok: false, error }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not open folder' }
  }
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim())
}

/**
 * Generates a mod that recolours the client's loading/UI surfaces by writing
 * flat single-colour PNGs over the stock textures. Only geometry-free solid
 * colours are produced — nothing is downloaded or AI-generated.
 */
export async function generateColorMod(request: ColorModRequest): Promise<OperationResult<ModEntry[]>> {
  const color = request.color?.trim() ?? ''
  if (!isHexColor(color)) {
    return { ok: false, error: 'Provide a colour as a hex value such as #101014' }
  }
  const accent = request.accent && isHexColor(request.accent) ? request.accent.trim() : color

  try {
    const name = sanitizeName(request.name || 'Colour mod', 'Colour mod')
    const id = newModId(name)
    const destination = modDirectory(id)

    const texturesDir = join(destination, 'content', 'textures', 'ui')
    await ensureDir(texturesDir)

    // 1x1 PNGs stretch across the client's UI panels.
    await writeFile(join(texturesDir, 'GuiBackground.png'), solidPng(color))
    await writeFile(join(texturesDir, 'GuiAccent.png'), solidPng(accent))

    await writeFile(
      join(destination, 'README.txt'),
      [
        `${name}`,
        '',
        `Generated by RemielleStrap.`,
        `Background: ${color}`,
        `Accent: ${accent}`,
        '',
        'These are flat colour textures layered over the client UI.',
        'Delete this mod from the Mods page to revert.',
        ''
      ].join('\n'),
      'utf8'
    )

    await registerMod(id, name, `Solid ${color} UI recolour`)
    logger.info(`Generated colour mod '${name}' (${color})`)
    return { ok: true, data: await listMods() }
  } catch (error) {
    logger.error(`Colour mod generation failed: ${String(error)}`)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not generate the mod'
    }
  }
}

/** CRC32 for PNG chunks. */
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

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/**
 * Builds a 1x1 opaque PNG of the given colour with a stored (uncompressed)
 * zlib stream, so no compression dependency is required.
 */
export function solidPng(hex: string): Buffer {
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0) // width
  ihdr.writeUInt32BE(1, 4) // height
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Raw scanline: filter byte + RGBA pixel.
  const raw = Buffer.from([0x00, r, g, b, 0xff])

  // zlib stream with a single stored deflate block.
  const header = Buffer.from([0x78, 0x01])
  const blockHeader = Buffer.alloc(5)
  blockHeader[0] = 0x01 // final, stored
  blockHeader.writeUInt16LE(raw.length, 1)
  blockHeader.writeUInt16LE(~raw.length & 0xffff, 3)

  // Adler-32 of the raw data.
  let a = 1
  let bSum = 0
  for (const byte of raw) {
    a = (a + byte) % 65521
    bSum = (bSum + a) % 65521
  }
  const adler = Buffer.alloc(4)
  adler.writeUInt32BE(((bSum << 16) | a) >>> 0, 0)

  const idat = Buffer.concat([header, blockHeader, raw, adler])

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

/**
 * Copies every enabled mod into the version directory in priority order.
 * Returns the relative paths written, which are persisted so the next update
 * knows which files came from mods.
 */
export async function applyMods(versionDirectory: string): Promise<string[]> {
  const mods = (await listMods())
    .filter((mod) => mod.enabled)
    .sort((a, b) => a.priority - b.priority)

  if (mods.length === 0) {
    await saveRobloxState({ modManifest: [] })
    return []
  }

  const written = new Set<string>()

  for (const mod of mods) {
    // listFiles returns paths relative to the mod root.
    const files = await listFiles(mod.path)

    for (const relativePath of files) {
      const normalised = relativePath.split(sep).join('/')

      if (normalised.toLowerCase() === 'readme.txt') continue
      if (PROTECTED_PATHS.has(normalised.toLowerCase())) {
        logger.warn(`Mod '${mod.name}' tried to overwrite protected file '${normalised}'`)
        continue
      }

      const source = safeJoin(mod.path, ...normalised.split('/'))
      const target = safeJoin(versionDirectory, ...normalised.split('/'))
      await ensureDir(join(target, '..'))
      await copyFile(source, target)
      written.add(normalised)
    }

    logger.info(`Applied mod '${mod.name}' (${files.length} files)`)
  }

  const manifest = [...written]
  await saveRobloxState({ modManifest: manifest })
  return manifest
}

/**
 * Removes files a previous launch's mods wrote. Called before applying a fresh
 * set so disabled mods stop taking effect without a full reinstall.
 */
export async function revertMods(
  versionDirectory: string,
  manifest: readonly string[]
): Promise<number> {
  let removed = 0

  for (const relativePath of manifest) {
    const target = safeJoin(versionDirectory, ...relativePath.split('/'))
    if (!(await pathExists(target))) continue
    try {
      const info = await stat(target)
      if (info.isFile()) {
        await rm(target, { force: true })
        removed += 1
      }
    } catch {
      // A file we can't remove is not fatal; the reinstall path will fix it.
    }
  }

  if (removed > 0) logger.info(`Reverted ${removed} modded file(s)`)
  return removed
}
