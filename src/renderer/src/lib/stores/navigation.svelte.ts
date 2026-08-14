import type { PageId } from '../types'
import { isPageId } from '../types'
import { updateSettings } from './settings.svelte'

/**
 * Which page is showing, plus the window's chrome state for the custom
 * titlebar. The active page is remembered across restarts via `lastOpenedPage`.
 */

let page = $state<PageId>('home')
let maximized = $state(false)
let focused = $state(true)

export const navigation = {
  get page(): PageId {
    return page
  },
  get maximized(): boolean {
    return maximized
  },
  get focused(): boolean {
    return focused
  }
}

/** Navigates, persisting the choice unless this came from a restore. */
export function goTo(next: PageId, persist = true): void {
  if (page === next) return
  page = next
  if (persist) void updateSettings({ lastOpenedPage: next })
}

/** Applies a `navigate:page` push event (tray menu, deep link, etc.). */
export function applyNavigation(value: string): void {
  if (isPageId(value)) goTo(value)
}

/** Restores the remembered page at start-up without writing it back. */
export function restorePage(value: string): void {
  if (isPageId(value)) goTo(value, false)
}

/** Applies a `window:state` push event. */
export function applyWindowState(state: { maximized: boolean; focused: boolean }): void {
  maximized = state.maximized
  focused = state.focused
}

export function setMaximized(value: boolean): void {
  maximized = value
}
