import { createHash } from 'crypto'
import { createReadStream } from 'fs'

/**
 * Package integrity verification. Roblox's rbxPkgManifest.txt records an MD5
 * checksum per package, so MD5 is what we must compare against.
 */

export function md5Buffer(buffer: Buffer | Uint8Array): string {
  return createHash('md5').update(buffer).digest('hex')
}

export function md5File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5')
    const stream = createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex')
}

/** Short, stable, filesystem-safe id derived from arbitrary input. */
export function shortId(value: string, length = 12): string {
  return sha1(value).slice(0, length)
}
