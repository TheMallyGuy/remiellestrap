import { promises as fs, existsSync } from 'fs'
import { dirname, join, normalize, relative, resolve, sep } from 'path'

/** Filesystem helpers shared by the installer, mods engine and caches. */

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export function pathExistsSync(target: string): boolean {
  return existsSync(target)
}

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/** Atomic JSON write: write to a temp file then rename over the target. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await ensureDir(dirname(file))
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export async function removeDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true })
}

export async function removeFile(file: string): Promise<void> {
  await fs.rm(file, { force: true })
}

export interface DirStats {
  fileCount: number
  totalBytes: number
}

export async function dirStats(dir: string): Promise<DirStats> {
  let fileCount = 0
  let totalBytes = 0

  async function walk(current: string): Promise<void> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(full)
          fileCount += 1
          totalBytes += stat.size
        } catch {
          /* ignore */
        }
      }
    }
  }

  await walk(dir)
  return { fileCount, totalBytes }
}

/** Recursively list files relative to `root`. */
export async function listFiles(root: string): Promise<string[]> {
  const out: string[] = []

  async function walk(current: string): Promise<void> {
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.isFile()) out.push(relative(root, full))
    }
  }

  await walk(root)
  return out
}

export async function copyDir(from: string, to: string): Promise<number> {
  let copied = 0
  const files = await listFiles(from)
  for (const rel of files) {
    const src = join(from, rel)
    const dest = join(to, rel)
    await ensureDir(dirname(dest))
    await fs.copyFile(src, dest)
    copied += 1
  }
  return copied
}

/**
 * Guard against path traversal: resolves `candidate` and asserts it stays
 * inside `root`. Used for anything derived from renderer input or zip entries.
 */
export function isInside(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root)
  const resolvedCandidate = resolve(candidate)
  if (resolvedCandidate === resolvedRoot) return true
  return resolvedCandidate.startsWith(resolvedRoot + sep)
}

export function safeJoin(root: string, ...segments: string[]): string {
  const target = normalize(join(root, ...segments))
  if (!isInside(root, target)) {
    throw new Error(`Refusing to resolve path outside of ${root}: ${segments.join('/')}`)
  }
  return target
}

/** Sanitises a user-supplied name for use as a single path segment. */
export function sanitizeName(name: string, fallback = 'untitled'): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+$/, '')
    .slice(0, 80)
  return cleaned.length > 0 ? cleaned : fallback
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, index)
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
