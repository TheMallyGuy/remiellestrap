# Overlays

RemielleStrap has two overlays, and they are not variations of one idea.

The **in-game overlay** is a real window: transparent, always on top, pinned over
the Roblox client, drawing live session figures. It is switched off by default
because a card in the corner of someone's game is a decision they should make
first.

The **command palette** is the launcher's own overlay — a Ctrl+K panel inside the
main window that searches and runs what the launcher can already do. It is on by
default and costs nothing.

Both are configured on one page, **Overlays**, with a tab each.

---

## The in-game overlay

### What it draws

Every figure is a widget with its own switch, so the card is only as busy as you
asked for. Ten widgets in three groups:

| Group   | Widget        | Where the number comes from                                       |
| ------- | ------------- | ----------------------------------------------------------------- |
| Session | Experience    | The activity watcher, from the client's own log                   |
| Session | Session time  | Timed locally, and ticked forward in the renderer between samples |
| Session | Account       | The stored account this session was launched as                   |
| Server  | Framerate     | The average FPS **other players reported** for this server        |
| Server  | Ping          | The average ping **reported** for this server                     |
| Server  | Region        | The server's datacenter code, mapped through the region catalogue |
| Server  | Players       | How full the server is, out of its capacity                       |
| Server  | Server id     | The job id, read from the client log                              |
| System  | Client memory | The Roblox process working set, from a local process watcher      |
| System  | Client CPU    | Share of every core the Roblox process is using                   |

Default: experience, session time, framerate, ping and region.

### What it will not pretend

Roblox publishes no API for your own framerate or your own latency, and the
launcher does not hook the process to invent one. The four server figures come
from the public server list — the averages Roblox collects from everyone in that
job — so the overlay says so out loud:

- each reported figure carries a small `avg` marker in the corner of the card;
- `OverlayStats` names its source per figure (`fpsSource`, `pingSource`);
- the page lists the same caveat in plain words under the live panel;
- a server that is not on the fetched page of the public list gets _no_ figures
  and a notice, rather than borrowing a neighbouring server's numbers.

Anything unavailable is `null` and simply not drawn. The overlay never shows a
stale or guessed value where it can show a gap.

### Placement

On Windows the launcher measures the Roblox client window — position, size,
whether it is minimised or covering its whole display — and pins the overlay to
one of its corners. The corner is an anchor (`top-right` by default) plus a
margin, and it follows the client when you move or resize it.

Dragging the card by hand works too: the overlay posts its new screen position
while you drag and commits on release, which stores the position as an offset
from the client window and moves the anchor to `custom`. **Reset position** puts
it back on its corner.

Window tracking is Windows-only. Everywhere else the overlay still draws and is
still draggable — it just pins to a display instead of to the game, and the page
and the notices say which of those happened.

### The process watcher

Memory and CPU need something watching the client process. That is one persistent
hidden PowerShell window, started on demand and printing a line every 400 ms
(handle, bounds, minimised, fullscreen, working set, CPU time), killed as soon as
nobody wants it. It is not started per sample and not started per tick — a fresh
PowerShell costs a second to warm up, which is longer than the interval it would
be measuring.

It exits on its own if its parent disappears, and has a twelve-hour deadline so
it cannot outlive a session that never ended cleanly. The Overlays page borrowing
a sample while the feature is switched off gets the watcher for fifteen seconds,
then gives it back.

### Appearance and cost

- **Opacity** 35–100 % and **scale** 80–160 %. Scale changes the card's root font
  size and everything inside is sized in `em`, so it stays sharp rather than
  stretching a raster.
- **Click-through** is on by default: mouse events pass through to the game. Off,
  the overlay's rectangle swallows clicks, which is why the page warns before you
  turn it off — you need it off to drag the card.
- **Refresh** is 2 s by default (1 s, 2 s, 5 s, 10 s). This is how often the card
  re-reads the local figures.
- **Server figures** refresh on their own slower cadence, 20 s by default
  (10/20/60/180 s), because they come from an HTTP request. They are shared with
  the Servers page cache, so having both open does not double the requests.

### Hotkey

`CommandOrControl+Shift+O` by default, registered globally so it works while the
game has focus. Any valid Electron accelerator may be typed instead; the presets
are the ones unlikely to collide with a game or with the launcher's own
Ctrl+1..9 page shortcuts. If a shortcut cannot be registered — another app owns
it — the page shows why instead of silently doing nothing, and the Show/Hide
buttons still work.

### Preview

**Preview** draws the card with sample figures while nothing is running, so you
can place it and choose widgets without launching a game. It is labelled: the
card carries a `Preview` chip, the page carries one too, and `clientRunning` and
`inGame` stay `false` — a preview never reports that you are playing.

---

## The command palette

Ctrl+K opens a search-and-run panel in the launcher window. It is a renderer
surface, not a window: it cannot be dragged onto your game and does not try.

- **Empty** shows the useful few — Play, join best in region, rejoin, toggle the
  overlay, and the first six pages.
- **Typing** fuzzy-searches titles, keywords, hints and badges, and sorts by score
  with word-boundary matches ahead of mid-word ones. One flat list; the group each
  command belongs to is drawn as a chip beside it.
- **Two or more characters** also searches Roblox for experiences (debounced,
  capped at six results) and offers to launch or join as a stored account. Off
  with `paletteGameSearch`.
- Up to 24 rows, arrow keys and Home/End, Enter to run, Escape to close, Tab
  trapped inside the panel, and focus returned to whatever opened it.

Nine groups of commands: **Navigate** (every page), **Launch** (play, update
check, reinstall), **Servers** (join best in region, rejoin, copy join script,
open the experience page), **Accounts** (switch to each stored account, sign in
to another), **Mods** (apply mods and flags now), **FastFlags** (the page and its
presets), **Overlays** (toggle, preview, settings), **System** (logs, folders,
launcher update, export settings), and **Experiences** (live search results).

The hotkey is configurable the same way as the overlay's, and the title bar
carries a search button that shows it.

---

## The contract

Seven invoke channels and two events, all declared once in `src/shared/ipc.ts`:

| Channel                  | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `overlay:getState`       | Everything the page needs to describe the overlay's situation      |
| `overlay:setVisible`     | Show or hide, without touching the setting                         |
| `overlay:toggle`         | The hotkey's action                                                |
| `overlay:preview`        | Draw sample figures while nothing is running                       |
| `overlay:setPosition`    | During a drag; `commit: true` on release stores it as an offset    |
| `overlay:setContentSize` | The card reporting its own measured size, clamped 120–640 × 28–640 |
| `overlay:sample`         | Force a fresh sample — the page's live panel                       |
| `overlay:state` (event)  | Pushed whenever the situation changes                              |
| `overlay:stats` (event)  | Pushed on every tick and on every forced sample                    |

Settings are ordinary settings: fifteen `overlay*` keys and three `palette*` keys
in `DEFAULT_SETTINGS`, each coerced and clamped in `coerceSettings()` so a hand
edited file cannot put the window off-screen or the refresh at 0 ms. Turning the
feature off tears the window down rather than hiding it, and unregisters the
global shortcut.

### Where the code lives

```
src/shared/            models, settings, catalogues, channels — the contract
src/main/app/overlayWindow.ts        the window shell: create, place, click-through
src/main/services/overlay.ts         behaviour: sampling, ticking, hotkey, notices
src/main/services/tweaks.ts          the client process watcher
src/renderer/src/OverlayWindow.svelte            the card
src/renderer/src/lib/stores/overlay.svelte.ts    its store
src/renderer/src/lib/pages/OverlaysPage.svelte   both settings tabs
src/renderer/src/lib/components/CommandPalette.svelte
src/renderer/src/lib/stores/palette.svelte.ts    the palette's command catalogue
```

The window shell and the behaviour are separate for the same reason the launcher
window and the services are: `overlayWindow.ts` knows how to make a transparent
always-on-top window and where to put it, and nothing about what is drawn on it.

The overlay window loads the same renderer bundle with `?view=overlay`, so it
shares the theme, the accent, the fonts and the reduce-motion setting through
`src/renderer/src/lib/appearance.ts` rather than keeping a second copy.
