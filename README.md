# RemielleStrap

A Roblox bootstrapper (launcher) for the desktop, themed after **Remielle Dan**
— *Void Hunter: Temporal Lumiflux*, Zenless Zone Zero. Built with **Tauri v2**
(Rust) + **Svelte 5** (runes) + **TailwindCSS v4**.

RemielleStrap replaces Roblox's official installer with a faster, fully local
deployment pipeline: version checking, streaming downloads, checksum
verification, extraction, mod overlay and FastFlags — then launches the client
and watches its logs for Discord Rich Presence and tray status.

> **Artwork notice.** All Remielle Dan artwork is fetched **live at runtime**
> from the [Safebooru](https://safebooru.org) public API by the app itself.
> RemielleStrap never generates, embeds, inlines or redistributes artwork. All
> rights belong to the original artists.

## Stack

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Shell    | Tauri v2 (Rust), frameless custom titlebar                  |
| Frontend | Svelte 5 (runes), SvelteKit adapter-static (SPA)            |
| Styles   | TailwindCSS v4 (CSS-first `@theme` tokens)                  |
| State    | Svelte runes stores + serde JSON in `{app_data}`            |

## The "Cathedral of Light" design language

Near-black void backgrounds with a violet undertone, warm parchment text, a
single disciplined gold accent ("Voidflare"), and one iridescent prism gradient
used only for the primary CTA, progress bars and focus rings. Serif display
type, hairline borders, restrained radii. Not bubbly, not neon.

## Features

- **URI handling** — registers `roblox://` and `roblox-player://` (deep-link
  plugin + `HKCU\Software\Classes` on Windows), forwards URIs while running
  via single-instance.
- **Bootstrapper** — version check → manifest → streaming download (md5 cache)
  → extraction → mod overlay → FastFlags → launch, with progress events and
  cancellation.
- **Art pipeline** — live Safebooru search per slot (splash / home banner /
  sidebar) with rate limiting, fallback tag chains, a 15 MB image cap, a
  200 MB LRU cache and per-slot persistence.
- **FastFlags** — profile manager with typed editors and JSON import/export.
- **Mods** — drag-drop / dialog import, drag-to-reorder priority, enable toggles.
- **Integrations** — Discord Rich Presence with a live preview card.
- **Activity watcher** — tails the newest Roblox log for join/leave/disconnect
  and detects client exit (notify + tokio).
- **System tray** — live game name, rejoin, close Roblox, open settings, exit.

## Development

Prerequisites: Node 20+, Rust 1.77.2+, and the
[Tauri system dependencies](https://tauri.app/start/prerequisites/) for your OS.

```sh
npm install
npm run tauri dev      # build the Rust backend + dev server
npm run tauri build    # production bundle
npm run check          # svelte-check (type checking)
```

### Project layout

```
src/                     Svelte 5 frontend (SvelteKit + Tailwind v4)
  lib/
    ipc.ts               typed invoke wrappers + event listeners
    stores/*.svelte.ts   $state/$derived/$effect runes stores
    components/          TitleBar, Sidebar, BooruArt, CurtainCall, …
    pages/               Home, Appearance, Behaviour, FastFlags, Mods,
                         Integrations, Installation, About
src-tauri/
  src/
    commands/            thin #[tauri::command] handlers
    core/                bootstrapper, manifest, deployment, launcher, uri
    services/            booru, activity_watcher, discord_rpc, tray
    models/              serde models (Settings, AppState, RobloxState, …)
    utils/               paths, http, md5, zip, registry, logging
```

### Persistence

| File           | Contents                                                            |
| -------------- | ------------------------------------------------------------------- |
| `Settings.json`| theme, channel, toggles, booru tags, FastFlag profiles, enabled mods|
| `State.json`   | window geometry, per-slot booru post ids, last-played               |
| `RobloxState.json` | installed GUID, channel, package md5s                          |

## License

MIT. Themed after Remielle Dan — Zenless Zone Zero.
