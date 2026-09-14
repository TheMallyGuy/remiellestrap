# Changelog

All notable changes to RemielleStrap are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] — unreleased

The feature-parity release: everything the launcher did, it now does alongside
accounts, regions, richer mods, a live allowlist, Studio, and a bootstrapper you
can rewrite.

### Added

**Accounts**

- Account roster with presence, profile, friends, avatar and notes, backed by the
  OS credential store — cookies are never written in the clear.
- Three sign-in paths: a Roblox sign-in window, Quick Log In by code, and a
  pasted cookie.
- Active account for launches, joins and shortcuts, switchable from the tray.
- Continue playing, favourites, recommendations, and search by name or place id.
- Expired sessions are kept with a reason instead of disappearing, and can be
  re-authenticated in place.
- Optional background refresh of presence and counts.

**Servers and regions**

- Eleven regions, mapped from Roblox datacenter codes, with a preferred region
  that sorts first without hiding anything else.
- Server size preference and a choice of sort key, plus `autoSortServers`.
- "Join best in region" from the Servers page, the Home page and the tray.
- Region-aware auto-rejoin after a disconnect.
- Per-place server list cache, and backoff that shows the last good list when
  Roblox rate limits the request.

**Mods**

- Community index browser with search, tags, previews and multi-install, with
  HTTPS-only downloads and checksum verification.
- Player / Studio / both target per mod.
- File replacements for the replaceable slots with pickers: cursor sets, the
  Shift Lock icon, the death sound and UI fonts, each becoming its own mod.
- Rich mod generator for UI surfaces, cursors, the Shift Lock icon, the emote
  wheel and the voice-chat bubble, from a colour or a gradient, with a preview.
- Conflict detection across enabled mods, and apply-now without waiting for a
  launch.

**FastFlags**

- Allowlist viewer with categories, types, risk levels and per-flag availability
  checks, merged from a built-in list and an optional remote one.
- Check-and-cross availability view, fuzzy search, and duplicate-from-allowlist.
- Clean list, with a dry run first, to drop flags the client ignores.
- Nine curated presets built only from allowlisted flags, applied to any profile.

**Discord presence and activity**

- Page-aware presence for the launcher's own pages and dialogs.
- Session and total playtime on the card, in the interface, and in the tray.
- Optional account name, optional capture-feature flags, and a first-class custom
  status with the game's name.
- Studio presence over a loopback bridge with a companion plugin.

**Appearance and the launcher window**

- Three new themes — Prism Night, Ivory Cathedral and Gold Ember — alongside Ink,
  Ivory and Match system.
- Backgrounds: solid, gradient, local image, or artwork; opacity, blur and an
  optional slow drift that respects reduce-motion.
- Custom fonts, loaded from a file or picked from the system.
- Sidebar display modes, icon style, and Windows Mica/Acrylic with a truthful
  report of what was applied.
- Five launcher styles — Fluent, Classic Roblox, Byfron, Minimal and Custom — with
  a validating JSON editor, per-stage messages, progress bar/spinner/dots and
  optional custom CSS.
- A first-run tour, remembered UI state, keyboard page navigation, and empty and
  error states throughout.

**Utilities**

- Fixed version folder for tools that expect a stable path.
- Channel browser for LIVE, ZLive, ZCanary, ZIntegration and anything else, with
  what each channel is currently serving.
- Version manager: switch, reinstall, delete, and step back to the previous build.
- Cleaner over ten targets with a dry run, confirmation, a history and a schedule.
- Crash handler auto-close, and optional periodic memory trim.
- GlobalBasicSettings editor for a safe subset, with a one-time backup and a guard
  while the client is running.
- Log viewer that parses client and launcher logs, follows them live, and extracts
  session events.
- Structured import from Bloxstrap, Fishstrap and Froststrap, with a report of what
  was not recognised.
- Game shortcuts with an account and a region baked in, and an encrypted full
  backup with optional account export.

**Platform**

- A translation scaffold, so strings can be translated a page at a time.
- Enhanced tray menu: current game, rejoin, per-region joins, launch as any stored
  account, logs and settings.
- `--remielle-place`, `--remielle-account` and `--remielle-region` arguments, so a
  shortcut re-mints its ticket at every launch instead of carrying a stale one.

### Changed

- `registerIpcHandlers()` now throws when a channel declared in `src/shared/ipc.ts`
  has no implementation, so the contract cannot drift from the handlers.
- Settings, models and state were regrouped by feature, with every new option
  defaulted in `DEFAULT_SETTINGS`.
- The main window, bootstrapper window, tray and preload bridge were rewritten
  around the new surfaces.

### Fixed

- Launcher window size now follows a custom definition instead of always using the
  default, and its background colour no longer flashes white.
- The Studio companion plugin is generated with the configured port (it was
  emitted with a literal placeholder), and the bridge matches exact paths rather
  than prefixes.
- The Studio plugin's source is now readable from the interface instead of being a
  copy that could drift from the installer.

### Documentation

- README rewritten: features, installation, build instructions, architecture,
  manual test matrix and credits.
- Added `docs/studio-bridge.md` and `docs/community-mods.md`.

## [0.1.2] — 2026-09-13

### Added

- Complete main-process feature set and its typed IPC contract: 130 invoke
  channels and 20 event channels, all implemented.
- Services for accounts, servers, mods, FastFlags, clean-up, logs, client
  settings, tweaks, shortcuts, backups, straps, playtime, the Studio bridge and
  the crash handler.
- The ink/ivory/gold theme, the Remielle Dan art system and the original pages.

### Fixed

- `svelte-check` now runs against `tsconfig.web.json`, which previously checked
  the renderer against a solution-style config that reported clean without
  checking anything.
