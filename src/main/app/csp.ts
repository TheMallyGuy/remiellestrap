import { session, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { createLogger } from '../utils/logger'
import { APP_SCHEME } from './protocol'

/**
 * Content-Security-Policy and navigation hardening.
 *
 * The policy is attached as a response header rather than a <meta> tag so it
 * also covers the dev server and any subresource the renderer requests.
 *
 * Images resolve from the `app://` scheme (the local Safebooru cache) — never
 * `file:` and never a remote host, so artwork cannot phone home or leak the
 * user's IP to the booru CDN at render time.
 */

const logger = createLogger('Security')

/** Hosts the renderer is allowed to be sent to via the shell. */
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'safebooru.org',
  'www.roblox.com',
  'roblox.com',
  'create.roblox.com',
  'github.com',
  'www.github.com'
])

function buildPolicy(): string {
  // Vite's dev server needs inline styles and a websocket for HMR; the packaged
  // build gets the strict policy.
  const styleSrc = is.dev ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline'"
  const scriptSrc = is.dev ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self'"
  const connectSrc = is.dev ? "'self' ws: http://localhost:* http://127.0.0.1:*" : "'self'"

  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    `style-src ${styleSrc}`,
    `img-src 'self' ${APP_SCHEME}: data: blob:`,
    "font-src 'self' data:",
    `connect-src ${connectSrc}`,
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'"
  ].join('; ')
}

/** Installs the CSP response header for every renderer request. */
export function installCsp(): void {
  const policy = buildPolicy()

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
        'X-Content-Type-Options': ['nosniff']
      }
    })
  })

  // Nothing in this app needs camera, microphone, geolocation and friends.
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    logger.warn(`Denied permission request: ${permission}`)
    callback(false)
  })

  session.defaultSession.setPermissionCheckHandler(() => false)

  logger.info('Content-Security-Policy installed')
}

/** True when a URL may be handed to the user's browser. */
export function isAllowedExternal(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'https:') return false
    return ALLOWED_EXTERNAL_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

/** Opens a URL in the user's browser if — and only if — it is whitelisted. */
export async function openExternal(rawUrl: string): Promise<boolean> {
  if (!isAllowedExternal(rawUrl)) {
    logger.warn(`Refused to open external URL: ${rawUrl}`)
    return false
  }

  await shell.openExternal(rawUrl)
  return true
}

/**
 * Prevents the renderer from navigating away from the app or spawning
 * windows. Any external link is routed through the whitelist instead.
 */
export function hardenWindow(window: BrowserWindow): void {
  const contents = window.webContents

  contents.setWindowOpenHandler(({ url }) => {
    void openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    const current = contents.getURL()
    if (url === current) return

    // The dev server reloads through will-navigate during HMR.
    if (is.dev && url.startsWith(process.env['ELECTRON_RENDERER_URL'] ?? '\u0000')) return

    event.preventDefault()
    logger.warn(`Blocked in-window navigation to ${url}`)
    void openExternal(url)
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
    logger.warn('Blocked webview attachment')
  })
}
