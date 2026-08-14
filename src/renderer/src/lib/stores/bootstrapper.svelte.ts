import type {
  BootstrapperProgress,
  BootstrapperResult,
  LaunchRequest,
  UpdateCheckResult
} from '@shared/models'
import { api, errorMessage } from '../ipc'
import { pushToast } from './toasts.svelte'

/**
 * Install/launch progress, mirrored from `bootstrapper:progress` events.
 *
 * The overlay is driven purely by `overlayOpen`; progress can keep arriving
 * while it is closed (a background update check, say) without forcing the UI
 * open.
 */

const IDLE: BootstrapperProgress = {
  stage: 'idle',
  progress: null,
  message: 'Ready',
  cancellable: false
}

let progress = $state<BootstrapperProgress>({ ...IDLE })
let overlayOpen = $state(false)
let lastResult = $state<BootstrapperResult | null>(null)
let updateCheck = $state<UpdateCheckResult | null>(null)
let checking = $state(false)
let failure = $state<{ message: string; detail?: string } | null>(null)

export const bootstrapper = {
  get progress(): BootstrapperProgress {
    return progress
  },
  get overlayOpen(): boolean {
    return overlayOpen
  },
  get lastResult(): BootstrapperResult | null {
    return lastResult
  },
  get updateCheck(): UpdateCheckResult | null {
    return updateCheck
  },
  get checking(): boolean {
    return checking
  },
  get failure(): { message: string; detail?: string } | null {
    return failure
  },
  /** True while an install or launch is actually in flight. */
  get busy(): boolean {
    return progress.stage !== 'idle' && !isTerminal(progress.stage)
  }
}

function isTerminal(stage: BootstrapperProgress['stage']): boolean {
  return stage === 'done' || stage === 'error' || stage === 'cancelled' || stage === 'running'
}

export function openOverlay(): void {
  overlayOpen = true
}

export function closeOverlay(): void {
  overlayOpen = false
  failure = null
  if (isTerminal(progress.stage)) progress = { ...IDLE }
}

/** Applies a `bootstrapper:progress` push event. */
export function applyProgress(next: BootstrapperProgress): void {
  progress = next
  if (!isTerminal(next.stage)) {
    failure = null
    overlayOpen = true
  }
}

/** Applies a `bootstrapper:complete` push event. */
export function applyComplete(result: BootstrapperResult): void {
  lastResult = result
}

/** Applies a `bootstrapper:error` push event. */
export function applyError(payload: { message: string; detail?: string }): void {
  failure = payload
  overlayOpen = true
}

/** Fetches the current progress from main, e.g. after a window reload. */
export async function syncProgress(): Promise<void> {
  try {
    const current = await api.bootstrapper.getProgress()
    progress = current
    if (!isTerminal(current.stage) && current.stage !== 'idle') overlayOpen = true
  } catch {
    /* a failed sync just leaves the idle default in place */
  }
}

export async function checkForUpdates(quiet = false): Promise<UpdateCheckResult | null> {
  checking = true

  try {
    const result = await api.bootstrapper.checkUpdate()
    updateCheck = result

    if (!quiet) {
      if (result.error) {
        pushToast({
          kind: 'warning',
          title: 'Update check failed',
          message: result.error
        })
      } else if (!result.installed) {
        pushToast({
          kind: 'info',
          title: 'Roblox is not installed yet',
          message: `Version ${result.latestVersion ?? 'unknown'} is available.`
        })
      } else if (result.upToDate) {
        pushToast({
          kind: 'success',
          title: 'Roblox is up to date',
          message: result.installedVersion ?? undefined
        })
      } else {
        pushToast({
          kind: 'info',
          title: 'An update is available',
          message: `${result.installedVersion ?? 'unknown'} → ${result.latestVersion ?? 'unknown'}`
        })
      }
    }

    return result
  } catch (error) {
    if (!quiet) {
      pushToast({ kind: 'error', title: 'Update check failed', message: errorMessage(error) })
    }
    return null
  } finally {
    checking = false
  }
}

export async function install(force = false): Promise<void> {
  overlayOpen = true
  failure = null

  try {
    lastResult = await api.bootstrapper.install(force)
    void checkForUpdates(true)
  } catch (error) {
    applyError({ message: 'Installation failed', detail: errorMessage(error) })
  }
}

export async function launch(request: LaunchRequest = {}): Promise<void> {
  overlayOpen = true
  failure = null

  try {
    lastResult = await api.bootstrapper.launch(request)
  } catch (error) {
    applyError({ message: 'Launch failed', detail: errorMessage(error) })
  }
}

export async function forceReinstall(): Promise<void> {
  overlayOpen = true
  failure = null

  try {
    lastResult = await api.bootstrapper.forceReinstall()
    void checkForUpdates(true)
  } catch (error) {
    applyError({ message: 'Reinstall failed', detail: errorMessage(error) })
  }
}

export async function cancel(): Promise<void> {
  try {
    const result = await api.bootstrapper.cancel()
    if (!result.ok && result.error) {
      pushToast({ kind: 'warning', title: 'Nothing to cancel', message: result.error })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Cancel failed', message: errorMessage(error) })
  }
}
