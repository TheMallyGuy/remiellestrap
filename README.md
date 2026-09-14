# RemielleStrap

A Roblox bootstrapper with an opinion about how software should look.

RemielleStrap installs and launches the Roblox client, and along the way it
manages mods, FastFlags, accounts, regions, Discord presence and the housekeeping
nobody wants to do by hand. It is built on Electron with a Svelte 5 interface and
a strongly-typed IPC contract, and it is themed around Remielle Dan: deep ink,
warm ivory, one soft gold accent, and a faint prism iridescence that only ever
appears as a sliver.

---

## Features

### Accounts

- **Three ways in.** A real Roblox sign-in window, Roblox's Quick Log In page for
  a code generated on your phone, or a pasted `.ROBLOSECURITY` cookie.
- **Cookies are encrypted**, never written in the clear. They live in the OS
  credential store (DPAPI on Windows, the Keychain on macOS, libsecret on Linux)
  and never appear in a JSON file, a log or a backup unless you ask for it with a
  passphrase.
- **Presence at a glance**: online, on the site, in a game, offline, with a
  coloured dot on each roster entry.
- **Profiles, friends and games** — display name, account age, friend and
  follower counts, your friends' presence, and your continue-playing, favourites
  and recommendation lists.
- **Launch as whoever you like**: the active account is used for launches, joins
  and shortcuts, and the tray can switch it without opening the window.
- **Search and join** by game name or place id, straight into the client.
- **Expired sessions are kept, not deleted**: the account stays in the list with a
  note, and one click signs in again.

### Region selector and server browser

- **Public server list** per place, with datacenter, player count, capacity bar and
  uptime.
- **Region preference** across eleven regions, mapping Roblox datacenter codes to
  something readable. Preferred-region servers sort first, the rest are not hidden.
- **Server size preference** — favour fuller servers or quieter ones.
- **Auto-sort** when the launcher picks a server for you, with a choice of sort key.
- **Join best in region** in one click, from the page, the tray or the Home page.
- **Region-aware auto-rejoin** after an unexpected disconnect.
- **Ping, honestly labelled**: Roblox publishes no ping for a running server, so
  the figure is derived from the datacenter and the server's own health report and
  is marked as an estimate.
- **Caching and backoff**: lists are cached per place, and a rate-limited request
  backs off and shows the last good list rather than an error.

### Mods

- **Community mod browser** with search, tags, previews and multi-install. Only
  HTTPS archives, and checksums are verified before a file is extracted.
- **Per-mod target**: player, Studio, or both.
- **File replacements** for the client's replaceable slots — cursors, the Shift
  Lock icon, the death sound, UI fonts — each with a file picker and each becoming
  its own switchable mod.
- **Cursor sets**: pick an arrow and a far cursor and they become one mod you can
  toggle.
- **Rich generator**: builds themed PNGs for UI surfaces, cursors, the Shift Lock
  icon, the emote wheel and the voice-chat bubble, from a colour or a gradient.
- **Conflict detection**: which enabled mods write the same client path, and who
  wins.
- **Apply now** without waiting for a launch; **automatic revert** restores the
  original files from the client's own packages when a mod is switched off.
- **Protected paths**: a mod can never overwrite an executable or the launcher's
  own settings.

### FastFlags

- **Allowlist-aware editing**: a built-in list of ~50 flags merged with a remote
  list, with categories, types, ranges, risk levels and an availability check per
  flag.
- **A clean list button** that removes flags the client ignores, with a dry run
  first.
- **Nine curated presets** (frame-rate unlocks, performance-low, quality-high,
  privacy, interface-clean, network-tune and more), built only from allowlisted
  flags.
- **Check-and-cross viewer** so you can see what the client accepts before you add
  it.
- **Fuzzy search and categories** across names and descriptions.
- **Profiles** with import/export, duplication, renaming and a live preview of the
  exact JSON that will be written.

### Discord presence and activity

- **Page-aware presence**: while you are in the launcher the card follows you
  around the app.
- **Session and total playtime** shown in the presence and in the interface.
- **Studio presence** through a loopback bridge and a companion plugin.
- **Optional account name** on the card.
- **Capture features can be switched off** through engine flags.
- **Activity history**: what you played, when, for how long, and which server.

### Appearance

- **Six themes** — Ink, Ivory, Match system, Prism Night, Ivory Cathedral and Gold
  Ember — each remapping the whole ramp rather than flipping a flag.
- **Window materials**: Mica, Acrylic and blur on Windows, vibrancy on macOS, with
  graceful fallback and a clear statement of what was actually applied.
- **Backdrops**: solid, gradient, a local image, or artwork fetched per slot.
- **Custom fonts**, loaded from a file or picked from the system.
- **Three sidebar modes**, classic Roblox or Remielle icons for the window and tray.
- **Five launcher styles** — Fluent, Classic Roblox, Byfron, Minimal — plus a
  custom JSON definition with a validating editor.
- **Reduce motion** respected everywhere, including the art drift.

### Bootstrapper and utilities

- **Fixed version folder** (`RobloxPlayer` by default) for tools that expect a
  stable path, alongside the normal versioned installs.
- **Channel browser** for LIVE, ZLive, ZCanary, ZIntegration and anything else you
  add — with what each channel is currently serving.
- **Version manager**: switch, reinstall or delete any installed build, and step
  back to a previous version in one click.
- **Cleaner** over ten targets with a dry run, a confirmation, a history and a
  schedule (at launch, daily or weekly).
- **Crash handler auto-close**, so the reporter never lingers after a crash.
- **Memory trim** on a timer while the client runs.
- **GlobalBasicSettings editor** for a safe subset of the client's own settings,
  with a one-time backup and a read-only guard while Roblox is running.
- **Log viewer** that parses both the client's and the launcher's logs, follows
  them live, and extracts session events.
- **Structured import** from Bloxstrap, Fishstrap and Froststrap: settings, flag
  profiles and mod folders, with a report of what was not recognised.
- **Game shortcuts** with the account and region baked in, and an encrypted full
  backup with optional account export.

### Interface

- **First-run tour**, remembered UI state, keyboard navigation between pages, error
  boundaries and empty states.
- **Enhanced tray**: current game, rejoin, join a region server, launch as any
  stored account, logs, settings.
- **Typed end to end**: every channel is declared in `src/shared/ipc.ts` and the
  main process refuses to start if one is unimplemented.
- **A translation scaffold** so strings can be translated one page at a time
  without leaving English holes.

---

## Installing

Builds are published on the [releases page](https://github.com/TheMallyGuy/remiellestrap/releases).

| Platform | Notes |
| --- | --- |
| Windows | Primary target. Every feature is available. |
| macOS | The player is not published for macOS, so launching is limited to Studio; window vibrancy and the fonts work normally. |
| Linux | Runs, and degrades gracefully: no Mica, no process tweaks, and launching depends on the community client builds. |

## Building

```bash
bun install      # or npm install
bun run dev      # development, with hot reload
bun run typecheck
bun run lint
bun run build:win
```

## How it is put together

```
src/
  shared/     the contract: IPC channels, domain models, settings, state, catalogues
  main/       the application: services, core bootstrapper, IPC handlers, app shell
  preload/    one frozen, typed bridge — the renderer never sees Node
  renderer/   Svelte 5 pages, stores and components
```

Three rules keep it honest:

1. **The contract lives in `src/shared`.** A channel is declared once and both
   sides derive their types from it. `registerIpcHandlers()` throws at startup if
   a declared channel has no implementation, so the two can never drift.
2. **Services own behaviour, handlers own validation.** `src/main/ipc` validates
   and delegates; nothing in it downloads, installs or parses.
3. **The renderer never touches the filesystem**, and never stores a secret.

Further reading: [`docs/studio-bridge.md`](docs/studio-bridge.md) for the Studio
plugin interface, [`docs/community-mods.md`](docs/community-mods.md) for the
community index format.

## Manual test matrix

Worth walking through after a change that touches the launch path:

- fresh install on a machine with no Roblox
- update from an older client build
- launch with mods, flags and an account together
- switch a flag profile and confirm `ClientAppSettings.json`
- import a mod, apply now, disable it, confirm the original file returns
- switch accounts, join a game as each
- join a specific server, then rejoin from the tray
- run the cleaner as a dry run, then for real, then on a schedule
- switch the launcher style, then use a custom definition
- shuffle each art slot and confirm each survives a restart
- export a backup with accounts, then import it on a clean profile

## Credits

- **[Bloxstrap](https://github.com/pizzaboxer/bloxstrap)** — the bootstrapper that
  showed what this could be, and where the FastFlag allowlist idea comes from.
- **[Fishstrap](https://github.com/fishstrap/fishstrap)** — for the practical
  details, especially multi-instance launching.
- **[Froststrap](https://github.com/Froststrap/Froststrap)** — the feature bar this
  project measures itself against.
- **Remielle Dan** — the character this interface is built around.
- **Safebooru** — where the artwork comes from.

## Licence

MIT. The Roblox client is Roblox's; RemielleStrap only installs and launches it.
