import { copyFile, readFile, writeFile } from 'fs/promises'
import { basename } from 'path'
import type { ClientSettingField, ClientSettingsState } from '@shared/models'
import { createLogger } from '../utils/logger'
import { globalBasicSettingsCandidates } from '../utils/paths'
import { pathExists } from '../utils/fs'
import { isRobloxRunning } from './activity'

/**
 * GlobalBasicSettings editor.
 *
 * Roblox keeps its client settings in an XML document under
 * `%LOCALAPPDATA%\Roblox`. The file is machine-generated and large, so this
 * editor deliberately does the narrowest possible thing:
 *
 *  * it only rewrites the *contents* of elements whose names are on the curated
 *    list below — element names, ordering, comments and unknown nodes are left
 *    byte-for-byte intact;
 *  * it refuses to write while the client is running, because the client
 *    rewrites the whole document on exit and would silently undo the change;
 *  * it takes a `.remielle.bak` copy the first time it touches the file.
 *
 * The curated list is the "safe subset": settings that shape how the client
 * looks and feels without touching anything that could break an install.
 */

const logger = createLogger('ClientSettings')

type FieldKind = 'number' | 'integer' | 'boolean' | 'string'

interface FieldDefinition {
  key: string
  label: string
  description: string
  group: string
  kind: FieldKind
  min: number | null
  max: number | null
  step: number | null
  /** Element names the value may live in, in preference order. */
  elements: string[]
  options?: { value: string; label: string }[]
}

const FIELDS: readonly FieldDefinition[] = [
  {
    key: 'MasterVolume',
    label: 'Master volume',
    description: 'Overall output volume for the client.',
    group: 'Audio',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    elements: ['float']
  },
  {
    key: 'MusicVolume',
    label: 'Music volume',
    description: 'Volume for in-experience music.',
    group: 'Audio',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    elements: ['float']
  },
  {
    key: 'VoiceChatVolume',
    label: 'Voice chat volume',
    description: 'Playback volume for spatial voice chat.',
    group: 'Audio',
    kind: 'number',
    min: 0,
    max: 1,
    step: 0.05,
    elements: ['float']
  },
  {
    key: 'EnableVoiceChat',
    label: 'Voice chat',
    description: 'The client-side voice chat switch.',
    group: 'Audio',
    kind: 'boolean',
    min: null,
    max: null,
    step: null,
    elements: ['bool']
  },
  {
    key: 'SavedQualityLevel',
    label: 'Graphics quality',
    description: 'Quality preset the client restores on launch (1–10).',
    group: 'Graphics',
    kind: 'integer',
    min: 1,
    max: 10,
    step: 1,
    elements: ['int', 'token']
  },
  {
    key: 'GraphicsQualityLevel',
    label: 'Graphics quality (legacy)',
    description: 'Older clients store the same value under this name.',
    group: 'Graphics',
    kind: 'integer',
    min: 1,
    max: 10,
    step: 1,
    elements: ['int', 'token']
  },
  {
    key: 'Fullscreen',
    label: 'Start fullscreen',
    description: 'Whether the client opens fullscreen by default.',
    group: 'Window',
    kind: 'boolean',
    min: null,
    max: null,
    step: null,
    elements: ['bool']
  },
  {
    key: 'MouseSensitivity',
    label: 'Mouse sensitivity',
    description: 'Default camera sensitivity.',
    group: 'Input',
    kind: 'number',
    min: 0,
    max: 10,
    step: 0.05,
    elements: ['float']
  },
  {
    key: 'GameLocale',
    label: 'Game locale',
    description: 'Language the client asks experiences for.',
    group: 'Language',
    kind: 'string',
    min: null,
    max: null,
    step: null,
    elements: ['string'],
    options: [
      { value: 'en_us', label: 'English (US)' },
      { value: 'en_gb', label: 'English (UK)' },
      { value: 'de_de', label: 'Deutsch' },
      { value: 'es_es', label: 'Español' },
      { value: 'fr_fr', label: 'Français' },
      { value: 'ja_jp', label: '日本語' },
      { value: 'ko_kr', label: '한국어' },
      { value: 'pt_br', label: 'Português (Brasil)' },
      { value: 'zh_cn', label: '简体中文' }
    ]
  },
  {
    key: 'CameraMode',
    label: 'Camera mode',
    description: 'Default camera behaviour: classic, follow or orbital.',
    group: 'Camera',
    kind: 'string',
    min: null,
    max: null,
    step: null,
    elements: ['string', 'token'],
    options: [
      { value: '0', label: 'Classic' },
      { value: '1', label: 'Follow' },
      { value: '2', label: 'Orbital' }
    ]
  },
  {
    key: 'RotationType',
    label: 'Camera rotation',
    description: 'How the camera rotates with movement.',
    group: 'Camera',
    kind: 'string',
    min: null,
    max: null,
    step: null,
    elements: ['string', 'token'],
    options: [
      { value: '0', label: 'Movement direction' },
      { value: '1', label: 'Camera direction' }
    ]
  }
]

function catalogue(): ClientSettingField[] {
  return FIELDS.map((field) => ({
    key: field.key,
    label: field.label,
    description: field.description,
    group: field.group,
    kind: field.kind === 'boolean' ? 'boolean' : field.kind === 'string' ? 'select' : 'number',
    min: field.min,
    max: field.max,
    step: field.step,
    options: field.options ?? []
  }))
}

async function findFile(): Promise<string | null> {
  for (const candidate of globalBasicSettingsCandidates()) {
    if (await pathExists(candidate)) return candidate
  }
  return null
}

interface ParsedValue {
  element: string
  raw: string
  value: unknown
}

const VALUE_PATTERN = /<(\w+)\s+name="([A-Za-z0-9_]+)"\s*>([^<]*)<\/\1>/g

function parse(xml: string): Map<string, ParsedValue> {
  const values = new Map<string, ParsedValue>()

  for (const match of xml.matchAll(VALUE_PATTERN)) {
    const [, element, name, raw] = match
    const definition = FIELDS.find((field) => field.key === name)
    if (!definition) continue

    let value: unknown = raw

    if (element === 'bool') value = /^(true|1)$/i.test(raw.trim())
    else if (element === 'float' || element === 'double') {
      const parsed = Number.parseFloat(raw)
      value = Number.isFinite(parsed) ? parsed : raw
    } else if (element === 'int' || element === 'token') {
      const parsed = Number.parseInt(raw, 10)
      value = Number.isFinite(parsed) ? parsed : raw
    }

    values.set(name, { element, raw, value })
  }

  return values
}

export async function readClientSettings(): Promise<ClientSettingsState> {
  const file = await findFile()

  if (!file) {
    return {
      present: false,
      path: null,
      values: {},
      fields: catalogue(),
      sizeBytes: 0,
      error:
        'GlobalBasicSettings.xml was not found. Launch Roblox once so the client writes its settings file.',
      readOnly: true
    }
  }

  try {
    const xml = await readFile(file, 'utf8')
    const parsed = parse(xml)
    const values: Record<string, unknown> = {}
    for (const [key, entry] of parsed) values[key] = entry.value

    return {
      present: true,
      path: file,
      values,
      fields: catalogue(),
      sizeBytes: Buffer.byteLength(xml, 'utf8'),
      // The client overwrites the document on exit, so the editor is only
      // usable while it is closed.
      readOnly: await isRobloxRunning(),
      error: null
    }
  } catch (error) {
    return {
      present: true,
      path: file,
      values: {},
      fields: catalogue(),
      sizeBytes: 0,
      error: error instanceof Error ? error.message : 'The settings file could not be read',
      readOnly: true
    }
  }
}

function serialize(definition: FieldDefinition, value: unknown): string | null {
  if (definition.kind === 'boolean') {
    if (typeof value !== 'boolean') return null
    return value ? 'true' : 'false'
  }

  if (definition.kind === 'number' || definition.kind === 'integer') {
    const numeric = typeof value === 'number' ? value : Number.parseFloat(String(value))
    if (!Number.isFinite(numeric)) return null

    const clamped = Math.min(
      Math.max(numeric, definition.min ?? numeric),
      definition.max ?? numeric
    )

    return definition.kind === 'integer' ? String(Math.round(clamped)) : clamped.toFixed(3)
  }

  const text = String(value ?? '').trim()
  if (text.length === 0 || text.length > 64) return null
  if (/[<>&]/.test(text)) return null
  return text
}

/**
 * Applies a patch. Returns the refreshed state plus the keys that were ignored
 * — a key the client does not use is reported rather than invented, because
 * adding a node Roblox does not expect is how these files get corrupted.
 */
export async function writeClientSettings(
  patch: Record<string, unknown>
): Promise<ClientSettingsState & { skipped: string[] }> {
  const state = await readClientSettings()
  const skipped: string[] = []

  if (!state.path) return { ...state, skipped: Object.keys(patch) }

  if (await isRobloxRunning()) {
    return {
      ...state,
      readOnly: true,
      error:
        'Close Roblox first — it rewrites its settings file on exit and would undo this change.',
      skipped: Object.keys(patch)
    }
  }

  let xml = await readFile(state.path, 'utf8')
  let changed = 0

  for (const [key, value] of Object.entries(patch)) {
    const definition = FIELDS.find((field) => field.key === key)
    if (!definition) {
      skipped.push(key)
      continue
    }

    const serialized = serialize(definition, value)
    if (serialized === null) {
      skipped.push(key)
      continue
    }

    const pattern = new RegExp(
      `(<(${definition.elements.join('|')})\\s+name="${key}"\\s*>)([^<]*)(</\\2>)`
    )

    if (!pattern.test(xml)) {
      skipped.push(key)
      continue
    }

    xml = xml.replace(
      pattern,
      (_match, open: string, _element: string, _old: string, close: string) => {
        changed += 1
        return `${open}${serialized}${close}`
      }
    )
  }

  if (changed === 0) {
    return {
      ...state,
      skipped,
      error: skipped.length > 0 ? 'None of those values exist in this client build' : null
    }
  }

  try {
    const backup = `${state.path}.remielle.bak`
    if (!(await pathExists(backup))) await copyFile(state.path, backup)

    await writeFile(state.path, xml, 'utf8')
    logger.info(`Wrote ${changed} client setting(s) to ${basename(state.path)}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error(`Could not write client settings: ${message}`)
    return { ...state, error: message, skipped }
  }

  return { ...(await readClientSettings()), skipped }
}

/** Restores the backup taken before the first edit made here. */
export async function restoreClientSettingsBackup(): Promise<ClientSettingsState> {
  const state = await readClientSettings()
  if (!state.path) return state

  const backup = `${state.path}.remielle.bak`
  if (!(await pathExists(backup))) {
    return { ...state, error: 'There is no backup from RemielleStrap to restore yet' }
  }

  if (await isRobloxRunning()) {
    return { ...state, error: 'Close Roblox before restoring its settings file' }
  }

  try {
    await copyFile(backup, state.path)
    logger.info('Restored GlobalBasicSettings from the RemielleStrap backup')
  } catch (error) {
    return {
      ...state,
      error: error instanceof Error ? error.message : 'Could not restore the backup'
    }
  }

  return readClientSettings()
}

/** Backups taken by this editor, for the About/diagnostics view. */
export async function hasBackup(): Promise<boolean> {
  const file = await findFile()
  return file ? pathExists(`${file}.remielle.bak`) : false
}
