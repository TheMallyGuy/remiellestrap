/**
 * Reading an Electron accelerator inside the renderer.
 *
 * The palette and overlay shortcuts are stored the way the main process spells
 * them (`CommandOrControl+Shift+O`), because that is what `globalShortcut`
 * takes. The launcher's own shortcuts are not global — they only fire while the
 * window has focus — so they are matched here against a `KeyboardEvent` instead.
 * Keeping one spelling for both means the setting means the same thing in both
 * places.
 */

const COMMAND_MODIFIERS = new Set([
  'commandorcontrol',
  'cmdorctrl',
  'command',
  'cmd',
  'super',
  'meta'
])
const CONTROL_MODIFIERS = new Set(['control', 'ctrl'])
const ALT_MODIFIERS = new Set(['alt', 'option'])

function isMac(): boolean {
  return navigator.userAgent.includes('Macintosh')
}

/** Splits an accelerator into its modifier names and its key. */
export function parseAccelerator(accelerator: string): { modifiers: string[]; key: string } | null {
  const parts = accelerator
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0)

  if (parts.length === 0) return null

  return { modifiers: parts.slice(0, -1), key: parts[parts.length - 1] }
}

/**
 * True when a keyboard event is the given accelerator.
 *
 * `CommandOrControl` means Command on macOS and Control everywhere else, and a
 * modifier the accelerator did not ask for must not be down — otherwise Ctrl+K
 * would also fire on Ctrl+Shift+K and swallow a different shortcut.
 */
export function acceleratorMatches(event: KeyboardEvent, accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator)
  if (!parsed) return false

  const mac = isMac()
  const wantsCommand = parsed.modifiers.some((modifier) => COMMAND_MODIFIERS.has(modifier))
  const wantsControl =
    parsed.modifiers.some((modifier) => CONTROL_MODIFIERS.has(modifier)) || (wantsCommand && !mac)
  const wantsMeta = wantsCommand && mac
  const wantsAlt = parsed.modifiers.some((modifier) => ALT_MODIFIERS.has(modifier))
  const wantsShift = parsed.modifiers.includes('shift')

  if (event.ctrlKey !== wantsControl) return false
  if (event.metaKey !== wantsMeta) return false
  if (event.altKey !== wantsAlt) return false
  if (event.shiftKey !== wantsShift) return false

  // `event.key` is already the shifted character, so case is not meaningful.
  return event.key.toLowerCase() === parsed.key
}
