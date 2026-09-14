import type { AccountFriend, AccountPresence, GameSummary } from '@shared/models'
import { createLogger } from '../utils/logger'
import { HttpError, USER_AGENT, getJson, httpRequest, postJson } from './http'

/**
 * Thin, typed wrapper around the Roblox web APIs this app uses.
 *
 * Everything here is *read* oriented and defensive: the endpoints are public
 * but not contractual, so each call is written to survive a shape change (every
 * field is treated as optional and coerced) and to fail with a clear error
 * rather than a stack trace. Nothing in this module writes to disk; caching is
 * the caller's business.
 *
 * Cookies are passed in per call rather than held in module state so an account
 * can never leak into a request made on behalf of a different one.
 */

const logger = createLogger('RobloxApi')

const USERS_HOST = 'https://users.roblox.com'
const AUTH_HOST = 'https://auth.roblox.com'
const FRIENDS_HOST = 'https://friends.roblox.com'
const PRESENCE_HOST = 'https://presence.roblox.com'
const GAMES_HOST = 'https://games.roblox.com'
const THUMBNAILS_HOST = 'https://thumbnails.roblox.com'
const APIS_HOST = 'https://apis.roblox.com'
const WWW_HOST = 'https://www.roblox.com'

export interface ApiOptions {
  signal?: AbortSignal
  timeoutMs?: number
}

/** Roblox refuses requests whose User-Agent does not look like a browser. */
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'application/json'
}

function cookieHeader(cookie: string): Record<string, string> {
  return { ...BROWSER_HEADERS, Cookie: `.ROBLOSECURITY=${cookie}` }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/* ------------------------------------------------------------------ Auth */

export interface AuthenticatedUser {
  id: number
  name: string
  displayName: string
}

/** Validates a cookie and returns the account it belongs to. */
export async function authenticatedUser(
  cookie: string,
  options: ApiOptions = {}
): Promise<AuthenticatedUser> {
  const payload = await getJson<{ id?: number; name?: string; displayName?: string }>(
    `${USERS_HOST}/v1/users/authenticated`,
    {
      headers: cookieHeader(cookie),
      retries: 0,
      timeoutMs: options.timeoutMs ?? 15_000,
      signal: options.signal
    }
  )

  if (!payload?.id || !payload.name) {
    throw new Error('Roblox did not recognise that cookie')
  }

  return {
    id: payload.id,
    name: payload.name,
    displayName: payload.displayName ?? payload.name
  }
}

/**
 * Requests a fresh authentication ticket for the account.
 *
 * Roblox guards the endpoint with a CSRF handshake: the first POST is rejected
 * with 403 and an `x-csrf-token` header, which is then echoed back. The ticket
 * comes home in the `rbx-authentication-ticket` response header.
 */
export async function authenticationTicket(
  cookie: string,
  options: ApiOptions = {}
): Promise<string> {
  const url = `${AUTH_HOST}/v1/authentication-ticket`
  const headers: Record<string, string> = {
    ...cookieHeader(cookie),
    Origin: WWW_HOST,
    Referer: `${WWW_HOST}/`,
    'Content-Type': 'application/json'
  }

  const attempt = async (extra: Record<string, string>): Promise<Response> =>
    httpRequest(url, {
      method: 'POST',
      body: {},
      headers: { ...headers, ...extra },
      retries: 0,
      timeoutMs: options.timeoutMs ?? 20_000,
      signal: options.signal
    })

  try {
    const response = await attempt({})
    const ticket = response.headers.get('rbx-authentication-ticket')
    if (ticket) return ticket
  } catch (error) {
    if (error instanceof HttpError && error.status === 403 && error.headers) {
      const token = error.headers.get('x-csrf-token')
      if (token) {
        const response = await attempt({ 'x-csrf-token': token })
        const ticket = response.headers.get('rbx-authentication-ticket')
        if (ticket) return ticket
      }
    }
    throw error
  }

  throw new Error('Roblox did not return an authentication ticket')
}

export interface JoinTicket {
  ticket: string
  jobId: string | null
  /** Address the client was told to talk to, when the API supplies it. */
  machineAddress: string | null
  serverPort: number | null
  universeId: number | null
  placeId: string | null
  userId: number | null
  userName: string | null
}

interface PlaceLauncherJoinScript {
  AuthenticationTicket?: string
  JobId?: string
  MachineAddress?: string
  ServerPort?: number
  UniverseId?: number
  PlaceId?: number
  UserId?: number
  UserName?: string
  Message?: string
}

/**
 * Asks Roblox's place launcher for a join script on behalf of an account.
 * This is the same endpoint the website uses when you press Play, so the
 * ticket it returns is exactly what the client needs to sign in as that
 * account — no cookie copying into the client's own cookie jar required.
 */
export async function joinTicket(
  cookie: string,
  placeId: string,
  jobId?: string | null,
  options: ApiOptions = {}
): Promise<JoinTicket> {
  const url = new URL(`${WWW_HOST}/Game/PlaceLauncher.ashx`)
  url.searchParams.set('request', jobId ? 'RequestGameJob' : 'RequestGame')
  url.searchParams.set('browserTrackerId', String(Math.floor(Math.random() * 1_000_000)))
  url.searchParams.set('placeId', placeId)
  if (jobId) url.searchParams.set('gameId', jobId)
  url.searchParams.set('isPlayTogetherGame', 'false')

  const script = await getJson<PlaceLauncherJoinScript>(url.toString(), {
    headers: cookieHeader(cookie),
    retries: 0,
    timeoutMs: options.timeoutMs ?? 20_000,
    signal: options.signal
  })

  if (!script?.AuthenticationTicket) {
    throw new Error(script?.Message ?? 'Roblox did not issue a join ticket for that experience')
  }

  return {
    ticket: script.AuthenticationTicket,
    jobId: asString(script.JobId) ?? jobId ?? null,
    machineAddress: asString(script.MachineAddress),
    serverPort: typeof script.ServerPort === 'number' ? script.ServerPort : null,
    universeId: typeof script.UniverseId === 'number' ? script.UniverseId : null,
    placeId: typeof script.PlaceId === 'number' ? String(script.PlaceId) : placeId,
    userId: typeof script.UserId === 'number' ? script.UserId : null,
    userName: asString(script.UserName)
  }
}

/**
 * OAuth-style launch ticket used for joining *without* a stored account: the
 * client is handed the ticket from the placeholder script below instead.
 * Kept small on purpose — it exists so the fallback path is one call.
 */
export async function csrfToken(cookie: string, options: ApiOptions = {}): Promise<string | null> {
  try {
    await httpRequest(`${AUTH_HOST}/v1/authentication-ticket`, {
      method: 'POST',
      body: {},
      headers: cookieHeader(cookie),
      retries: 0,
      signal: options.signal
    })
    return null
  } catch (error) {
    if (error instanceof HttpError) return error.headers?.get('x-csrf-token') ?? null
    return null
  }
}

/* --------------------------------------------------------------- Profiles */

export interface UserProfileResponse {
  id: number
  name: string
  displayName: string
  description: string | null
  created: string | null
  isBanned: boolean
  hasVerifiedBadge: boolean
}

export async function userProfile(
  userId: number,
  cookie: string | null,
  options: ApiOptions = {}
): Promise<UserProfileResponse | null> {
  try {
    const payload = await getJson<Partial<UserProfileResponse>>(
      `${USERS_HOST}/v1/users/${userId}`,
      {
        headers: cookie ? cookieHeader(cookie) : BROWSER_HEADERS,
        retries: 1,
        signal: options.signal
      }
    )

    if (!payload?.id) return null
    return {
      id: payload.id,
      name: payload.name ?? 'unknown',
      displayName: payload.displayName ?? payload.name ?? 'unknown',
      description: payload.description ?? null,
      created: payload.created ?? null,
      isBanned: payload.isBanned === true,
      hasVerifiedBadge: payload.hasVerifiedBadge === true
    }
  } catch (error) {
    logger.warn(`Profile lookup for ${userId} failed: ${String(error)}`)
    return null
  }
}

/** Batched headshot thumbnails. Unknown ids simply come back missing. */
export async function avatarHeadshots(
  userIds: number[],
  size = '150x150',
  options: ApiOptions = {}
): Promise<Record<number, string>> {
  const out: Record<number, string> = {}
  const unique = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))]
  if (unique.length === 0) return out

  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100)
    try {
      const payload = await getJson<{
        data?: Array<{ targetId?: number; state?: string; imageUrl?: string }>
      }>(
        `${THUMBNAILS_HOST}/v1/users/avatar-headshot?userIds=${batch.join(',')}&size=${size}&format=Png&isCircular=true`,
        { headers: BROWSER_HEADERS, retries: 1, signal: options.signal }
      )

      for (const entry of payload?.data ?? []) {
        if (entry?.targetId && entry.state === 'Completed' && entry.imageUrl) {
          out[entry.targetId] = entry.imageUrl
        }
      }
    } catch (error) {
      logger.warn(`Avatar batch failed: ${String(error)}`)
    }
  }

  return out
}

/* --------------------------------------------------------------- Presence */

export interface PresenceEntry {
  userId: number
  presence: AccountPresence
  lastLocation: string | null
  placeId: string | null
  lastOnline: string | null
}

function presenceType(value: unknown): AccountPresence {
  switch (value) {
    case 1:
      return 'website'
    case 2:
      return 'ingame'
    case 3:
      return 'online'
    default:
      return 'offline'
  }
}

export async function userPresence(
  userIds: number[],
  cookie: string | null,
  options: ApiOptions = {}
): Promise<Record<number, PresenceEntry>> {
  const unique = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))]
  if (unique.length === 0) return {}

  try {
    const payload = await postJson<{
      userPresences?: Array<{
        userId?: number
        userPresenceType?: number
        lastLocation?: string
        placeId?: number | null
        lastOnline?: string
      }>
    }>(
      `${PRESENCE_HOST}/v1/presence/users`,
      { userIds: unique },
      {
        headers: cookie ? cookieHeader(cookie) : BROWSER_HEADERS,
        retries: 1,
        signal: options.signal
      }
    )

    const out: Record<number, PresenceEntry> = {}
    for (const entry of payload?.userPresences ?? []) {
      if (!entry?.userId) continue
      out[entry.userId] = {
        userId: entry.userId,
        presence: presenceType(entry.userPresenceType),
        lastLocation: asString(entry.lastLocation),
        placeId: entry.placeId ? String(entry.placeId) : null,
        lastOnline: asString(entry.lastOnline)
      }
    }
    return out
  } catch (error) {
    logger.warn(`Presence lookup failed: ${String(error)}`)
    return {}
  }
}

/* ---------------------------------------------------------------- Friends */

export async function friendCount(
  userId: number,
  cookie: string | null,
  kind: 'friends' | 'followers' | 'followings',
  options: ApiOptions = {}
): Promise<number | null> {
  try {
    const payload = await getJson<{ count?: number }>(
      `${FRIENDS_HOST}/v1/users/${userId}/${kind}/count`,
      {
        headers: cookie ? cookieHeader(cookie) : BROWSER_HEADERS,
        retries: 1,
        signal: options.signal
      }
    )
    return typeof payload?.count === 'number' ? payload.count : null
  } catch {
    return null
  }
}

export async function friendsList(
  userId: number,
  cookie: string | null,
  options: ApiOptions = {}
): Promise<AccountFriend[]> {
  try {
    const payload = await getJson<{
      data?: Array<{ id?: number; name?: string; displayName?: string }>
    }>(`${FRIENDS_HOST}/v1/users/${userId}/friends`, {
      headers: cookie ? cookieHeader(cookie) : BROWSER_HEADERS,
      retries: 1,
      signal: options.signal
    })

    const friends = (payload?.data ?? [])
      .filter((entry) => entry?.id)
      .map((entry) => ({
        userId: entry.id as number,
        username: entry.name ?? 'unknown',
        displayName: entry.displayName ?? entry.name ?? 'unknown',
        avatarUrl: null as string | null,
        presence: 'unknown' as AccountPresence,
        isOnline: false,
        isPlaying: false
      }))

    if (friends.length === 0) return []

    const [avatars, presence] = await Promise.all([
      avatarHeadshots(
        friends.map((friend) => friend.userId),
        '150x150',
        options
      ),
      userPresence(
        friends.map((friend) => friend.userId),
        cookie,
        options
      )
    ])

    return friends
      .map((friend) => {
        const state = presence[friend.userId]
        return {
          ...friend,
          avatarUrl: avatars[friend.userId] ?? null,
          presence: state?.presence ?? 'unknown',
          isOnline: state ? state.presence !== 'offline' : false,
          isPlaying: state?.presence === 'ingame'
        }
      })
      .sort(
        (a, b) => Number(b.isOnline) - Number(a.isOnline) || a.username.localeCompare(b.username)
      )
  } catch (error) {
    logger.warn(`Friend list for ${userId} failed: ${String(error)}`)
    return []
  }
}

/* ------------------------------------------------------------------ Games */

interface RawGame {
  id?: number
  rootPlaceId?: number
  name?: string
  description?: string
  creator?: { id?: number; name?: string; type?: string }
  playing?: number
  visits?: number
  favoritedCount?: number
  maxPlayers?: number
  updated?: string
}

function toSummary(raw: RawGame, thumbnailUrl: string | null): GameSummary | null {
  if (!raw?.id) return null
  return {
    universeId: raw.id,
    placeId: raw.rootPlaceId ?? raw.id,
    name: raw.name ?? 'Untitled experience',
    description: raw.description ?? null,
    creatorName: raw.creator?.name ?? null,
    creatorType: raw.creator?.type ?? null,
    playerCount: typeof raw.playing === 'number' ? raw.playing : null,
    visitCount: typeof raw.visits === 'number' ? raw.visits : null,
    favoriteCount: typeof raw.favoritedCount === 'number' ? raw.favoritedCount : null,
    maxPlayers: typeof raw.maxPlayers === 'number' ? raw.maxPlayers : null,
    thumbnailUrl,
    updatedAt: raw.updated ? Date.parse(raw.updated) || null : null,
    rootPlaceId: raw.rootPlaceId ?? null
  }
}

export async function gameDetails(
  universeIds: number[],
  options: ApiOptions = {}
): Promise<GameSummary[]> {
  const unique = [...new Set(universeIds.filter((id) => Number.isFinite(id) && id > 0))]
  if (unique.length === 0) return []

  const summaries: GameSummary[] = []

  for (let offset = 0; offset < unique.length; offset += 50) {
    const batch = unique.slice(offset, offset + 50)
    try {
      const payload = await getJson<{ data?: RawGame[] }>(
        `${GAMES_HOST}/v1/games?universeIds=${batch.join(',')}`,
        { headers: BROWSER_HEADERS, retries: 1, signal: options.signal }
      )
      for (const raw of payload?.data ?? []) {
        const summary = toSummary(raw, null)
        if (summary) summaries.push(summary)
      }
    } catch (error) {
      logger.warn(`Game details batch failed: ${String(error)}`)
    }
  }

  const thumbnails = await gameThumbnails(
    summaries.map((game) => game.universeId),
    options
  )

  return summaries.map((game) => ({
    ...game,
    thumbnailUrl: thumbnails[game.universeId] ?? null
  }))
}

/** Game icons, keyed by universe id. */
export async function gameThumbnails(
  universeIds: number[],
  options: ApiOptions = {}
): Promise<Record<number, string>> {
  const out: Record<number, string> = {}
  const unique = [...new Set(universeIds.filter((id) => Number.isFinite(id) && id > 0))]
  if (unique.length === 0) return out

  for (let offset = 0; offset < unique.length; offset += 50) {
    const batch = unique.slice(offset, offset + 50)
    try {
      const payload = await getJson<{
        data?: Array<{
          universeId?: number
          thumbnails?: Array<{ imageUrl?: string; state?: string }>
        }>
      }>(
        `${THUMBNAILS_HOST}/v1/games/multiget/thumbnails?universeIds=${batch.join(',')}&size=768x432&format=Png&isCircular=false`,
        { headers: BROWSER_HEADERS, retries: 1, signal: options.signal }
      )

      for (const entry of payload?.data ?? []) {
        const first = entry?.thumbnails?.find(
          (thumb) => thumb?.imageUrl && thumb.state === 'Completed'
        )
        if (entry?.universeId && first?.imageUrl) out[entry.universeId] = first.imageUrl
      }
    } catch (error) {
      logger.warn(`Game thumbnail batch failed: ${String(error)}`)
    }
  }

  return out
}

/** Place id -> universe id, used when the UI only has a place id. */
export async function universeIdForPlace(
  placeId: number,
  options: ApiOptions = {}
): Promise<number | null> {
  try {
    const payload = await getJson<{ data?: Array<{ placeId?: number; universeId?: number }> }>(
      `${APIS_HOST}/universes/v1/places/${placeId}/universe`,
      { headers: BROWSER_HEADERS, retries: 1, signal: options.signal }
    )
    return payload?.data?.[0]?.universeId ?? null
  } catch {
    return null
  }
}

/**
 * Game search.
 *
 * The modern omni-search endpoint is preferred because it returns live player
 * counts; the legacy `games/list` endpoint is used as a fallback for regions
 * where omni-search is not available.
 */
export async function searchGames(
  query: string,
  limit: number,
  options: ApiOptions = {}
): Promise<GameSummary[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return []

  const universeIds: number[] = []

  try {
    const payload = await postJson<{
      searchResults?: Array<{
        contents?: Array<{ universeId?: number; name?: string; playerCount?: number }>
      }>
    }>(
      `${APIS_HOST}/search-api/omni-search?searchQuery=${encodeURIComponent(trimmed)}&sessionId=${crypto.randomUUID()}&pageType=all`,
      { searchQuery: trimmed, sessionId: crypto.randomUUID(), pageType: 'all' },
      { headers: BROWSER_HEADERS, retries: 1, signal: options.signal }
    )

    for (const group of payload?.searchResults ?? []) {
      for (const item of group?.contents ?? []) {
        if (item?.universeId) universeIds.push(item.universeId)
        if (universeIds.length >= limit) break
      }
      if (universeIds.length >= limit) break
    }
  } catch (error) {
    logger.warn(`Omni search failed, falling back to games/list: ${String(error)}`)
  }

  if (universeIds.length > 0) {
    const details = await gameDetails(universeIds.slice(0, limit), options)
    if (details.length > 0) return details
  }

  // Place ids and numeric queries are common; treat them as a direct lookup.
  const numeric = Number.parseInt(trimmed, 10)
  if (Number.isFinite(numeric) && String(numeric) === trimmed) {
    const universeId = await universeIdForPlace(numeric, options)
    if (universeId) return gameDetails([universeId], options)
  }

  try {
    const payload = await getJson<{ games?: RawGame[] }>(
      `${GAMES_HOST}/v1/games/list?model.keyword=${encodeURIComponent(trimmed)}&model.maxRows=${limit}&model.startRows=0`,
      { headers: BROWSER_HEADERS, retries: 1, signal: options.signal }
    )
    const summaries = (payload?.games ?? [])
      .map((raw) => toSummary(raw, null))
      .filter((game): game is GameSummary => game !== null)

    const thumbnails = await gameThumbnails(
      summaries.map((game) => game.universeId),
      options
    )
    return summaries.map((game) => ({ ...game, thumbnailUrl: thumbnails[game.universeId] ?? null }))
  } catch (error) {
    logger.warn(`Game search failed: ${String(error)}`)
    return []
  }
}

/** Games a user recently played, newest first. */
export async function recentlyPlayed(
  userId: number,
  cookie: string,
  limit: number,
  options: ApiOptions = {}
): Promise<GameSummary[]> {
  try {
    const payload = await getJson<{ data?: Array<{ universeId?: number }> }>(
      `${GAMES_HOST}/v2/users/${userId}/games?accessFilter=2&limit=${Math.min(limit, 50)}&sortOrder=Desc`,
      { headers: cookieHeader(cookie), retries: 1, signal: options.signal }
    )

    const universeIds = (payload?.data ?? [])
      .map((entry) => entry?.universeId)
      .filter((id): id is number => typeof id === 'number')

    return gameDetails(universeIds, options)
  } catch (error) {
    logger.warn(`Continue-playing lookup failed: ${String(error)}`)
    return []
  }
}

export async function favoriteGames(
  userId: number,
  cookie: string,
  limit: number,
  options: ApiOptions = {}
): Promise<GameSummary[]> {
  try {
    const payload = await getJson<{ data?: Array<{ id?: number; universeId?: number }> }>(
      `${GAMES_HOST}/v2/users/${userId}/favorite/games?accessFilter=2&limit=${Math.min(limit, 50)}&sortOrder=Desc`,
      { headers: cookieHeader(cookie), retries: 1, signal: options.signal }
    )

    const universeIds = (payload?.data ?? [])
      .map((entry) => entry?.universeId)
      .filter((id): id is number => typeof id === 'number')

    return gameDetails(universeIds, options)
  } catch (error) {
    logger.warn(`Favourites lookup failed: ${String(error)}`)
    return []
  }
}

/**
 * Recommendations.
 *
 * Roblox's own recommendation feed needs a signed-in *browser* session, which a
 * cookie alone does not give us. The public "because you played X" endpoint is
 * used when it answers, and the caller falls back to genre search otherwise.
 */
export async function recommendations(
  universeId: number,
  cookie: string,
  limit: number,
  options: ApiOptions = {}
): Promise<GameSummary[]> {
  try {
    const payload = await getJson<{ games?: Array<{ id?: number }> }>(
      `${GAMES_HOST}/v1/recommendations/game/${universeId}?maxRows=${Math.min(limit, 50)}`,
      { headers: cookieHeader(cookie), retries: 1, signal: options.signal }
    )

    const universeIds = (payload?.games ?? [])
      .map((entry) => entry?.id)
      .filter((id): id is number => typeof id === 'number')

    if (universeIds.length === 0) return []
    return gameDetails(universeIds, options)
  } catch (error) {
    logger.info(`Recommendation feed unavailable (${String(error)}); caller should fall back`)
    return []
  }
}

/* ---------------------------------------------------------------- Servers */

export interface RawServer {
  id?: string
  maxPlayers?: number
  playing?: number
  playerTokens?: string[]
  fps?: number
  ping?: number
}

export interface ServerPage {
  servers: RawServer[]
  nextCursor: string | null
}

/** Public server list for a place. Rate limits surface as an empty page. */
export async function publicServers(
  placeId: string,
  limit: number,
  cursor: string | null,
  options: ApiOptions = {}
): Promise<ServerPage> {
  const url = new URL(`${GAMES_HOST}/v1/games/${encodeURIComponent(placeId)}/servers/Public`)
  url.searchParams.set('limit', String(Math.min(Math.max(limit, 10), 100)))
  url.searchParams.set('excludeFullGames', 'false')
  if (cursor) url.searchParams.set('cursor', cursor)

  const payload = await getJson<{ data?: RawServer[]; nextPageCursor?: string | null }>(
    url.toString(),
    {
      headers: BROWSER_HEADERS,
      retries: 0,
      timeoutMs: options.timeoutMs ?? 15_000,
      signal: options.signal
    }
  )

  return {
    servers: (payload?.data ?? []).filter((server) => typeof server?.id === 'string'),
    nextCursor: payload?.nextPageCursor ?? null
  }
}

/** Resolves a place id to a name without a full game details round trip. */
export async function placeName(placeId: string, options: ApiOptions = {}): Promise<string | null> {
  const universeId = await universeIdForPlace(Number.parseInt(placeId, 10), options)
  if (!universeId) return null
  const details = await gameDetails([universeId], options)
  return details[0]?.name ?? null
}
