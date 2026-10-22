import type { AccentMode, SidebarMode, ThemeMode } from '@shared/settings'

/**
 * Applying the appearance settings to a document.
 *
 * The app has more than one window now — the launcher, the install window and
 * the in-game overlay — and every one of them has to look like the same app.
 * These helpers are the single implementation of "what a setting means in CSS":
 * each one touches `<html>` and nothing else, and the ones that subscribe to
 * something return a disposer so a Svelte `$effect` can clean up after them.
 *
 * Components never read these settings themselves; they inherit the result.
 */

/** Themes that remap the whole ramp rather than only flipping light/dark. */
const VARIANT_THEMES = ['prism-night', 'ivory-cathedral', 'gold-ember'] as const

/** Themes that are light on their own, without asking the operating system. */
const LIGHT_THEMES = new Set<string>(['light', 'ivory-cathedral'])

function root(): HTMLElement {
  return document.documentElement
}

/** Honoured by every animation utility through one class on `<html>`. */
export function applyReduceMotion(value: boolean): void {
  root().classList.toggle('reduce-motion', value)
}

/**
 * The accent picker. Applied as `data-accent` so the stylesheet can remap the
 * gold ramp to Remielle's prism rose in one place.
 */
export function applyAccent(value: AccentMode): void {
  root().dataset.accent = value === 'prism' ? 'prism' : 'gold'
}

/** The rail's display mode; the sidebar reads the attribute, not the setting. */
export function applySidebarMode(value: SidebarMode): void {
  root().dataset.sidebar = value
}

/**
 * A user-chosen font.
 *
 * A file is loaded from the app's own folder over `app://` and then named
 * through a single CSS variable; a family name is used as given. Returns a
 * disposer that removes the injected `@font-face` and the variable.
 */
export function applyCustomFont(file: string | null, family: string): () => void {
  const element = root()
  let style: HTMLStyleElement | null = null

  if (file) {
    const name = 'RemielleUserFont'
    style = document.createElement('style')
    style.textContent = `@font-face { font-family: '${name}'; src: url('app://font/${encodeURIComponent(
      file.split(/[\\/]/).pop() ?? file
    )}'); font-display: swap; }`
    document.head.appendChild(style)
    element.style.setProperty('--font-sans', `'${name}', var(--font-sans-default)`)
  } else if (family) {
    element.style.setProperty('--font-sans', `'${family}', var(--font-sans-default)`)
  } else {
    element.style.removeProperty('--font-sans')
  }

  return () => {
    style?.remove()
    element.style.removeProperty('--font-sans')
  }
}

/**
 * The theme.
 *
 * Only the `system` mode has to follow the operating system, so the media query
 * is subscribed to just for that case; the explicit modes are applied once.
 * Returns a disposer for the listener.
 */
export function applyThemeMode(value: ThemeMode): () => void {
  const element = root()

  for (const variant of VARIANT_THEMES) {
    element.classList.toggle(`theme-${variant}`, value === variant)
  }

  const media = window.matchMedia('(prefers-color-scheme: light)')

  const apply = (): void => {
    const light = LIGHT_THEMES.has(value) || (value === 'system' && media.matches)

    element.classList.toggle('theme-light', light)
    element.style.colorScheme = light ? 'light' : 'dark'
  }

  apply()

  if (value !== 'system') return () => undefined

  media.addEventListener('change', apply)
  return () => media.removeEventListener('change', apply)
}
