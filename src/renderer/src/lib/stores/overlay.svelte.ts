import type { OverlayState, OverlayStats } from '@shared/models'
import { api, errorMessage } from '../ipc'
import { pushToast } from './toasts.svelte'

/**
 * The in-game overlay's state, mirrored in the launcher.
 *
 * Two things arrive separately and both matter: the *state* (visible, tracking,
 * which shortcut was registered) only changes occasionally, while the *sample*
 * arrives on every tick. The overlay window draws from the sample; this store
 * exists so the Overlays page can show the same truth without polling for it.
 */

const IDLE: OverlayState = {
  enabled: false,
  visible: false,
  supported: false,
  reason: null,
  clickThrough: true,
  anchor: 'top-right',
  bounds: null,
  tracking: false,
  hotkey: null,
  hotkeyError: null,
  preview: false,
  contentSize: { width: 248, height: 132 },
  stats: null
}

let current = $state<OverlayState>({ ...IDLE })
let stats = $state<OverlayStats | null>(null)

export const overlay = {
  get value(): OverlayState {
    return current
  },
  /** The newest sample, falling back to whatever the state carried. */
  get stats(): OverlayStats | null {
    return stats ?? current.stats
  },
  get visible(): boolean {
    return current.visible
  },
  /** True while the overlay is pinned to a measured client window. */
  get tracking(): boolean {
    return current.tracking
  }
}

export async function loadOverlay(): Promise<void> {
  try {
    current = await api.overlay.getState()
  } catch {
    current = { ...IDLE }
  }
}

/** Applies an `overlay:state` push event. */
export function applyOverlayState(next: OverlayState): void {
  current = next
}

/** Applies an `overlay:stats` push event. */
export function applyOverlayStats(next: OverlayStats): void {
  stats = next
}

export async function toggleOverlay(): Promise<void> {
  try {
    current = await api.overlay.toggle()
  } catch (error) {
    pushToast({ kind: 'error', title: 'The overlay did not respond', message: errorMessage(error) })
  }
}

export async function setOverlayVisible(visible: boolean): Promise<void> {
  try {
    current = await api.overlay.setVisible(visible)
  } catch (error) {
    pushToast({ kind: 'error', title: 'The overlay did not respond', message: errorMessage(error) })
  }
}

/**
 * Draws the overlay with placeholder figures so it can be arranged without a
 * game running — the only way to see it on a machine with no Roblox installed.
 */
export async function setOverlayPreview(enabled: boolean): Promise<void> {
  try {
    current = await api.overlay.preview(enabled)
  } catch (error) {
    pushToast({ kind: 'error', title: 'Preview failed', message: errorMessage(error) })
  }
}

/** Asks for one fresh sample, for the page's live panel. */
export async function sampleOverlay(): Promise<void> {
  try {
    stats = await api.overlay.sample()
  } catch (error) {
    pushToast({ kind: 'error', title: 'Could not sample', message: errorMessage(error) })
  }
}
