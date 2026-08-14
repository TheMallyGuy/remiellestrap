# Assets

This document is the complete inventory of every visual asset RemielleStrap
uses: what ships inside the repository, what is drawn at runtime by code, and
what is fetched from the network while the app is running.

The short version:

- **No character artwork is committed to this repository.** Not one file.
- **No asset in this repository is AI-generated.**
- Every image of Remielle Dan you see in the running app is downloaded from
  [Safebooru](https://safebooru.org) at runtime by `src/main/services/booru.ts`,
  cached on the user's own machine, and attributed in the UI.
- You do **not** need to source, draw, or drop in any character art to build or
  run this project. There is nothing to fill in.

---

## 1. Committed binary assets

These are the only binary files tracked in Git. All of them are the application
icon in different container formats, produced from a single source image, plus
the macOS entitlements file that references none of them.

| Path                 | Format                         | Size    | Used by                    | Purpose                                                                                                                                                                                 |
| -------------------- | ------------------------------ | ------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build/icon.png`     | PNG, 512×512                   | ~36 KB  | electron-builder           | Linux `.desktop` icon; source for AppImage/deb icon scaling                                                                                                                             |
| `build/icon.ico`     | Windows ICO (multi-resolution) | ~121 KB | electron-builder → NSIS    | Windows executable icon, installer icon, Start Menu / taskbar entry                                                                                                                     |
| `build/icon.icns`    | Apple ICNS (multi-resolution)  | ~84 KB  | electron-builder → dmg/mac | macOS bundle icon, Dock icon, DMG volume icon                                                                                                                                           |
| `resources/icon.png` | PNG, 512×512                   | ~36 KB  | app runtime                | Tray icon (`src/main/app/tray.ts`) and desktop-notification icon (`src/main/app/notifications.ts`). Kept out of the asar via `asarUnpack: resources/**` so the OS can read it from disk |

`build/entitlements.mac.plist` is a text plist, not an image; it is listed here
only because it lives in `build/` alongside the icons.

### Why the icons are duplicated

`build/` is `electron-builder`'s `buildResources` directory. Files there are
consumed by the packager at build time and are **not** included in the shipped
app bundle. `resources/` is the opposite: it is packaged with the app and
readable at runtime. The tray and notification code needs a real file path on
disk at runtime, so the PNG exists in both places. They are byte-identical.

### Replacing the icon

The three `build/` files must stay in sync. From a single square PNG of at
least 1024×1024:

```bash
# Linux / source PNG
cp source-1024.png build/icon.png
cp source-1024.png resources/icon.png

# Windows .ico (ImageMagick)
magick source-1024.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico

# macOS .icns (macOS only, iconutil)
mkdir icon.iconset
sips -z 16 16     source-1024.png --out icon.iconset/icon_16x16.png
sips -z 32 32     source-1024.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     source-1024.png --out icon.iconset/icon_32x32.png
sips -z 64 64     source-1024.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   source-1024.png --out icon.iconset/icon_128x128.png
sips -z 256 256   source-1024.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   source-1024.png --out icon.iconset/icon_256x256.png
sips -z 512 512   source-1024.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   source-1024.png --out icon.iconset/icon_512x512.png
cp                source-1024.png       icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o build/icon.icns
rm -rf icon.iconset
```

The icon must not be character art belonging to someone else if you intend to
distribute builds. An abstract mark — a prism, a wing silhouette, a monogram —
is both safer and more consistent with the app's visual language.

---

## 2. Non-character branding drawn in code

RemielleStrap ships **zero** decorative image files. Everything that is not the
app icon is either a vector icon drawn inline as SVG, a CSS gradient, or a font.

### 2.1 Icon set

**File:** `src/renderer/src/lib/components/icons.ts`
**Component:** `src/renderer/src/lib/components/Icon.svelte`

Icons are hand-authored SVG path data stored as plain strings in a single
TypeScript record, rendered by one component:

```svelte
<Icon name="play" size={16} />
```

Every path is drawn on a 24×24 viewBox, stroke-based, `stroke-width` 1.5,
`stroke-linecap="round"`, `stroke-linejoin="round"`, `fill="none"`, and
inherits `currentColor` from its parent. This means an icon is coloured by the
surrounding Tailwind text colour and needs no per-icon variants.

The geometry is in the Feather / Lucide idiom — simple, open, geometric
line-work. It contains no character likeness, no logo, and no third-party
trademark. Adding an icon means adding one entry to the record in `icons.ts`;
the `IconName` union is derived from the record's keys, so TypeScript will
immediately flag any `<Icon name="...">` referring to a name that does not
exist.

The one non-generic mark in the set is `prism`: a triangle with three
refracted rays, used as the app's inline wordmark glyph in the titlebar and
sidebar. It is original geometry, not a trace of anything.

### 2.2 Typography

Declared in `src/renderer/src/assets/main.css` under the `@theme` block as
`--font-sans`, `--font-display`, and `--font-mono`.

**No font files are committed and no webfont is downloaded.** All three tokens
are system font stacks, which keeps the Content-Security-Policy free of any
`font-src` exception and keeps the bundle small:

- `--font-sans` — `'Inter var'`, `'Inter'`, `-apple-system`,
  `BlinkMacSystemFont`, `'Segoe UI'`, `system-ui`, `sans-serif`. The UI face
  for every control, label, and body string. Inter is used _if the user
  already has it_; otherwise the platform UI face is used and nothing is
  downloaded.
- `--font-display` — `'Cormorant Garamond'`, `'Iowan Old Style'`, `Georgia`,
  `'Times New Roman'`, `serif`. A high-contrast serif, applied only by the
  `.display` component class on page titles and the largest headings. This is
  the single strongest signal of the "cathedral light" register: an elegant
  serif over near-black, against a grotesque UI face everywhere else. When
  Cormorant Garamond is absent it degrades to Iowan Old Style then Georgia,
  both of which hold the same tone.
- `--font-mono` — `ui-monospace`, `'SF Mono'`, `'JetBrains Mono'`,
  `'Cascadia Mono'`, `Consolas`, `monospace`. Used for FastFlag keys and
  values, version GUIDs, byte counts, and Safebooru post IDs.

If you want the serif to render identically on every machine, bundle it: drop
the `.woff2` under `src/renderer/src/assets/fonts/`, `@font-face` it in
`main.css`, and add `font-src 'self'` to the CSP in `src/main/app/csp.ts`.
Nothing else changes — the token already points at the family name. Cormorant
Garamond is SIL Open Font License 1.1, so redistributing it in a build is
permitted provided the licence travels with it.

**No webfont is fetched over the network.** There is no Google Fonts link, no
`@import url(...)`, and consequently no `font-src` exception in the CSP.

### 2.3 Colour, gradients and texture

All defined as CSS custom properties in the `@theme` block of
`src/renderer/src/assets/main.css`. There are no gradient image files.

| Token family                          | Range            | Role                                                                                  |
| ------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `--color-ink-*`                       | `950` → `400`    | Substrate. Near-black through slate. Backgrounds, surfaces, borders                   |
| `--color-ivory-*`                     | `50` → `600`     | Content. Warm off-white through muted grey. Text, icons, hairlines                    |
| `--color-gold-*`                      | `200` → `700`    | Accent. Soft, desaturated gold. The single high-emphasis CTA, focus rings, active nav |
| `--color-prism-rose/violet/cyan/mint` | four fixed hues  | Iridescence. Used only at very low alpha in `.prism-edge` and status dots             |
| `--color-positive/caution/negative`   | three fixed hues | Status. Success, warning, destructive                                                 |

The "prism" effect — the faint spectral shimmer along the top edge of elevated
surfaces — is the `.prism-edge` component class. It is a `::after`
pseudo-element: a 1px-tall absolutely-positioned strip pinned to the top of the
element, filled with a horizontal `linear-gradient` that fades in from
transparent, steps rose → violet → cyan → mint at 40–45% alpha across the
20%–78% span, and fades back out. `pointer-events: none` keeps it inert.

It is pure CSS. There is no overlay PNG, no noise texture, and no blur image
anywhere in the app.

`.skeleton` uses the `shimmer` keyframe animation over a flat `ink` fill to
indicate loading art. `.surface`, `.surface-inset` and `.hairline` are flat
fills plus a single hairline border at low alpha.

### 2.4 Light theme

`.theme-light` (in the base layer of `main.css`) does **not** introduce a
second palette. It redefines `--color-ink-*` as a pale ramp and
`--color-ivory-*` as a dark ramp, in place. Every component keeps saying
`bg-ink-900` and `text-ivory-100` and simply inverts. `gold-*` darkens so it
stays legible on pale surfaces; the prism hues deepen for the same reason.
`App.svelte` toggles the class on `<html>`, along with `.reduce-motion`.

---

## 3. Runtime artwork — the Safebooru pipeline

This is where every image of Remielle Dan comes from. None of it is in the
repository; all of it is fetched, cached, and attributed at runtime.

### 3.1 Where it runs

| Concern                                                                 | Location                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------ |
| Search, download, cache, eviction, slot resolution                      | `src/main/services/booru.ts` (main process)      |
| HTTP with timeout / retry / redirect handling                           | `src/main/services/http.ts`                      |
| IPC surface (`booru:search`, `booru:getArtForSlot`, `booru:clearCache`) | `src/main/ipc/index.ts`                          |
| Payload validation                                                      | `src/main/ipc/validate.ts`                       |
| `app://` scheme that serves cached files to the renderer                | `src/main/app/protocol.ts`                       |
| Renderer state per slot                                                 | `src/renderer/src/lib/stores/art.svelte.ts`      |
| Presentation, skeleton, attribution, shuffle                            | `src/renderer/src/lib/components/ArtSlot.svelte` |

The renderer never touches the network for art and never receives a Safebooru
URL to load. It receives an `app://art/<filename>` URL pointing at a file
already on disk.

### 3.2 The API contract

Safebooru's DAPI, documented at
`https://safebooru.org/index.php?page=help&topic=dapi`:

```
GET https://safebooru.org/index.php
      ?page=dapi
      &s=post
      &q=index
      &json=1
      &tags=<space-separated tags>
      &limit=<1..1000>
      &pid=<0-based page index>
```

Notes that shaped the implementation:

- `limit` is hard-capped at 1000 server-side. The app requests 40–60.
- `pid` is a **page** index, not an offset.
- A failed search returns **HTTP 200** with a failure body rather than an error
  status, so the client must inspect the payload, not just the status code.
- The response is either a bare JSON array or an object wrapping `post`.
  `parsePayload` in `booru.ts` accepts both, plus `null` for "no results".
- Image URLs are assembled from the `directory` and `image` fields:
  - full: `https://safebooru.org/images/<directory>/<image>`
  - sample: `https://safebooru.org/samples/<directory>/sample_<base>.jpg`
  - thumb: `https://safebooru.org/thumbnails/<directory>/thumbnail_<base>.jpg`
- Only posts with a `sample` flag actually have a sample file.

### 3.3 Slots and their default tags

Defined as `ART_SLOTS` and `DEFAULT_BOORU_TAGS` in `src/shared/settings.ts`.

| Slot           | Default tags              | Where it appears                                  | Preferred aspect |
| -------------- | ------------------------- | ------------------------------------------------- | ---------------- |
| `home_banner`  | `remielle_dan wide_image` | Hero band across the top of the Home page         | Wide / landscape |
| `splash`       | `remielle_dan`            | Full-bleed backdrop behind the launch state       | Tall / portrait  |
| `sidebar`      | `remielle_dan solo`       | Narrow art panel at the foot of the nav rail      | Tall / portrait  |
| `about_header` | `remielle_dan`            | Banner behind the About page title                | Wide / landscape |
| `bootstrapper` | `remielle_dan solo`       | Backdrop of the install / launch progress overlay | Tall / portrait  |

`choosePost` scores candidates by aspect ratio against the slot's preference,
so a wide slot is not handed a portrait image when a landscape one is
available.

Users can override the tag string for any slot from **Appearance →
Artwork**. The override is stored in `settings.booruTags[slot]`. If a custom
tag string returns nothing, `fallbackChain` progressively drops the trailing
tag words and finally falls back to the slot's default, so an over-specific
query degrades to _some_ Remielle art rather than to an empty box.

### 3.4 Caching

| Property                | Value                                                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache directory         | `<userData>/Cache/Art` (`paths.artCache`)                                                                                                                       |
| Filename                | `<postId>-<sha1(url)[0..8]><ext>`                                                                                                                               |
| Allowed extensions      | `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif` — anything else is coerced to `.jpg`                                                                                   |
| Per-image ceiling       | 24 MB. Larger downloads are aborted and the post is skipped                                                                                                     |
| Total cache ceiling     | 256 MB. Enforced by least-recently-used eviction after each write                                                                                               |
| Sample preference       | Posts above ~6 megapixels use the `sample_` variant instead of the full file                                                                                    |
| Thumbnail               | Cached alongside the main image, best-effort; failure to fetch it is non-fatal                                                                                  |
| Chosen post persistence | `settings.chosenBooruPosts[slot]` (the post ID) and `state.booruCache[slot]` (the `CachedArt` record: post ID, filename, dimensions, tags, page URL, timestamp) |

`<userData>` resolves to:

- Windows — `%APPDATA%\RemielleStrap`
- macOS — `~/Library/Application Support/RemielleStrap`
- Linux — `~/.config/RemielleStrap`

Because the chosen post is persisted per slot, the same artwork reappears on
the next launch with no network call at all. The app only hits Safebooru when a
slot has no cached file, when the user shuffles, or when the user changes the
tags for that slot.

**Appearance → Artwork → Clear art cache** (`booru:clearCache`) deletes every
file in the cache directory and drops the persisted selections. The next render
re-fetches.

### 3.5 Serving cached files to the renderer

Cached images are served over a custom `app://` scheme, never `file://`.

`src/main/app/protocol.ts` registers `app` as a **privileged** scheme
(`standard`, `secure`, `corsEnabled`, `stream`, `bypassCSP: false`) before
`app.whenReady()`, then handles `app://art/<filename>` by resolving the name
inside the cache directory and streaming the file back.

`resolveAppUrl` rejects any request whose decoded filename escapes the cache
directory. The WHATWG URL parser already normalises literal `..` and `.`
segments away before the handler sees them, so the explicit checks target
percent-encoded separators (`%2f`, `%5c`) and backslashes.

The CSP in `src/main/app/csp.ts` therefore reads
`img-src 'self' app: data: blob:` — note the absence of `https:`. The renderer
is structurally incapable of hotlinking Safebooru, which is both a privacy
property (no requests leak from the renderer) and a politeness property (no
hotlinking of someone else's bandwidth).

### 3.6 Attribution and links

`ArtSlot.svelte` renders an attribution chip over every populated slot reading
`Safebooru #<postId>`. Clicking it invokes the dedicated `booru:openPost`
channel with just the integer post ID; the main process validates it and builds
the page URL itself (`https://safebooru.org/index.php?page=post&s=view&id=<id>`)
before handing it to `openExternal`. The renderer never gets to choose a URL.

`safebooru.org` is on the external-host whitelist in `csp.ts`, so the link
opens in the user's real browser. Everything not on that whitelist is refused;
`window.open` and in-app navigation to external origins are both blocked by
`hardenWindow`.

### 3.7 Failure behaviour

The pipeline is written to never break the UI, because the network is not
guaranteed:

| Failure                                          | Result                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Network unreachable / DNS failure / TLS failure  | Slot keeps its previously cached image. If there is none, it renders an empty `surface` with a quiet one-line message. The rest of the page is fully functional |
| HTTP 200 with a failure body                     | Treated as "no results" and routed into `fallbackChain`                                                                                                         |
| Zero results for the configured tags             | Tags are progressively shortened, then the slot default is tried                                                                                                |
| Image exceeds 24 MB                              | Download aborted, that post skipped, next candidate scored                                                                                                      |
| Corrupt or truncated download                    | File discarded, error surfaced on the slot, cache left consistent                                                                                               |
| Request superseded (user shuffles twice quickly) | Previous request is cancelled via `AbortSignal`; only the latest result is committed                                                                            |

Art is decorative. Nothing about launching Roblox, managing mods, editing
FastFlags, or tracking activity depends on any of it succeeding.

### 3.8 Rate limiting and etiquette

- `prefetchAllSlots()` runs once on startup and resolves slots sequentially,
  not in parallel, so a cold start is at most five requests spread over time.
- Slots with a valid cached file make **no** request at all.
- `http.ts` sends a descriptive `User-Agent` identifying the app and its
  repository —
  `RemielleStrap/1.0 (+https://github.com/TheMallyGuy/remiellestrap)` — retries
  at most twice, and times out at 45 s for image bodies.
- Please do not lower the cache ceilings or add a polling refresh. Safebooru is
  a free service.

---

## 4. Licensing

- **Application icons** (`build/*`, `resources/icon.png`) and everything drawn
  in code — icons, colours, `.prism-edge`, the `prism` glyph — are part of this
  repository and covered by its MIT licence.
- **Runtime artwork from Safebooru** is not part of this repository and is not
  covered by its licence. Each image belongs to its original artist. The app
  never redistributes it: it is downloaded to the end user's own machine, shown
  locally, attributed with a link back to the source post, and deletable from
  the UI at any time.
- **Remielle Dan** is a character from _Zenless Zone Zero_, © HoYoverse.
  RemielleStrap is an unofficial, non-commercial fan project and is not
  affiliated with, endorsed by, or sponsored by HoYoverse or Roblox
  Corporation.

If you distribute builds of this project, replace the application icon with a
mark you own.

---

## 5. What is deliberately absent

For the avoidance of doubt, and so nobody goes looking for a missing folder:

- No AI-generated images of any kind, anywhere in this repository.
- No character art, portraits, mascots, wallpapers, or splash images committed.
- No placeholder art, no "drop your image here" slots, no `TODO: add asset`.
- No sprite sheets, no Lottie/JSON animations, no video, no audio.
- No bundled font files.
- No icon-library dependency — the SVG paths are in `icons.ts` and that is the
  whole icon system.
- No gradient, noise, or texture image files. Every surface effect is CSS.

The repository's entire binary footprint is four image files, and all four are
the same application icon.
