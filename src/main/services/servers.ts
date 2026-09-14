import type {
  ServerInstance,
  ServerJoinRequest,
  ServerJoinResult,
  ServerListRequest,
  ServerListResult,
  ServerPingSample
} from '@shared/models'
import type { ServerCacheEntry, ServerCacheFile } from '@shared/state'
import { regionById, regionForDatacenter } from '@shared/catalog'
import { createLogger } from '../utils/logger'
import { paths } from '../utils/paths'
import { ensureDir, readJson, writeJson } from '../utils/fs'
import { getJson, postJson } from './http'
import { getSettings } from './settingsStore'
import { loadState, saveState } from './stateStore'
import { resolveJoinUri } from './accounts'
import * as bootstrapper from '../core/bootstrapper'
import * as robloxApi from './robloxApi'

/**
 * Roblox server browser.
 *
 * Two data sources are combined:
 *
 *  1. Roblox's own public server list (`games.roblox.com`), which gives us job
 *     ids, player counts, max players, and the average ping/FPS that connected
 *     clients have reported.
 *  2. An optional community "datacenter lookup" endpoint, which maps a job id
 *     to the datacenter it runs in. Roblox does not expose this publicly, so
 *     the endpoint is user-configurable and every failure degrades to "region
 *     unknown" rather than an error.
 *
 * Results are cached in memory and in ServerCache.json for
 * `settings.serverCacheSeconds`, because Roblox rate limits this endpoint
 * aggressively (a 429 is answered with the previous, stale list instead of an
 * empty one).
 */

const logger = createLogger('Servers')

const MAX_CACHE_ENTRIES = 40
const RATE_LIMIT_BACKOFF_MS = 60_000

let memoryCache: ServerCacheFile | null = null
let rateLimitedUntil = 0

async function loadCache(): Promise<ServerCacheFile> {
  if (memoryCache) return memoryCache
  await ensureDir(paths.root)
  const raw = await readJson<Partial<ServerCacheFile>>(paths.serverCacheFile, {})
  memoryCache = {
    entries: typeof raw.entries === 'object' && raw.entries !== null ? raw.entries : {},
    regions: typeof raw.regions === 'object' && raw.regions !== null ? raw.regions : {}
  }
  return memoryCache
}

async function saveCache(patch: Partial<ServerCacheFile>): Promise<ServerCacheFile> {
  const current = await loadCache()
  memoryCache = { ...current, ...patch }
  try {
    await writeJson(paths.serverCacheFile, memoryCache)
  } catch (error) {
    logger.warn(`Could not persist the server cache: ${String(error)}`)
  }
  return memoryCache
}

/** Datacenter code -> region id, learned over time and remembered. */
async function rememberedRegion(datacenter: string | null): Promise<string | null> {
  if (!datacenter) return null
  const cache = await loadCache()
  const known = cache.regions[datacenter.toUpperCase()]
  if (known) return known

  const derived = regionForDatacenter(datacenter)
  if (derived) {
    await saveCache({ regions: { ...cache.regions, [datacenter.toUpperCase()]: derived } })
  }
  return derived
}

/* ------------------------------------------------------------ Region API */

interface RegionLookupHit {
  datacenter: string | null
  region: string | null
  uptimeSeconds: number | null
}

/**
 * Queries the configured datacenter lookup for a batch of job ids.
 *
 * The response shape is intentionally parsed loosely — the endpoint is a
 * community service and different deployments answer slightly differently — so
 * we look for `datacenter`/`region`/`uptime` keys under either a map or an
 * array. Anything we cannot understand is simply treated as "unknown".
 */
async function lookupRegions(
  placeId: string,
  serverIds: string[]
): Promise<Map<string, RegionLookupHit>> {
  const out = new Map<string, RegionLookupHit>()
  const settings = getSettings()
  const endpoint = settings.serverRegionApi

  if (!endpoint || serverIds.length === 0) return out
  if (Date.now() < rateLimitedUntil) return out

  const ids = serverIds.slice(0, 100)

  const collect = (payload: unknown): void => {
    if (!payload || typeof payload !== 'object') return

    const entries: Array<[string, unknown]> = Array.isArray(payload)
      ? payload.map((item) => [(item as { id?: string })?.id ?? '', item])
      : Object.entries(payload as Record<string, unknown>)

    for (const [key, value] of entries) {
      if (!value || typeof value !== 'object') continue
      const record = value as Record<string, unknown>
      const id = typeof record.id === 'string' ? record.id : key
      if (!id) continue

      const datacenter =
        typeof record.datacenter === 'string'
          ? record.datacenter
          : typeof record.dataCenter === 'string'
            ? record.dataCenter
            : typeof record.location === 'string'
              ? record.location
              : null

      out.set(id, {
        datacenter,
        region: typeof record.region === 'string' ? record.region : null,
        uptimeSeconds:
          typeof record.uptime === 'number'
            ? record.uptime
            : typeof record.uptimeSeconds === 'number'
              ? record.uptimeSeconds
              : null
      })
    }
  }

  try {
    // GET first: the common deployment takes query parameters.
    const url = new URL(endpoint)
    url.searchParams.set('place_id', placeId)
    url.searchParams.set('placeId', placeId)
    url.searchParams.set('server_ids', ids.join(','))
    const payload = await getJson<unknown>(url.toString(), { retries: 0, timeoutMs: 12_000 })
    collect(payload)
    return out
  } catch (error) {
    logger.info(`Datacenter lookup via GET failed (${String(error)}); trying POST`)
  }

  try {
    const payload = await postJson<unknown>(
      endpoint,
      { placeId, serverIds: ids },
      { retries: 0, timeoutMs: 12_000 }
    )
    collect(payload)
  } catch (error) {
    // A failing community endpoint must never break the server list.
    logger.warn(`Datacenter lookup unavailable: ${String(error)}`)
    rateLimitedUntil = Date.now() + 30_000
  }

  return out
}

/* ------------------------------------------------------------- Listing */

function toInstance(
  raw: robloxApi.RawServer,
  placeId: string,
  firstSeen: number,
  extra: RegionLookupHit | null
): ServerInstance {
  const maxPlayers = typeof raw.maxPlayers === 'number' ? raw.maxPlayers : 0
  const playing = typeof raw.playing === 'number' ? raw.playing : 0

  const age = Math.max(0, Math.round((Date.now() - firstSeen) / 1000))

  return {
    id: raw.id ?? 'unknown',
    placeId,
    region: extra?.region ?? null,
    datacenter: extra?.datacenter ?? null,
    ping: typeof raw.ping === 'number' && raw.ping > 0 ? Math.round(raw.ping) : null,
    fps: typeof raw.fps === 'number' && raw.fps > 0 ? Math.round(raw.fps) : null,
    playing,
    maxPlayers,
    playerTokens: Array.isArray(raw.playerTokens) ? raw.playerTokens.slice(0, 20) : [],
    uptimeSeconds: extra?.uptimeSeconds ?? age,
    firstSeenAt: firstSeen,
    healthy: maxPlayers > 0,
    full: maxPlayers > 0 && playing >= maxPlayers
  }
}

/** Sorts and filters a list the way the user asked for. */
export function rankServers(
  servers: ServerInstance[],
  options: { sort?: ServerJoinRequest['sort']; region?: string; size?: ServerJoinRequest['size'] }
): ServerInstance[] {
  const region = options.region ?? 'any'
  const size = options.size ?? 'any'

  let list = servers.filter((server) => server.healthy)

  if (region !== 'any') {
    const matches = list.filter((server) => server.region === region)
    // Only apply the region filter when it actually matched something, so a
    // lookup outage cannot leave the user with an empty list.
    if (matches.length > 0) list = matches
  }

  if (size === 'small') {
    const threshold = list.length > 0 ? Math.max(1, Math.floor(list.length * 0.5)) : 0
    const sorted = [...list].sort((a, b) => a.playing - b.playing)
    if (threshold > 0) list = sorted.slice(0, threshold)
  } else if (size === 'big') {
    list = [...list].sort((a, b) => b.playing - a.playing)
  }

  const sort = options.sort ?? 'players'

  switch (sort) {
    case 'ping':
      list.sort((a, b) => (a.ping ?? 9999) - (b.ping ?? 9999))
      break
    case 'region':
      list.sort((a, b) => (a.region ?? 'zz').localeCompare(b.region ?? 'zz') || b.playing - a.playing)
      break
    case 'uptime':
      list.sort((a, b) => (b.uptimeSeconds ?? 0) - (a.uptimeSeconds ?? 0))
      break
    default:
      list.sort((a, b) => b.playing - a.playing)
  }

  return list
}

export async function listServers(request: ServerListRequest): Promise<ServerListResult> {
  const settings = getSettings()
  const placeId = request.placeId ?? (request.universeId ? await placeFromUniverse(request.universeId) : null)

  if (!placeId) {
    return {
      placeId: '',
      placeName: null,
      servers: [],
      fetchedAt: Date.now(),
      cached: false,
      error: 'A place id is required to list servers',
      stale: false
    }
  }

  const cache = await loadCache()
  const cached: ServerCacheEntry | undefined = cache.entries[placeId]
  const ttl = Math.max(settings.serverCacheSeconds, 0) * 1000

  if (!request.refresh && cached && Date.now() - cached.fetchedAt < ttl) {
    const servers = await decorate(cached.servers)
    return {
      placeId,
      placeName: await placeNameCached(placeId),
      servers: rankServers(servers, {
        sort: request.sort ?? (settings.autoSortServers ? 'players' : undefined),
        region: request.region ?? settings.preferredRegion,
        size: request.size ?? settings.serverSizePreference
      }),
      fetchedAt: cached.fetchedAt,
      cached: true,
      error: cached.error,
      stale: cached.error !== null
    }
  }

  const limit = Math.min(Math.max(request.limit ?? settings.serverPageSize, 10), 100)

  try {
    const page = await robloxApi.publicServers(placeId, limit, null)
    const state = await loadState()
    const firstSeen = { ...state.serverFirstSeen }
    const learned: RegionLookupHit | null = null

    const raw = page.servers
    for (const server of raw) {
      if (server.id && firstSeen[server.id] === undefined) firstSeen[server.id] = Date.now()
    }

    // Only ask the lookup service about servers we have not classified yet.
    const unknowns = raw
      .filter((server) => server.id && !cache.entries[placeId]?.servers.some((s) => s.id === server.id && s.datacenter))
      .map((server) => server.id as string)

    const lookups = unknowns.length > 0 ? await lookupRegions(placeId, unknowns) : new Map()

    const servers: ServerInstance[] = []
    for (const server of raw) {
      if (!server.id) continue
      const extra = lookups.get(server.id) ?? null
      const instance = toInstance(server, placeId, firstSeen[server.id] ?? Date.now(), extra)
      instance.region = instance.region ?? (await rememberedRegion(instance.datacenter))
      servers.push(instance)
    }

    void learned

    await saveState({ serverFirstSeen: firstSeen })

    const entries = { ...cache.entries, [placeId]: { placeId, servers, fetchedAt: Date.now(), error: null } }
    await saveCache({ entries: pruneEntries(entries) })

    return {
      placeId,
      placeName: await placeNameCached(placeId),
      servers: rankServers(servers, {
        sort: request.sort ?? (settings.autoSortServers ? 'players' : undefined),
        region: request.region ?? settings.preferredRegion,
        size: request.size ?? settings.serverSizePreference
      }),
      fetchedAt: Date.now(),
      cached: false,
      error: null,
      stale: false
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (/429|rate/i.test(message)) {
      rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS
    }

    logger.warn(`Server list for ${placeId} failed: ${message}`)

    if (cached) {
      return {
        placeId,
        placeName: await placeNameCached(placeId),
        servers: rankServers(await decorate(cached.servers), {
          sort: request.sort,
          region: request.region ?? settings.preferredRegion,
          size: request.size ?? settings.serverSizePreference
        }),
        fetchedAt: cached.fetchedAt,
        cached: true,
        error: message,
        stale: true
      }
    }

    return {
      placeId,
      placeName: await placeNameCached(placeId),
      servers: [],
      fetchedAt: Date.now(),
      cached: false,
      error: message,
      stale: false
    }
  }
}

/** Re-derives the current player counts from the cached rows' first-seen data. */
async function decorate(servers: ServerInstance[]): Promise<ServerInstance[]> {
  return servers.map((server) => ({
    ...server,
    uptimeSeconds:
      server.uptimeSeconds ?? Math.max(0, Math.round((Date.now() - server.firstSeenAt) / 1000))
  }))
}

function pruneEntries(entries: Record<string, ServerCacheEntry>): Record<string, ServerCacheEntry> {
  const sorted = Object.entries(entries).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
  return Object.fromEntries(sorted.slice(0, MAX_CACHE_ENTRIES))
}

const placeNameCache = new Map<string, string | null>()

async function placeNameCached(placeId: string): Promise<string | null> {
  if (placeNameCache.has(placeId)) return placeNameCache.get(placeId) ?? null
  const name = await robloxApi.placeName(placeId)
  placeNameCache.set(placeId, name)
  return name
}

async function placeFromUniverse(universeId: number): Promise<string | null> {
  const details = await robloxApi.gameDetails([universeId])
  const placeId = details[0]?.placeId
  return placeId ? String(placeId) : null
}

/* ---------------------------------------------------------------- Ping */

/**
 * Ping estimates for a set of servers.
 *
 * Roblox reports an average client ping per server which we surface verbatim;
 * we label it `estimated` because it is not measured from this machine. A
 * measured value would need the server's IP, which Roblox only reveals to the
 * connected client.
 */
export async function pingServers(
  placeId: string,
  servers: { id: string; datacenter: string | null }[]
): Promise<ServerPingSample[]> {
  const cache = await loadCache()
  const known = new Map((cache.entries[placeId]?.servers ?? []).map((server) => [server.id, server]))

  return servers.map((server) => {
    const cachedServer = known.get(server.id)
    const ping = cachedServer?.ping ?? null
    return {
      serverId: server.id,
      ping,
      region: cachedServer?.region ?? (regionForDatacenter(server.datacenter) as string | null),
      datacenter: cachedServer?.datacenter ?? server.datacenter,
      method: ping !== null ? 'estimated' : 'none',
      samples: ping !== null ? [ping] : []
    }
  })
}

/* ---------------------------------------------------------------- Join */

export async function joinServer(request: ServerJoinRequest): Promise<ServerJoinResult> {
  const settings = getSettings()
  const region = request.region ?? settings.preferredRegion
  const size = request.size ?? settings.serverSizePreference

  let serverId = request.serverId ?? null
  let chosen: ServerInstance | null = null

  if (!serverId) {
    const list = await listServers({
      placeId: request.placeId,
      region,
      size,
      sort: request.sort ?? (settings.autoSortServers ? 'players' : undefined)
    })

    const ranked = rankServers(list.servers, { region, size, sort: request.sort })
    chosen = ranked[0] ?? null

    if (!chosen) {
      return {
        serverId: null,
        region: null,
        ping: null,
        launched: false,
        message: list.error ?? 'No healthy servers were available for that experience'
      }
    }

    serverId = chosen.id
  } else {
    const cache = await loadCache()
    chosen = cache.entries[request.placeId]?.servers.find((server) => server.id === serverId) ?? null
  }

  try {
    const resolved = await resolveJoinUri({
      placeId: request.placeId,
      serverId,
      accountId: request.accountId ?? null
    })

    const result = await bootstrapper.launch({ uri: resolved.uri, force: request.force ?? true })

    logger.info(
      `Joining ${request.placeId} on server ${serverId ?? 'any'}${
        chosen?.region ? ` (${chosen.region})` : ''
      }${resolved.accountName ? ` as ${resolved.accountName}` : ''}`
    )

    return {
      serverId,
      region: chosen?.region ?? null,
      ping: chosen?.ping ?? null,
      launched: result.launched,
      message: result.message
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Region join failed: ${message}`)
    return { serverId, region: chosen?.region ?? null, ping: chosen?.ping ?? null, launched: false, message }
  }
}

/** Human label for a region id, used by notifications and the tray menu. */
export function regionLabel(id: string | null): string {
  return regionById(id ?? 'any').label
}

/** Drops cached data for a place, e.g. after a join failure. */
export async function invalidate(placeId?: string): Promise<void> {
  const cache = await loadCache()
  if (!placeId) {
    await saveCache({ entries: {} })
    return
  }

  const entries = { ...cache.entries }
  delete entries[placeId]
  await saveCache({ entries })
}
