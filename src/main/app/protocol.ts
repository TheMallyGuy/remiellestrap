import { protocol, net } from 'electron'
import { join, normalize, sep } from 'path'
import { pathToFileURL } from 'url'
import { paths } from '../utils/paths'
import { isInside } from '../utils/fs'
import { createLogger } from '../utils/logger'

/**
 * Custom `app://` protocol used to serve cached Safebooru artwork to the
 * renderer.
 *
 * Serving cache files over a dedicated scheme rather than `file://` means the
 * Content-Security-Policy never has to allow `file:` in `img-src`, and the
 * renderer can only ever reach the art cache directory — path traversal in a
 * URL cannot escape it.
 *
 * URL shape: `app://art/<fileName>`
 */

const logger = createLogger('Protocol')

export const APP_SCHEME = 'app'

/** Host segments that map to a directory on disk. */
const HOSTS: Record<string, () => string> = {
  art: () => paths.artCache
}

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
}

/**
 * Must be called before `app.whenReady()`. Marks the scheme as secure so it
 * behaves like https for CSP and mixed-content purposes.
 */
export function registerSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        bypassCSP: false,
        corsEnabled: true,
        stream: true
      }
    }
  ])
}

/** Builds an `app://` URL for a file inside the art cache. */
export function artUrl(fileName: string): string {
  return `${APP_SCHEME}://art/${encodeURIComponent(fileName)}`
}

/**
 * Resolves an `app://` URL to an absolute path inside a whitelisted root,
 * or null when the request is malformed or escapes that root.
 */
export function resolveAppUrl(rawUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }

  if (parsed.protocol !== `${APP_SCHEME}:`) return null

  // Non-special schemes keep the host's original case, so normalise it.
  const root = HOSTS[parsed.hostname.toLowerCase()]?.()
  if (!root) return null

  let relative: string
  try {
    relative = decodeURIComponent(parsed.pathname)
  } catch {
    return null
  }

  relative = relative.replace(/^\/+/, '')
  if (!relative) return null

  // Reject anything that tries to climb out or looks like an absolute path.
  if (relative.includes('\0')) return null
  const segments = relative.split('/').filter(Boolean)
  // Backslashes are ordinary filename characters on POSIX but separators on
  // Windows, so a decoded `..\..\` would traverse on the target platform.
  if (segments.some((segment) => segment === '..' || segment === '.' || segment.includes('\\')))
    return null

  const target = normalize(join(root, ...segments))
  if (target !== root && !isInside(root, target)) return null
  if (target.endsWith(sep)) return null

  return target
}

/** Registers the request handler. Must be called after the app is ready. */
export function registerProtocolHandler(): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const target = resolveAppUrl(request.url)

    if (!target) {
      logger.warn(`Blocked app:// request: ${request.url}`)
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain' }
      })
    }

    const extension = target.slice(target.lastIndexOf('.')).toLowerCase()
    const mime = MIME_TYPES[extension] ?? 'application/octet-stream'

    try {
      const response = await net.fetch(pathToFileURL(target).toString())
      if (!response.ok) {
        return new Response('Not found', {
          status: 404,
          headers: { 'content-type': 'text/plain' }
        })
      }

      return new Response(response.body, {
        status: 200,
        headers: {
          'content-type': mime,
          // The cache directory is content-addressed by post id, so entries
          // are safe to cache aggressively within a session.
          'cache-control': 'public, max-age=86400'
        }
      })
    } catch (error) {
      logger.warn(`Failed to serve ${target}: ${String(error)}`)
      return new Response('Not found', {
        status: 404,
        headers: { 'content-type': 'text/plain' }
      })
    }
  })

  logger.info(`Registered ${APP_SCHEME}:// protocol handler`)
}
