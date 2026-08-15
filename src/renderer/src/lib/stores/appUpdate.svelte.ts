import type { AppUpdateState } from '@shared/models'
import { api, errorMessage } from '../ipc'
import { pushToast } from './toasts.svelte'

const initialState: AppUpdateState = {
  status: 'idle',
  currentVersion: '0.0.0',
  latestVersion: null,
  progress: null,
  bytesPerSecond: 0,
  bytesDownloaded: 0,
  bytesTotal: 0,
  releaseName: null,
  releaseNotes: null,
  releaseUrl: null,
  checkedAt: null,
  error: null
}

let state = $state<AppUpdateState>(initialState)

export const appUpdate = {
  get state(): AppUpdateState {
    return state
  },
  get busy(): boolean {
    return state.status === 'checking' || state.status === 'downloading'
  },
  get canInstall(): boolean {
    return state.status === 'downloaded'
  },
  get canDownload(): boolean {
    return state.status === 'available'
  }
}

export function applyAppUpdate(next: AppUpdateState): void {
  state = next
}

export async function loadAppUpdate(): Promise<void> {
  try {
    state = await api.app.getUpdateState()
  } catch (error) {
    pushToast({
      kind: 'error',
      title: 'Could not read update status',
      message: errorMessage(error)
    })
  }
}

export async function checkForAppUpdate(): Promise<void> {
  try {
    state = await api.app.checkForUpdates()
    if (state.status === 'up-to-date') {
      pushToast({ kind: 'success', title: 'RemielleStrap is up to date' })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Update check failed', message: errorMessage(error) })
  }
}

export async function downloadAppUpdate(): Promise<void> {
  try {
    const result = await api.app.downloadUpdate()
    if (!result.ok && result.error) {
      pushToast({ kind: 'error', title: 'Could not download the update', message: result.error })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Download failed', message: errorMessage(error) })
  }
}

export async function restartToUpdate(): Promise<void> {
  try {
    const result = await api.app.restartToUpdate()
    if (!result.ok && result.error) {
      pushToast({ kind: 'error', title: 'Could not restart RemielleStrap', message: result.error })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Restart failed', message: errorMessage(error) })
  }
}
