import { deflateSync } from 'zlib'

/**
 * Tiny PNG writer.
 *
 * The mod generator only ever needs flat colours and linear gradients, so
 * rather than pulling in an image library the pixels are produced here and
 * encoded with zlib's own deflate. That keeps the dependency list unchanged and
 * makes the output deterministic, which matters because these files are written
 * into a client install.
 */

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Parses `#rrggbb` (or `#rgb`) into channels. Throws on anything else. */
export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, '')

  if (/^[0-9a-f]{3}$/i.test(value)) {
    return {
      r: Number.parseInt(value[0] + value[0], 16),
      g: Number.parseInt(value[1] + value[1], 16),
      b: Number.parseInt(value[2] + value[2], 16)
    }
  }

  if (!/^[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Not a hex colour: ${hex}`)
  }

  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16)
  }
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (channel: number): string =>
    Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** Linear blend between two colours; `t` is clamped to 0..1. */
export function mix(from: Rgb, to: Rgb, t: number): Rgb {
  const clamped = Math.max(0, Math.min(1, t))
  return {
    r: from.r + (to.r - from.r) * clamped,
    g: from.g + (to.g - from.g) * clamped,
    b: from.b + (to.b - from.b) * clamped
  }
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)
  return Buffer.concat([length, typeAndData, crc])
}

/** Encodes raw RGBA scanlines as an 8-bit RGBA PNG. */
export function encodePng(width: number, height: number, pixels: Buffer): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // truecolour with alpha
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // One filter byte (0 = none) per scanline.
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const source = y * width * 4
    const target = y * (width * 4 + 1)
    raw[target] = 0
    pixels.copy(raw, target + 1, source, source + width * 4)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** A single opaque pixel of `hex`. Stretches across panels in the client UI. */
export function solidPng(hex: string): Buffer {
  const { r, g, b } = parseHex(hex)
  return encodePng(1, 1, Buffer.from([r, g, b, 0xff]))
}

export interface GradientOptions {
  from: string
  to: string
  /** Square edge length; kept small because these are stretched by the client. */
  size?: number
  /** Gradient direction in degrees, 0 = left to right, 90 = top to bottom. */
  angle?: number
  /** Use noise-free vertical banding plus a soft vignette. */
  vignette?: boolean
}

/**
 * A linear gradient PNG.
 *
 * The angle is honoured by projecting each pixel onto the gradient axis, which
 * keeps the maths trivial while still giving the generator something that looks
 * deliberate rather than a flat wash.
 */
export function gradientPng(options: GradientOptions): Buffer {
  const size = Math.max(2, Math.min(options.size ?? 32, 256))
  const from = parseHex(options.from)
  const to = parseHex(options.to)
  const radians = ((options.angle ?? 90) * Math.PI) / 180
  const dx = Math.cos(radians)
  const dy = Math.sin(radians)

  const pixels = Buffer.alloc(size * size * 4)

  // Project every pixel onto the gradient axis, then normalise.
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  const projections = new Float32Array(size * size)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const nx = (x / (size - 1)) * 2 - 1
      const ny = (y / (size - 1)) * 2 - 1
      const projection = nx * dx + ny * dy
      projections[y * size + x] = projection
      min = Math.min(min, projection)
      max = Math.max(max, projection)
    }
  }

  const span = max - min || 1

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const t = (projections[y * size + x] - min) / span
      const colour = mix(from, to, t)

      let alpha = 255
      if (options.vignette) {
        const nx = (x / (size - 1)) * 2 - 1
        const ny = (y / (size - 1)) * 2 - 1
        const distance = Math.min(1, Math.sqrt(nx * nx + ny * ny))
        alpha = Math.round(255 * (1 - distance * 0.35))
      }

      const offset = (y * size + x) * 4
      pixels[offset] = Math.round(colour.r)
      pixels[offset + 1] = Math.round(colour.g)
      pixels[offset + 2] = Math.round(colour.b)
      pixels[offset + 3] = alpha
    }
  }

  return encodePng(size, size, pixels)
}
