import type { ArtAsset } from '@shared/models'
import type { ArtSlot } from '@shared/settings'
import { ART_SLOTS } from '@shared/settings'
import { api } from '../ipc'

/**
 * Remielle artwork per UI slot.
 *
 * The main process owns fetching, caching and disk hygiene; the renderer only
 * ever receives an `app://` URL pointing at an already-downloaded file. A slot
 * has three observable states: loading, resolved with an asset, or resolved
 * with `null` (Safebooru unreachable or no matching post — the UI then falls
 * back to a plain treatment rather than showing a broken image).
 */

interface SlotState {
  asset: ArtAsset | null
  loading: boolean
  error: string | null
  /** Bumped on shuffle so `<img>` remounts even if the URL repeats. */
  nonce: number
}

function emptySlot(): SlotState {
  return { asset: null, loading: false, error: null, nonce: 0 }
}

const slots = $state<Record<string, SlotState>>(
  Object.fromEntries(ART_SLOTS.map((slot) => [slot, emptySlot()]))
)

export function artSlot(slot: ArtSlot): SlotState {
  return (slots[slot] ??= emptySlot())
}

/** Loads a slot's art, using the persisted choice unless `shuffle` is set. */
export async function loadArt(slot: ArtSlot, shuffle = false): Promise<void> {
  const state = artSlot(slot)
  if (state.loading) return

  state.loading = true
  state.error = null

  try {
    const asset = await api.booru.getArtForSlot({ slot, shuffle })
    state.asset = asset
    if (shuffle) state.nonce += 1
    if (!asset) state.error = 'No artwork available'
  } catch (error) {
    state.asset = null
    state.error = error instanceof Error ? error.message : 'Artwork could not be loaded'
  } finally {
    state.loading = false
  }
}

/** Loads every slot that has not been populated yet. */
export async function loadAllArt(): Promise<void> {
  await Promise.all(
    ART_SLOTS.filter((slot) => !artSlot(slot).asset && !artSlot(slot).loading).map((slot) =>
      loadArt(slot)
    )
  )
}

/** Applies a `theme:artUpdated` push event. */
export function applyArtUpdate(slot: string, asset: ArtAsset | null): void {
  const state = artSlot(slot as ArtSlot)
  state.asset = asset
  state.loading = false
  state.error = asset ? null : 'No artwork available'
  state.nonce += 1
}

/** Drops every cached asset, e.g. after the disk cache is cleared. */
export function forgetAllArt(): void {
  for (const slot of ART_SLOTS) {
    slots[slot] = emptySlot()
  }
}
