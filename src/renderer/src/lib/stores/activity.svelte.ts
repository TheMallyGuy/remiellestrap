import type { ActivityUpdate, RobloxExitPayload, RpcUpdate } from '@shared/models'
import type { AppState } from '@shared/state'
import { DEFAULT_APP_STATE } from '@shared/state'
import { api, errorMessage } from '../ipc'
import { pushToast } from './toasts.svelte'

/**
 * Live Roblox activity, Discord presence and the persisted session history.
 */

const IDLE: ActivityUpdate = { activity: null, inGame: false, robloxRunning: false }

let current = $state<ActivityUpdate>({ ...IDLE })
let rpc = $state<RpcUpdate | null>(null)
let appState = $state<AppState>({ ...DEFAULT_APP_STATE })
let lastExit = $state<RobloxExitPayload | null>(null)

export const activity = {
  get value(): ActivityUpdate {
    return current
  },
  get rpc(): RpcUpdate | null {
    return rpc
  },
  get state(): AppState {
    return appState
  },
  get lastExit(): RobloxExitPayload | null {
    return lastExit
  },
  get history(): AppState['recentActivity'] {
    return appState.recentActivity
  },
  /** A session can be rejoined when we know both the place and the server. */
  get canRejoin(): boolean {
    const entry = current.activity ?? appState.lastActivity
    return Boolean(entry?.placeId && entry?.jobId)
  }
}

export async function loadActivity(): Promise<void> {
  try {
    current = await api.activity.get()
  } catch {
    current = { ...IDLE }
  }
}

export async function loadAppState(): Promise<void> {
  try {
    appState = await api.system.getState()
  } catch {
    /* keep whatever we already have */
  }
}

/** Applies an `activity:update` push event. */
export function applyActivity(update: ActivityUpdate): void {
  current = update
}

/** Applies an `activity:leave` push event. */
export function applyLeave(): void {
  current = { ...current, activity: null, inGame: false }
  // The history list gained an entry with a `leftAt`, so refresh it.
  void loadAppState()
}

/** Applies an `rpc:update` push event. */
export function applyRpc(update: RpcUpdate): void {
  rpc = update
}

/** Applies a `roblox:exit` push event. */
export function applyExit(payload: RobloxExitPayload): void {
  lastExit = payload
  current = { ...IDLE }
  void loadAppState()
}

export async function rejoin(): Promise<void> {
  try {
    const result = await api.activity.rejoin()
    if (!result.ok) {
      pushToast({
        kind: 'warning',
        title: 'Could not rejoin',
        message: result.error ?? 'No recent server to rejoin.'
      })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Rejoin failed', message: errorMessage(error) })
  }
}

export async function copyJoinScript(): Promise<void> {
  try {
    const result = await api.activity.copyJoinScript()
    if (result.ok) {
      pushToast({ kind: 'success', title: 'Join script copied to the clipboard' })
    } else {
      pushToast({
        kind: 'warning',
        title: 'Nothing to copy',
        message: result.error ?? 'No active server.'
      })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Copy failed', message: errorMessage(error) })
  }
}

export async function openGamePage(): Promise<void> {
  try {
    const result = await api.activity.openGamePage()
    if (!result.ok) {
      pushToast({
        kind: 'warning',
        title: 'No experience to open',
        message: result.error ?? undefined
      })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Could not open the page', message: errorMessage(error) })
  }
}

export async function closeRoblox(): Promise<void> {
  try {
    const result = await api.bootstrapper.killRoblox()
    if (result.ok) {
      pushToast({ kind: 'success', title: 'Roblox closed' })
    } else {
      pushToast({
        kind: 'warning',
        title: 'Roblox is not running',
        message: result.error ?? undefined
      })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Could not close Roblox', message: errorMessage(error) })
  }
}
