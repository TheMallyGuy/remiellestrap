<script lang="ts">
  import { activity } from "$lib/stores/activity.svelte";
  import { settings } from "$lib/stores/settings.svelte";

  function fmtElapsed(sec: number): string {
    if (sec < 0) return "00:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // Elapsed time ticks once per second while in-game.
  let now = $state(Date.now());
  $effect(() => {
    if (activity.status !== "in_game") return;
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  const elapsed = $derived(
    activity.joined_at ? Math.floor((now - activity.joined_at * 1000) / 1000) : 0,
  );

  const inGame = $derived(activity.status === "in_game" || activity.status === "joining");
  const gameName = $derived(activity.game_name || "Loading game…");
</script>

<div class="w-[280px] rounded-md bg-void-900 p-4 hairline">
  <!-- profile row -->
  <div class="flex items-center gap-3">
    <div class="relative">
      <div
        class="flex h-10 w-10 items-center justify-center rounded-full"
        style="background: var(--gradient-prism);"
      >
        <span class="text-sm font-bold text-void-950">R</span>
      </div>
      <span
        class="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-void-900"
        style="background: {inGame ? 'var(--color-ok)' : 'var(--color-wing-600)'};"
        aria-hidden="true"
      ></span>
    </div>
    <div class="min-w-0">
      <div class="truncate text-sm font-semibold text-wing-50">RemielleStrap</div>
      <div class="truncate text-xs text-wing-400">
        {#if settings.integrations.discord_rpc}
          Rich presence active
        {:else}
          Rich presence disabled
        {/if}
      </div>
    </div>
  </div>

  <!-- activity row -->
  <div class="mt-4 rounded-md bg-void-800 px-3 py-2.5">
    {#if inGame && settings.integrations.discord_rpc}
      <div class="text-[11px] font-semibold uppercase tracking-wide text-wing-400">
        Playing a game
      </div>
      {#if settings.integrations.discord_show_game}
        <div class="mt-1 truncate text-sm text-wing-50">{gameName}</div>
      {/if}
      {#if settings.integrations.discord_show_elapsed}
        <div class="mt-0.5 font-mono text-xs text-wing-400">{fmtElapsed(elapsed)} elapsed</div>
      {/if}
    {:else}
      <div class="text-xs text-wing-600">No activity to show.</div>
    {/if}
  </div>

  {#if !settings.integrations.discord_rpc}
    <div class="mt-3 text-[11px] leading-snug text-wing-600">
      Enable Discord Rich Presence to see your Roblox session appear on your Discord profile.
    </div>
  {/if}
</div>
