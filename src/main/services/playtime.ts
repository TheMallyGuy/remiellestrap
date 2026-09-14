import type { PlaytimeGame, PlaytimeSummary } from '@shared/models'
import { DEFAULT_PLAYTIME, type AppState, type PlaytimeStats } from '@shared/state'
import { createLogger } from '../utils/logger'
import { emit, toast } from './events'
import { getSettings } from './settingsStore'
import { loadState, saveState } from './stateStore'

/**
 * Playtime tracking.
 *
 * A session is opened when the client is spawned and closed when the activity
 * service sees the client exit, which keeps the bookkeeping honest even if the
 * client crashes. The open session is written to State.json immediately so an
 * unclean shutdown of *this* app still leaves the time recoverable: on the next
 * boot `recoverOpenSession` closes whatever was left open.
 */

const logger = createLogger('Playtime')

/** Sessions shorter than this are treated as a mis-launch and discarded. */
const MINIMUM_SESSION_MS = 20_000

function statsFrom(state: AppState): PlaytimeStats {
  return { ...DEFAULT_PLAYTIME, ...(state.playtime ?? {}) }
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Opens a session. Called by the bootstrapper right after the client spawns. */
export async function openSession(placeId: string | null = null): Promise<void> {
  if (!getSettings().trackPlaytime) return

  const state = await loadState()
  const playtime = statsFrom(state)

  if (playtime.openSessionStartedAt) return

  await saveState({
    playtime: {
      ...playtime,
      openSessionStartedAt: Date.now(),
      openSessionPlaceId: placeId,
      firstLaunchAt: playtime.firstLaunchAt ?? Date.now()
    }
  })

  logger.info('Playtime session opened')
}

/** Attaches the place being played to the open session. */
export async function attributeSession(placeId: string): Promise<void> {
  if (!getSettings().trackPlaytime) return

  const state = await loadState()
  const playtime = statsFrom(state)

  if (!playtime.openSessionStartedAt) return
  if (playtime.openSessionPlaceId === placeId) return

  await saveState({ playtime: { ...playtime, openSessionPlaceId: placeId } })
}

/**
 * Closes the open session and banks its time.
 *
 * Returns the session length in milliseconds, or 0 when there was nothing to
 * close. The optional notification is what makes the "you played for two hours"
 * toast appear when the client exits.
 */
export async function closeSession(options: { notify?: boolean } = {}): Promise<number> {
  const state = await loadState()
  const playtime = statsFrom(state)

  if (!playtime.openSessionStartedAt) return 0

  const startedAt = playtime.openSessionStartedAt
  const placeId = playtime.openSessionPlaceId
  const duration = Math.max(0, Date.now() - startedAt)

  const games: Record<string, PlaytimeGame> = { ...playtime.games }

  if (placeId && duration >= MINIMUM_SESSION_MS) {
    const existing = games[placeId]
    games[placeId] = {
      placeId,
      name: existing?.name ?? `Place ${placeId}`,
      thumbnailUrl: existing?.thumbnailUrl ?? null,
      totalMs: (existing?.totalMs ?? 0) + duration,
      sessions: (existing?.sessions ?? 0) + 1,
      lastPlayedAt: Date.now()
    }
  }

  const next: PlaytimeStats = {
    ...playtime,
    totalMs: playtime.totalMs + (duration >= MINIMUM_SESSION_MS ? duration : 0),
    sessions: playtime.sessions + 1,
    games,
    openSessionStartedAt: null,
    openSessionPlaceId: null
  }

  await saveState({ playtime: next })
  emit('playtime:update', await summary())

  logger.info(`Playtime session closed after ${Math.round(duration / 1000)}s`)

  if (options.notify !== false && getSettings().notifyPlaytimeOnExit && duration >= 60_000) {
    const label = placeId && games[placeId] ? games[placeId].name : 'Roblox'
    toast('info', 'Session finished', `${label} · ${formatDuration(duration)}`)
  }

  return duration
}

/** The figures the UI shows. */
export async function summary(): Promise<PlaytimeSummary> {
  const state = await loadState()
  const playtime = statsFrom(state)

  return {
    totalMs: playtime.totalMs,
    sessions: playtime.sessions,
    firstLaunchAt: playtime.firstLaunchAt,
    games: Object.values(playtime.games)
      .sort((a, b) => b.totalMs - a.totalMs)
      .slice(0, 60),
    currentSessionMs: playtime.openSessionStartedAt
      ? Date.now() - playtime.openSessionStartedAt
      : null
  }
}

export async function reset(): Promise<PlaytimeSummary> {
  const state = await loadState()
  await saveState({
    playtime: { ...DEFAULT_PLAYTIME, firstLaunchAt: state.playtime.firstLaunchAt }
  })
  logger.info('Playtime statistics reset')
  return summary()
}

/** Names and thumbnails are learned from the activity feed as it arrives. */
export async function rememberGame(
  placeId: string,
  name: string | null,
  thumbnailUrl: string | null
): Promise<void> {
  const state = await loadState()
  const playtime = statsFrom(state)
  const existing = playtime.games[placeId]

  if (!existing) return
  if (existing.name === name && existing.thumbnailUrl === thumbnailUrl) return

  await saveState({
    playtime: {
      ...playtime,
      games: {
        ...playtime.games,
        [placeId]: {
          ...existing,
          name: name ?? existing.name,
          thumbnailUrl: thumbnailUrl ?? existing.thumbnailUrl
        }
      }
    }
  })
}

/**
 * Closes a session that was left open by an unclean exit — for example when the
 * machine was shut down mid-game. Called on every startup.
 */
export async function recoverOpenSession(): Promise<void> {
  const state = await loadState()
  const playtime = statsFrom(state)

  if (!playtime.openSessionStartedAt) return

  logger.info('Closing a playtime session left open by an unclean exit')
  await closeSession({ notify: false })
}

/** Formats a duration for the UI's summary lines. */
export function formatPlaytime(ms: number): string {
  return formatDuration(ms)
}
