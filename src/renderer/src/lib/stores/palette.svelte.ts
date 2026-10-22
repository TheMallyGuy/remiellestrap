import type { FlagProfile, GameSummary, ModEntry } from '@shared/models'
import { regionById } from '@shared/catalog'
import type { IconName } from '../components/icons'
import { api, errorMessage } from '../ipc'
import { NAV_ITEMS } from '../nav'
import { acceleratorMatches } from '../utils/accelerator'
import { bestMatch } from '../utils/fuzzy'
import { accounts } from './accounts.svelte'
import { activity, closeRoblox, copyJoinScript, openGamePage, rejoin } from './activity.svelte'
import { checkForAppUpdate } from './appUpdate.svelte'
import { checkForUpdates, install, launch } from './bootstrapper.svelte'
import { goTo } from './navigation.svelte'
import { setOverlayPreview, toggleOverlay } from './overlay.svelte'
import { exportSettings, settings } from './settings.svelte'
import { pushToast } from './toasts.svelte'

/**
 * The command palette — the launcher's own overlay.
 *
 * Everything the app can do is already reachable by mouse; this is the keyboard
 * path to the same actions, and the reason it is an *overlay* rather than a page
 * is that it should cost nothing to summon and nothing to dismiss.
 *
 * The catalogue is assembled from the same stores the pages use, so a command
 * can never disagree with the button it stands in for: switching an account here
 * runs the account store's own switcher, and joining a server runs the server
 * store's own join.
 */

export interface PaletteCommand {
  id: string
  title: string
  /** Longer explanation, drawn under the title. */
  hint?: string
  /** Right-aligned metadata: a shortcut, a status, an id. */
  badge?: string
  group: string
  icon: IconName
  /** Extra text the search matches but the row does not show. */
  keywords?: string
  /** True while the command's own work is in flight. */
  busy?: boolean
  run: () => void | Promise<void>
}

/** Group order, which is also the order rows appear within a search. */
const GROUPS = [
  'Navigate',
  'Launch',
  'Servers',
  'Accounts',
  'Mods',
  'FastFlags',
  'Overlays',
  'System',
  'Experiences'
] as const

/** How many rows the palette will draw; a list you have to scroll is a search, not a palette. */
const MAX_RESULTS = 24

let open = $state(false)
let query = $state('')
let selected = $state(0)
let running = $state<string | null>(null)

/** Fetched when the palette opens: local reads, so they cost nothing. */
let mods = $state<ModEntry[]>([])
let profiles = $state<FlagProfile[]>([])

/** Fetched as you type, only when the setting allows it. */
let games = $state<PaletteCommand[]>([])
let searchingGames = $state(false)

let gameToken = 0
let gameTimer: ReturnType<typeof setTimeout> | null = null

/* ------------------------------------------------------------- Catalogue */

function navigationCommands(): PaletteCommand[] {
  return NAV_ITEMS.map((item) => ({
    id: `nav:${item.id}`,
    title: `Go to ${item.label}`,
    hint: item.hint,
    group: 'Navigate',
    icon: item.icon,
    keywords: `page ${item.id}`,
    run: () => goTo(item.id)
  }))
}

function launchCommands(): PaletteCommand[] {
  const commands: PaletteCommand[] = [
    {
      id: 'launch:play',
      title: 'Play Roblox',
      hint: 'Install if needed, then launch with your mods, flags and account applied.',
      group: 'Launch',
      icon: 'play',
      keywords: 'start run client join',
      run: () => launch()
    },
    {
      id: 'launch:update',
      title: 'Check for a client update',
      hint: 'Asks the deployment endpoints what the channel is serving.',
      group: 'Launch',
      icon: 'refresh',
      keywords: 'version channel update check',
      run: () => checkForUpdates().then(() => undefined)
    },
    {
      id: 'launch:repair',
      title: 'Reinstall the client',
      hint: 'Re-extracts the packages that are already downloaded.',
      group: 'Launch',
      icon: 'download',
      keywords: 'repair reinstall fix force',
      run: () => install(true)
    }
  ]

  if (activity.value.robloxRunning) {
    commands.push({
      id: 'launch:close',
      title: 'Close Roblox',
      hint: 'Asks the running client to exit.',
      group: 'Launch',
      icon: 'x',
      keywords: 'kill quit stop exit',
      run: closeRoblox
    })
  }

  return commands
}

function serverCommands(): PaletteCommand[] {
  const commands: PaletteCommand[] = []
  const current = activity.value.activity
  const last = activity.state.lastActivity
  const placeId = current?.placeId ?? last?.placeId ?? null
  const region = regionById(settings.value.preferredRegion)

  if (activity.canRejoin) {
    commands.push({
      id: 'servers:rejoin',
      title: 'Rejoin the last server',
      hint: 'The same experience, the same job id.',
      group: 'Servers',
      icon: 'refresh',
      keywords: 'reconnect rejoin last server',
      run: rejoin
    })
  }

  if (placeId) {
    commands.push({
      id: 'servers:best',
      title:
        region.id === 'any' ? 'Join the best server' : `Join the best server in ${region.label}`,
      hint: `Place ${placeId}, ranked by your region and size preferences.`,
      badge: region.label,
      group: 'Servers',
      icon: 'globe',
      keywords: 'join region best server queue',
      run: async () => {
        const result = await api.servers.join({ placeId })
        if (!result.launched) {
          pushToast({ kind: 'warning', title: 'Could not join', message: result.message })
        } else {
          pushToast({ kind: 'success', title: 'Joining', message: result.message })
        }
      }
    })
  }

  if (current) {
    commands.push(
      {
        id: 'servers:copy',
        title: 'Copy the join script',
        hint: 'A roblox:// link for this exact server.',
        group: 'Servers',
        icon: 'copy',
        keywords: 'join script link uri clipboard',
        run: copyJoinScript
      },
      {
        id: 'servers:page',
        title: 'Open the experience page',
        hint: 'On roblox.com, in your browser.',
        group: 'Servers',
        icon: 'external',
        keywords: 'website roblox page store',
        run: openGamePage
      }
    )
  }

  return commands
}

function accountCommands(): PaletteCommand[] {
  const list = accounts.list
  if (list.length === 0) return []

  const commands: PaletteCommand[] = list.map((account) => ({
    id: `accounts:play:${account.id}`,
    title: `Play as ${account.displayName}`,
    hint: account.valid
      ? `@${account.username} — mints a fresh join ticket for this account.`
      : `@${account.username} — ${account.statusMessage ?? 'this session has expired'}`,
    badge: account.isActive ? 'Active' : undefined,
    group: 'Accounts',
    icon: 'user',
    keywords: `login switch account ${account.username} ${account.displayName}`,
    busy: accounts.busy === account.id,
    run: async () => {
      const result = await api.accounts.joinAs({ accountId: account.id })
      if (!result.ok) {
        pushToast({ kind: 'error', title: 'Could not launch', message: result.message })
      }
    }
  }))

  commands.push({
    id: 'accounts:signin',
    title: 'Sign in to another account',
    hint: 'Opens a real Roblox sign-in window.',
    group: 'Accounts',
    icon: 'key',
    keywords: 'add login signin cookie account',
    run: async () => {
      const result = await api.accounts.browserLogin({ mode: 'login' })
      if (!result.ok) {
        pushToast({ kind: 'warning', title: 'Sign-in did not finish', message: result.error })
      }
    }
  })

  return commands
}

function modCommands(): PaletteCommand[] {
  if (mods.length === 0) return []

  const commands: PaletteCommand[] = mods.map((mod) => ({
    id: `mods:toggle:${mod.id}`,
    title: `${mod.enabled ? 'Disable' : 'Enable'} ${mod.name}`,
    hint: `${mod.fileCount} file${mod.fileCount === 1 ? '' : 's'} · ${mod.target}`,
    badge: mod.enabled ? 'On' : 'Off',
    group: 'Mods',
    icon: 'layers',
    keywords: `mod toggle ${mod.name} ${mod.author ?? ''}`,
    run: async () => {
      await api.mods.toggle(mod.id, !mod.enabled)
      mods = await api.mods.list()
      pushToast({
        kind: 'success',
        title: `${mod.name} ${mod.enabled ? 'disabled' : 'enabled'}`,
        message: settings.value.applyModsImmediately
          ? undefined
          : 'It will be applied at the next launch.'
      })
    }
  }))

  commands.push({
    id: 'mods:apply',
    title: 'Apply mods and flags now',
    hint: 'Writes the enabled mods and the active profile into the installed client.',
    group: 'Mods',
    icon: 'save',
    keywords: 'apply now mods flags write',
    run: async () => {
      const result = await api.bootstrapper.applyNow()
      if (result.ok && result.data) {
        pushToast({
          kind: 'success',
          title: 'Applied',
          message: `${result.data.files} file(s) and ${result.data.flags} flag(s)`
        })
      } else {
        pushToast({ kind: 'warning', title: 'Nothing was applied', message: result.error })
      }
    }
  })

  return commands
}

function flagCommands(): PaletteCommand[] {
  return profiles.map((profile) => ({
    id: `flags:activate:${profile.name}`,
    title: `Use the ${profile.name} flag profile`,
    hint: `${profile.flagCount} FastFlag${profile.flagCount === 1 ? '' : 's'}.`,
    badge: profile.isActive ? 'Active' : undefined,
    group: 'FastFlags',
    icon: 'flag',
    keywords: `fastflag profile preset ${profile.name}`,
    run: async () => {
      await api.fastflags.setActive(profile.name)
      profiles = await api.fastflags.getProfiles()
      pushToast({
        kind: 'success',
        title: `${profile.name} is now active`,
        message: 'It is written at the next launch, or apply now from Mods.'
      })
    }
  }))
}

function overlayCommands(): PaletteCommand[] {
  const overlayOn = settings.value.overlayEnabled

  return [
    {
      id: 'overlay:toggle',
      title: overlayOn ? 'Hide the in-game overlay' : 'Show the in-game overlay',
      hint: overlayOn
        ? 'The same action as the overlay shortcut.'
        : 'Switches the overlay on and shows it.',
      group: 'Overlays',
      icon: 'overlay',
      keywords: 'overlay hud stats fps ping hide show',
      run: async () => {
        if (!overlayOn) await api.settings.save({ overlayEnabled: true })
        await toggleOverlay()
      }
    },
    {
      id: 'overlay:preview',
      title: 'Preview the overlay',
      hint: 'Draws it with placeholder figures, so it can be arranged without a game.',
      group: 'Overlays',
      icon: 'eye',
      keywords: 'overlay preview sample arrange position',
      run: () => setOverlayPreview(true)
    },
    {
      id: 'overlay:settings',
      title: 'Overlay settings',
      hint: 'Widgets, position, opacity and the shortcut.',
      group: 'Overlays',
      icon: 'sliders',
      keywords: 'overlay settings widgets configure',
      run: () => goTo('overlays')
    }
  ]
}

function systemCommands(): PaletteCommand[] {
  return [
    {
      id: 'system:logs',
      title: 'Open the launcher logs',
      hint: 'The folder this app writes its own logs to.',
      group: 'System',
      icon: 'terminal',
      keywords: 'logs folder open debug',
      run: () => void api.system.openLogs()
    },
    {
      id: 'system:roblox',
      title: 'Open the Roblox folder',
      hint: 'Where the client is installed.',
      group: 'System',
      icon: 'folder',
      keywords: 'roblox folder install directory',
      run: () => void api.system.openRobloxDir()
    },
    {
      id: 'system:appdata',
      title: 'Open the RemielleStrap folder',
      hint: 'Settings, state, mods and caches.',
      group: 'System',
      icon: 'folder',
      keywords: 'appdata settings folder data',
      run: () => void api.system.openAppData()
    },
    {
      id: 'system:appupdate',
      title: 'Check for a launcher update',
      hint: 'RemielleStrap itself, from the releases page.',
      group: 'System',
      icon: 'refresh',
      keywords: 'update launcher app release version',
      run: checkForAppUpdate
    },
    {
      id: 'system:export',
      title: 'Export settings',
      hint: 'Writes a copy of Settings.json wherever you choose.',
      group: 'System',
      icon: 'save',
      keywords: 'export settings backup json',
      run: exportSettings
    }
  ]
}

/** The whole catalogue, in group order. */
function catalogue(): PaletteCommand[] {
  return [
    ...navigationCommands(),
    ...launchCommands(),
    ...serverCommands(),
    ...accountCommands(),
    ...modCommands(),
    ...flagCommands(),
    ...overlayCommands(),
    ...systemCommands(),
    ...games
  ]
}

/** What an empty query shows: the things worth reaching for without typing. */
function defaults(): PaletteCommand[] {
  const shortcuts: PaletteCommand[] = [
    ...launchCommands().slice(0, 1),
    ...serverCommands().slice(0, 2),
    ...overlayCommands().slice(0, 1)
  ]

  const pages = navigationCommands().slice(0, 6)
  return [...shortcuts, ...pages].slice(0, MAX_RESULTS)
}

const results = $derived.by<PaletteCommand[]>(() => {
  const text = query.trim()
  if (text.length === 0) return defaults()

  const scored: Array<{ command: PaletteCommand; score: number }> = []

  for (const command of catalogue()) {
    const hit = bestMatch(text, [command.title, command.keywords, command.hint, command.badge])
    if (hit) scored.push({ command, score: hit.score })
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Equal scores fall back to the catalogue's own order, so related commands
    // stay together rather than interleaving by accident.
    return (
      GROUPS.indexOf(a.command.group as (typeof GROUPS)[number]) -
      GROUPS.indexOf(b.command.group as (typeof GROUPS)[number])
    )
  })

  return scored.slice(0, MAX_RESULTS).map((entry) => entry.command)
})

export const palette = {
  get open(): boolean {
    return open
  },
  get query(): string {
    return query
  },
  get selected(): number {
    return selected
  },
  get results(): PaletteCommand[] {
    return results
  },
  get searching(): boolean {
    return searchingGames
  },
  get running(): string | null {
    return running
  }
}

/* ------------------------------------------------------------ Interaction */

export function openPalette(): void {
  if (!settings.value.paletteEnabled) return

  open = true
  query = ''
  selected = 0
  void loadLocal()
}

export function closePalette(): void {
  open = false
  running = null

  if (gameTimer) {
    clearTimeout(gameTimer)
    gameTimer = null
  }
}

export function togglePalette(): void {
  if (open) closePalette()
  else openPalette()
}

export function setPaletteQuery(value: string): void {
  query = value
  selected = 0
  scheduleGameSearch(value)
}

/** Moves the selection, wrapping, and returns the id now selected. */
export function movePaletteSelection(delta: number): string | null {
  const count = results.length
  if (count === 0) return null

  selected = (selected + delta + count) % count
  return results[selected]?.id ?? null
}

export async function runSelected(): Promise<void> {
  const command = results[selected]
  if (command) await runCommand(command)
}

export async function runCommand(command: PaletteCommand): Promise<void> {
  running = command.id

  try {
    await command.run()
    closePalette()
  } catch (error) {
    pushToast({
      kind: 'error',
      title: `"${command.title}" did not finish`,
      message: errorMessage(error)
    })
  } finally {
    running = null
  }
}

/** True when a key event is the palette's configured shortcut. */
export function isPaletteShortcut(event: KeyboardEvent): boolean {
  const accelerator = settings.value.paletteHotkey.trim()
  if (!settings.value.paletteEnabled || accelerator.length === 0) return false
  return acceleratorMatches(event, accelerator)
}

/* -------------------------------------------------------------- Data loads */

/** Mods and profiles are local reads, so the palette fetches them on open. */
async function loadLocal(): Promise<void> {
  try {
    const [modList, profileList] = await Promise.all([api.mods.list(), api.fastflags.getProfiles()])
    mods = modList
    profiles = profileList
  } catch {
    // The palette still works; it simply has fewer things to offer.
    mods = []
    profiles = []
  }
}

/**
 * Searches Roblox for experiences as you type.
 *
 * Debounced, cancelled on every keystroke, and switched off entirely by
 * `paletteGameSearch` — it is the only command source that leaves the machine,
 * so it is the one the user gets to decline.
 */
function scheduleGameSearch(text: string): void {
  if (gameTimer) clearTimeout(gameTimer)

  const trimmed = text.trim()
  if (!settings.value.paletteGameSearch || trimmed.length < 2) {
    games = []
    searchingGames = false
    return
  }

  searchingGames = true
  const token = ++gameToken

  gameTimer = setTimeout(() => {
    void (async () => {
      try {
        const result = await api.accounts.searchGames({ query: trimmed, limit: 6 })
        // A newer keystroke already moved on; this answer is stale.
        if (token !== gameToken) return

        games = (result.ok ? (result.data ?? []) : []).map((game: GameSummary) => ({
          id: `games:play:${game.placeId}`,
          title: `Play ${game.name}`,
          hint: game.creatorName ? `By ${game.creatorName}` : undefined,
          badge: String(game.placeId),
          group: 'Experiences',
          icon: 'gamepad' as IconName,
          keywords: `game experience place roblox ${game.name} ${game.creatorName ?? ''}`,
          run: async () => {
            const launched = await api.accounts.joinAs({ placeId: String(game.placeId) })
            if (!launched.ok) {
              pushToast({ kind: 'error', title: 'Could not launch', message: launched.message })
            }
          }
        }))
      } catch {
        games = []
      } finally {
        if (token === gameToken) searchingGames = false
      }
    })()
  }, 260)
}
