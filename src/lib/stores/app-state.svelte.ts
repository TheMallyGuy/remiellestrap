import { api } from "$lib/ipc";
import type { AppState } from "$lib/types";

const defaultState = (): AppState => ({
  window: {
    width: 1120,
    height: 720,
    x: -1,
    y: -1,
    maximized: false,
    sidebar_collapsed: false,
  },
  booru_slots: {},
  last_played: null,
});

export const appState = $state<AppState>(defaultState());

let loaded = $state(false);

export function isAppStateLoaded() {
  return loaded;
}

export async function loadAppState() {
  try {
    Object.assign(appState, await api.app_state_get());
  } catch {
    /* keep defaults */
  } finally {
    loaded = true;
  }
}

export async function saveAppState() {
  await api.app_state_update(appState);
}
