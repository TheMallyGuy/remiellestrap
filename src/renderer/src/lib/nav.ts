import type { NavItem } from './types'

/**
 * The navigation catalogue.
 *
 * One list, in rail order, used by the sidebar to draw itself, by the command
 * palette to offer "Go to …", and by the page shortcuts to know what Ctrl+1..9
 * means. It lives here rather than inside a component so those three can never
 * disagree about a label, a hint or an order.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'home', label: 'Home', hint: 'Launch Roblox and see what you last played', icon: 'home' },
  {
    id: 'accounts',
    label: 'Accounts',
    hint: 'Stored logins, presence and one-click joins',
    icon: 'user'
  },
  {
    id: 'servers',
    label: 'Servers',
    hint: 'Region preference and the public server browser',
    icon: 'globe'
  },
  {
    id: 'appearance',
    label: 'Appearance',
    hint: 'Theme, accent and the Remielle artwork',
    icon: 'palette'
  },
  {
    id: 'behaviour',
    label: 'Behaviour',
    hint: 'How the bootstrapper acts around a launch',
    icon: 'sliders'
  },
  {
    id: 'overlays',
    label: 'Overlays',
    hint: 'The in-game overlay and the launcher command palette',
    icon: 'overlay'
  },
  { id: 'fastflags', label: 'FastFlags', hint: 'Client engine flag profiles', icon: 'flag' },
  { id: 'mods', label: 'Mods', hint: 'File overrides applied to the client', icon: 'layers' },
  {
    id: 'integrations',
    label: 'Integrations',
    hint: 'Discord presence and activity tracking',
    icon: 'plug'
  },
  {
    id: 'utilities',
    label: 'Utilities',
    hint: 'Cleaner, logs, client settings, tweaks and backups',
    icon: 'wrench'
  },
  {
    id: 'installation',
    label: 'Installation',
    hint: 'Channel, versions, install location and repair',
    icon: 'download'
  },
  { id: 'about', label: 'About', hint: 'Version, credits and licences', icon: 'info' }
]

/**
 * The pages reachable by a number key, in order.
 *
 * Ctrl+1..9 covers the first nine and Ctrl+0 the tenth, so every page except
 * Installation and About — which are destinations rather than daily drivers —
 * has a shortcut.
 */
export const PAGE_SHORTCUT_ORDER: readonly NavItem['id'][] = NAV_ITEMS.filter(
  (item) => item.id !== 'installation' && item.id !== 'about'
).map((item) => item.id)
