import { createWriteStream } from 'fs'
import { rename, rm } from 'fs/promises'
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

/**
 * Builds one signal without manually detaching the caller's signal too early.
 * A fetch resolves as soon as the response headers arrive, but the signal must
 * stay active until text()/arrayBuffer()/the download stream has also finished.
 */
function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([timeout, signal]) : timeout
}

async function request(url: string, options: RequestOptions = {}): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT, retries = 2 } = options
  let lastError: unknown = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: requestSignal(timeoutMs, options.signal),
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT, ...options.headers }
      })

      if (!response.ok) {
        // 4xx responses are not worth retrying, except for rate limiting.
        if (response.status < 500 && response.status !== 429) {
          throw new HttpError(
            `HTTP ${response.status} ${response.statusText}`,
            response.status,
            url
          )
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
  const response = await request(url, {
    ...options,
    headers: { Accept: 'application/json', ...options?.headers }
  })
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

export interface DownloadOptions extends RequestOptions {
  onProgress?: (progress: DownloadProgress) => void
  /** Exact byte count advertised by a trusted package manifest. */
  expectedBytes?: number
}

/**
 * Streams a URL to a sibling .part file and only publishes it after the whole
 * body has arrived. Interrupted responses can therefore never masquerade as a
 * reusable cached package on the next bootstrapper run.
 */
export async function downloadToFile(
  url: string,
  destination: string,
  options: DownloadOptions = {}
): Promise<number> {
  const response = await request(url, { ...options, timeoutMs: options.timeoutMs ?? 300_000 })
  if (!response.body) throw new Error(`Empty response body for ${url}`)

  await ensureDir(dirname(destination))

  const lengthHeader = response.headers.get('content-length')
  const parsedLength = lengthHeader ? Number.parseInt(lengthHeader, 10) : Number.NaN
  const responseBytes = Number.isFinite(parsedLength) ? parsedLength : null
  const total = options.expectedBytes ?? responseBytes
  const temporary = `${destination}.part`
  let received = 0

  await rm(temporary, { force: true }).catch(() => undefined)

  try {
    const nodeStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
    nodeStream.on('data', (chunk: Buffer) => {
      received += chunk.length
      options.onProgress?.({ received, total })
    })

    await pipeline(nodeStream, createWriteStream(temporary, { flags: 'wx' }))

    if (responseBytes !== null && received !== responseBytes) {
      throw new Error(
        `Incomplete response from ${url}: expected ${responseBytes} bytes, got ${received}`
      )
    }

    if (options.expectedBytes !== undefined && received !== options.expectedBytes) {
      throw new Error(
        `Incomplete package from ${url}: expected ${options.expectedBytes} bytes, got ${received}`
      )
    }

    // The caller removes an invalid old destination before downloading. rm is
    // repeated here so rename remains portable when recovering from an older
    // RemielleStrap build that may have left a file behind.
    await rm(destination, { force: true })
    await rename(temporary, destination)
    return received
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
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
