import type { EventChannel, EventMap } from '@shared/ipc'

/**
 * The renderer's only door to the main process.
 *
 * Everything goes through `window.remielle`, which the preload script exposes
 * over the context bridge. This module exists so components never touch the
 * global directly: they import `api` and get a typed, guarded handle.
 */

const bridge = window.remielle

if (!bridge) {
  // This can only happen if the preload script failed to load, in which case
  // nothing in the app can work. Fail loudly rather than throwing scattered
  // `undefined is not a function` errors deep in component code.
  throw new Error(
    'The RemielleStrap bridge is unavailable. The preload script did not load correctly.'
  )
}

export const api = bridge

/**
 * Subscribes to a main-process event and returns an unsubscribe function,
 * shaped for direct use inside Svelte's `$effect`.
 */
export function listen<C extends EventChannel>(
  channel: C,
  handler: (payload: EventMap[C]) => void
): () => void {
  return api.on(channel, handler)
}

/**
 * Runs an IPC call and funnels any failure into a caller-supplied handler
 * instead of leaving an unhandled rejection. Returns `fallback` on error.
 */
export async function safeInvoke<T>(
  operation: () => Promise<T>,
  fallback: T,
  onError?: (message: string) => void
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[ipc]', message)
    onError?.(message)
    return fallback
  }
}

/** Normalises an unknown thrown value into a displayable message. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Something went wrong'
}
