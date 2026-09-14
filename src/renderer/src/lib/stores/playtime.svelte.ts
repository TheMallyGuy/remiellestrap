import type { PlaytimeSummary } from '@shared/models'
import { api, errorMessage } from '../ipc'
import { pushToast } from './toasts.svelte'

/**
 * Session and lifetime playtime.
 *
 * The main process banks a session when the client exits; this store keeps the
 * current totals for whatever is on screen. It is refreshed by the
 * `playtime:update` push event rather than by polling.
 */

const EMPTY: PlaytimeSummary = {
  totalMs: 0,
  sessions: 0,
  firstLaunchAt: null,
  games: [],
  currentSessionMs: null
}

let current = $state<PlaytimeSummary>({ ...EMPTY })

export const playtime = {
  get value(): PlaytimeSummary {
    return current
  },
  /** Lifetime hours, as a number, for the stat tiles. */
  get hours(): number {
    return Math.floor(current.totalMs / 3_600_000)
  },
  /** The five most played experiences, longest first. */
  get topGames() {
    return [...current.games].sort((a, b) => b.totalMs - a.totalMs).slice(0, 5)
  },
  get inSession(): boolean {
    return current.currentSessionMs !== null
  }
}

export async function loadPlaytime(): Promise<void> {
  try {
    current = await api.playtime.summary()
  } catch {
    /* the page still renders with zeroes */
  }
}

export function applyPlaytime(next: PlaytimeSummary): void {
  current = next
}

export async function resetPlaytime(): Promise<void> {
  try {
    current = await api.playtime.reset()
    pushToast({ kind: 'success', title: 'Playtime cleared' })
  } catch (error) {
    pushToast({ kind: 'error', title: 'Could not clear playtime', message: errorMessage(error) })
  }
}
