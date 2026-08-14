import { api } from "$lib/ipc";
import type { ModInfo } from "$lib/types";

export const mods = $state<ModInfo[]>([]);
let loaded = $state(false);

export async function loadMods() {
  try {
    mods.splice(0, mods.length, ...(await api.mods_list()));
  } catch {
    /* ignore */
  } finally {
    loaded = true;
  }
}

export function isModsLoaded() {
  return loaded;
}

export async function setModEnabled(name: string, enabled: boolean) {
  await api.mods_set_enabled(name, enabled);
  await loadMods();
}

export async function reorderMods(names: string[]) {
  await api.mods_reorder(names);
  await loadMods();
}

export async function deleteMod(name: string) {
  await api.mods_delete(name);
  await loadMods();
}

export async function importMod(path: string) {
  await api.mods_import(path);
  await loadMods();
}
