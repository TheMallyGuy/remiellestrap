import { api } from "$lib/ipc";
import { defaultSettings } from "$lib/const";
import type { Settings } from "$lib/types";

export const settings = $state<Settings>(defaultSettings());

let loaded = $state(false);
let error = $state<string | null>(null);

export function isSettingsLoaded() {
  return loaded;
}
export function settingsError() {
  return error;
}

export async function loadSettings() {
  error = null;
  try {
    Object.assign(settings, await api.settings_get());
  } catch (e) {
    error = String(e);
  } finally {
    loaded = true;
  }
}

/** Persist the full settings object. */
export async function saveSettings(next?: Settings) {
  if (next) Object.assign(settings, next);
  await api.settings_update(settings);
}

/** Apply a deep-ish patch helper for ergonomic updates. */
export async function patchSettings(patch: Partial<Settings>) {
  Object.assign(settings, { ...settings, ...patch });
  await saveSettings();
}

export async function resetSettings() {
  Object.assign(settings, await api.settings_reset());
}
