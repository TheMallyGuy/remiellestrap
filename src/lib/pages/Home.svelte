<script lang="ts">
  import { onMount } from "svelte";
  import { Play, Clock3, CircleDot, Layers } from "lucide-svelte";
  import BooruArt from "$lib/components/BooruArt.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { api } from "$lib/ipc";
  import { settings } from "$lib/stores/settings.svelte";
  import { appState } from "$lib/stores/app-state.svelte";
  import { startBootstrap, getStatus } from "$lib/stores/bootstrap.svelte";
  import type { RobloxState, AppInfo } from "$lib/types";

  let roblox = $state<RobloxState | null>(null);
  let appInfo = $state<AppInfo | null>(null);
  let confirmOpen = $state(false);

  onMount(async () => {
    try {
      [roblox, appInfo] = await Promise.all([
        api.roblox_state_get(),
        api.app_get_info(),
      ]);
    } catch {
      /* ignore */
    }
  });

  const busy = $derived(getStatus().state === "working");
  const lastPlayed = $derived(appState.last_played);

  function launch() {
    if (settings.behaviour.confirm_launch) {
      confirmOpen = true;
    } else {
      void startBootstrap(null, false);
    }
  }

  function confirmLaunch() {
    confirmOpen = false;
    void startBootstrap(null, false);
  }

  function fmtDate(ts: number): string {
    try {
      return new Date(ts * 1000).toLocaleString();
    } catch {
      return "—";
    }
  }
</script>

<div class="flex flex-col gap-6">
  <!-- Hero banner -->
  <section class="relative h-[280px] w-full overflow-hidden rounded-xl hairline">
    <BooruArt slot="home_banner" fit="cover" class="h-full w-full" />
    <div
      class="pointer-events-none absolute inset-0 bg-gradient-to-t from-void-950 via-void-950/30 to-transparent"
      aria-hidden="true"
    ></div>

    <div class="absolute inset-x-0 bottom-0 flex items-end justify-between gap-6 p-7">
      <div>
        <p class="text-[11px] uppercase tracking-[0.2em] text-wing-400">RemielleStrap</p>
        <h2 class="mt-1 font-display text-4xl leading-tight text-wing-50">Welcome back</h2>
        <p class="mt-1 text-sm text-wing-400">
          Step through the Hollow — your Roblox client, prepared with grace.
        </p>
      </div>
      <button
        class="btn-primary focus-flare h-10 shrink-0 rounded-md px-6 text-sm"
        disabled={busy}
        onclick={launch}
      >
        <span class="inline-flex items-center gap-2">
          <Play size={15} />
          {busy ? "Launching…" : "Launch Roblox"}
        </span>
      </button>
    </div>
  </section>

  <div class="phase-flow"></div>

  <!-- Status chips -->
  <section class="flex flex-wrap gap-3">
    <div class="flex items-center gap-2 rounded-md bg-void-800 hairline px-3 py-2 text-sm text-wing-200">
      <CircleDot size={14} class="text-flare-500" />
      <span class="text-wing-400">Channel</span>
      <span class="font-mono text-wing-50">{roblox?.channel ?? settings.behaviour.channel}</span>
    </div>
    <div class="flex items-center gap-2 rounded-md bg-void-800 hairline px-3 py-2 text-sm text-wing-200">
      <Layers size={14} class="text-flare-500" />
      <span class="text-wing-400">Version</span>
      {#if roblox?.installed_guid}
        <span class="font-mono text-wing-50 truncate max-w-[240px]" title={roblox.installed_guid}>
          {roblox.installed_guid}
        </span>
      {:else}
        <span class="text-wing-600">not installed</span>
      {/if}
    </div>
    <div class="flex items-center gap-2 rounded-md bg-void-800 hairline px-3 py-2 text-sm text-wing-200">
      <span class="text-wing-400">Launcher</span>
      <span class="font-mono text-wing-50">v{appInfo?.version ?? "—"}</span>
    </div>
  </section>

  <!-- Last played -->
  <section>
    <div class="mb-3 flex items-center gap-2">
      <Clock3 size={15} class="text-wing-400" />
      <h3 class="font-display text-xl text-wing-50">Last played</h3>
      <span class="h-[2px] w-8 rounded-full bg-flare-500" aria-hidden="true"></span>
    </div>
    {#if lastPlayed}
      <div class="card-hover flex items-center justify-between rounded-lg bg-void-800 hairline px-5 py-4">
        <div class="min-w-0">
          <div class="truncate text-wing-50">{lastPlayed.name || `Place ${lastPlayed.place_id}`}</div>
          <div class="mt-0.5 font-mono text-xs text-wing-400">
            place {lastPlayed.place_id} · {fmtDate(lastPlayed.at)}
          </div>
        </div>
        <button
          class="btn-secondary focus-flare h-9 rounded-md px-4 text-sm"
          onclick={() => startBootstrap(`roblox://placeId=${lastPlayed.place_id}`, false)}
        >
          Rejoin
        </button>
      </div>
    {:else}
      <div class="rounded-lg bg-void-800 hairline px-5 py-6 text-center text-sm text-wing-600">
        No recent sessions yet — launch Roblox to begin.
      </div>
    {/if}
  </section>
</div>

<Modal open={confirmOpen} title="Launch Roblox?" onClose={() => (confirmOpen = false)}>
  <p>
    Roblox will be checked for updates, patched with your mods and FastFlags, then launched.
    Continue?
  </p>

  {#snippet footer()}
    <button class="btn-ghost focus-flare rounded-md px-4 py-2 text-sm" onclick={() => (confirmOpen = false)}>
      Cancel
    </button>
    <button class="btn-primary focus-flare rounded-md px-4 py-2 text-sm" onclick={confirmLaunch}>
      Launch
    </button>
  {/snippet}
</Modal>
