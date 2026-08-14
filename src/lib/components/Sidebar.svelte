<script lang="ts">
  import {
    Home,
    Palette,
    SlidersHorizontal,
    Flag,
    Package,
    PlugZap,
    HardDriveDownload,
    Info,
    PanelLeftClose,
    PanelLeftOpen,
  } from "lucide-svelte";
  import BooruArt from "$lib/components/BooruArt.svelte";
  import { NAV_ITEMS, type PageId } from "$lib/nav";
  import { appState, saveAppState } from "$lib/stores/app-state.svelte";

  let { current, onNavigate }: { current: PageId; onNavigate: (p: PageId) => void } =
    $props();

  const icons: Record<PageId, typeof Home> = {
    home: Home,
    appearance: Palette,
    behaviour: SlidersHorizontal,
    fastflags: Flag,
    mods: Package,
    integrations: PlugZap,
    installation: HardDriveDownload,
    about: Info,
  };

  const collapsed = $derived(appState.window.sidebar_collapsed);

  function toggle() {
    appState.window.sidebar_collapsed = !appState.window.sidebar_collapsed;
    void saveAppState();
  }
</script>

<nav
  class="flex shrink-0 flex-col bg-void-900 hairline {collapsed ? 'w-16' : 'w-[232px]'}"
  style="border-top: none; border-bottom: none; border-left: none; transition: width 200ms var(--ease-out);"
  aria-label="Navigation"
>
  <div class="flex items-center justify-between h-14 px-4">
    {#if !collapsed}
      <div class="flex items-center gap-2.5 min-w-0">
        <span class="font-display text-xl text-wing-50 leading-none tracking-wide">Remielle<span class="text-prism">Strap</span></span>
      </div>
    {/if}
    <button
      class="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-wing-400 transition-colors hover:bg-void-800 hover:text-wing-50 focus-flare"
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      onclick={toggle}
    >
      {#if collapsed}
        <PanelLeftOpen size={16} />
      {:else}
        <PanelLeftClose size={16} />
      {/if}
    </button>
  </div>

  <div class="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
    {#each NAV_ITEMS as item (item.id)}
      {@const Icon = icons[item.id]}
      <button
        class="relative flex h-10 w-full items-center gap-3 rounded-md text-sm transition-colors focus-flare {collapsed
          ? 'justify-center px-2'
          : 'px-3'} {current === item.id
          ? 'bg-void-800 text-wing-50'
          : 'text-wing-400 hover:bg-void-800 hover:text-wing-200'}"
        onclick={() => onNavigate(item.id)}
        title={collapsed ? item.label : undefined}
      >
        {#if current === item.id}
          <span
            class="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-flare-500"
            aria-hidden="true"
          ></span>
        {/if}
        <Icon size={18} class="shrink-0" />
        {#if !collapsed}
          <span class="truncate">{item.label}</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if !collapsed}
    <div class="px-2 pb-3">
      <div class="relative h-24 overflow-hidden rounded-lg hairline">
        <BooruArt slot="sidebar" class="h-full w-full" />
        <div
          class="pointer-events-none absolute inset-0 bg-gradient-to-t from-void-900/80 to-transparent"
          aria-hidden="true"
        ></div>
        <span
          class="absolute bottom-1.5 left-2 text-[10px] tracking-wider uppercase text-wing-400"
        >
          Void Hunter
        </span>
      </div>
    </div>
  {/if}
</nav>
