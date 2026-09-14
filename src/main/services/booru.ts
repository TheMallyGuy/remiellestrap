import { promises as fs } from 'fs'
import { extname, join } from 'path'
import type {
  ArtAsset,
  ArtRequest,
  BooruPost,
  BooruSearchRequest,
  CacheStats
} from '@shared/models'
import {
  DEFAULT_BOORU_TAGS,
  booruProviderLabel,
  type ArtSlot,
  type BooruProvider,
  ART_SLOTS
} from '@shared/settings'
import type { CachedArt } from '@shared/state'
import { paths } from '../utils/paths'
import { artUrl } from '../app/protocol'
import { dirStats, ensureDir, pathExists, removeDir } from '../utils/fs'
import { shortId } from '../utils/hash'
import { createLogger } from '../utils/logger'
import { HttpError, getBuffer, getJson } from './http'
import { getSettings, saveSettingsQuiet } from './settingsStore'
import { clearArtCacheState, getState, loadState, setCachedArt } from './stateStore'
import { emit } from './events'

const logger = createLogger('Booru')
const inFlightArt = new Map<string, Promise<ArtAsset | null>>()

/**
 * Runtime art pipeline.
 *
 * All Remielle artwork is fetched from an image board's public API at
 * runtime — nothing is bundled with the app. Safebooru is the default; the
 * user can switch to Danbooru in Appearance. Chosen posts are persisted per
 * slot so the UI is stable between launches, and image bytes are cached on
 * disk so the final view renders local files instead of hotlinking a CDN.
 */

interface ProviderConfig {
  id: BooruProvider
  origin: string
  postPage: string
  headers: Record<string, string>
  /** Hosts image bytes are accepted from. Post pages live on `origin`. */
  imageHosts: ReadonlySet<string>
}

const PROVIDERS: Record<BooruProvider, ProviderConfig> = {
  safebooru: {
    id: 'safebooru',
    origin: 'https://safebooru.org',
    postPage: 'https://safebooru.org/index.php?page=post&s=view&id=',
    headers: {
      Referer: 'https://safebooru.org/',
      'Accept-Language': 'en-US,en;q=0.8'
    },
    imageHosts: new Set(['safebooru.org'])
  },
  danbooru: {
    id: 'danbooru',
    origin: 'https://danbooru.donmai.us',
    postPage: 'https://danbooru.donmai.us/posts/',
    headers: {
      Referer: 'https://danbooru.donmai.us/',
      'Accept-Language': 'en-US,en;q=0.8'
    },
    imageHosts: new Set(['cdn.donmai.us', 'danbooru.donmai.us'])
  }
}

/** Hard cap for the on-disk art cache. */
const MAX_CACHE_BYTES = 256 * 1024 * 1024
const MAX_IMAGE_BYTES = 24 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])

function resolveProvider(requested?: unknown): BooruProvider {
  if (requested === 'danbooru' || requested === 'safebooru') return requested
  return getSettings().booruProvider === 'danbooru' ? 'danbooru' : 'safebooru'
}

/** Accept only image URLs served by the provider's own hosts. */
function providerImageUrl(
  value: string | null | undefined,
  provider: BooruProvider
): string | null {
  if (!value) return null
  try {
    const config = PROVIDERS[provider]
    const url = new URL(value, config.origin)
    if (url.protocol !== 'https:' || !config.imageHosts.has(url.hostname.toLowerCase())) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}

/**
 * The extension of a remote URL's path. `extname` is run on the pathname —
 * not the raw URL — so query strings (`image.jpg?123`) cannot break the
 * allowlist check.
 */
function extensionOf(url: string): string {
  try {
    return extname(new URL(url).pathname).toLowerCase()
  } catch {
    return extname(url.split('?')[0].split('#')[0]).toLowerCase()
  }
}

/* ------------------------------------------------------------ Safebooru */

/** Safebooru's raw DAPI post shape (json=1). */
interface SafebooruRawPost {
  id?: number
  directory?: string | number
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
function buildSafebooruUrls(
  raw: SafebooruRawPost
): { fileUrl: string; previewUrl: string; sampleUrl: string | null } | null {
  const suppliedFile = providerImageUrl(raw.file_url, 'safebooru')
  const suppliedPreview = providerImageUrl(raw.preview_url, 'safebooru')
  const hasSample = raw.sample === true || raw.sample === 1

  if (suppliedFile && suppliedPreview) {
    return {
      fileUrl: suppliedFile,
      previewUrl: suppliedPreview,
      sampleUrl: hasSample ? providerImageUrl(raw.sample_url, 'safebooru') : null
    }
  }

  const directory = String(raw.directory ?? '')
  const image = raw.image ?? ''
  if (!/^\d+$/.test(directory) || !/^[a-zA-Z0-9._-]+$/.test(image)) return null

  const base = image.replace(/\.[^.]+$/, '')
  const fileUrl = `${PROVIDERS.safebooru.origin}/images/${directory}/${image}`
  const previewUrl = `${PROVIDERS.safebooru.origin}/thumbnails/${directory}/thumbnail_${base}.jpg`
  const sampleUrl = hasSample
    ? `${PROVIDERS.safebooru.origin}/samples/${directory}/sample_${base}.jpg`
    : null

  return { fileUrl, previewUrl, sampleUrl }
}

function toSafebooruPost(raw: SafebooruRawPost): BooruPost | null {
  if (typeof raw.id !== 'number') return null
  const urls = buildSafebooruUrls(raw)
  if (!urls) return null

  return {
    id: raw.id,
    source: 'safebooru',
    fileUrl: urls.fileUrl,
    previewUrl: urls.previewUrl,
    sampleUrl: urls.sampleUrl,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    tags: raw.tags ?? '',
    rating: raw.rating ?? 'safe',
    score: typeof raw.score === 'number' ? raw.score : 0,
    postUrl: `${PROVIDERS.safebooru.postPage}${raw.id}`
  }
}

function buildSafebooruSearchUrl(tags: string, page: number, limit: number): string {
  const params = new URLSearchParams({
    page: 'dapi',
    s: 'post',
    q: 'index',
    json: '1',
    limit: String(Math.min(Math.max(limit, 1), 100)),
    pid: String(Math.max(page, 0)),
    tags: tags.trim()
  })
  return `${PROVIDERS.safebooru.origin}/index.php?${params.toString()}`
}

/** Raw Safebooru search. Returns [] when nothing matches. */
async function searchSafebooru(
  tags: string,
  page: number,
  limit: number,
  signal?: AbortSignal
): Promise<BooruPost[]> {
  const url = buildSafebooruSearchUrl(tags, page, limit)
  logger.info(`Searching Safebooru: ${tags} (page ${Math.max(page, 0)})`)

  try {
    const payload = await getJson<SafebooruRawPost[] | { post?: SafebooruRawPost[] } | null>(url, {
      signal,
      retries: 2,
      headers: PROVIDERS.safebooru.headers
    })

    // Safebooru returns a bare array, an empty string, or occasionally an
    // object wrapper depending on the result count.
    const rawPosts: SafebooruRawPost[] = Array.isArray(payload)
      ? payload
      : payload && Array.isArray(payload.post)
        ? payload.post
        : []

    const posts = rawPosts
      .map(toSafebooruPost)
      .filter((post): post is BooruPost => post !== null)
      .filter((post) => ALLOWED_EXTENSIONS.has(extensionOf(post.fileUrl)))

    logger.info(`Found ${posts.length} Safebooru post(s) for "${tags}"`)
    return posts
  } catch (error) {
    logger.error(`Safebooru search failed for "${tags}": ${String(error)}`)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/* ------------------------------------------------------------- Danbooru */

/** Danbooru's raw /posts.json shape (only the fields we read). */
interface DanbooruRawPost {
  id?: number
  file_url?: string | null
  large_file_url?: string | null
  preview_file_url?: string | null
  image_width?: number | null
  image_height?: number | null
  tag_string?: string
  rating?: string
  score?: number | null
  file_ext?: string
  is_deleted?: boolean
  is_banned?: boolean
}

const DANBOORU_RATINGS: Record<string, string> = {
  g: 'general',
  s: 'sensitive',
  q: 'questionable',
  e: 'explicit'
}

function toDanbooruPost(raw: DanbooruRawPost): BooruPost | null {
  if (typeof raw.id !== 'number') return null
  // Deleted and banned posts have no usable file.
  if (raw.is_deleted === true || raw.is_banned === true) return null

  const fileUrl = providerImageUrl(raw.file_url, 'danbooru')
  if (!fileUrl) return null
  if (!ALLOWED_EXTENSIONS.has(extensionOf(fileUrl))) return null
  // Belt and braces: Danbooru declares the type outright — ugoira (zip) and
  // video (mp4/webm) posts never reach the image pipeline.
  if (raw.file_ext && !ALLOWED_EXTENSIONS.has(`.${raw.file_ext.toLowerCase()}`)) return null

  return {
    id: raw.id,
    source: 'danbooru',
    fileUrl,
    previewUrl: providerImageUrl(raw.preview_file_url, 'danbooru') ?? fileUrl,
    sampleUrl: providerImageUrl(raw.large_file_url, 'danbooru'),
    width: raw.image_width ?? 0,
    height: raw.image_height ?? 0,
    tags: raw.tag_string ?? '',
    rating: DANBOORU_RATINGS[raw.rating ?? ''] ?? raw.rating ?? 'unknown',
    score: typeof raw.score === 'number' ? raw.score : 0,
    postUrl: `${PROVIDERS.danbooru.postPage}${raw.id}`
  }
}

/**
 * Appends `-rating:q -rating:e` unless safe-only is off or the query already
 * constrains the rating itself. Danbooru — unlike Safebooru — hosts explicit
 * posts, so the default keeps the launcher safe-for-work.
 */
function withDanbooruSafeOnly(tags: string): string {
  if (!getSettings().danbooruSafeOnly) return tags
  if (/(?:^|\s)-?rating\s*:/i.test(tags)) return tags
  return `${tags} -rating:q -rating:e`.trim()
}

function buildDanbooruSearchUrl(tags: string, page: number, limit: number): string {
  const params = new URLSearchParams({
    tags: withDanbooruSafeOnly(tags).trim(),
    // Danbooru pages are 1-based; ours are 0-based.
    page: String(Math.max(page, 0) + 1),
    limit: String(Math.min(Math.max(limit, 1), 100))
  })

  // Authenticated callers get far higher rate limits. These values are sent
  // only to Danbooru, and the URL carrying them is never logged.
  const login = getSettings().danbooruLogin.trim()
  const apiKey = getSettings().danbooruApiKey.trim()
  if (login.length > 0 && apiKey.length > 0) {
    params.set('login', login)
    params.set('api_key', apiKey)
  }

  return `${PROVIDERS.danbooru.origin}/posts.json?${params.toString()}`
}

/** Raw Danbooru search. Returns [] when nothing matches. */
async function searchDanbooru(
  tags: string,
  page: number,
  limit: number,
  signal?: AbortSignal
): Promise<BooruPost[]> {
  const url = buildDanbooruSearchUrl(tags, page, limit)
  logger.info(`Searching Danbooru: ${tags} (page ${Math.max(page, 0)})`)

  try {
    const payload = await getJson<DanbooruRawPost[] | null>(url, {
      signal,
      retries: 2,
      headers: PROVIDERS.danbooru.headers
    })

    const posts = (Array.isArray(payload) ? payload : [])
      .map(toDanbooruPost)
      .filter((post): post is BooruPost => post !== null)

    logger.info(`Found ${posts.length} Danbooru post(s) for "${tags}"`)
    return posts
  } catch (error) {
    if (error instanceof HttpError && error.status === 429) {
      logger.error(`Danbooru rate limit hit for "${tags}"`)
      throw new Error(
        'Danbooru rate-limited this search. Wait a minute, or add a Danbooru login and API key in Appearance for higher limits.'
      )
    }
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      logger.error(`Danbooru rejected the request for "${tags}" (HTTP ${error.status})`)
      throw new Error(
        'Danbooru rejected this search. If you entered a login and API key, double-check them in Appearance.'
      )
    }
    logger.error(`Danbooru search failed for "${tags}": ${String(error)}`)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/* ---------------------------------------------------------------- search */

/** Raw provider search. Returns [] when nothing matches. */
export async function searchPosts(
  request: BooruSearchRequest,
  signal?: AbortSignal
): Promise<BooruPost[]> {
  const tags = (request.tags ?? '').trim()
  if (tags.length === 0) return []

  const provider = resolveProvider(request.provider)
  const page = request.page ?? 0
  const limit = request.limit ?? 40

  return provider === 'danbooru'
    ? searchDanbooru(tags, page, limit, signal)
    : searchSafebooru(tags, page, limit, signal)
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
  provider: BooruProvider,
  signal?: AbortSignal
): Promise<{ posts: BooruPost[]; usedTags: string }> {
  for (const candidate of fallbackChain(tags, slot)) {
    try {
      const posts = await searchPosts({ tags: candidate, limit: 60, provider }, signal)
      if (posts.length > 0) return { posts, usedTags: candidate }
      logger.warn(`No results for "${candidate}", trying next fallback`)
    } catch (error) {
      logger.warn(`Search error for "${candidate}": ${String(error)}`)
    }
  }
  return { posts: [], usedTags: tags }
}

/* ----------------------------------------------------------------- cache */

function cacheFileName(provider: BooruProvider, postId: number, url: string): string {
  const ext = extensionOf(url)
  const safeExt = ALLOWED_EXTENSIONS.has(ext) ? ext : '.jpg'
  // Namespaced per provider: post ids collide across boards.
  return `${provider}-${postId}-${shortId(url, 8)}${safeExt}`
}

function hasImageSignature(buffer: Buffer): boolean {
  if (buffer.length < 12) return false

  const png = buffer
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  const gif =
    buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
    buffer.subarray(0, 6).toString('ascii') === 'GIF89a'
  const webp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'

  return png || jpeg || gif || webp
}

/** Downloads an image into the art cache and returns the local file name. */
async function cacheImage(
  url: string,
  postId: number,
  provider: BooruProvider,
  signal?: AbortSignal
): Promise<string | null> {
  const fileName = cacheFileName(provider, postId, url)
  const target = join(paths.artCache, fileName)

  if (await pathExists(target)) {
    try {
      const handle = await fs.open(target, 'r')
      try {
        const header = Buffer.alloc(12)
        const { bytesRead } = await handle.read(header, 0, header.length, 0)
        if (hasImageSignature(header.subarray(0, bytesRead))) return fileName
      } finally {
        await handle.close()
      }
    } catch {
      /* remove and replace an unreadable cache entry below */
    }
    await fs.rm(target, { force: true }).catch(() => undefined)
  }

  try {
    await ensureDir(paths.artCache)
    const buffer = await getBuffer(url, {
      signal,
      timeoutMs: 45_000,
      headers: {
        ...PROVIDERS[provider].headers,
        Accept: 'image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8'
      }
    })

    if (buffer.byteLength === 0) throw new Error('Empty image response')
    if (!hasImageSignature(buffer)) {
      throw new Error(`${booruProviderLabel(provider)} returned something other than an image`)
    }
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      logger.warn(`Skipping ${url}: ${buffer.byteLength} bytes exceeds cache limit`)
      return null
    }

    await fs.writeFile(target, buffer)
    logger.info(`Cached ${provider} post ${postId} (${buffer.byteLength} bytes) as ${fileName}`)
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
    source: cached.source ?? 'safebooru',
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
export async function getArtForSlot(
  request: ArtRequest,
  signal?: AbortSignal
): Promise<ArtAsset | null> {
  // Startup prefetch and the first renderer paint often ask for the same slot
  // together. Coalesce those reads so they result in one real API request.
  // Explicit shuffles always bypass this map because the caller asked for a
  // newly selected post.
  const provider = resolveProvider()
  const key = `${provider}\u0000${request.slot}\u0000${request.tags?.trim() ?? ''}`
  if (!request.shuffle) {
    const active = inFlightArt.get(key)
    if (active) return active
  }

  const task = resolveArtForSlot(request, signal)
  if (request.shuffle) return task

  inFlightArt.set(key, task)
  try {
    return await task
  } finally {
    if (inFlightArt.get(key) === task) inFlightArt.delete(key)
  }
}

async function resolveArtForSlot(
  request: ArtRequest,
  signal?: AbortSignal
): Promise<ArtAsset | null> {
  const slot = request.slot
  if (!ART_SLOTS.includes(slot as ArtSlot)) {
    throw new Error(`Unknown art slot: ${slot}`)
  }

  const provider = resolveProvider()
  const settings = getSettings()
  await loadState()
  const state = getState()
  const cached = state.booruCache[slot]
  const configuredTags =
    request.tags?.trim() ||
    settings.booruTags[slot as ArtSlot] ||
    DEFAULT_BOORU_TAGS[slot as ArtSlot]

  // Reuse the persisted choice unless the caller explicitly asked to re-roll,
  // the configured tags changed since it was cached, or the artwork now
  // comes from a different board.
  if (
    !request.shuffle &&
    cached &&
    cached.tags === configuredTags &&
    (cached.source ?? 'safebooru') === provider
  ) {
    if (await pathExists(join(paths.artCache, cached.fileName))) {
      return toAsset(cached)
    }
    logger.warn(`Cached file missing for slot ${slot}, refetching`)
  }

  const { posts } = await searchWithFallback(configuredTags, slot, provider, signal)
  if (posts.length === 0) {
    logger.warn(`No artwork available for slot ${slot}`)
    return cached && (await pathExists(join(paths.artCache, cached.fileName)))
      ? toAsset(cached)
      : null
  }

  const previousId = request.shuffle ? (cached?.postId ?? null) : null
  const post = choosePost(posts, slot, previousId)
  if (!post) return null

  // Prefer the sample render for very large originals: same art, less disk.
  const shouldUseSample = post.sampleUrl !== null && post.width * post.height > 6_000_000
  const sourceUrl = shouldUseSample && post.sampleUrl ? post.sampleUrl : post.fileUrl

  const fileName = await cacheImage(sourceUrl, post.id, provider, signal)
  if (!fileName) {
    return cached && (await pathExists(join(paths.artCache, cached.fileName)))
      ? toAsset(cached)
      : null
  }

  const previewFileName = await cacheImage(post.previewUrl, post.id, provider, signal).catch(
    () => null
  )

  const entry: CachedArt = {
    slot,
    postId: post.id,
    source: provider,
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

export function postUrlFor(postId: number, source: BooruProvider = 'safebooru'): string {
  return `${(PROVIDERS[source] ?? PROVIDERS.safebooru).postPage}${postId}`
}
