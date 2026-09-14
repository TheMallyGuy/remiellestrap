import type { ChannelInfo } from '@shared/models'
import { KNOWN_CHANNELS } from '@shared/settings'
import { createLogger } from '../utils/logger'
import { getSettings, saveSettings } from '../services/settingsStore'
import { getRobloxState } from '../services/stateStore'
import { binaryTypeFor, getLatestClientVersion } from './deployment'

/**
 * Channel browser.
 *
 * Roblox publishes a separate deployment for every channel. Only `LIVE` is
 * advertised, but the staging channels are perfectly readable — which is what
 * makes the browser useful: it shows what each channel is currently serving, so
 * a channel can be picked because it is *ahead* of LIVE rather than by guessing.
 *
 * Probing is cached for five minutes and limited to a few concurrent requests:
 * the deployment endpoint is rate limited, and a browser that trips it becomes
 * useless exactly when it is needed.
 */

const logger = createLogger('Channels')

const CACHE_TTL_MS = 5 * 60_000
const PROBE_CONCURRENCY = 3

interface CacheEntry {
  at: number
  info: ChannelInfo
}

const cache = new Map<string, CacheEntry>()

/**
 * Channels to offer.
 *
 * `settings.channel` may hold a comma-separated list: the first entry is the
 * active channel and any further entries are channels the user added by hand,
 * so a private or unlisted deployment stays available across restarts.
 */
export function channelNames(): string[] {
  const stored = getSettings().channel.split(',').map((value) => value.trim())
  const names = new Set<string>([...KNOWN_CHANNELS])

  for (const name of stored) {
    if (/^[A-Za-z0-9_-]{1,40}$/.test(name)) names.add(name)
  }

  return [...names]
}

export function activeChannel(): string {
  return getSettings().channel.split(',')[0]?.trim() || 'LIVE'
}

async function probe(name: string, refresh: boolean): Promise<ChannelInfo> {
  const cached = cache.get(name)
  if (!refresh && cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.info

  const robloxState = getRobloxState()
  const current = activeChannel()

  const info: ChannelInfo = {
    name,
    playerVersion: null,
    studioVersion: null,
    playerClientVersion: null,
    isCurrent: name === current,
    isInstalled: robloxState.installedChannel === name,
    error: null
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)

  try {
    const player = await getLatestClientVersion('WindowsPlayer', name, controller.signal)
    info.playerClientVersion = player.clientVersionUpload
    info.playerVersion = player.version ?? null
  } catch (error) {
    info.error = error instanceof Error ? error.message : 'The channel did not respond'
  }

  // Studio is only probed for the active channel and the ones that actually
  // answered: two requests per channel would triple the time to fill the page.
  if (info.error === null && (name === current || process.env.REMIELLE_PROBE_STUDIO === '1')) {
    try {
      const studio = await getLatestClientVersion(
        binaryTypeFor('studio'),
        name,
        controller.signal
      )
      info.studioVersion = studio.version ?? studio.clientVersionUpload
    } catch {
      // Studio is optional: its absence is not an error worth showing.
    }
  }

  clearTimeout(timer)
  cache.set(name, { at: Date.now(), info })
  return info
}

export async function listChannels(options: { refresh?: boolean } = {}): Promise<ChannelInfo[]> {
  const names = channelNames()
  const results: ChannelInfo[] = []
  const queue = [...names]

  const workers = Array.from({ length: PROBE_CONCURRENCY }, async () => {
    for (;;) {
      const name = queue.shift()
      if (!name) return

      try {
        results.push(await probe(name, options.refresh === true))
      } catch (error) {
        logger.warn(`Probe of ${name} failed: ${String(error)}`)
        results.push({
          name,
          playerVersion: null,
          studioVersion: null,
          playerClientVersion: null,
          isCurrent: name === activeChannel(),
          isInstalled: false,
          error: error instanceof Error ? error.message : 'Probe failed'
        })
      }
    }
  })

  await Promise.all(workers)

  const order = new Map(names.map((name, index) => [name, index]))
  return results.sort((a, b) => {
    // The active channel is always first, then the built-in order.
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
    return (order.get(a.name) ?? 99) - (order.get(b.name) ?? 99)
  })
}

/** Switches the active channel, keeping any hand-added channels on the list. */
export async function setChannel(name: string): Promise<ChannelInfo[]> {
  const trimmed = name.trim()

  if (!/^[A-Za-z0-9_-]{1,40}$/.test(trimmed)) {
    throw new Error('Channel names may only contain letters, numbers, dashes and underscores')
  }

  const extras = getSettings()
    .channel.split(',')
    .slice(1)
    .map((value) => value.trim())
    .filter((value) => value.length > 0 && value !== trimmed)

  await saveSettings({ channel: [trimmed, ...extras].join(',') })
  logger.info(`Channel set to ${trimmed}`)

  return listChannels()
}

/** Adds a channel to the list without switching to it. */
export async function rememberChannel(name: string): Promise<ChannelInfo[]> {
  const trimmed = name.trim()

  if (!/^[A-Za-z0-9_-]{1,40}$/.test(trimmed)) {
    throw new Error('Channel names may only contain letters, numbers, dashes and underscores')
  }

  const parts = getSettings().channel.split(',').map((value) => value.trim())
  if (!parts.includes(trimmed)) parts.push(trimmed)

  await saveSettings({ channel: parts.filter(Boolean).join(',') })
  cache.delete(trimmed)

  return listChannels()
}

export function clearChannelCache(): void {
  cache.clear()
}
