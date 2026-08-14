import type { ToastPayload } from '@shared/models'
import type { Toast } from '../types'

/**
 * Transient notifications. Toasts are queued in insertion order, capped so a
 * runaway loop cannot bury the UI, and auto-dismissed unless `timeout` is 0.
 */

const MAX_VISIBLE = 4
const DEFAULT_TIMEOUT = 5000

let items = $state<Toast[]>([])
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let counter = 0

export const toasts = {
  get value(): Toast[] {
    return items
  }
}

export function pushToast(payload: ToastPayload): string {
  counter += 1
  const id = payload.id ?? `toast-${counter}`
  const timeout = payload.timeout ?? DEFAULT_TIMEOUT

  const toast: Toast = {
    id,
    kind: payload.kind,
    title: payload.title,
    message: payload.message,
    timeout,
    createdAt: Date.now()
  }

  // Replacing by id lets repeated progress-style messages update in place.
  const existing = items.findIndex((item) => item.id === id)
  if (existing >= 0) {
    clearTimer(id)
    items[existing] = toast
  } else {
    items = [...items, toast].slice(-MAX_VISIBLE)
  }

  if (timeout > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), timeout)
    )
  }

  return id
}

export function dismissToast(id: string): void {
  clearTimer(id)
  items = items.filter((item) => item.id !== id)
}

export function clearToasts(): void {
  for (const id of timers.keys()) clearTimer(id)
  items = []
}

function clearTimer(id: string): void {
  const handle = timers.get(id)
  if (handle !== undefined) {
    clearTimeout(handle)
    timers.delete(id)
  }
}
