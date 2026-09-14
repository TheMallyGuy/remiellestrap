# Studio presence bridge

Roblox Studio cannot be observed the way the player can. It writes no discoverable
log, and there is no supported way to ask it what is open. RemielleStrap works
from the other side instead: a small loopback HTTP listener that a companion
Studio plugin posts to.

The bridge is off until you enable it in **Integrations → Studio bridge**, and the
companion plugin is written by the launcher — there is nothing to install from the
Toolbox.

## Enabling it

1. Open **Integrations** and turn on **Studio bridge**.
2. Pick a port (39457 by default). It must be free; if something else owns it the
   launcher says so and keeps the bridge disabled rather than silently failing.
3. Press **Install plugin**. The launcher writes
   `RemielleStrap Presence.client.lua` into the Studio Plugins folder and starts
   the listener.
4. Restart Studio, or press *Plugins → RemielleStrap Presence → Reload* if you have
   it open already.

The plugin posts on load, every 20 seconds while Studio is open, and once on
close. A report that stops arriving is treated as "the session ended" after 45
seconds, because plugins get no reliable unload hook.

## The contract

The listener binds to `127.0.0.1` only — never to a public interface — caps request
bodies at 4 KiB, and never executes anything it receives. Every field is validated
individually, and unknown paths get a 404.

### `GET /status`

Liveness probe, useful for checking the bridge from a browser.

```json
{ "ok": true, "app": "RemielleStrap", "port": 39457 }
```

### `POST /presence`

```json
{
  "placeName": "Remielle's Cathedral",
  "placeId": "606849621",
  "placeVersion": 42,
  "studioVersion": "0.700.0.7001234",
  "authoring": true
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `placeName` | yes | Trimmed to 120 characters. `name` and `place` are accepted as aliases. |
| `placeId` | no | Digits only, as a string or a number. An unsaved place has none. |
| `placeVersion` | no | Integer. |
| `studioVersion` | no | Free text, trimmed to 32 characters. |
| `authoring` | no | `true` in the editor, `false` while playing a place in Studio. Defaults to `true`. |

Responses: `200 { "ok": true }`, `400` for a body that is not JSON, `422` when
`placeName` is missing or empty.

### `POST /clear`

Drops the current report and clears the presence. Send `{}` as the body.

## Writing your own plugin

Anything that speaks HTTP to the loopback address can drive the bridge — the
bundled plugin is only the reference implementation. A minimum viable version:

```lua
local HttpService = game:GetService("HttpService")
local endpoint = "http://127.0.0.1:39457"

HttpService:PostAsync(endpoint .. "/presence", HttpService:JSONEncode({
    placeName = game.Name ~= "" and game.Name or "Untitled place",
    placeId = game.PlaceId,
    placeVersion = game.PlaceVersion,
    authoring = true
}), Enum.HttpContentType.ApplicationJson)
```

Note that Studio only permits HTTP requests to localhost from a plugin if
**Game Settings → Security → Allow HTTP Requests** is on, or from a plugin you
have granted permission to.

## Privacy

The payload never leaves the machine: it goes from your plugin to the launcher on
`127.0.0.1` and nowhere else. The launcher then publishes it to Discord if
presence is enabled, exactly as it does for the player. Nothing about your place
is reported anywhere by RemielleStrap, and the plugin file is a plain text file
you can read, edit or delete at any time.
