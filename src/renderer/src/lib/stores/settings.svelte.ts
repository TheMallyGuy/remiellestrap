import type { AppSettings } from '@shared/settings'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { api, errorMessage } from '../ipc'
import { pushToast } from './toasts.svelte'

/**
 * The authoritative copy of settings lives in the main process. This store is
 * a reactive mirror: writes go out over IPC and the returned value is folded
 * back in, so the renderer can never drift from what was actually persisted.
 */

let current = $state<AppSettings>({ ...DEFAULT_SETTINGS })
let loaded = $state(false)
let saving = $state(0)

export const settings = {
  get value(): AppSettings {
    return current
  },
  get loaded(): boolean {
    return loaded
  },
  get saving(): boolean {
    return saving > 0
  }
}

/** Loads settings once at start-up. */
export async function loadSettings(): Promise<AppSettings> {
  try {
    current = await api.settings.load()
  } catch (error) {
    pushToast({
      kind: 'error',
      title: 'Settings could not be loaded',
      message: errorMessage(error)
    })
  } finally {
    loaded = true
  }

  return current
}

/**
 * Applies a patch optimistically, then reconciles with whatever the main
 * process actually stored. On failure the optimistic change is rolled back.
 */
export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const previous = current
  current = { ...current, ...patch }
  saving += 1

  try {
    current = await api.settings.save(patch)
  } catch (error) {
    current = previous
    pushToast({
      kind: 'error',
      title: 'Could not save that change',
      message: errorMessage(error)
    })
  } finally {
    saving -= 1
  }
}

/** Convenience for the many boolean switches in the settings pages. */
export function toggleSetting(key: keyof AppSettings): void {
  const value = current[key]
  if (typeof value !== 'boolean') return
  void updateSettings({ [key]: !value } as Partial<AppSettings>)
}

export async function resetSettings(): Promise<void> {
  try {
    current = await api.settings.reset()
    pushToast({ kind: 'success', title: 'Settings restored to defaults' })
  } catch (error) {
    pushToast({ kind: 'error', title: 'Reset failed', message: errorMessage(error) })
  }
}

export async function exportSettings(): Promise<void> {
  try {
    const result = await api.settings.export()
    if (result.ok) {
      pushToast({ kind: 'success', title: 'Settings exported', message: result.data })
    } else if (result.error) {
      pushToast({ kind: 'warning', title: 'Export cancelled', message: result.error })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Export failed', message: errorMessage(error) })
  }
}

export async function importSettings(): Promise<void> {
  try {
    const result = await api.settings.import()
    if (result.ok && result.data) {
      current = result.data
      pushToast({ kind: 'success', title: 'Settings imported' })
    } else if (result.error) {
      pushToast({ kind: 'warning', title: 'Import cancelled', message: result.error })
    }
  } catch (error) {
    pushToast({ kind: 'error', title: 'Import failed', message: errorMessage(error) })
  }
}

/** Folds in a `settings:changed` push event from the main process. */
export function applyExternalSettings(next: AppSettings): void {
  current = next
}
