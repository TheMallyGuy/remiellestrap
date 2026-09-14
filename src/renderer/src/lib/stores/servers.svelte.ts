import type { ServerInstance, ServerListResult, ServerPingSample } from '@shared/models'
import type { ServerSizePreference, ServerSortKey } from '@shared/settings'
import { api, errorMessage } from '../ipc'
import { pushToast } from './toasts.svelte'
import { settings } from './settings.svelte'
import { activity } from './activity.svelte'

/**
 * The server browser's data.
 *
 * The main process caches the raw list per place; this store keeps just the
 * current place's view plus any ping samples taken this session, so switching
 * pages does not throw away what was already fetched.
 */

let current = $state<ServerListResult | null>(null)
let placeId = $state('')
let loading = $state(false)
let pinging = $state(false)
let error = $state<string | null>(null)
let pings = $state<Record<string, ServerPingSample>>({})

export const servers = {
  get value(): ServerListResult | null {
    return current
  },
  get list(): ServerInstance[] {
    return current?.servers ?? []
  },
  get placeId(): string {
    return placeId
  },
  get loading(): boolean {
    return loading
  },
  get pinging(): boolean {
    return pinging
  },
  get error(): string | null {
    return error
  },
  get pings(): Record<string, ServerPingSample> {
    return pings
  }
}

export function setPlaceId(value: string): void {
  placeId = value.replace(/[^\d]/g, '').slice(0, 20)
}

export function applyServers(next: ServerListResult | null): void {
  current = next
}

/**
 * Loads the list for a place.
 *
 * The place defaults to whatever the client is currently in, then to the last
 * played experience, so opening the page usually needs no typing at all.
 */
export async function loadServers(
  options: { placeId?: string; refresh?: boolean } = {}
): Promise<void> {
  const target =
    options.placeId ||
    placeId ||
    activity.value.activity?.placeId ||
    activity.state.lastActivity?.placeId ||
    ''

  if (!target) {
    current = null
    return
  }

  placeId = target
  loading = true
  error = null

  try {
    const result = await api.servers.list({
      placeId: target,
      refresh: options.refresh ?? false,
      sort: settings.value.autoSortServers ? undefined : 'players',
      region: settings.value.preferredRegion,
      size: settings.value.serverSizePreference,
      limit: settings.value.serverPageSize
    })

    current = result
    error = result.error
  } catch (exception) {
    error = errorMessage(exception)
    pushToast({ kind: 'warning', title: 'The server list is unavailable', message: error })
  } finally {
    loading = false
  }
}

/** Joins a specific server, or lets the main process pick the best match. */
export async function joinServer(
  options: { serverId?: string; region?: string } = {}
): Promise<void> {
  if (!placeId) return

  loading = true
  try {
    const result = await api.servers.join({
      placeId,
      serverId: options.serverId,
      region:
        options.region ??
        (settings.value.preferredRegion === 'any' ? undefined : settings.value.preferredRegion),
      size: settings.value.serverSizePreference,
      sort: settings.value.autoSortServers ? undefined : 'players'
    })

    if (result.launched) {
      pushToast({
        kind: 'success',
        title: options.serverId ? 'Joining server' : 'Joining the best match',
        message: result.message
      })
    } else {
      pushToast({ kind: 'error', title: 'Could not join', message: result.message })
    }
  } catch (exception) {
    pushToast({ kind: 'error', title: 'Could not join', message: errorMessage(exception) })
  } finally {
    loading = false
  }
}

/**
 * Samples ping for every server on the page.
 *
 * Roblox does not publish a ping figure for a job, so the main process derives
 * one from the reported server FPS and the region's distance class. The UI
 * labels it as an estimate rather than pretending it is a measurement.
 */
export async function pingServers(): Promise<void> {
  if (!placeId || servers.list.length === 0) return

  pinging = true

  try {
    const samples = await api.servers.ping(
      placeId,
      servers.list.map((server) => ({ id: server.id, datacenter: server.datacenter }))
    )

    pings = Object.fromEntries(samples.map((sample) => [sample.serverId, sample]))
  } catch (exception) {
    pushToast({ kind: 'warning', title: 'Ping sampling failed', message: errorMessage(exception) })
  } finally {
    pinging = false
  }
}

/** Reorders the loaded list client-side, without another API call. */
export function sortServers(key: ServerSortKey, size: ServerSizePreference): ServerInstance[] {
  const list = [...servers.list]

  const region = settings.value.preferredRegion
  const matchesRegion = (server: ServerInstance): boolean => {
    if (region === 'any') return true
    return serverPing(server).region === region || server.region === region
  }

  const pingOf = (server: ServerInstance): number =>
    serverPing(server).ping ?? Number.POSITIVE_INFINITY

  const sorted = list.sort((a, b) => {
    if (key === 'ping') return pingOf(a) - pingOf(b)
    if (key === 'region') return a.region?.localeCompare(b.region ?? '') ?? 0
    if (key === 'uptime') return (b.uptimeSeconds ?? 0) - (a.uptimeSeconds ?? 0)
    return b.playing - a.playing
  })

  // Preferred-region servers float to the top when one is set; the rest keep
  // their order so nothing is hidden.
  const preferred = sorted.filter(matchesRegion)
  const rest = sorted.filter((server) => !matchesRegion(server))
  const ordered = [...preferred, ...rest]

  if (size === 'small') return ordered.sort((a, b) => a.playing - b.playing)
  if (size === 'big') return ordered.sort((a, b) => b.playing - a.playing)

  return ordered
}

/** A server's ping sample, falling back to the value on the server itself. */
export function serverPing(server: ServerInstance): ServerPingSample {
  return (
    pings[server.id] ?? {
      serverId: server.id,
      ping: server.ping,
      region: server.region,
      datacenter: server.datacenter,
      method: server.ping === null ? 'none' : 'estimated',
      samples: []
    }
  )
}

export function resetServers(): void {
  current = null
  pings = {}
  error = null
}
