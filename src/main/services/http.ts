import { createWriteStream } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { dirname } from 'path'
import { ensureDir } from '../utils/fs'
import { createLogger } from '../utils/logger'

const logger = createLogger('Http')

export const USER_AGENT = 'RemielleStrap/1.0 (+https://github.com/TheMallyGuy/remiellestrap)'

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
  headers?: Record<string, string>
  retries?: number
}

const DEFAULT_TIMEOUT = 20_000

function mergeSignals(signals: (AbortSignal | undefined)[]): {
  signal: AbortSignal
  cleanup: () => void
} {
  const controller = new AbortController()
  const active = signals.filter((s): s is AbortSignal => Boolean(s))

  const onAbort = (event: Event): void => {
    const target = event.target as AbortSignal
    controller.abort(target.reason)
  }

  for (const signal of active) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', onAbort, { once: true })
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const signal of active) signal.removeEventListener('abort', onAbort)
    }
  }
}

async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT, retries = 2 } = options
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const { signal, cleanup } = mergeSignals([timeoutSignal, options.signal])

    try {
      const response = await fetch(url, {
        signal,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, ...options.headers }
      })

      if (!response.ok) {
        // 4xx responses are not worth retrying, except for rate limiting.
        if (response.status < 500 && response.status !== 429) {
          throw new HttpError(`HTTP ${response.status} ${response.statusText}`, response.status, url)
        }
        throw new HttpError(`HTTP ${response.status} ${response.statusText}`, response.status, url)
      }

      return response
    } catch (error) {
      lastError = error
      if (options.signal?.aborted) throw new Error('Request cancelled')
      if (error instanceof HttpError && error.status < 500 && error.status !== 429) throw error
      if (attempt < retries) {
        const backoff = 400 * Math.pow(2, attempt)
        logger.warn(`${url} failed (attempt ${attempt + 1}/${retries + 1}): ${String(error)}`)
        await new Promise((resolve) => setTimeout(resolve, backoff))
      }
    } finally {
      cleanup()
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`Request failed: ${url}`)
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly url: string
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export async function getText(url: string, options?: RequestOptions): Promise<string> {
  const response = await request(url, options)
  return response.text()
}

export async function getJson<T>(url: string, options?: RequestOptions): Promise<T> {
  const response = await request(url, { ...options, headers: { Accept: 'application/json', ...options?.headers } })
  const text = await response.text()
  if (text.trim().length === 0) return [] as unknown as T
  try {
    return JSON.parse(text) as T
  } catch (error) {
    throw new Error(`Malformed JSON from ${url}: ${String(error)}`)
  }
}

export async function getBuffer(url: string, options?: RequestOptions): Promise<Buffer> {
  const response = await request(url, options)
  return Buffer.from(await response.arrayBuffer())
}

export interface DownloadProgress {
  received: number
  total: number | null
}

/** Streams a URL to disk, reporting progress. Used for Roblox packages. */
export async function downloadToFile(
  url: string,
  destination: string,
  options: RequestOptions & { onProgress?: (progress: DownloadProgress) => void } = {}
): Promise<number> {
  const response = await request(url, { ...options, timeoutMs: options.timeoutMs ?? 120_000 })
  if (!response.body) throw new Error(`Empty response body for ${url}`)

  await ensureDir(dirname(destination))

  const lengthHeader = response.headers.get('content-length')
  const total = lengthHeader ? Number.parseInt(lengthHeader, 10) : null
  let received = 0

  const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  nodeStream.on('data', (chunk: Buffer) => {
    received += chunk.length
    options.onProgress?.({ received, total: Number.isFinite(total) ? total : null })
  })

  await pipeline(nodeStream, createWriteStream(destination))
  return received
}

/** Returns true when the URL responds to a lightweight request. */
export async function testConnection(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    await request(url, { timeoutMs, retries: 0 })
    return true
  } catch {
    return false
  }
}
