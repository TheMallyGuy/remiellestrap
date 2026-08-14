<script lang="ts">
  import { Feather, Dices } from "lucide-svelte";
  import { api, convertFileSrc, openInBrowser } from "$lib/ipc";
  import { getArtRefresh } from "$lib/stores/art.svelte";
  import type { CachedArt } from "$lib/types";

  let {
    slot,
    class: klass = "",
    fit = "cover",
    shuffleable = true,
  }: {
    slot: string;
    class?: string;
    fit?: "cover" | "contain";
    shuffleable?: boolean;
  } = $props();

  type LoadState = "loading" | "ready" | "error";

  let art = $state<CachedArt | null>(null);
  let phase = $state<LoadState>("loading");
  let error = $state("");

  async function load(shuffle: boolean) {
    phase = "loading";
    error = "";
    try {
      art = await api.booru_get_art_for_slot(slot, shuffle);
      phase = "ready";
    } catch (e) {
      error = String(e);
      phase = "error";
    }
  }

  $effect(() => {
    void getArtRefresh(); // re-resolve when the global art cache is shuffled/cleared
    void load(false);
  });
</script>

<div class="relative overflow-hidden bg-void-800 {klass}">
  {#if phase === "ready" && art}
    <img
      src={convertFileSrc(art.local_path)}
      alt="Artwork"
      class="absolute inset-0 h-full w-full select-none"
      style="object-fit: {fit};"
      draggable="false"
    />

    <a
      href={art.post_url}
      class="absolute bottom-2 right-2 flex items-center gap-1 rounded-sm bg-void-950/70 px-1.5 py-0.5 text-[10px] leading-none text-wing-400 backdrop-blur-sm transition-colors hover:text-wing-50 focus-flare"
      title={art.post_url}
      onclick={(e: MouseEvent) => {
        e.preventDefault();
        void openInBrowser(art!.post_url);
      }}
    >
      art: safebooru #{art.id}
    </a>

    {#if shuffleable}
      <button
        class="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-md bg-void-950/60 text-wing-200 backdrop-blur-sm transition-colors hover:bg-void-950/85 hover:text-flare-300 focus-flare"
        aria-label="Shuffle artwork"
        title="Shuffle artwork"
        onclick={() => void load(true)}
      >
        <Dices size={14} />
      </button>
    {/if}
  {:else if phase === "error"}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-2">
      <Feather size={22} class="text-wing-600" />
      <button
        class="btn-ghost focus-flare rounded-md px-3 py-1 text-xs"
        onclick={() => void load(false)}
      >
        Retry
      </button>
    </div>
  {:else}
    <div class="skeleton absolute inset-0 flex items-center justify-center">
      <Feather size={22} class="text-wing-600" />
    </div>
  {/if}
</div>
