/**
 * Shared catalogs.
 *
 * These are the *static* tables that both processes need to agree on: which
 * client files a "file replacement" mod may target, which directories the
 * cleaner may touch, the region list used by the server browser, and the
 * handful of FastFlags that back a UI toggle.
 *
 * Everything here is plain data with no Node or DOM imports, so it can be
 * imported from the main process, the preload script and the renderer alike.
 */

import type {
  BackgroundStyle,
  CleanerCategory,
  LauncherStyle,
  ModTarget,
  OverlayAnchor,
  OverlayWidget,
  SidebarMode,
  WindowEffect
} from './settings'
import type { ModFileSlot } from './models'

/* ------------------------------------------------------------------- Mods */

/**
 * Client file slots a user may drop their own file into.
 *
 * `relative` is the path inside the Roblox version directory. Roblox renames
 * these occasionally, so each slot lists `fallbacks` that are probed on disk
 * before the primary path is used.
 */
export interface ModFileSlotDefinition extends ModFileSlot {
  /** Alternative client paths, tried in order when the primary is missing. */
  fallbacks: string[]
}

export const MOD_FILE_SLOTS: readonly ModFileSlotDefinition[] = [
  {
    id: 'cursor-arrow',
    label: 'Cursor',
    description: "The default pointer, Roblox's arrow cursor.",
    relative: 'content/textures/Cursors/KeyboardMouse/ArrowCursor.png',
    fallbacks: ['content/textures/Cursors/KeyboardMouse/ArrowCursor.png'],
    extensions: ['png'],
    kind: 'image'
  },
  {
    id: 'cursor-arrow-far',
    label: 'Cursor (fading)',
    description: 'The dimmed pointer shown after the mouse is idle.',
    relative: 'content/textures/Cursors/KeyboardMouse/ArrowFarCursor.png',
    fallbacks: ['content/textures/Cursors/KeyboardMouse/ArrowFarCursor.png'],
    extensions: ['png'],
    kind: 'image'
  },
  {
    id: 'shift-lock',
    label: 'Shift Lock icon',
    description: 'The padlock drawn by the default control scripts when Shift Lock is on.',
    relative: 'content/textures/ShiftLock.png',
    fallbacks: [
      'content/textures/ShiftLock.png',
      'ExtraContent/textures/ShiftLock.png',
      'content/textures/ui/ShiftLock.png'
    ],
    extensions: ['png'],
    kind: 'image'
  },
  {
    id: 'death-sound',
    label: 'Death sound',
    description: 'Played by the default health script when the character dies.',
    relative: 'content/sounds/ouch.ogg',
    fallbacks: ['content/sounds/ouch.ogg', 'content/sounds/uuhhh.mp3'],
    extensions: ['ogg', 'mp3', 'wav'],
    kind: 'audio'
  },
  {
    id: 'font-ui',
    label: 'UI font',
    description: 'Replaces the client UI font used by menu and in-game core UI.',
    relative: 'content/fonts/families/RemielleUI.ttf',
    fallbacks: [
      'content/fonts/families/SourceSansPro-Regular.ttf',
      'content/fonts/families/GothamSSm-Book.ttf'
    ],
    extensions: ['ttf', 'otf'],
    kind: 'font'
  },
  {
    id: 'emote-wheel',
    label: 'Emote wheel',
    description: 'The radial emote picker background texture.',
    relative: 'ExtraContent/textures/EmoteWheel.png',
    fallbacks: [
      'ExtraContent/textures/EmoteWheel.png',
      'content/textures/ui/EmoteWheel.png',
      'content/textures/EmoteWheel.png'
    ],
    extensions: ['png'],
    kind: 'image'
  },
  {
    id: 'voice-chat',
    label: 'Voice chat icon',
    description: 'The microphone glyph shown by the voice chat UI.',
    relative: 'content/textures/ui/VoiceChat.png',
    fallbacks: [
      'content/textures/ui/VoiceChat.png',
      'content/textures/VoiceChat.png',
      'ExtraContent/textures/VoiceChat.png'
    ],
    extensions: ['png'],
    kind: 'image'
  }
] as const

export function modFileSlot(id: string): ModFileSlotDefinition | null {
  return MOD_FILE_SLOTS.find((slot) => slot.id === id) ?? null
}

export const MOD_TARGETS: readonly { value: ModTarget; label: string; hint: string }[] = [
  { value: 'player', label: 'Player', hint: 'Only applied to RobloxPlayerBeta.' },
  { value: 'studio', label: 'Studio', hint: 'Only applied to RobloxStudioBeta.' },
  { value: 'both', label: 'Both', hint: 'Applied to the player and Studio installs.' }
]

/* ---------------------------------------------------------------- Cleaner */

export interface CleanerTargetDefinition {
  id: CleanerCategory
  label: string
  description: string
  /** True when deleting this cannot break an installed client. */
  safe: boolean
}

export const CLEANER_TARGETS: readonly CleanerTargetDefinition[] = [
  {
    id: 'roblox-logs',
    label: 'Roblox logs',
    description: 'Client log files under %LOCALAPPDATA%\\Roblox\\logs.',
    safe: true
  },
  {
    id: 'roblox-crash-dumps',
    label: 'Roblox crash dumps',
    description: 'Crash handler dumps and archives.',
    safe: true
  },
  {
    id: 'roblox-cache',
    label: 'Roblox caches',
    description: 'HTTP, asset and thumbnail caches the client rebuilds itself.',
    safe: true
  },
  {
    id: 'roblox-temp',
    label: 'Roblox temp files',
    description: 'Scratch files left behind in %TEMP%.',
    safe: true
  },
  {
    id: 'roblox-versions',
    label: 'Orphaned Roblox versions',
    description: 'Version folders under %LOCALAPPDATA%\\Roblox\\Versions that no install uses.',
    safe: false
  },
  {
    id: 'strap-logs',
    label: 'RemielleStrap logs',
    description: 'This app\u2019s own rolling log files.',
    safe: true
  },
  {
    id: 'strap-cache',
    label: 'RemielleStrap cache',
    description: 'Cached API responses and downloaded package copies.',
    safe: true
  },
  {
    id: 'strap-downloads',
    label: 'Downloaded packages',
    description: 'Roblox package archives kept so mods can be reverted offline.',
    safe: false
  },
  {
    id: 'strap-versions',
    label: 'Unused RemielleStrap installs',
    description: 'Version folders this app installed that are no longer referenced.',
    safe: false
  },
  {
    id: 'strap-art',
    label: 'Safebooru art cache',
    description: 'Downloaded artwork. Slots refill the next time they are shown.',
    safe: true
  }
] as const

/* ---------------------------------------------------------------- Regions */

export interface RegionDefinition {
  id: string
  label: string
  /** Roblox datacenter prefixes that map to this region. */
  datacenters: string[]
  hint: string
}

/**
 * Roblox datacenters, grouped into the regions the server browser offers.
 * Datacenter prefixes are matched case-insensitively against the value a
 * region lookup returns (e.g. "ATL", "CHI1", "fra").
 */
export const REGION_CATALOG: readonly RegionDefinition[] = [
  {
    id: 'any',
    label: 'Anywhere',
    datacenters: [],
    hint: 'No preference — join the fullest healthy server.'
  },
  {
    id: 'us-east',
    label: 'US East',
    datacenters: ['ATL', 'IAD', 'NYC', 'MIA', 'ASH', 'BOS'],
    hint: 'Atlanta, Washington DC, New York, Miami.'
  },
  {
    id: 'us-central',
    label: 'US Central',
    datacenters: ['CHI', 'DFW', 'DEN', 'HOU', 'KCI'],
    hint: 'Chicago, Dallas, Denver, Houston.'
  },
  {
    id: 'us-west',
    label: 'US West',
    datacenters: ['LAX', 'SEA', 'SJC', 'PHX', 'PDX', 'SLC'],
    hint: 'Los Angeles, Seattle, San Jose, Phoenix.'
  },
  {
    id: 'us-south',
    label: 'US South',
    datacenters: ['NASH', 'OKC', 'SAT'],
    hint: 'Nashville, Oklahoma City, San Antonio.'
  },
  {
    id: 'europe',
    label: 'Europe',
    datacenters: ['LON', 'FRA', 'AMS', 'PAR', 'MAD', 'STO', 'WAR', 'HEL', 'MUC', 'MIL'],
    hint: 'London, Frankfurt, Amsterdam, Paris, Madrid.'
  },
  {
    id: 'asia-east',
    label: 'Asia East',
    datacenters: ['TOK', 'SEL', 'OSA', 'HKG', 'TPE'],
    hint: 'Tokyo, Seoul, Osaka, Hong Kong.'
  },
  {
    id: 'asia-south',
    label: 'Asia South',
    datacenters: ['SIN', 'BOM', 'MAA', 'DEL', 'BKK'],
    hint: 'Singapore, Mumbai, Chennai, Delhi.'
  },
  {
    id: 'oceania',
    label: 'Oceania',
    datacenters: ['SYD', 'MEL', 'AKL'],
    hint: 'Sydney, Melbourne, Auckland.'
  },
  {
    id: 'south-america',
    label: 'South America',
    datacenters: ['GRU', 'SCL', 'BOG', 'LIM'],
    hint: 'S\u00e3o Paulo, Santiago, Bogot\u00e1, Lima.'
  },
  {
    id: 'africa',
    label: 'Africa',
    datacenters: ['JNB', 'CPT', 'LOS'],
    hint: 'Johannesburg, Cape Town, Lagos.'
  }
] as const

export function regionById(id: string): RegionDefinition {
  return REGION_CATALOG.find((region) => region.id === id) ?? REGION_CATALOG[0]
}

/** Maps a datacenter code (or a raw location string) onto a region id. */
export function regionForDatacenter(datacenter: string | null | undefined): string | null {
  if (!datacenter) return null
  const needle = datacenter.trim().toUpperCase()
  if (needle.length === 0) return null

  for (const region of REGION_CATALOG) {
    if (region.id === 'any') continue
    for (const code of region.datacenters) {
      if (needle === code || needle.startsWith(code)) return region.id
    }
  }

  // Fall back to substring matching so "us-east-1" or "US East" still resolve.
  for (const region of REGION_CATALOG) {
    if (region.id === 'any') continue
    if (needle.includes(region.label.toUpperCase())) return region.id
  }

  return null
}

/* ----------------------------------------------------------------- Themes */

export interface ThemeDefinition {
  id: string
  label: string
  hint: string
  /** True when the theme is built on the light ink/ivory ramp. */
  light: boolean
}

export const THEME_CATALOG: readonly ThemeDefinition[] = [
  { id: 'dark', label: 'Ink', hint: 'The default deep-black cathedral.', light: false },
  {
    id: 'light',
    label: 'Ivory',
    hint: 'The light ramp: pale stone and gold ink.',
    light: true
  },
  {
    id: 'system',
    label: 'Match system',
    hint: 'Follows the operating system appearance.',
    light: false
  },
  {
    id: 'prism-night',
    label: 'Prism Night',
    hint: 'Cold violet-black with a rose accent.',
    light: false
  },
  {
    id: 'ivory-cathedral',
    label: 'Ivory Cathedral',
    hint: 'Warm ivory, thin gold lines, high daylight.',
    light: true
  },
  {
    id: 'gold-ember',
    label: 'Gold Ember',
    hint: 'Warm near-black with a brighter amber accent.',
    light: false
  }
] as const

export const SIDEBAR_MODES: readonly { value: SidebarMode; label: string; hint: string }[] = [
  { value: 'full', label: 'Icons and labels', hint: 'The default rail.' },
  { value: 'compact', label: 'Compact', hint: 'Narrower rail with shorter labels.' },
  { value: 'icons', label: 'Icons only', hint: 'Maximum room for content.' }
] as const

export const WINDOW_EFFECT_OPTIONS: readonly {
  value: WindowEffect
  label: string
  hint: string
}[] = [
  { value: 'none', label: 'None', hint: 'A solid background everywhere.' },
  { value: 'auto', label: 'Automatic', hint: 'Mica on Windows 11, otherwise a soft blur.' },
  { value: 'mica', label: 'Mica', hint: 'Windows 11 desktop-tinted backdrop.' },
  { value: 'acrylic', label: 'Acrylic', hint: 'Windows 10/11 translucent backdrop.' },
  { value: 'blur', label: 'Blur', hint: 'Blur behind a translucent window.' }
] as const

export const BACKGROUND_STYLES: readonly {
  value: BackgroundStyle
  label: string
  hint: string
}[] = [
  { value: 'none', label: 'Plain', hint: 'No backdrop layer; the theme alone.' },
  { value: 'solid', label: 'Solid colour', hint: 'A single flat colour behind the app.' },
  { value: 'gradient', label: 'Gradient', hint: 'Two colours at an angle you choose.' },
  { value: 'image', label: 'Local image', hint: 'Any image file on this machine.' },
  { value: 'art', label: 'Safebooru art', hint: 'Pulled from the art slot pipeline.' }
] as const

export const LAUNCHER_STYLES: readonly {
  value: LauncherStyle
  label: string
  hint: string
}[] = [
  { value: 'fluent', label: 'Fluent', hint: 'The default RemielleStrap progress window.' },
  { value: 'classic', label: 'Classic Roblox', hint: 'The 2016-era grey installer panel.' },
  { value: 'byfron', label: 'Byfron', hint: 'Dark, minimal, single progress bar.' },
  { value: 'minimal', label: 'Minimal', hint: 'Text and a hairline only.' },
  { value: 'custom', label: 'Custom definition', hint: 'Your own JSON definition below.' }
] as const

/* -------------------------------------------------------------- Overlays */

export interface OverlayWidgetDefinition {
  id: OverlayWidget
  label: string
  /** What the figure is, and where it comes from. */
  hint: string
  /** Grouping used by the Overlays page so the switches read as a list. */
  group: 'session' | 'server' | 'system'
  /**
   * True when the figure is not measured on this machine, so the overlay draws
   * it with its provenance next to it rather than implying a local reading.
   */
  reported: boolean
}

/**
 * Every figure the in-game overlay can draw.
 *
 * Roblox gives an outside process very little: it publishes a public server
 * list carrying the average framerate and average ping its connected clients
 * reported, and everything else has to be derived from the client's own log,
 * its process, or this launcher's bookkeeping. The `reported` flag is what
 * keeps that distinction visible in the interface instead of buried in a
 * comment.
 */
export const OVERLAY_WIDGET_CATALOG: readonly OverlayWidgetDefinition[] = [
  {
    id: 'game',
    label: 'Experience',
    hint: 'The name of what you are playing, from the activity watcher.',
    group: 'session',
    reported: false
  },
  {
    id: 'time',
    label: 'Session time',
    hint: 'How long you have been in this experience, ticking locally.',
    group: 'session',
    reported: false
  },
  {
    id: 'account',
    label: 'Account',
    hint: 'The stored account this session was launched as.',
    group: 'session',
    reported: false
  },
  {
    id: 'fps',
    label: 'Framerate',
    hint: 'The average FPS other players reported for this server, not yours.',
    group: 'server',
    reported: true
  },
  {
    id: 'ping',
    label: 'Ping',
    hint: 'The average ping reported for this server, not measured here.',
    group: 'server',
    reported: true
  },
  {
    id: 'region',
    label: 'Region',
    hint: 'The datacenter this server runs in, mapped to a readable region.',
    group: 'server',
    reported: true
  },
  {
    id: 'players',
    label: 'Players',
    hint: 'How full this server is, out of its capacity.',
    group: 'server',
    reported: true
  },
  {
    id: 'server',
    label: 'Server id',
    hint: 'The job id of the server you are connected to.',
    group: 'server',
    reported: false
  },
  {
    id: 'memory',
    label: 'Client memory',
    hint: 'The working set of the Roblox process on this machine.',
    group: 'system',
    reported: false
  },
  {
    id: 'cpu',
    label: 'Client CPU',
    hint: 'Share of every core the Roblox process is using, sampled per tick.',
    group: 'system',
    reported: false
  }
] as const

export function overlayWidget(id: string): OverlayWidgetDefinition | null {
  return OVERLAY_WIDGET_CATALOG.find((widget) => widget.id === id) ?? null
}

export const OVERLAY_ANCHORS: readonly { value: OverlayAnchor; label: string; hint: string }[] = [
  { value: 'top-left', label: 'Top left', hint: 'Away from the health bar in most experiences.' },
  { value: 'top-right', label: 'Top right', hint: 'The default; clear of the chat and the menu.' },
  { value: 'bottom-left', label: 'Bottom left', hint: 'Below the chat window.' },
  { value: 'bottom-right', label: 'Bottom right', hint: 'Where the hotbar usually is.' },
  { value: 'custom', label: 'Custom', hint: 'An offset you set by dragging the overlay.' }
] as const

/**
 * Shortcut presets for the two overlays.
 *
 * Any valid Electron accelerator may be typed instead; these are only the ones
 * that are unlikely to collide with a game or with the launcher's own Ctrl+1..9
 * page shortcuts.
 */
export const OVERLAY_HOTKEY_PRESETS: readonly string[] = [
  'CommandOrControl+Shift+O',
  'CommandOrControl+Shift+F9',
  'CommandOrControl+Alt+O',
  'F13',
  ''
] as const

export const PALETTE_HOTKEY_PRESETS: readonly string[] = [
  'CommandOrControl+K',
  'CommandOrControl+Shift+K',
  'CommandOrControl+J',
  'CommandOrControl+P',
  ''
] as const

/** Reads an accelerator for display: "CommandOrControl+Shift+O" -> "Ctrl Shift O". */
export function acceleratorLabel(accelerator: string | null | undefined): string {
  if (!accelerator || accelerator.trim().length === 0) return 'None'

  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Macintosh')

  return accelerator
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      switch (part.toLowerCase()) {
        case 'commandorcontrol':
        case 'cmdorctrl':
          return isMac ? '⌘' : 'Ctrl'
        case 'control':
        case 'ctrl':
          return isMac ? '⌃' : 'Ctrl'
        case 'command':
        case 'cmd':
          return '⌘'
        case 'super':
        case 'meta':
          return isMac ? '⌘' : 'Win'
        case 'alt':
          return isMac ? '⌥' : 'Alt'
        case 'option':
          return isMac ? '⌥' : 'Alt'
        case 'shift':
          return isMac ? '⇧' : 'Shift'
        default:
          return part.length === 1 ? part.toUpperCase() : part
      }
    })
    .join(isMac ? '' : ' + ')
}

/* ------------------------------------------------------------ Capture flags */

/**
 * FastFlags that turn off parts of Roblox's capture pipeline.
 *
 * Roblox renames these quietly and none of them are on the public allowlist, so
 * they are written only when the matching setting is on and are always reported
 * as non-allowlisted by the FastFlags page.
 */
export const DISABLE_CAPTURE_FLAGS: Record<string, string | number | boolean> = {
  FFlagDisableScreenshotAndVideoCapture: true,
  FFlagEnableScreenshotCapture: false,
  FFlagEnableVideoCapture: false,
  DFFlagScreenshotCaptureEnabled: false,
  DFFlagVideoCaptureEnabled: false
}

/** Audio/visual capability flags worth exposing next to the capture toggle. */
export const VOICE_CHAT_FLAGS: Record<string, string | number | boolean> = {
  FFlagVoiceChatEnabled: true,
  FFlagEnableVoiceChat: true
}
