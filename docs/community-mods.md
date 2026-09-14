# Community mod index

The mod page can browse a catalogue of community mods instead of asking you to
find a `.zip` yourself. The catalogue is just a JSON document at a URL you choose
in **Mods → Community → Index URL**; nothing about the format is privileged, and
you can point it at a fork, a gist on a webserver you run, or a file on an
intranet.

## The document

Either a bare array or an object with a `mods` array. Both are accepted:

```json
{
  "mods": [
    {
      "id": "cathedral-cursors",
      "name": "Cathedral Cursors",
      "author": "Remielle",
      "description": "Ink and gold pointer set, with a prism trail.",
      "version": "1.2.0",
      "url": "https://example.com/mods/cathedral-cursors-1.2.0.zip",
      "sha256": "9f2c4d1e5b8a7c0f3e6d9a2b5c8e1f4a7d0b3c6e9f2a5d8b1c4e7f0a3d6b9c2e",
      "size": 48213,
      "preview": "https://example.com/mods/cathedral-cursors.png",
      "tags": ["cursors", "dark"],
      "target": "both",
      "updatedAt": 1767225600000
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | yes | Up to 80 characters. Stable: it is the local identity of the mod, and changing it makes the launcher treat the download as a new mod. |
| `url` | yes | **HTTPS only.** `http:`, `file:` and `data:` URLs are rejected outright. |
| `name` | no | Up to 120 characters. Falls back to the id. |
| `author` | no | Up to 80 characters. |
| `description` | no | Up to 600 characters, shown in the browser. |
| `version` | no | Free text, up to 40 characters. |
| `sha256` | no | 64 hex characters. **Strongly recommended** — see below. |
| `size` | no | Bytes, for the size hint in the UI. |
| `preview` | no | An image URL shown in the browser. |
| `tags` | no | Up to 12 strings, used for search. |
| `target` | no | `player`, `studio` or `both`. Defaults to `player`. |
| `updatedAt` | no | Unix milliseconds. |

At most 500 entries are read, and entries without an `id` or a valid `url` are
skipped rather than failing the whole document.

## What the launcher does with a download

1. The archive is fetched to `paths.communityCache` with a timeout and one retry.
2. If `sha256` is present it is verified, and a mismatch means the file is
   **deleted** and reported — the archive is never extracted.
3. The file must actually be a ZIP (checked by its central directory, not its
   extension).
4. It is extracted with the same path checks as a manually imported mod, and every
   file is normalised to a relative path inside the mod's own folder.
5. Anything targeting a protected path — executables, the launcher's settings, the
   client's package manifests — is refused.

Steps 3 to 5 are exactly what happens when you import a zip by hand, so a
community mod can never do anything a manual one could not.

## Caching

The last good index is cached in `paths.communityCache`, along with the URL it came
from. A refresh that fails — offline, a 404, a rate limit — falls back to the cache
and reports the failure rather than emptying your list. Changing the index URL
invalidates the cache automatically.

## Hosting your own

Any static file host works: a gist, a repository's raw URL, an S3 bucket. Serve it
with `Content-Type: application/json`, keep archives next to it, and generate a
checksum for each one:

```bash
sha256sum cathedral-cursors-1.2.0.zip
```

The default index lives at
`https://raw.githubusercontent.com/TheMallyGuy/remiellestrap/main/community-mods.json`,
which is the file this repository publishes. Point the setting somewhere else if
you would rather not use it.
