import type { FlagAllowlistEntry, FlagPreset, FlagValue } from '@shared/models'
import { DISABLE_CAPTURE_FLAGS, VOICE_CHAT_FLAGS } from '@shared/catalog'

/**
 * The built-in FastFlag allowlist and the presets built on top of it.
 *
 * This is a *snapshot*: Roblox adds and retires flags constantly and each
 * client version validates its own set. The list exists so the UI can say
 * "this one is known and safe-ish" versus "nobody has ever heard of this",
 * which is the difference between a tweak and a crash-to-desktop. It can be
 * refreshed from a remote source (see `flagAllowlistUrl` in settings) and any
 * remote entry is merged over these.
 *
 * Risk levels:
 *   safe     — widely used, easy to revert, no known client breakage.
 *   caution  — affects rendering, input or networking; can look wrong.
 *   advanced — can change how the client behaves in ways that are hard to
 *              diagnose, or that Roblox may treat as tampering.
 */

function entry(
  name: string,
  category: string,
  description: string,
  kind: FlagAllowlistEntry['kind'],
  risk: FlagAllowlistEntry['risk'],
  extras: Partial<FlagAllowlistEntry> = {}
): FlagAllowlistEntry {
  return {
    name,
    category,
    description,
    kind,
    defaultValue: null,
    min: null,
    max: null,
    options: [],
    risk,
    presets: [],
    ...extras
  }
}

const CAPTURE_ENTRIES: FlagAllowlistEntry[] = Object.keys(DISABLE_CAPTURE_FLAGS).map((name) =>
  entry(name, 'Privacy', 'Turns part of Roblox\u2019s screenshot/video capture pipeline off.', 'boolean', 'caution')
)

const VOICE_ENTRIES: FlagAllowlistEntry[] = Object.keys(VOICE_CHAT_FLAGS).map((name) =>
  entry(name, 'Voice chat', 'Enables the client-side voice chat capability.', 'boolean', 'caution')
)

export const BUILTIN_ALLOWLIST: readonly FlagAllowlistEntry[] = [
  /* Rendering / graphics */
  entry('FFlagDebugGraphicsPreferD3D11', 'Graphics', 'Force the Direct3D 11 renderer instead of the default.', 'boolean', 'caution'),
  entry('FFlagDebugGraphicsPreferVulkan', 'Graphics', 'Force the Vulkan renderer where the driver exposes it.', 'boolean', 'caution'),
  entry('FFlagDebugGraphicsPreferOpenGL', 'Graphics', 'Force the OpenGL renderer.', 'boolean', 'caution'),
  entry('FFlagDebugGraphicsDisableDirect3D11', 'Graphics', 'Disable the Direct3D 11 renderer entirely.', 'boolean', 'advanced'),
  entry('FFlagDebugGraphicsDisableMetal', 'Graphics', 'Disable the Metal renderer (macOS).', 'boolean', 'advanced'),
  entry('FFlagGraphicsDisableVulkan', 'Graphics', 'Disable Vulkan even when the driver offers it.', 'boolean', 'caution'),
  entry('DFIntDebugFRMQualityLevelOverride', 'Graphics', 'Override the visual quality level (1\u201310).', 'number', 'caution', {
    min: 1,
    max: 10,
    defaultValue: 10
  }),
  entry('FIntRenderShadowIntensity', 'Graphics', 'Shadow darkness, 0 disables shadows.', 'number', 'safe', {
    min: 0,
    max: 100,
    defaultValue: 100
  }),
  entry('DFFlagTextureQualityOverrideEnabled', 'Graphics', 'Enable the texture quality override below.', 'boolean', 'safe'),
  entry('DFIntTextureQualityOverride', 'Graphics', 'Texture quality level (0\u20133).', 'number', 'safe', {
    min: 0,
    max: 3,
    defaultValue: 3
  }),
  entry('FFlagDisablePostFx', 'Graphics', 'Skip post-processing effects such as bloom and depth of field.', 'boolean', 'safe'),
  entry('FFlagDisableTerrainMotionBlur', 'Graphics', 'Disable motion blur on terrain.', 'boolean', 'safe'),
  entry('DFIntDebugFRMQualityLevel', 'Graphics', 'Legacy quality level override.', 'number', 'caution', { min: 1, max: 10 }),
  entry('FFlagRenderGuiTextureQuality', 'Graphics', 'Higher quality UI textures in some clients.', 'boolean', 'safe'),

  /* Performance */
  entry('DFIntTaskSchedulerTargetFps', 'Performance', 'Unlocks the framerate cap. 0 means "no cap" on most clients.', 'number', 'safe', {
    min: 0,
    max: 10_000,
    defaultValue: 60
  }),
  entry('FFlagTaskSchedulerTargetFpsEnabled', 'Performance', 'Enable the framerate target above.', 'boolean', 'safe'),
  entry('FFlagDisableDPIScale', 'Performance', 'Ignore the display scaling factor, which can help on high-DPI screens.', 'boolean', 'caution'),
  entry('FFlagHandleAltEnterFullscreenManually', 'Performance', 'Let the client handle Alt+Enter itself instead of the window manager.', 'boolean', 'safe'),
  entry('DFIntMaxDownloadThreads', 'Performance', 'Number of parallel asset download threads.', 'number', 'advanced', {
    min: 1,
    max: 32
  }),
  entry('DFIntPhysicsEnvironmentSpeed', 'Performance', 'Scales physics stepping; a value other than 1 changes simulation behaviour.', 'number', 'advanced', {
    min: 0.5,
    max: 2
  }),
  entry('FFlagLuaAppEnableFontCache', 'Performance', 'Cache client fonts between screens.', 'boolean', 'safe'),

  /* Networking */
  entry('DFIntConnectionMTUSize', 'Networking', 'Override the maximum transmission unit used by the client.', 'number', 'advanced', {
    min: 576,
    max: 1500
  }),
  entry('DFIntHttpThrottleErrorCodes', 'Networking', 'Tune how aggressively the client backs off on HTTP errors.', 'number', 'advanced'),
  entry('FIntRakNetResendBufferArrayLength', 'Networking', 'Size of the reliable packet resend buffer.', 'number', 'advanced', { min: 16, max: 4096 }),
  entry('FFlagEnableBetterNetworkErrors', 'Networking', 'More descriptive disconnect messages.', 'boolean', 'safe'),
  entry('DFIntNetworkPingIntervalMS', 'Networking', 'How often the client reports its ping.', 'number', 'caution', { min: 250, max: 10_000 }),

  /* User interface */
  entry('FFlagEnableInGameMenuV1Update', 'Interface', 'Newer in-game menu layout on clients that support it.', 'boolean', 'safe'),
  entry('FFlagDisableInGameMenuFade', 'Interface', 'Open the in-game menu without the fade animation.', 'boolean', 'safe'),
  entry('FFlagChatTransparencyEnabled', 'Interface', 'Translucent chat window.', 'boolean', 'safe'),
  entry('FIntChatDefaultWindowTransparency', 'Interface', 'Default chat transparency, 0\u20131.', 'number', 'safe', { min: 0, max: 1 }),
  entry('FFlagHideChatBarEnabled', 'Interface', 'Hide the chat input bar until it is focused.', 'boolean', 'safe'),
  entry('DFFlagDisableVIPUpsell', 'Interface', 'Hide premium upsell prompts.', 'boolean', 'safe'),
  entry('FFlagRemoveVoiceIndicator', 'Interface', 'Hide the microphone indicator overlay.', 'boolean', 'caution'),

  /* Privacy */
  entry('FFlagDisableTelemetry', 'Privacy', 'Disable the client telemetry reporter.', 'boolean', 'advanced'),
  entry('DFFlagDisableCrashReporting', 'Privacy', 'Do not send crash reports.', 'boolean', 'caution'),
  ...CAPTURE_ENTRIES,

  /* Voice chat */
  ...VOICE_ENTRIES,

  /* Client behaviour */
  entry('FFlagDebugDisableLegacyTweening', 'Client', 'Use the newer tween implementation everywhere.', 'boolean', 'advanced'),
  entry('FFlagDisableControllerEmulation', 'Client', 'Ignore gamepad input.', 'boolean', 'caution'),
  entry('DFFlagDisableGamepadCursor', 'Client', 'Disable the gamepad cursor.', 'boolean', 'safe'),
  entry('FFlagUserSoundEnabled', 'Client', 'Master switch for client sound.', 'boolean', 'safe'),
  entry('FFlagEnableMouseLockOption', 'Client', 'Show the Shift Lock option in settings.', 'boolean', 'safe'),
  entry('FFlagDebugAlwaysDisplayFPS', 'Client', 'Always show the framerate counter.', 'boolean', 'safe'),
  entry('FFlagDebugDisplayFPS', 'Client', 'Show the framerate counter overlay.', 'boolean', 'safe'),
  entry('DFIntDebugResetPhysicsOnTeleport', 'Client', 'Reset physics state when teleporting; can fix some glitches.', 'boolean', 'advanced'),
  entry('FFlagUseOptimizedPhysics', 'Client', 'Use the optimised physics solver.', 'boolean', 'advanced'),
  entry('FFlagIXPServiceEnabled', 'Client', 'Enable the in-experience purchase service.', 'boolean', 'caution'),
  entry('DFFlagDiscordRichPresence', 'Client', 'Toggle the client\u2019s own Discord presence (independent of the launcher\u2019s).', 'boolean', 'safe')
]

/**
 * Presets. Each one only touches flags that appear in the allowlist above, so
 * applying a preset can never introduce an unknown flag.
 */
export const FLAG_PRESETS: readonly FlagPreset[] = [
  {
    id: 'fps-unlocked',
    name: 'Unlock the framerate',
    description: 'Removes the 60 FPS ceiling and lets the client use as many frames as the display allows.',
    category: 'Performance',
    risk: 'safe',
    flags: {
      FFlagTaskSchedulerTargetFpsEnabled: true,
      DFIntTaskSchedulerTargetFps: 0
    }
  },
  {
    id: 'fps-144',
    name: 'Cap at 144 FPS',
    description: 'A higher but still bounded framerate target. Good for high-refresh laptops.',
    category: 'Performance',
    risk: 'safe',
    flags: {
      FFlagTaskSchedulerTargetFpsEnabled: true,
      DFIntTaskSchedulerTargetFps: 144
    }
  },
  {
    id: 'performance-low',
    name: 'Favour performance',
    description: 'Turns off post-processing and shadow intensity in exchange for frames.',
    category: 'Performance',
    risk: 'safe',
    flags: {
      FFlagDisablePostFx: true,
      FIntRenderShadowIntensity: 0,
      DFIntDebugFRMQualityLevelOverride: 3
    }
  },
  {
    id: 'quality-high',
    name: 'Favour quality',
    description: 'Maximum texture quality and full shadow intensity.',
    category: 'Graphics',
    risk: 'safe',
    flags: {
      DFFlagTextureQualityOverrideEnabled: true,
      DFIntTextureQualityOverride: 3,
      DFIntDebugFRMQualityLevelOverride: 10,
      FIntRenderShadowIntensity: 100
    }
  },
  {
    id: 'd3d11',
    name: 'Prefer Direct3D 11',
    description: 'Forces the Direct3D 11 renderer. Useful when a driver update breaks the default one.',
    category: 'Graphics',
    risk: 'caution',
    flags: {
      FFlagDebugGraphicsPreferD3D11: true
    }
  },
  {
    id: 'privacy',
    name: 'Quieter client',
    description: 'Disables telemetry, crash reporting, screenshot/video capture and premium upsells.',
    category: 'Privacy',
    risk: 'caution',
    flags: {
      FFlagDisableTelemetry: true,
      DFFlagDisableCrashReporting: true,
      DFFlagDisableVIPUpsell: true,
      ...DISABLE_CAPTURE_FLAGS
    }
  },
  {
    id: 'voice-chat',
    name: 'Enable voice chat flags',
    description: 'Turns on the client-side voice chat capability flags. Server eligibility still applies.',
    category: 'Voice chat',
    risk: 'caution',
    flags: { ...VOICE_CHAT_FLAGS }
  },
  {
    id: 'interface-clean',
    name: 'Clean interface',
    description: 'Hides upsells, quietens the chat window and skips the menu fade.',
    category: 'Interface',
    risk: 'safe',
    flags: {
      DFFlagDisableVIPUpsell: true,
      FFlagDisableInGameMenuFade: true,
      FFlagHideChatBarEnabled: true,
      FFlagDebugDisplayFPS: true
    }
  },
  {
    id: 'network-tune',
    name: 'Network tuning',
    description: 'More descriptive disconnects and a larger resend buffer for lossy connections.',
    category: 'Networking',
    risk: 'advanced',
    flags: {
      FFlagEnableBetterNetworkErrors: true,
      FIntRakNetResendBufferArrayLength: 1024
    }
  }
]

/** Every built-in entry, keyed by name. */
export const BUILTIN_ALLOWLIST_MAP: ReadonlyMap<string, FlagAllowlistEntry> = new Map(
  BUILTIN_ALLOWLIST.map((item) => [item.name, item])
)

/**
 * Normalises a remotely supplied allowlist.
 *
 * Accepts the shapes actually seen in the wild: an array of names, an array of
 * objects with a `name`/`FlagName`/`flag` key, and a map of name -> descriptor
 * (Bloxstrap's `FlagList` style uses a bare type string as the descriptor).
 */
export function parseRemoteAllowlist(payload: unknown): FlagAllowlistEntry[] {
  const out: FlagAllowlistEntry[] = []

  const fromName = (name: unknown, descriptor: Record<string, unknown>): void => {
    if (typeof name !== 'string' || !/^[A-Za-z0-9_.]{1,128}$/.test(name)) return

    const type = typeof descriptor.type === 'string' ? descriptor.type.toLowerCase() : ''
    const kind: FlagAllowlistEntry['kind'] =
      descriptor.kind === 'number' || type === 'int' || type === 'float' || type === 'number'
        ? 'number'
        : descriptor.kind === 'string' || type === 'string'
          ? 'string'
          : 'boolean'

    out.push({
      name,
      category: typeof descriptor.category === 'string' ? descriptor.category.slice(0, 40) : 'Other',
      description:
        typeof descriptor.description === 'string'
          ? descriptor.description.slice(0, 400)
          : 'Reported by the remote allowlist.',
      kind,
      defaultValue: (descriptor.default ?? descriptor.defaultValue ?? null) as FlagValue | null,
      min: typeof descriptor.min === 'number' ? descriptor.min : null,
      max: typeof descriptor.max === 'number' ? descriptor.max : null,
      options: Array.isArray(descriptor.options)
        ? (descriptor.options.filter(
            (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
          ) as FlagValue[])
        : [],
      risk:
        descriptor.risk === 'safe' || descriptor.risk === 'advanced' || descriptor.risk === 'caution'
          ? descriptor.risk
          : 'caution',
      presets: []
    })
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (typeof item === 'string') {
        fromName(item, {})
        continue
      }
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        fromName(record.name ?? record.FlagName ?? record.flag, record)
      }
    }
    return out
  }

  if (payload && typeof payload === 'object') {
    // Some sources nest the list one level down.
    const root = payload as Record<string, unknown>
    const nested = root.flags ?? root.Flags ?? root.entries ?? root.allowlist
    if (nested && nested !== payload) return parseRemoteAllowlist(nested)

    for (const [name, descriptor] of Object.entries(root)) {
      if (typeof descriptor === 'string') {
        // A bare type string, as Bloxstrap's FlagList uses.
        fromName(name, { type: descriptor })
        continue
      }
      if (descriptor && typeof descriptor === 'object') {
        fromName(name, descriptor as Record<string, unknown>)
      }
    }
  }

  return out
}

/** Merges remote entries over the built-in list, keeping our descriptions. */
export function mergeAllowlist(remote: FlagAllowlistEntry[]): FlagAllowlistEntry[] {
  const merged = new Map<string, FlagAllowlistEntry>(BUILTIN_ALLOWLIST_MAP)

  for (const item of remote) {
    const existing = merged.get(item.name)
    merged.set(
      item.name,
      existing
        ? {
            ...existing,
            kind: item.kind,
            min: item.min ?? existing.min,
            max: item.max ?? existing.max,
            options: item.options.length > 0 ? item.options : existing.options,
            description:
              existing.description && existing.description.length > 0
                ? existing.description
                : item.description
          }
        : item
    )
  }

  // Attach preset membership so the UI can mark which flags a preset owns.
  for (const item of merged.values()) {
    item.presets = FLAG_PRESETS.filter((preset) => item.name in preset.flags).map((preset) => preset.id)
  }

  return [...merged.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
  )
}
