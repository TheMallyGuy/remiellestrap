import type {
  AccentId,
  BootstrapStyle,
  Settings,
  FlagValue,
} from "$lib/types";

/** Roblox deployment channels (selection order). */
export const CHANNELS = ["LIVE", "zcanary", "znext"] as const;

/** Booru art slots. */
export const ART_SLOTS = ["splash", "home_banner", "sidebar"] as const;
export type ArtSlot = (typeof ART_SLOTS)[number];

/** Default tag set per slot (overridable in Appearance). */
export const DEFAULT_SLOT_TAGS: Record<ArtSlot, string> = {
  splash: "remielle_dan solo",
  home_banner: "remielle_dan",
  sidebar: "remielle_dan solo",
};

export const ART_SLOT_LABELS: Record<ArtSlot, string> = {
  splash: "Splash (Curtain Call)",
  home_banner: "Home banner",
  sidebar: "Sidebar",
};

export const ACCENTS: { id: AccentId; name: string; desc: string }[] = [
  { id: "voidflare", name: "Voidflare", desc: "Luminous gold — the canon accent" },
  { id: "lumen", name: "Lumen", desc: "Cold silver-white lumiflux" },
  { id: "aurora", name: "Aurora", desc: "Cool iridescent prisms" },
];

export const BOOTSTRAP_STYLES: {
  id: BootstrapStyle;
  name: string;
  desc: string;
}[] = [
  { id: "curtain_call", name: "Curtain Call", desc: "Full-window overlay with splash art" },
  { id: "classic", name: "Classic", desc: "Art full-bleed with an operations pane" },
  { id: "minimal", name: "Minimal", desc: "No art — progress only" },
];

export const DISCORD_APP_ID_PLACEHOLDER = "1281932102909956117";

export function defaultSettings(): Settings {
  return {
    appearance: {
      accent: "voidflare",
      bootstrap_style: "curtain_call",
      booru_tags: {},
    },
    behaviour: {
      channel: "LIVE",
      multi_instance: false,
      auto_close: false,
      confirm_launch: false,
      force_language: "",
      auto_rejoin: false,
    },
    integrations: {
      discord_rpc: false,
      discord_client_id: DISCORD_APP_ID_PLACEHOLDER,
      discord_show_game: true,
      discord_show_elapsed: true,
      discord_show_details: true,
    },
    fast_flags: {
      profiles: [
        {
          name: "Default",
          flags: [
            { key: "FFlagDebugDisableTelemetry", value: { type: "bool", value: true } },
          ],
        },
      ],
      active_profile: "Default",
    },
    mods: {
      enabled: [],
    },
    installation: {
      versions_dir: "",
      downloads_dir: "",
    },
  };
}

/** Derive a UI editor type from an arbitrary JSON-ish value. */
export function flagTypeOf(value: unknown): FlagValue["type"] {
  if (typeof value === "boolean") return "bool";
  if (typeof value === "number") return "number";
  return "string";
}
