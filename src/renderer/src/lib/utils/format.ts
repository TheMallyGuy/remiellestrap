/**
 * Display formatting helpers. Everything here is pure and locale-light: the
 * app targets one language, so these favour short, predictable output over
 * full Intl machinery.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 1536 -> "1.5 KB" */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes === 0) return '0 B'

  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }

  const decimals = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(decimals)} ${UNITS[unit]}`
}

/** 3_725_000 -> "1h 2m" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—'

  const totalSeconds = Math.floor(ms / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`

  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)

  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

/** A compact absolute timestamp: "14 Aug, 18:42" */
export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '—'

  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'

  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** "just now" / "12m ago" / "3d ago" */
export function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '—'

  const delta = Date.now() - timestamp
  if (delta < 45_000) return 'just now'
  if (delta < 0) return formatDateTime(timestamp)

  const minutes = Math.floor(delta / 60_000)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`

  return formatDateTime(timestamp)
}

/** Shortens a Roblox version GUID for display: "version-824aa258…" */
export function shortVersion(version: string | null | undefined): string {
  if (!version) return '—'
  if (version.length <= 20) return version
  return `${version.slice(0, 19)}…`
}

/** Turns `remielle_dan solo wings` into a readable, comma-separated list. */
export function prettyTags(tags: string | null | undefined, limit = 6): string {
  if (!tags) return ''

  const parts = tags
    .split(/\s+/)
    .filter(Boolean)
    .map((tag) => tag.replace(/_/g, ' '))

  const shown = parts.slice(0, limit).join(', ')
  return parts.length > limit ? `${shown} +${parts.length - limit}` : shown
}

/** Clamps a fractional progress value into a percentage string. */
export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`
}

/** Truncates a filesystem path in the middle so both ends stay readable. */
export function ellipsisPath(path: string | null | undefined, max = 52): string {
  if (!path) return '—'
  if (path.length <= max) return path

  const keep = Math.floor((max - 1) / 2)
  return `${path.slice(0, keep)}…${path.slice(-keep)}`
}

/** Formats a place id as a readable label when no game name is known. */
export function placeLabel(name: string | null, placeId: string | null): string {
  if (name) return name
  if (placeId) return `Place ${placeId}`
  return 'Unknown experience'
}
