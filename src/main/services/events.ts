import { BrowserWindow, webContents } from 'electron'
import type { EventChannel, EventMap } from '@shared/ipc'

/**
 * Typed main -> renderer event bus. Broadcasting through one place keeps
 * every emitter honest about channel names and payload shapes, and lets
 * subsystems fire events without holding window references.
 */

type Listener<C extends EventChannel> = (payload: EventMap[C]) => void

const localListeners = new Map<EventChannel, Set<Listener<never>>>()

export function emit<C extends EventChannel>(channel: C, payload: EventMap[C]): void {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed()) continue
    try {
      contents.send(channel, payload)
    } catch {
      /* a window may be closing mid-send */
    }
  }

  const listeners = localListeners.get(channel)
  if (listeners) {
    for (const listener of listeners) {
      try {
        ;(listener as Listener<C>)(payload)
      } catch {
        /* listener errors must not break the emit loop */
      }
    }
  }
}

/** Send to a specific window only (used for bootstrapper overlay windows). */
export function emitTo<C extends EventChannel>(
  window: BrowserWindow | null,
  channel: C,
  payload: EventMap[C]
): void {
  if (!window || window.isDestroyed()) return
  try {
    window.webContents.send(channel, payload)
  } catch {
    /* ignore */
  }
}

/** Subscribe inside the main process (e.g. tray reacting to activity). */
export function onEvent<C extends EventChannel>(channel: C, listener: Listener<C>): () => void {
  let listeners = localListeners.get(channel)
  if (!listeners) {
    listeners = new Set()
    localListeners.set(channel, listeners)
  }
  listeners.add(listener as Listener<never>)
  return () => {
    listeners?.delete(listener as Listener<never>)
  }
}

/** Convenience helper for surfacing a toast in the renderer. */
export function toast(
  kind: EventMap['toast:show']['kind'],
  title: string,
  message?: string,
  timeout?: number
): void {
  emit('toast:show', { kind, title, message, timeout })
}
