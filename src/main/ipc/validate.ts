/**
 * Payload validation helpers for IPC handlers.
 *
 * Everything arriving over IPC is untrusted: a compromised renderer could send
 * any shape at all. Handlers use these helpers to coerce arguments into known
 * types and throw a descriptive error otherwise, rather than letting malformed
 * data reach the filesystem or the network layer.
 */

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

function fail(field: string, expected: string): never {
  throw new ValidationError(`Invalid IPC payload: "${field}" must be ${expected}`)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function requireObject(value: unknown, field = 'payload'): Record<string, unknown> {
  if (!isRecord(value)) fail(field, 'an object')
  return value
}

export function requireString(value: unknown, field: string, maxLength = 4096): string {
  if (typeof value !== 'string') fail(field, 'a string')
  if (value.length > maxLength) fail(field, `at most ${maxLength} characters`)
  return value
}

export function requireNonEmptyString(value: unknown, field: string, maxLength = 4096): string {
  const text = requireString(value, field, maxLength).trim()
  if (!text) fail(field, 'a non-empty string')
  return text
}

export function optionalString(
  value: unknown,
  field: string,
  maxLength = 4096
): string | undefined {
  if (value === undefined || value === null) return undefined
  return requireString(value, field, maxLength)
}

export function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') fail(field, 'a boolean')
  return value
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  return requireBoolean(value, field)
}

export function requireInteger(
  value: unknown,
  field: string,
  min = Number.MIN_SAFE_INTEGER,
  max = Number.MAX_SAFE_INTEGER
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    fail(field, 'an integer')
  }
  if (value < min || value > max) fail(field, `between ${min} and ${max}`)
  return value
}

export function optionalInteger(
  value: unknown,
  field: string,
  min?: number,
  max?: number
): number | undefined {
  if (value === undefined || value === null) return undefined
  return requireInteger(value, field, min, max)
}

export function requireStringArray(
  value: unknown,
  field: string,
  maxItems = 1000,
  maxLength = 512
): string[] {
  if (!Array.isArray(value)) fail(field, 'an array of strings')
  if (value.length > maxItems) fail(field, `at most ${maxItems} entries`)
  return value.map((item, index) => requireString(item, `${field}[${index}]`, maxLength))
}

/** A hex colour such as #101014 or #fff. */
export function requireHexColor(value: unknown, field: string): string {
  const text = requireNonEmptyString(value, field, 9)
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) {
    fail(field, 'a hex colour like #101014')
  }
  return text
}
