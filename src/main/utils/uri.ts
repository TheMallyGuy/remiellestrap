/**
 * Roblox launch URI parsing and sanitisation.
 *
 * Two protocols are handled, matching the stock bootstrapper:
 *
 *   roblox-player:1+launchmode:play+robloxLocale:en_us+placelauncherurl:...
 *   roblox://experiences/start?placeId=1818
 *
 * The `roblox-player` form is a '+' delimited stream of `key:value` pairs
 * (the protocol identifier itself is the first pair). The `roblox` form is a
 * regular URL used for universal deep links.
 */

export interface ParsedLaunchUri {
  raw: string
  protocol: 'roblox' | 'roblox-player'
  /** Key/value pairs for roblox-player URIs, query params for roblox:// ones. */
  params: Record<string, string>
  launchMode: string | null
  placeId: string | null
  gameInstanceId: string | null
  accessCode: string | null
  linkCode: string | null
  launchData: string | null
  isAppLaunch: boolean
  isJoin: boolean
}

const MAX_URI_LENGTH = 4096

/**
 * Characters refused in a launch URI. '&', '$' and '\'' are legal URL
 * characters (query separators, base64 launch data) so they must be permitted
 * here — arguments are passed to spawn() as an array and never via a shell.
 */
// Whitespace is never legal in a genuine Roblox launch URI (Roblox percent-
// encodes every parameter), and the client is spawned without a shell, so this
// is belt-and-braces against a mangled or injected argument.
// eslint-disable-next-line no-control-regex
const FORBIDDEN_URI = /[\u0000-\u001f\u007f\s"`|;<>^]/

/**
 * Shell metacharacters refused in free-text launch arguments. Quotes are
 * allowed so paths containing spaces can be quoted normally.
 */
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f`$|;&<>^\n\r]/

/** Deep-link parameters the stock roblox:// handler understands. */
const ALLOWED_DEEPLINK_PARAMS = new Set([
  'placeid',
  'gameinstanceid',
  'accesscode',
  'linkcode',
  'launchdata',
  'joinattemptid',
  'joinattemptorigin',
  'reservedserveraccesscode',
  'callid',
  'browsertrackerid',
  'userid',
  'referredbyplayerid',
  'eventid',
  'conversationid',
  'universeid',
  'type',
  'id'
])

/**
 * Returns the URI unchanged when it is a well-formed, safe Roblox launch URI,
 * otherwise null. Never trust the raw argv/deep-link string beyond this point.
 */
export function sanitizeLaunchUri(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null

  const trimmed = input.trim().replace(/^"+|"+$/g, '')
  if (trimmed.length === 0 || trimmed.length > MAX_URI_LENGTH) return null
  if (FORBIDDEN_URI.test(trimmed)) return null

  const lower = trimmed.toLowerCase()
  if (!lower.startsWith('roblox:') && !lower.startsWith('roblox-player:')) return null

  return trimmed
}

/** Finds the first Roblox launch URI in a process argv array. */
export function findLaunchUri(argv: readonly string[]): string | null {
  for (const arg of argv) {
    const sanitized = sanitizeLaunchUri(arg)
    if (sanitized) return sanitized
  }
  return null
}

export function parseLaunchUri(input: string): ParsedLaunchUri | null {
  const uri = sanitizeLaunchUri(input)
  if (!uri) return null

  const lower = uri.toLowerCase()
  const params: Record<string, string> = {}

  if (lower.startsWith('roblox-player:')) {
    // key:value pairs delimited by '+', including the leading "roblox-player:1"
    for (const pair of uri.split('+')) {
      const separator = pair.indexOf(':')
      if (separator <= 0) continue
      const key = pair.slice(0, separator).trim()
      const value = pair.slice(separator + 1).trim()
      if (key.length === 0) continue
      params[key.toLowerCase()] = value
    }

    const launchMode = params['launchmode'] ?? null
    return {
      raw: uri,
      protocol: 'roblox-player',
      params,
      launchMode,
      placeId: params['placeid'] ?? extractPlaceIdFromLauncherUrl(params['placelauncherurl']),
      gameInstanceId: params['gameinfo'] ?? params['gameinstanceid'] ?? null,
      accessCode: params['accesscode'] ?? null,
      linkCode: params['linkcode'] ?? null,
      launchData: params['launchdata'] ?? null,
      isAppLaunch: launchMode === 'app',
      isJoin: launchMode === 'play' || Boolean(params['placelauncherurl'])
    }
  }

  // roblox:// universal deep link
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }

  for (const [key, value] of url.searchParams.entries()) {
    const lowerKey = key.toLowerCase()
    if (ALLOWED_DEEPLINK_PARAMS.has(lowerKey)) params[lowerKey] = value
  }

  const path = `${url.hostname}${url.pathname}`.toLowerCase()
  const isStart = path.includes('experiences/start') || path.includes('placeid')

  return {
    raw: uri,
    protocol: 'roblox',
    params,
    launchMode: isStart ? 'play' : 'app',
    placeId: params['placeid'] ?? null,
    gameInstanceId: params['gameinstanceid'] ?? null,
    accessCode: params['accesscode'] ?? params['reservedserveraccesscode'] ?? null,
    linkCode: params['linkcode'] ?? null,
    launchData: params['launchdata'] ?? null,
    isAppLaunch: !isStart,
    isJoin: isStart
  }
}

function extractPlaceIdFromLauncherUrl(launcherUrl: string | undefined): string | null {
  if (!launcherUrl) return null
  try {
    const decoded = decodeURIComponent(launcherUrl)
    const match = decoded.match(/placeId=(\d+)/i)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Builds the argument list passed to RobloxPlayerBeta.
 *
 * Since Bloxstrap v2.6.0 the launch URI is handed to the client verbatim
 * instead of being decomposed into flags, which is what we mirror here. For a
 * plain app launch we still pass the locale flags the client expects.
 */
export function buildRobloxArguments(
  parsed: ParsedLaunchUri | null,
  options: { robloxLocale: string; gameLocale: string; extraArguments?: string }
): string[] {
  const args: string[] = []

  if (parsed) {
    args.push(parsed.raw)
  } else {
    args.push('--app')
    args.push('--rloc', options.robloxLocale)
    args.push('--gloc', options.gameLocale)
  }

  const extra = parseExtraArguments(options.extraArguments ?? '')
  args.push(...extra)

  return args
}

/**
 * Splits a user-provided argument string, honouring quotes and rejecting
 * anything containing shell metacharacters. Arguments are passed to spawn()
 * as an array (never through a shell), so this is purely a hygiene check.
 */
export function parseExtraArguments(input: string): string[] {
  if (!input.trim()) return []

  // A single unsafe token invalidates the whole string rather than being
  // silently dropped, so a mangled entry can never leak neighbouring words
  // through as arguments.
  if (FORBIDDEN.test(input)) return []

  const matches = input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
  return matches
    .map((token) => token.replace(/^"|"$/g, ''))
    .filter((token) => token.length > 0)
}

/** Builds a roblox-player URI for rejoining a specific place/instance. */
export function buildJoinUri(placeId: string, gameInstanceId?: string | null): string {
  const launcherUrl = new URL('https://assetgame.roblox.com/game/PlaceLauncher.ashx')
  launcherUrl.searchParams.set('request', gameInstanceId ? 'RequestGameJob' : 'RequestGame')
  launcherUrl.searchParams.set('browserTrackerId', '0')
  launcherUrl.searchParams.set('placeId', placeId)
  if (gameInstanceId) launcherUrl.searchParams.set('gameId', gameInstanceId)
  launcherUrl.searchParams.set('isPlayTogetherGame', 'false')

  return [
    'roblox-player:1',
    'launchmode:play',
    `placelauncherurl:${encodeURIComponent(launcherUrl.toString())}`,
    'robloxLocale:en_us',
    'gameLocale:en_us'
  ].join('+')
}
