import type { IconName } from '../components/icons'

/**
 * Renderer-only types. Anything shared with the main process belongs in
 * `src/shared`, not here.
 */

export const PAGES = [
  'home',
  'appearance',
  'behaviour',
  'fastflags',
  'mods',
  'integrations',
  'installation',
  'about'
] as const

export type PageId = (typeof PAGES)[number]

export interface NavItem {
  id: PageId
  label: string
  /** One-line description used as the tooltip and the page subtitle. */
  hint: string
  icon: IconName
}

export function isPageId(value: unknown): value is PageId {
  return typeof value === 'string' && (PAGES as readonly string[]).includes(value)
}

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'warning' | 'error'
  title: string
  message?: string
  timeout: number
  createdAt: number
}

/** A single row in the FastFlags editor, kept as text while being edited. */
export interface FlagRow {
  id: string
  key: string
  value: string
  error: string | null
}

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}
