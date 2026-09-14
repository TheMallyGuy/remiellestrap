import { createServer, type Server } from 'http'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import type { OperationResult, StudioBridgeInfo, StudioBridgeReport } from '@shared/models'
import { createLogger } from '../utils/logger'
import { ensureDir, pathExistsSync } from '../utils/fs'
import { robloxPluginsDirectory } from '../utils/paths'
import { emit } from './events'
import { getSettings } from './settingsStore'
import { clearStudioPresence, setStudioPresence } from './rpc'

/**
 * Roblox Studio presence bridge (scaffold).
 *
 * Studio cannot be observed the way the player is: it writes no discoverable
 * log, and there is no supported way to ask it what is open. What *is*
 * supported is working from the other side — a small loopback HTTP listener
 * that a companion Studio plugin posts to.
 *
 * The contract, documented for plugin authors in `docs/studio-bridge.md`:
 *
 *   GET  /status    -> { ok: true, app: "RemielleStrap", port }
 *   POST /presence    { placeName, placeId?, placeVersion?, studioVersion?, authoring? }
 *   POST /clear
 *
 * The listener binds to 127.0.0.1 only, caps bodies at 4 KiB, and never
 * executes anything it receives: the payload is validated field by field and
 * then published to the renderer and to the Discord client.
 */

const logger = createLogger('StudioBridge')

const MAX_BODY_BYTES = 4096
const PRESENCE_TTL_MS = 45_000
const PLUGIN_FILE_NAME = 'RemielleStrap Presence.client.lua'

let server: Server | null = null
let report: StudioBridgeReport | null = null
let expiryTimer: NodeJS.Timeout | null = null
let lastError: string | null = null

export function pluginPath(): string {
  return join(robloxPluginsDirectory(), PLUGIN_FILE_NAME)
}

export function pluginInstalled(): boolean {
  return pathExistsSync(pluginPath())
}

export function bridgeInfo(): StudioBridgeInfo {
  const settings = getSettings()

  return {
    enabled: settings.studioBridgeEnabled,
    port: Math.min(Math.max(settings.studioBridgePort, 1024), 65535),
    listening: server !== null,
    pluginInstalled: pluginInstalled(),
    pluginPath: pluginPath(),
    lastReportAt: report?.at ?? null,
    placeName: report?.placeName ?? null,
    placeId: report?.placeId ?? null,
    scriptName: report?.scriptName ?? null,
    lineCount: report?.lineCount ?? null
  }
}

export function bridgeError(): string | null {
  return lastError
}

/**
 * Validates a report.
 *
 * Only `placeName` is required; everything else is optional because a plugin
 * may legitimately know less than the launcher would like (an unsaved place has
 * no id, for instance).
 */
function sanitize(payload: unknown): StudioBridgeReport | null {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as Record<string, unknown>

  const name = record.placeName ?? record.name ?? record.place
  if (typeof name !== 'string' || name.trim().length === 0) return null

  const placeIdRaw = record.placeId ?? record.place_id
  const placeId =
    typeof placeIdRaw === 'number'
      ? String(Math.trunc(placeIdRaw))
      : typeof placeIdRaw === 'string' && /^\d+$/.test(placeIdRaw.trim())
        ? placeIdRaw.trim()
        : null

  const placeVersionRaw = record.placeVersion ?? record.version
  const scriptNameRaw = record.scriptName ?? record.script
  const lineCountRaw = record.lineCount ?? record.line

  return {
    placeName: name.trim().slice(0, 120),
    placeId,
    placeVersion:
      typeof placeVersionRaw === 'number'
        ? Math.trunc(placeVersionRaw)
        : typeof placeVersionRaw === 'string' && /^\d+$/.test(placeVersionRaw)
          ? Number.parseInt(placeVersionRaw, 10)
          : null,
    studioVersion: typeof record.studioVersion === 'string' ? record.studioVersion.slice(0, 32) : null,
    authoring: typeof record.authoring === 'boolean' ? record.authoring : true,
    scriptName: typeof scriptNameRaw === 'string' ? scriptNameRaw.slice(0, 120) : null,
    lineCount:
      typeof lineCountRaw === 'number'
        ? Math.trunc(lineCountRaw)
        : typeof lineCountRaw === 'string' && /^\d+$/.test(lineCountRaw)
          ? Number.parseInt(lineCountRaw, 10)
          : null,
    at: Date.now()
  }
}

function readBody(request: NodeJS.ReadableStream & { destroy: () => void }): Promise<string> {
  return new Promise((resolve) => {
    let size = 0
    const chunks: Buffer[] = []

    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        request.destroy()
        resolve('')
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', () => resolve(''))
  })
}

function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer)

  // Studio gives plugins no reliable unload hook, so a session that stops
  // reporting is treated as over rather than shown forever.
  expiryTimer = setTimeout(() => {
    report = null
    void clearStudioPresence()
    emit('studio:bridge', bridgeInfo())
  }, PRESENCE_TTL_MS)
}

export async function start(): Promise<StudioBridgeInfo> {
  const settings = getSettings()

  if (!settings.studioBridgeEnabled) {
    stop()
    return bridgeInfo()
  }

  if (server) return bridgeInfo()

  const port = Math.min(Math.max(settings.studioBridgePort, 1024), 65535)

  return new Promise((resolve) => {
    const instance = createServer((request, response) => {
      const url = request.url ?? '/'

      if (request.method === 'GET' && url.startsWith('/status')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true, app: 'RemielleStrap', port }))
        return
      }

      if (request.method !== 'POST') {
        response.writeHead(405).end()
        return
      }

      void readBody(request).then((body) => {
        if (url.startsWith('/clear')) {
          report = null
          void clearStudioPresence()
          emit('studio:bridge', bridgeInfo())
          response.writeHead(204).end()
          return
        }

        if (!url.startsWith('/presence')) {
          response.writeHead(404).end()
          return
        }

        let parsed: unknown = null
        try {
          parsed = JSON.parse(body)
        } catch {
          response.writeHead(400, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: false, error: 'The body must be JSON' }))
          return
        }

        const next = sanitize(parsed)
        if (!next) {
          response.writeHead(422, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ ok: false, error: 'placeName is required' }))
          return
        }

        report = next
        lastError = null

        if (getSettings().studioRpc) {
          void setStudioPresence(next)
        }

        emit('studio:bridge', bridgeInfo())
        scheduleExpiry()

        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ ok: true }))
      })
    })

    instance.on('error', (error: NodeJS.ErrnoException) => {
      lastError =
        error.code === 'EADDRINUSE'
          ? `Port ${port} is already in use. Choose another port in Settings → Integrations.`
          : error.message

      logger.warn(`The Studio bridge could not start: ${lastError}`)
      emit('studio:bridge', bridgeInfo())
      resolve(bridgeInfo())
    })

    instance.listen(port, '127.0.0.1', () => {
      server = instance
      lastError = null
      logger.info(`Studio bridge listening on 127.0.0.1:${port}`)
      emit('studio:bridge', bridgeInfo())
      resolve(bridgeInfo())
    })
  })
}

export function stop(): void {
  if (expiryTimer) {
    clearTimeout(expiryTimer)
    expiryTimer = null
  }

  if (server) {
    server.close()
    server = null
  }

  report = null
  emit('studio:bridge', bridgeInfo())
}

/** Applies the settings toggle and port at runtime. */
export async function sync(): Promise<StudioBridgeInfo> {
  const settings = getSettings()

  if (!settings.studioBridgeEnabled) {
    stop()
    return bridgeInfo()
  }

  // A port change needs a fresh listener.
  if (server) stop()
  return start()
}

/**
 * Writes the companion plugin into Studio's local Plugins folder.
 *
 * Studio loads `*.lua` files from there as plugins, so no build step is needed
 * and the user can read exactly what will run before it runs.
 */
export async function installPlugin(): Promise<OperationResult<StudioBridgeInfo>> {
  const port = Math.min(Math.max(getSettings().studioBridgePort, 1024), 65535)
  const directory = robloxPluginsDirectory()

  try {
    await ensureDir(directory)
  } catch (error) {
    return {
      ok: false,
      error: `Studio's Plugins folder could not be created: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }

  const source = `--[[
	RemielleStrap presence bridge.

	Installed by RemielleStrap. It posts the place you have open to the launcher
	on 127.0.0.1 (port ${port}) so the Discord presence and the launcher's Studio
	indicator can follow along. It sends nothing else and never leaves the
	machine. Delete this file to stop it.
]]

local PORT = ${port}
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local endpoint = string.format("http://127.0.0.1:%d", PORT)

local function publish()
	local payload = HttpService:JSONEncode({
		placeName = game.Name ~= "" and game.Name or "Untitled place",
		placeId = game.PlaceId,
		placeVersion = game.PlaceVersion,
		authoring = RunService:IsEdit(),
	})

	local ok, err = pcall(function()
		HttpService:PostAsync(endpoint .. "/presence", payload, Enum.HttpContentType.ApplicationJson)
	end)

	if not ok then
		warn("[RemielleStrap] " .. tostring(err))
	end
end

publish()

task.spawn(function()
	while true do
		task.wait(20)
		publish()
	end
end)

game:BindToClose(function()
	pcall(function()
		HttpService:PostAsync(endpoint .. "/clear", "{}", Enum.HttpContentType.ApplicationJson)
	end)
end)
`

  try {
    await writeFile(pluginPath(), source, 'utf8')
    logger.info(`Studio companion plugin written to ${pluginPath()}`)
    await start()
    return { ok: true, data: bridgeInfo() }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The plugin file could not be written'
    }
  }
}

/** The plugin source, so the UI can show what it does without opening a file. */
export function pluginSource(): string {
  return pluginPath()
}
