import { dialog, shell } from 'electron'
import { copyFile, readdir, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, join, sep } from 'path'
import type {
  ColorModRequest,
  CommunityIndex,
  CommunityInstallRequest,
  CommunityMod,
  CursorSetRequest,
  FileReplacementRequest,
  FileReplacementResult,
  ModConflict,
  ModEntry,
  ModTarget,
  OperationResult,
  RichModRequest
} from '@shared/models'
import { MOD_FILE_SLOTS, modFileSlot, type ModFileSlotDefinition } from '@shared/catalog'
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
import { md5File, shortId } from '../utils/hash'
import { extractZip, isZipFile } from '../utils/zip'
import { gradientPng, parseHex, solidPng, toHex } from '../utils/png'
import { downloadToFile, getJson } from './http'
import { getPackageForFile, restoreFileFromPackage, type BinaryType } from '../core/deployment'
import { getSettings, saveSettings } from './settingsStore'
import { saveRobloxState } from './stateStore'
import { emit } from './events'

/**
 * Mod management.
 *
 * A mod is a folder under <appdata>/Mods/<id>/ whose contents mirror the Roblox
 * version directory (e.g. content/sounds/ouch.ogg). Enabled mods are merged
 * into the version directory before launch, in priority order, and the files
 * they wrote are tracked so they can be reverted on the next update.
 *
 * Every mod also declares a *target*: player, studio, or both. The overlay only
 * copies a mod into the binary it targets, which is what lets someone ship a
 * Studio-only font without touching the player, or vice versa.
 */

const logger = createLogger('Mods')

interface ModIndexEntry {
  id: string
  name: string
  priority: number
  addedAt: number
  description: string | null
  target: ModTarget
  kind: ModEntry['kind']
  author: string | null
  version: string | null
  sourceUrl: string | null
  communityId: string | null
  /** Relative client paths this mod writes, cached for conflict detection. */
  provides: string[]
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
  'robloxstudiobeta.exe.config',
  'appsettings.xml',
  'rbxpackagemanifest.txt'
])

const MAX_MOD_FILES = 5000

/* ------------------------------------------------------------------ Index */

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

function normalizeEntry(raw: Partial<ModIndexEntry>, fallbackPriority: number): ModIndexEntry {
  return {
    id: raw.id as string,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : (raw.id as string),
    priority: typeof raw.priority === 'number' ? raw.priority : fallbackPriority,
    addedAt: typeof raw.addedAt === 'number' ? raw.addedAt : Date.now(),
    description: typeof raw.description === 'string' ? raw.description : null,
    target:
      raw.target === 'player' || raw.target === 'studio' || raw.target === 'both'
        ? raw.target
        : 'player',
    kind:
      raw.kind === 'archive' ||
      raw.kind === 'folder' ||
      raw.kind === 'generated' ||
      raw.kind === 'file-replacement' ||
      raw.kind === 'cursor-set' ||
      raw.kind === 'community'
        ? raw.kind
        : 'folder',
    author: typeof raw.author === 'string' ? raw.author : null,
    version: typeof raw.version === 'string' ? raw.version : null,
    sourceUrl: typeof raw.sourceUrl === 'string' ? raw.sourceUrl : null,
    communityId: typeof raw.communityId === 'string' ? raw.communityId : null,
    provides: Array.isArray(raw.provides)
      ? raw.provides.filter((item): item is string => typeof item === 'string').slice(0, MAX_MOD_FILES)
      : []
  }
}

/** The relative client paths a mod folder writes, ignoring our own metadata. */
async function describeProvides(directory: string): Promise<string[]> {
  const files = await listFiles(directory)
  return files
    .map((file) => file.split(sep).join('/'))
    .filter((file) => !/^readme\.txt$/i.test(file) && !file.startsWith('mod.json'))
    .slice(0, MAX_MOD_FILES)
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

  const mods = index.mods.map((raw, position) => normalizeEntry(raw, position + 1)).filter((mod) => present.has(mod.id))
  let nextPriority = mods.reduce((max, mod) => Math.max(max, mod.priority), 0)
  let changed = mods.length !== index.mods.length

  for (const directory of directories) {
    if (known.has(directory)) continue
    nextPriority += 1
    mods.push({
      id: directory,
      name:
        directory
          .replace(/-[a-f0-9]{6,}$/i, '')
          .replace(/[-_]+/g, ' ')
          .trim() || directory,
      priority: nextPriority,
      addedAt: Date.now(),
      description: null,
      target: 'player',
      kind: 'folder',
      author: null,
      version: null,
      sourceUrl: null,
      communityId: null,
      provides: await describeProvides(join(paths.mods, directory))
    })
    changed = true
    logger.info(`Discovered mod folder '${directory}'`)
  }

  mods.sort((a, b) => a.priority - b.priority)
  mods.forEach((mod, i) => {
    mod.priority = i + 1
  })

  if (changed) await writeIndex({ mods })
  return { mods }
}

/* ------------------------------------------------------------------- List */

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
        description: mod.description,
        target: mod.target,
        kind: mod.kind,
        author: mod.author,
        version: mod.version,
        sourceUrl: mod.sourceUrl,
        communityId: mod.communityId,
        provides: mod.provides
      }
    })
  )

  return entries
}

async function registerMod(entry: ModIndexEntry): Promise<void> {
  const index = await readIndex()
  const priority = index.mods.reduce((max, mod) => Math.max(max, mod.priority), 0) + 1
  index.mods.push({ ...entry, priority })
  await writeIndex(index)

  const settings = getSettings()
  if (!settings.enabledMods.includes(entry.id)) {
    await saveSettings({ enabledMods: [...settings.enabledMods, entry.id] })
  }

  emit('mods:changed', await listMods())
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

/* --------------------------------------------------------------- Imports */

function defaultTarget(): ModTarget {
  return getSettings().defaultModTarget
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

      const target = defaultTarget()
      await registerMod({
        id,
        name,
        priority: 0,
        addedAt: Date.now(),
        description: `Imported from ${basename(file)}`,
        target,
        kind: 'archive',
        author: null,
        version: null,
        sourceUrl: null,
        communityId: null,
        provides: await describeProvides(destination)
      })
      logger.info(`Imported mod '${name}' (${written.length} files, target ${target})`)
    }

    await maybeApplyNow()
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

    await registerMod({
      id,
      name,
      priority: 0,
      addedAt: Date.now(),
      description: `Imported from ${source}`,
      target: defaultTarget(),
      kind: 'folder',
      author: null,
      version: null,
      sourceUrl: null,
      communityId: null,
      provides: await describeProvides(destination)
    })
    logger.info(`Imported mod folder '${name}' (${copied} files)`)
    await maybeApplyNow()
    return { ok: true, data: await listMods() }
  } catch (error) {
    logger.error(`Mod folder import failed: ${String(error)}`)
    return { ok: false, error: error instanceof Error ? error.message : 'Import failed' }
  }
}

/**
 * Imports a single file into one of the known client slots — a cursor, the
 * shift-lock icon, a death sound or a font. The mod this creates is tiny and
 * carries exactly one file, so it can be toggled on and off from the list like
 * any other.
 */
export async function replaceFile(
  request: FileReplacementRequest
): Promise<OperationResult<FileReplacementResult>> {
  const slot = modFileSlot(request.slot)
  if (!slot) return { ok: false, error: `Unknown file slot '${request.slot}'` }

  const result = await dialog.showOpenDialog({
    title: `Choose a file for ${slot.label}`,
    filters: [{ name: slot.label, extensions: slot.extensions }],
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, error: 'Selection cancelled' }
  }

  const source = result.filePaths[0]
  const extension = (source.split('.').pop() ?? '').toLowerCase()

  if (!slot.extensions.includes(extension)) {
    return {
      ok: false,
      error: `${basename(source)} is not one of the accepted types (${slot.extensions.join(', ')})`
    }
  }

  try {
    const name = sanitizeName(request.name ?? `${slot.label} replacement`, 'Replacement')
    const id = newModId(name)
    const destination = modDirectory(id)
    const relativePath = resolveSlotPath(slot, extension)

    const targetFile = safeJoin(destination, ...relativePath.split('/'))
    await ensureDir(join(targetFile, '..'))
    await copyFile(source, targetFile)

    await writeFile(
      join(destination, 'README.txt'),
      [
        name,
        '',
        `Slot: ${slot.label}`,
        `Source: ${basename(source)}`,
        `Client path: ${relativePath}`,
        '',
        'Generated by RemielleStrap. Delete the mod to revert.',
        ''
      ].join('\n'),
      'utf8'
    )

    await registerMod({
      id,
      name,
      priority: 0,
      addedAt: Date.now(),
      description: `${slot.label} replaced from ${basename(source)}`,
      target: request.target,
      kind: 'file-replacement',
      author: null,
      version: null,
      sourceUrl: null,
      communityId: null,
      provides: [relativePath]
    })

    await maybeApplyNow()
    const mods = await listMods()
    const mod = mods.find((entry) => entry.id === id)
    if (!mod) return { ok: false, error: 'The replacement was written but could not be indexed' }

    logger.info(`Replaced ${slot.id} from ${basename(source)}`)
    return { ok: true, data: { slot: slot.id, mod, relativePath } }
  } catch (error) {
    logger.error(`File replacement failed: ${String(error)}`)
    return { ok: false, error: error instanceof Error ? error.message : 'Could not copy that file' }
  }
}

/**
 * Fonts are the one slot where the client path matters a lot: Roblox only picks
 * up a font that sits in `content/fonts/families`. The file name is normalised
 * so the client can find it regardless of what the user picked.
 */
function resolveSlotPath(slot: ModFileSlotDefinition, extension: string): string {
  if (slot.kind === 'font') {
    return `content/fonts/families/RemielleFont.${extension === 'otf' ? 'otf' : 'ttf'}`
  }
  return slot.relative
}

async function pickImage(title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    title,
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: ['openFile']
  })

  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/**
 * A named cursor set: the arrow plus (optionally) the faded arrow. Creating one
 * is just a mod with two files in it, which keeps switching between sets
 * exactly as cheap as toggling a mod.
 */
export async function createCursorSet(request: CursorSetRequest): Promise<OperationResult<ModEntry[]>> {
  const arrow = request.cursor || (await pickImage('Choose the cursor image'))
  if (!arrow) return { ok: false, error: 'No cursor image was chosen' }

  const far = request.farCursor ?? arrow

  try {
    const name = sanitizeName(request.name || 'Cursor set', 'Cursor set')
    const id = newModId(name)
    const destination = modDirectory(id)

    for (const [file, slotId] of [
      [arrow, 'cursor-arrow'],
      [far, 'cursor-arrow-far']
    ] as const) {
      const slot = modFileSlot(slotId)
      if (!slot) continue
      const target = safeJoin(destination, ...slot.relative.split('/'))
      await ensureDir(join(target, '..'))
      await copyFile(file, target)
    }

    await writeFile(
      join(destination, 'README.txt'),
      [`${name}`, '', 'Cursor set generated by RemielleStrap.', ''].join('\n'),
      'utf8'
    )

    await registerMod({
      id,
      name,
      priority: 0,
      addedAt: Date.now(),
      description: `Cursor set · ${basename(arrow)}`,
      target: request.target,
      kind: 'cursor-set',
      author: null,
      version: null,
      sourceUrl: null,
      communityId: null,
      provides: ['content/textures/Cursors/KeyboardMouse/ArrowCursor.png', 'content/textures/Cursors/KeyboardMouse/ArrowFarCursor.png']
    })

    await maybeApplyNow()
    return { ok: true, data: await listMods() }
  } catch (error) {
    logger.error(`Cursor set generation failed: ${String(error)}`)
    return { ok: false, error: error instanceof Error ? error.message : 'Could not build the cursor set' }
  }
}

/* ------------------------------------------------------------- Generator */

function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim())
}

/**
 * The rich mod generator.
 *
 * Everything it writes is generated locally: flat textures for the UI surfaces,
 * gradients for the cursor and emote wheel, and the user's own images where
 * they supplied them. Nothing is downloaded, so the result is deterministic and
 * works offline.
 */
export async function generateRichMod(request: RichModRequest): Promise<OperationResult<ModEntry[]>> {
  const color = (request.color ?? '').trim()
  const accent = (request.accent ?? '').trim()

  if (!isHexColor(color) || !isHexColor(accent)) {
    return { ok: false, error: 'Provide both colours as hex values such as #101014' }
  }

  const gradientTo = request.gradientTo && isHexColor(request.gradientTo) ? request.gradientTo.trim() : null
  const targets = request.targets

  try {
    const name = sanitizeName(request.name || 'Remielle mod', 'Remielle mod')
    const id = newModId(name)
    const destination = modDirectory(id)
    const provides: string[] = []

    const write = async (relativePath: string, data: Buffer): Promise<void> => {
      const target = safeJoin(destination, ...relativePath.split('/'))
      await ensureDir(join(target, '..'))
      await writeFile(target, data)
      provides.push(relativePath)
    }

    /** Gradient when a second colour was given, otherwise flat. */
    const surface = (from: string, to: string, angle: number, size: number, vignette = false): Buffer =>
      gradientTo
        ? gradientPng({ from, to: to === from ? gradientTo : to, angle, size, vignette })
        : solidPng(from)

    if (targets.uiSurfaces) {
      await write('content/textures/ui/GuiBackground.png', surface(color, color, 90, 32))
      await write('content/textures/ui/GuiAccent.png', solidPng(accent))
      await write('content/textures/ui/GuiGradient.png', surface(color, accent, 155, 64, true))
    }

    if (targets.cursor) {
      const supplied = request.cursorImage && (await pathExists(request.cursorImage))
      if (supplied && request.cursorImage) {
        await write('content/textures/Cursors/KeyboardMouse/ArrowCursor.png', await readBinary(request.cursorImage))
        await write('content/textures/Cursors/KeyboardMouse/ArrowFarCursor.png', await readBinary(request.cursorImage))
      } else {
        // A soft radial-ish tile reads as a deliberate cursor stand-in rather
        // than a coloured square.
        await write(
          'content/textures/Cursors/KeyboardMouse/ArrowCursor.png',
          gradientPng({ from: accent, to: color, angle: 45, size: 32, vignette: true })
        )
        await write(
          'content/textures/Cursors/KeyboardMouse/ArrowFarCursor.png',
          gradientPng({ from: color, to: accent, angle: 225, size: 32, vignette: true })
        )
      }
    }

    if (targets.shiftLock) {
      if (request.shiftLockImage && (await pathExists(request.shiftLockImage))) {
        await write('content/textures/ShiftLock.png', await readBinary(request.shiftLockImage))
      } else {
        await write('content/textures/ShiftLock.png', surface(accent, color, 135, 48, true))
      }
    }

    if (targets.emoteWheel) {
      await write('ExtraContent/textures/EmoteWheel.png', surface(color, accent, 90, 64, true))
    }

    if (targets.voiceChat) {
      await write('content/textures/ui/VoiceChat.png', surface(accent, color, 200, 32))
    }

    if (provides.length === 0) {
      await removeDir(destination)
      return { ok: false, error: 'Select at least one thing for the mod to change' }
    }

    await writeFile(
      join(destination, 'README.txt'),
      [
        name,
        '',
        `Base: ${color}`,
        `Accent: ${accent}`,
        gradientTo ? `Gradient to: ${gradientTo}` : 'Flat colours',
        `Parts: ${Object.entries(targets)
          .filter(([, on]) => on)
          .map(([key]) => key)
          .join(', ')}`,
        '',
        'Generated locally by RemielleStrap — no assets were downloaded.',
        'Delete this mod from the Mods page to revert.',
        ''
      ].join('\n'),
      'utf8'
    )

    await registerMod({
      id,
      name,
      priority: 0,
      addedAt: Date.now(),
      description: `${gradientTo ? `${color} → ${gradientTo}` : color} · ${provides.length} file(s)`,
      target: request.target,
      kind: 'generated',
      author: 'RemielleStrap',
      version: null,
      sourceUrl: null,
      communityId: null,
      provides
    })

    await maybeApplyNow()
    logger.info(`Generated rich mod '${name}' (${provides.length} files)`)
    return { ok: true, data: await listMods() }
  } catch (error) {
    logger.error(`Rich mod generation failed: ${String(error)}`)
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not generate the mod'
    }
  }
}

async function readBinary(file: string): Promise<Buffer> {
  const { readFile } = await import('fs/promises')
  return readFile(file)
}

/**
 * The original single-purpose generator, kept as an alias so nothing that
 * already calls it breaks. It is the rich generator with just the UI surfaces.
 */
export async function generateColorMod(
  request: ColorModRequest
): Promise<OperationResult<ModEntry[]>> {
  return generateRichMod({
    name: request.name,
    color: request.color,
    accent: request.accent ?? request.color,
    gradientTo: null,
    targets: {
      uiSurfaces: true,
      cursor: false,
      shiftLock: false,
      emoteWheel: false,
      voiceChat: false
    },
    target: defaultTarget(),
    cursorImage: null,
    shiftLockImage: null
  })
}

/* --------------------------------------------------------------- Metadata */

export async function setTarget(id: string, target: ModTarget): Promise<ModEntry[]> {
  const index = await readIndex()
  const mods = index.mods.map((mod) => (mod.id === id ? { ...mod, target } : mod))
  await writeIndex({ mods })
  logger.info(`Mod '${id}' now targets ${target}`)
  emit('mods:changed', await listMods())
  return listMods()
}

/** Every client path claimed by more than one enabled mod. */
export async function conflicts(): Promise<ModConflict[]> {
  const index = await reconcile()
  const enabled = new Set(getSettings().enabledMods)
  const byPath = new Map<string, string[]>()

  for (const mod of [...index.mods].sort((a, b) => a.priority - b.priority)) {
    if (!enabled.has(mod.id)) continue
    for (const relativePath of mod.provides) {
      const list = byPath.get(relativePath) ?? []
      list.push(mod.id)
      byPath.set(relativePath, list)
    }
  }

  return [...byPath.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([relativePath, modIds]) => ({ relativePath, modIds }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

/* ------------------------------------------------------------ Community */

interface CommunityCacheFile {
  source: string
  fetchedAt: number
  mods: CommunityMod[]
}

/**
 * The community catalogue.
 *
 * The index is a plain JSON array of mod descriptors at a user-configurable
 * URL, which keeps this feature usable with any curated list (ours, a GitHub
 * raw file, or a fork's own index) without hard-coding a service.
 */
export async function communityIndex(options: { refresh?: boolean; query?: string } = {}): Promise<CommunityIndex> {
  const settings = getSettings()
  const source = settings.communityModIndexUrl
  const cacheFile = join(paths.communityCache, 'index.json')

  const readCache = async (): Promise<CommunityCacheFile | null> =>
    readJson<CommunityCacheFile | null>(cacheFile, null)

  const filter = (mods: CommunityMod[]): CommunityMod[] => {
    const query = options.query?.trim().toLowerCase()
    if (!query) return mods
    return mods.filter((mod) =>
      [mod.name, mod.author, mod.description, ...mod.tags].join(' ').toLowerCase().includes(query)
    )
  }

  let cached: CommunityCacheFile | null = null

  if (source.length === 0) {
    return { source, fetchedAt: 0, mods: [], error: 'No community index URL is configured', cached: false }
  }

  if (!options.refresh) {
    cached = await readCache()
    if (cached?.source === source) {
      return { source, fetchedAt: cached.fetchedAt, mods: filter(cached.mods), error: null, cached: true }
    }
  }

  try {
    const payload = await getJson<unknown>(source, { retries: 1, timeoutMs: 20_000 })
    const mods = parseCommunityIndex(payload)

    await ensureDir(paths.communityCache)
    await writeJson(cacheFile, { source, fetchedAt: Date.now(), mods } satisfies CommunityCacheFile)

    logger.info(`Community index refreshed: ${mods.length} mod(s)`)
    return { source, fetchedAt: Date.now(), mods: filter(mods), error: null, cached: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Community index fetch failed: ${message}`)

    cached = cached ?? (await readCache())
    if (cached) {
      return {
        source,
        fetchedAt: cached.fetchedAt,
        mods: filter(cached.mods),
        error: message,
        cached: true
      }
    }

    return { source, fetchedAt: 0, mods: [], error: message, cached: false }
  }
}

function parseCommunityIndex(payload: unknown): CommunityMod[] {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { mods?: unknown })?.mods)
      ? ((payload as { mods: unknown[] }).mods as unknown[])
      : []

  const out: CommunityMod[] = []

  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const record = raw as Record<string, unknown>

    const id = typeof record.id === 'string' ? record.id.slice(0, 80) : null
    const url = typeof record.url === 'string' ? record.url : null
    if (!id || !url) continue

    // Only https downloads, and never a file:// or data: URL.
    if (!/^https:\/\//i.test(url)) continue

    out.push({
      id,
      name: typeof record.name === 'string' ? record.name.slice(0, 120) : id,
      author: typeof record.author === 'string' ? record.author.slice(0, 80) : 'Unknown',
      description: typeof record.description === 'string' ? record.description.slice(0, 600) : '',
      version: typeof record.version === 'string' ? record.version.slice(0, 40) : '1.0.0',
      url,
      sha256: typeof record.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(record.sha256) ? record.sha256 : null,
      sizeBytes: typeof record.size === 'number' ? record.size : null,
      previewUrl: typeof record.preview === 'string' ? record.preview : null,
      tags: Array.isArray(record.tags)
        ? record.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 12)
        : [],
      target:
        record.target === 'player' || record.target === 'studio' || record.target === 'both'
          ? record.target
          : 'player',
      updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : null
    })

    if (out.length >= 500) break
  }

  return out
}

/** Downloads and installs selected community mods in one pass. */
export async function installCommunity(
  request: CommunityInstallRequest
): Promise<OperationResult<ModEntry[]>> {
  const index = await communityIndex({})
  const wanted = index.mods.filter((mod) => request.ids.includes(mod.id))

  if (wanted.length === 0) {
    return { ok: false, error: index.error ?? 'None of those mods are in the current index' }
  }

  const failures: string[] = []

  for (const mod of wanted) {
    const archive = join(paths.communityCache, `${mod.id}.zip`)

    try {
      await ensureDir(paths.communityCache)
      await downloadToFile(mod.url, archive, { retries: 1, timeoutMs: 120_000 })

      if (mod.sha256) {
        const { sha256File } = await import('../utils/hash')
        const digest = await sha256File(archive)
        if (digest.toLowerCase() !== mod.sha256.toLowerCase()) {
          await rm(archive, { force: true })
          failures.push(`${mod.name}: checksum mismatch, the download was discarded`)
          continue
        }
      }

      if (!(await isZipFile(archive))) {
        await rm(archive, { force: true })
        failures.push(`${mod.name}: the download was not a zip archive`)
        continue
      }

      const id = newModId(mod.name)
      const destination = modDirectory(id)
      await ensureDir(destination)
      await extractZip(archive, destination)
      await flattenSingleRoot(destination)

      await registerMod({
        id,
        name: mod.name,
        priority: 0,
        addedAt: Date.now(),
        description: mod.description || `Community mod by ${mod.author}`,
        target: request.target ?? mod.target,
        kind: 'community',
        author: mod.author,
        version: mod.version,
        sourceUrl: mod.url,
        communityId: mod.id,
        provides: await describeProvides(destination)
      })

      logger.info(`Installed community mod '${mod.name}' (${mod.version})`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${mod.name}: ${message}`)
      logger.warn(`Community install of '${mod.name}' failed: ${message}`)
    }
  }

  await maybeApplyNow()
  const mods = await listMods()

  if (failures.length > 0) {
    return { ok: true, data: mods, error: failures.join('\n') }
  }
  return { ok: true, data: mods }
}

/** Re-downloads community mods whose version moved upstream. */
export async function updateCommunityMods(): Promise<{ updated: string[]; skipped: string[] }> {
  const index = await communityIndex({})
  const mods = await listMods()
  const updated: string[] = []
  const skipped: string[] = []

  for (const mod of mods) {
    if (!mod.communityId) continue
    const remote = index.mods.find((item) => item.id === mod.communityId)

    if (!remote) {
      skipped.push(`${mod.name}: no longer in the index`)
      continue
    }
    if (remote.version === mod.version) continue

    // Replace in place: remove the old folder, then fetch the new version.
    await deleteMod(mod.id)
    const result = await installCommunity({ ids: [remote.id] })
    if (result.ok) updated.push(`${remote.name} → ${remote.version}`)
    else skipped.push(`${remote.name}: ${result.error ?? 'install failed'}`)
  }

  return { updated, skipped }
}

/* ------------------------------------------------------ Toggle / ordering */

export async function toggleMod(id: string, enabled: boolean): Promise<ModEntry[]> {
  const settings = getSettings()
  const current = new Set(settings.enabledMods)

  if (enabled) current.add(id)
  else current.delete(id)

  await saveSettings({ enabledMods: [...current] })
  logger.info(`Mod '${id}' ${enabled ? 'enabled' : 'disabled'}`)
  emit('mods:changed', await listMods())
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
  emit('mods:changed', await listMods())
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
  emit('mods:changed', await listMods())
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

export async function openFolderIn(target: string): Promise<OperationResult> {
  try {
    await ensureDir(target)
    const error = await shell.openPath(target)
    return error ? { ok: false, error } : { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not open folder' }
  }
}

/* ----------------------------------------------------------------- Apply */

/** True when a mod built for `target` should be copied into `binaryType`. */
function targetsBinary(target: ModTarget, binaryType: BinaryType): boolean {
  if (target === 'both') return true
  return target === 'studio' ? binaryType === 'WindowsStudio64' : binaryType === 'WindowsPlayer'
}

/**
 * Copies every enabled mod into the version directory in priority order.
 * Returns the relative paths written, which are persisted so the next update
 * knows which files came from mods.
 */
export async function applyMods(versionDirectory: string, binaryType: BinaryType = 'WindowsPlayer'): Promise<string[]> {
  const mods = (await listMods())
    .filter((mod) => mod.enabled)
    .sort((a, b) => a.priority - b.priority)

  const applicable = mods.filter((mod) => targetsBinary(mod.target, binaryType))

  if (applicable.length === 0) {
    await saveRobloxState({ modManifest: [] })
    return []
  }

  const written = new Set<string>()

  for (const mod of applicable) {
    const files = await listFiles(mod.path)

    for (const relativePath of files) {
      const normalised = relativePath.split(sep).join('/')

      if (/^readme\.txt$/i.test(normalised) || normalised.startsWith('mod.json')) continue
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

    logger.info(`Applied mod '${mod.name}' (${files.length} files, target ${mod.target})`)
  }

  const manifest = [...written]
  await saveRobloxState({ modManifest: manifest })
  return manifest
}

export interface RevertOptions {
  versionDirectory: string
  versionGuid: string
  binaryType: BinaryType
  channel: string
}

/**
 * Puts the stock files a previous launch's mods overwrote back in place by
 * extracting them from their source package, and removes any files the mods
 * added that have no stock equivalent. Called before applying a fresh set so
 * disabled mods stop taking effect without a full reinstall.
 */
export async function revertMods(
  options: RevertOptions,
  manifest: readonly string[]
): Promise<number> {
  let reverted = 0

  for (const relativePath of manifest) {
    const target = safeJoin(options.versionDirectory, ...relativePath.split('/'))

    try {
      const packageName = getPackageForFile(relativePath, options.binaryType)

      if (packageName) {
        const written = await restoreFileFromPackage(
          relativePath,
          options.versionGuid,
          options.versionDirectory,
          options.binaryType,
          options.channel
        )
        if (written.length > 0) {
          reverted += 1
          continue
        }
      }

      // No stock package supplied this file — the mod added it. Remove it.
      if ((await pathExists(target)) && (await stat(target)).isFile()) {
        await rm(target, { force: true })
        reverted += 1
      }
    } catch (error) {
      // A file we can't restore is not fatal; the reinstall path will fix it.
      logger.warn(`Could not revert '${relativePath}': ${String(error)}`)
    }
  }

  if (reverted > 0) logger.info(`Reverted ${reverted} modded file(s)`)
  return reverted
}

/**
 * Applies the current mod set to the installed client without a full
 * reinstall. Safe to call any time the client is not running: the previous
 * manifest is reverted first, then the enabled set is copied over it.
 */
export async function applyNow(): Promise<OperationResult<{ files: number; flags: number }>> {
  const { currentInstall } = await import('../core/bootstrapper')

  const install = await currentInstall()
  if (!install) {
    return { ok: false, error: 'Roblox is not installed yet — install it first, then apply mods' }
  }

  if (await isClientRunning()) {
    return {
      ok: false,
      error: 'Close Roblox first: mod files cannot be replaced while the client has them mapped'
    }
  }

  try {
    const state = await import('./stateStore')
    const current = state.getRobloxState()

    if (current.modManifest.length > 0) {
      await revertMods(
        {
          versionDirectory: install.directory,
          versionGuid: install.versionGuid,
          binaryType: install.binaryType,
          channel: install.channel
        },
        current.modManifest
      )
    }

    const files = await applyMods(install.directory, install.binaryType)
    const { applyFlags } = await import('./fastflags')
    const flags = await applyFlags(install.directory)

    logger.info(`Applied ${files.length} modded file(s) and ${flags} flag(s) without relaunching`)
    return { ok: true, data: { files: files.length, flags } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Applying mods to the live install failed: ${message}`)
    return { ok: false, error: message }
  }
}

async function isClientRunning(): Promise<boolean> {
  const { currentActivity } = await import('./activity')
  return currentActivity().robloxRunning
}

/** Honours `applyModsImmediately` after an import. Never throws. */
async function maybeApplyNow(): Promise<void> {
  if (!getSettings().applyModsImmediately) return
  const result = await applyNow().catch(() => ({ ok: false as const, error: 'apply failed' }))
  if (!result.ok) {
    logger.info(`Immediate apply skipped: ${'error' in result ? result.error : 'unknown'}`)
  }
}

/* --------------------------------------------------------------- Helpers */

/** Slot definitions, exposed for the UI's file-replacement pickers. */
export function fileSlots(): ModFileSlotDefinition[] {
  return [...MOD_FILE_SLOTS]
}

/** Diagnostics used by the About page. */
export async function summary(): Promise<{ mods: number; enabled: number; bytes: number; conflicts: number }> {
  const mods = await listMods()
  return {
    mods: mods.length,
    enabled: mods.filter((mod) => mod.enabled).length,
    bytes: mods.reduce((sum, mod) => sum + mod.sizeBytes, 0),
    conflicts: (await conflicts()).length
  }
}

export { solidPng, gradientPng, parseHex, toHex }

/** Kept for callers that only want a digest of a single mod folder. */
export async function modDigest(id: string): Promise<string | null> {
  const index = await readIndex()
  const mod = index.mods.find((entry) => entry.id === id)
  if (!mod) return null

  const file = mod.provides[0]
  if (!file) return null

  const target = safeJoin(modDirectory(id), ...file.split('/'))
  return (await pathExists(target)) ? md5File(target) : null
}
