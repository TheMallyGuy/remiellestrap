import { promises as fs } from 'fs'
import { extname, join } from 'path'
import type { ArtAsset, ArtRequest, BooruPost, BooruSearchRequest, CacheStats } from '@shared/models'
import { DEFAULT_BOORU_TAGS, type ArtSlot, ART_SLOTS } from '@shared/settings'
import type { CachedArt } from '@shared/state'
import { paths } from '../utils/paths'
import { artUrl } from '../app/protocol'
import { dirStats, ensureDir, pathExists, removeDir } from '../utils/fs'
import { shortId } from '../utils/hash'
import { createLogger } from '../utils/logger'
import { getBuffer, getJson } from './http'
import { getSettings, saveSettingsQuiet } from './settingsStore'
import { clearArtCacheState, getState, loadState, setCachedArt } from './stateStore'
import { emit } from './events'

const logger = createLogger('Booru')

/**
 * Safebooru runtime art pipeline.
 *
 * All Remielle artwork is fetched from Safebooru's DAPI at runtime — nothing
 * is bundled with the app. Chosen posts are persisted per slot so the UI is
 * stable between launches, and image bytes are cached on disk so the final
 * view renders local files instead of hotlinking the remote CDN.
 */

const API_BASE = 'https://safebooru.org/index.php'
const POST_PAGE = 'https://safebooru.org/index.php?page=post&s=view&id='

/** Hard cap for the on-disk art cache. */
const MAX_CACHE_BYTES = 256 * 1024 * 1024
const MAX_IMAGE_BYTES = 24 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

/** Safebooru's raw DAPI post shape (json=1). */
interface RawPost {
  id?: number
  directory?: string
  image?: string
  hash?: string
  width?: number
  height?: number
  tags?: string
  rating?: string
  score?: number | null
  sample?: boolean | number
  sample_width?: number
  sample_height?: number
  file_url?: string
  preview_url?: string
  sample_url?: string
  owner?: string
  change?: number
}

/**
 * Safebooru's json=1 responses omit absolute URLs in some deployments, so we
 * reconstruct them from `directory` + `image` the same way the site does.
 */
function buildUrls(raw: RawPost): { fileUrl: string; previewUrl: string; sampleUrl: string | null } | null {
  if (raw.file_url && raw.preview_url) {
    return {
      fileUrl: raw.file_url,
      previewUrl: raw.preview_url,
      sampleUrl: raw.sample_url ?? null
    }
  }

  if (!raw.directory || !raw.image) return null

  const image = raw.image
  const base = image.replace(/\.[^.]+$/, '')
  const fileUrl = `https://safebooru.org/images/${raw.directory}/${image}`
  const previewUrl = `https://safebooru.org/thumbnails/${raw.directory}/thumbnail_${base}.jpg`
  const hasSample = raw.sample === true || raw.sample === 1
  const sampleUrl = hasSample
    ? `https://safebooru.org/samples/${raw.directory}/sample_${base}.jpg`
    : null

  return { fileUrl, previewUrl, sampleUrl }
}

function toPost(raw: RawPost): BooruPost | null {
  if (typeof raw.id !== 'number') return null
  const urls = buildUrls(raw)
  if (!urls) return null

  return {
    id: raw.id,
    fileUrl: urls.fileUrl,
    previewUrl: urls.previewUrl,
    sampleUrl: urls.sampleUrl,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    tags: raw.tags ?? '',
    rating: raw.rating ?? 'safe',
    score: typeof raw.score === 'number' ? raw.score : 0,
    postUrl: `${POST_PAGE}${raw.id}`
  }
}

function buildSearchUrl(tags: string, page: number, limit: number): string {
  const params = new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
    limit: String(Math.min(Math.max(limit, 1), 100)),
    pid: String(Math.max(page, 0)),
    tags: tags.trim()
  })
  return `${API_BASE}?${params.toString()}`
}

/** Raw Safebooru search. Returns [] when nothing matches. */
export async function searchPosts(request: BooruSearchRequest, signal?: AbortSignal): Promise<BooruPost[]> {
  const tags = (request.tags ?? '').trim()
  if (tags.length === 0) return []

  const url = buildSearchUrl(tags, request.page ?? 0, request.limit ?? 40)
  logger.info(`Searching: ${tags} (page ${request.page ?? 0})`)

  try {
    const payload = await getJson<RawPost[] | { post?: RawPost[] } | null>(url, { signal, retries: 2 })

    // Safebooru returns a bare array, an empty string, or occasionally an
    // object wrapper depending on the result count.
    const rawPosts: RawPost[] = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.post)
        ? payload.post
        : []

    const posts = rawPosts
      .map(toPost)
      .filter((post): post is BooruPost => post !== null)
      .filter((post) => ALLOWED_EXTENSIONS.has(extname(post.fileUrl).toLowerCase()))

    logger.info(`Found ${posts.length} post(s) for "${tags}"`)
    return posts
  } catch (error) {
    logger.error(`Search failed for "${tags}": ${String(error)}`)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * Progressive fallback: if the configured tags return nothing, retry with
 * successively broader queries so a slot is never permanently empty.
 */
function fallbackChain(tags: string, slot: string): string[] {
  const chain: string[] = [tags]
  const words = tags.trim().split(/\s+/).filter(Boolean)

  if (words.length > 1) chain.push(words[0])
  const defaultTag = DEFAULT_BOORU_TAGS[slot as ArtSlot]
  if (defaultTag && !chain.includes(defaultTag)) chain.push(defaultTag)
  if (!chain.includes('remielle_dan')) chain.push('remielle_dan')
  // Final safety net: the character's franchise, so the theme still lands.
  chain.push('zenless_zone_zero')

  return [...new Set(chain)]
}

async function searchWithFallback(
  tags: string,
  slot: string,
  signal?: AbortSignal
): Promise<{ posts: BooruPost[]; usedTags: string }> {
  for (const candidate of fallbackChain(tags, slot)) {
    try {
      const posts = await searchPosts({ tags: candidate, limit: 60 }, signal)
      if (posts.length > 0) return { posts, usedTags: candidate }
      logger.warn(`No results for "${candidate}", trying next fallback`)
    } catch (error) {
      logger.warn(`Search error for "${candidate}": ${String(error)}`)
    }
  }
  return { posts: [], usedTags: tags }
}

function cacheFileName(postId: number, url: string): string {
  const ext = extname(url).toLowerCase()
  const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.jpg'
  return `${postId}-${shortId(url, 8)}${safeExt}`
}

/** Downloads an image into the art cache and returns the local file name. */
async function cacheImage(url: string, postId: number, signal?: AbortSignal): Promise<string | null> {
  const fileName = cacheFileName(postId, url)
  const target = join(paths.artCache, fileName)

  if (await pathExists(target)) return fileName

  try {
    await ensureDir(paths.artCache)
    const buffer = await getBuffer(url, { signal, timeoutMs: 45_000 })

    if (buffer.byteLength === 0) throw new Error('Empty image response')
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      logger.warn(`Skipping ${url}: ${buffer.byteLength} bytes exceeds cache limit`)
      return null
    }

    await fs.writeFile(target, buffer)
    logger.info(`Cached post ${postId} (${buffer.byteLength} bytes) as ${fileName}`)
    return fileName
  } catch (error) {
    logger.error(`Failed to cache ${url}: ${String(error)}`)
    return null
  }
}

function toAsset(cached: CachedArt): ArtAsset {
  return {
    slot: cached.slot,
    postId: cached.postId,
    url: artUrl(cached.fileName),
    previewUrl: cached.previewFileName ? artUrl(cached.previewFileName) : null,
    width: cached.width,
    height: cached.height,
    tags: cached.tags,
    rating: cached.rating,
    postUrl: cached.postUrl,
    fetchedAt: cached.fetchedAt
  }
}

/** Picks a post, preferring larger images for banner-style slots. */
function choosePost(posts: BooruPost[], slot: string, excludeId?: number | null): BooruPost | null {
  let pool = posts.filter((post) => post.id !== excludeId)
  if (pool.length === 0) pool = posts
  if (pool.length === 0) return null

  const wantsWide = slot === 'home_banner' || slot === 'about_header'
  const wantsTall = slot === 'sidebar' || slot === 'splash' || slot === 'bootstrapper'

  const scored = pool
    .map((post) => {
      const ratio = post.height > 0 ? post.width / post.height : 1
      let score = Math.min(post.width * post.height, 12_000_000) / 12_000_000
      if (wantsWide) score += ratio > 1.3 ? 0.6 : 0
      if (wantsTall) score += ratio < 1.1 ? 0.5 : 0
      return { post, score: score + Math.random() * 0.7 }
    })
    .sort((a, b) => b.score - a.score)

  return scored[0]?.post ?? null
}

/**
 * Resolves the artwork for a UI slot.
 *
 * Order of preference:
 *   1. the persisted post for the slot, if its bytes are still cached
 *   2. a fresh search using the slot's configured tags (with fallbacks)
 *   3. null, letting the UI fall back to its typographic treatment
 */
export async function getArtForSlot(request: ArtRequest, signal?: AbortSignal): Promise<ArtAsset | null> {
  const slot = request.slot
  if (!ART_SLOTS.includes(slot as ArtSlot)) {
    throw new Error(`Unknown art slot: ${slot}`)
  }

  const settings = getSettings()
  await loadState()
  const state = getState()
  const cached = state.booruCache[slot]
  const configuredTags = request.tags?.trim() || settings.booruTags[slot as ArtSlot] || DEFAULT_BOORU_TAGS[slot as ArtSlot]

  // Reuse the persisted choice unless the caller explicitly asked to re-roll
  // or the configured tags changed since it was cached.
  if (!request.shuffle && cached && cached.tags === configuredTags) {
    if (await pathExists(join(paths.artCache, cached.fileName))) {
      return toAsset(cached)
    }
    logger.warn(`Cached file missing for slot ${slot}, refetching`)
  }

  const { posts } = await searchWithFallback(configuredTags, slot, signal)
  if (posts.length === 0) {
    logger.warn(`No artwork available for slot ${slot}`)
    return cached && (await pathExists(join(paths.artCache, cached.fileName))) ? toAsset(cached) : null
  }

  const previousId = request.shuffle ? (cached?.postId ?? null) : null
  const post = choosePost(posts, slot, previousId)
  if (!post) return null

  // Prefer the sample render for very large originals: same art, less disk.
  const shouldUseSample = post.sampleUrl !== null && post.width * post.height > 6_000_000
  const sourceUrl = shouldUseSample && post.sampleUrl ? post.sampleUrl : post.fileUrl

  const fileName = await cacheImage(sourceUrl, post.id, signal)
  if (!fileName) {
    return cached && (await pathExists(join(paths.artCache, cached.fileName))) ? toAsset(cached) : null
  }

  const previewFileName = await cacheImage(post.previewUrl, post.id, signal).catch(() => null)

  const entry: CachedArt = {
    slot,
    postId: post.id,
    fileName,
    previewFileName,
    width: post.width,
    height: post.height,
    tags: configuredTags,
    rating: post.rating,
    sourceUrl,
    postUrl: post.postUrl,
    fetchedAt: Date.now()
  }

  await setCachedArt(slot, entry)

  // Persist the chosen post id so the slot is stable across launches.
  const chosen = { ...settings.chosenBooruPosts, [slot]: post.id }
  await saveSettingsQuiet({ chosenBooruPosts: chosen })

  await enforceCacheBudget()

  const asset = toAsset(entry)
  emit('theme:artUpdated', { slot, asset })
  return asset
}

/** Warms every slot in the background, ignoring individual failures. */
export async function prefetchAllSlots(): Promise<void> {
  for (const slot of ART_SLOTS) {
    try {
      await getArtForSlot({ slot })
    } catch (error) {
      logger.warn(`Prefetch failed for ${slot}: ${String(error)}`)
    }
  }
}

export async function getCacheStats(): Promise<CacheStats> {
  await ensureDir(paths.artCache)
  const stats = await dirStats(paths.artCache)
  return { ...stats, directory: paths.artCache }
}

export async function clearCache(): Promise<CacheStats> {
  logger.info('Clearing art cache')
  await removeDir(paths.artCache)
  await ensureDir(paths.artCache)
  await clearArtCacheState()

  const cleared: Record<string, number | null> = {}
  for (const slot of ART_SLOTS) cleared[slot] = null
  await saveSettingsQuiet({ chosenBooruPosts: cleared })

  for (const slot of ART_SLOTS) emit('theme:artUpdated', { slot, asset: null })

  return getCacheStats()
}

/**
 * Evicts the least-recently fetched files when the cache exceeds its budget.
 * Files still referenced by an active slot are kept.
 */
async function enforceCacheBudget(): Promise<void> {
  try {
    const stats = await dirStats(paths.artCache)
    if (stats.totalBytes <= MAX_CACHE_BYTES) return

    const state = getState()
    const inUse = new Set<string>()
    for (const entry of Object.values(state.booruCache)) {
      inUse.add(entry.fileName)
      if (entry.previewFileName) inUse.add(entry.previewFileName)
    }

    const entries = await fs.readdir(paths.artCache)
    const candidates = await Promise.all(
      entries
        .filter((name) => !inUse.has(name))
        .map(async (name) => {
          const full = join(paths.artCache, name)
          try {
            const stat = await fs.stat(full)
            return { full, size: stat.size, mtime: stat.mtimeMs }
          } catch {
            return null
          }
        })
    )

    const sorted = candidates
      .filter((item): item is { full: string; size: number; mtime: number } => item !== null)
      .sort((a, b) => a.mtime - b.mtime)

    let remaining = stats.totalBytes
    for (const item of sorted) {
      if (remaining <= MAX_CACHE_BYTES) break
      try {
        await fs.rm(item.full, { force: true })
        remaining -= item.size
        logger.info(`Evicted cached art ${item.full}`)
      } catch {
        /* ignore */
      }
    }
  } catch (error) {
    logger.warn(`Cache cleanup failed: ${String(error)}`)
  }
}

export function postUrlFor(postId: number): string {
  return `${POST_PAGE}${postId}`
}
