import { copyFile, readdir } from 'fs/promises'
import { basename, extname, join } from 'path'
import { app, BrowserWindow, nativeTheme } from 'electron'
import type { FontCatalog, WindowEffectState } from '@shared/models'
import type { WindowEffect } from '@shared/settings'
import { createLogger } from '../utils/logger'
import { paths } from '../utils/paths'
import { ensureDir, pathExists, removeFile } from '../utils/fs'
import { emit } from '../services/events'
import { getSettings } from '../services/settingsStore'

/**
 * Window materials and appearance assets.
 *
 * The background material is applied with Electron's own window APIs:
 * `backgroundMaterial` on Windows (Mica/Acrylic/tabbed) and `setVibrancy` on
 * macOS. Neither exists on Linux, and Windows 10 ignores the material, so the
 * result is read back and reported to the renderer — a theme that asks for Mica
 * on an unsupported machine gets a translucent CSS surface instead of a
 * window the OS renders as plain grey.
 */

const logger = createLogger('Effects')

let applied: WindowEffectState = {
  requested: 'none',
  applied: 'none',
  supported: ['none'],
  platform: process.platform,
  reason: null
}

export function effectState(): WindowEffectState {
  return applied
}

function supportedEffects(): WindowEffect[] {
  if (process.platform === 'win32') return ['none', 'auto', 'mica', 'acrylic', 'blur']
  if (process.platform === 'darwin') return ['none', 'auto', 'blur', 'acrylic']
  return ['none', 'auto', 'blur']
}

/**
 * Applies a material to a window.
 *
 * `auto` prefers Mica on Windows 11 (it follows the desktop wallpaper, which
 * suits a launcher that is usually maximised over a desktop) and Acrylic
 * elsewhere.
 */
export function applyEffect(window: BrowserWindow | null, requested: WindowEffect): WindowEffectState {
  const supported = supportedEffects()

  if (!window || window.isDestroyed()) {
    applied = {
      requested,
      applied: 'none',
      supported,
      platform: process.platform,
      reason: 'No window to apply the material to.'
    }
    return applied
  }

  if (!supported.includes(requested)) {
    applied = {
      requested,
      applied: 'none',
      supported,
      platform: process.platform,
      reason: `${requested} is not available on ${process.platform}.`
    }
    return applied
  }

  let effective: WindowEffect = requested
  let reason: string | null = null

  try {
    if (process.platform === 'win32') {
      // Windows 10 reports version 10.0 with a build below 22000; the Mica
      // attribute exists there but is ignored by the compositor.
      const build = Number.parseInt(process.getSystemVersion().split('.')[2] ?? '0', 10)
      const windows11 = build >= 22000

      if (requested === 'auto') effective = windows11 ? 'mica' : 'acrylic'
      if (effective === 'mica' && !windows11) {
        effective = 'acrylic'
        reason = 'Windows 11 is required for Mica; Acrylic is being used instead.'
      }
      if ((effective === 'mica' || effective === 'acrylic') && !windows11 && build < 17763) {
        effective = 'none'
        reason = 'This build of Windows has no Acrylic support.'
      }

      const material =
        effective === 'mica'
          ? nativeTheme.shouldUseDarkColors
            ? 'mica'
            : 'mica'
          : effective === 'acrylic'
            ? 'acrylic'
            : effective === 'blur'
              ? 'acrylic'
              : 'none'

      window.setBackgroundMaterial(material as 'none' | 'mica' | 'acrylic' | 'tabbed')

      // A material is only visible through a transparent window background.
      if (material === 'none') window.setBackgroundColor('#0a0a0b')
      else window.setBackgroundColor('#00000000')

      applied = { requested, applied: effective, supported, platform: process.platform, reason }
    } else if (process.platform === 'darwin') {
      const vibrancy =
        effective === 'blur' || effective === 'acrylic'
          ? 'under-window'
          : effective === 'auto'
            ? 'sidebar'
            : null

      window.setVibrancy(vibrancy as 'under-window' | 'sidebar' | null)
      applied = { requested, applied: effective, supported, platform: process.platform, reason }
    } else {
      // Linux: Electron cannot blur behind a window, so ask the compositor for
      // translucency where it is available and let the renderer do the rest.
      applied = {
        requested,
        applied: effective === 'none' ? 'none' : 'blur',
        supported,
        platform: process.platform,
        reason:
          effective === 'none'
            ? null
            : 'Linux compositors blur the renderer\u2019s own surfaces; the window itself stays solid.'
      }
    }
  } catch (error) {
    applied = {
      requested,
      applied: 'none',
      supported,
      platform: process.platform,
      reason: error instanceof Error ? error.message : 'The material could not be applied.'
    }
    logger.warn(`Could not apply window material: ${String(applied.reason)}`)
  }

  emit('window:effect', applied)
  if (reason) logger.info(reason)

  return applied
}

/* -------------------------------------------------------- User-provided art */

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.bmp', '.gif']
const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2']

export function isImageFile(file: string): boolean {
  return IMAGE_EXTENSIONS.includes(extname(file).toLowerCase())
}

export function isFontFile(file: string): boolean {
  return FONT_EXTENSIONS.includes(extname(file).toLowerCase())
}

/**
 * Copies a chosen background image into the app's own cache and returns the
 * file name the renderer can load through `app://media/`.
 *
 * Copying (rather than pointing at the original path) means the image keeps
 * working when the original is moved, and keeps the protocol handler's
 * allowlist to a single directory.
 */
export async function importBackground(source: string): Promise<string> {
  if (!isImageFile(source)) throw new Error('That file is not an image')

  await ensureDir(paths.backgrounds)
  const extension = extname(source).toLowerCase()
  const target = join(paths.backgrounds, `background${extension}`)

  // Only one backdrop is kept at a time; remove other extensions from a
  // previous choice so the directory cannot grow without bound.
  for (const existing of IMAGE_EXTENSIONS) {
    const candidate = join(paths.backgrounds, `background${existing}`)
    if (candidate !== target && (await pathExists(candidate))) await removeFile(candidate)
  }

  await copyFile(source, target)
  logger.info(`Background set to ${basename(source)}`)
  return target
}

export async function importFont(source: string): Promise<{ family: string; path: string }> {
  if (!isFontFile(source)) throw new Error('Fonts must be .ttf or .otf files')

  await ensureDir(paths.userFonts)
  const extension = extname(source).toLowerCase()
  const target = join(paths.userFonts, `user-font${extension}`)

  for (const existing of FONT_EXTENSIONS) {
    const candidate = join(paths.userFonts, `user-font${existing}`)
    if (candidate !== target && (await pathExists(candidate))) await removeFile(candidate)
  }

  await copyFile(source, target)
  logger.info(`Loaded UI font from ${basename(source)}`)

  return { family: familyFromFile(source), path: target }
}

/** Derives a displayable family name from a file name. */
function familyFromFile(file: string): string {
  return basename(file, extname(file))
    .replace(/[-_]+/g, ' ')
    .replace(/\b(bold|italic|regular|light|medium|semibold|black|thin)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/**
 * The font catalogue.
 *
 * Enumerating every installed family properly needs a platform API Electron
 * does not expose (and a font parser we are not going to add), so this returns
 * a curated list of families that ship with each platform, plus a Windows
 * registry read and the user's own font files. Anything the user types into the
 * family field is still honoured by the renderer.
 */
export async function fontCatalog(): Promise<FontCatalog> {
  const families = new Set<string>([
    'Cormorant Garamond',
    'Georgia',
    'Segoe UI',
    'Inter',
    'Roboto',
    'Helvetica Neue',
    'SF Pro Text',
    'Noto Sans',
    'DejaVu Sans',
    'Ubuntu',
    'Cantarell',
    'Times New Roman',
    'Garamond',
    'Verdana',
    'Tahoma',
    'Consolas',
    'JetBrains Mono',
    'Fira Code',
    'Cascadia Mono'
  ])

  if (process.platform === 'win32') {
    const { execFile } = await import('child_process')
    const output = await new Promise<string>((resolve) => {
      execFile(
        'reg',
        [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
          '/v',
          '*'
        ],
        { timeout: 6000, windowsHide: true },
        (error, stdout) => resolve(error ? '' : String(stdout))
      )
    })

    for (const line of output.split(/\r?\n/)) {
      const match = /^\s{4}(.+?)\s+(REG_SZ|REG_MULTI_SZ)\s+/.exec(line)
      if (!match) continue
      const family = match[1]
        .replace(/\s*\((TrueType|OpenType|All res|VGA res|90|Bold|Italic)\)\s*$/i, '')
        .replace(/\s+(Bold|Italic|Bold Italic|Regular|Light|SemiBold|Black|Thin)$/i, '')
        .trim()
      if (family.length > 1 && family.length < 60) families.add(family)
    }
  }

  const userFonts: { family: string; path: string }[] = []

  try {
    await ensureDir(paths.userFonts)
    for (const entry of await readdir(paths.userFonts)) {
      if (!isFontFile(entry)) continue
      userFonts.push({ family: familyFromFile(entry), path: join(paths.userFonts, entry) })
    }
  } catch {
    // No user fonts yet.
  }

  const active = getSettings().fontFile

  return {
    families: [...families].sort((a, b) => a.localeCompare(b)),
    userFonts,
    activeFontFile: active && (await pathExists(active)) ? active : null
  }
}

/** Restores the default appearance assets, used by reset-to-defaults. */
export async function clearUserAssets(): Promise<void> {
  await removeFile(join(paths.backgrounds, 'background.png')).catch(() => undefined)
  await removeFile(join(paths.userFonts, 'user-font.ttf')).catch(() => undefined)
}

/** App version, surfaced alongside the effect diagnostics. */
export function appName(): string {
  return app.getName()
}
