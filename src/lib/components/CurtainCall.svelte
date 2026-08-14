<script lang="ts">
  import { X } from "lucide-svelte";
  import BooruArt from "$lib/components/BooruArt.svelte";
  import ProgressBar from "$lib/components/ProgressBar.svelte";
  import { getStatus, getProgress, isVisible, cancelBootstrap } from "$lib/stores/bootstrap.svelte";
  import { settings } from "$lib/stores/settings.svelte";

  const STAGE_LABELS: Record<string, string> = {
    checking_version: "Reading the latest deployment…",
    fetching_manifest: "Unfolding the manifest…",
    downloading: "Gathering packages…",
    extracting: "Placing files with care…",
    applying_mods: "Weaving mods into the version…",
    writing_settings: "Inscribing your FastFlags…",
    launching: "Raising the curtain…",
    done: "Curtain call.",
  };

  function stageLabel(stage: string): string {
    return STAGE_LABELS[stage] ?? "Preparing…";
  }

  function fmtBytes(n: number): string {
    if (!isFinite(n) || n <= 0) return "—";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let v = n;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
  }

  function fmtRate(bps: number): string {
    if (!isFinite(bps) || bps <= 0) return "—";
    return `${fmtBytes(bps)}/s`;
  }

  const pct = $derived(Math.round(getProgress().total_progress * 100));
  const rate = $derived(fmtRate(getProgress().bytes_per_sec));

  const style = $derived(settings.appearance.bootstrap_style);
</script>

{#if isVisible()}
  <div class="fixed inset-0 z-40 flex bg-void-950/95 backdrop-blur-md">
    {#if style === "minimal"}
      <div class="fade-up mx-auto flex w-[520px] max-w-[90vw] flex-col justify-center gap-6">
        <p class="font-display text-2xl text-wing-50">{stageLabel(getStatus().message)}</p>
        {#if getProgress().package}
          <p class="font-mono text-sm text-wing-400 truncate">{getProgress().package}</p>
        {/if}
        <ProgressBar value={getProgress().total_progress} label={`${pct}%`} />
        <p class="font-mono text-xs text-wing-400">{rate}</p>
        <button class="btn-ghost focus-flare self-start rounded-md px-3 py-1.5 text-sm" onclick={() => void cancelBootstrap()}>
          Cancel
        </button>
      </div>
    {:else}
      <div class="relative h-full w-1/2 min-w-[320px] overflow-hidden" class:hidden={style === "classic"}>
        <div class="absolute inset-0 slow-zoom">
          <BooruArt slot="splash" fit="contain" shuffleable={false} class="h-full w-full" />
        </div>
        <div class="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent to-void-950/60" aria-hidden="true"></div>
      </div>

      <div class="flex flex-1 flex-col justify-center gap-5 px-12">
        <p class="font-display text-2xl text-wing-50">{stageLabel(getStatus().message)}</p>
        {#if getProgress().package}
          <p class="font-mono text-sm text-wing-400 truncate" title={getProgress().package}>
            {getProgress().package}
          </p>
        {/if}
        <ProgressBar value={getProgress().total_progress} label={`${pct}%`} />
        <div class="flex items-center gap-4">
          <span class="font-mono text-xs text-wing-400">{rate}</span>
        </div>
        <button class="btn-ghost focus-flare self-start rounded-md px-3 py-1.5 text-sm" onclick={() => void cancelBootstrap()}>
          Cancel
        </button>
      </div>
    {/if}
  </div>
{/if}
