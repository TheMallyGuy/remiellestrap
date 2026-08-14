<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { Minus, Square, X, Copy } from "lucide-svelte";

  let { title = "RemielleStrap", subtitle = "" }: { title?: string; subtitle?: string } =
    $props();

  const win = getCurrentWindow();
  let maximized = $state(false);
  let unlisten: (() => void) | undefined;

  $effect(() => {
    win.onResized(async () => {
      maximized = await win.isMaximized();
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  });

  function minimize() {
    void win.minimize();
  }

  function toggleMaximize() {
    void win.toggleMaximize();
  }

  function close() {
    void win.close();
  }
</script>

<header
  class="flex h-10 shrink-0 items-stretch border-b hairline bg-void-950/80"
  style="border-top: none; border-left: none; border-right: none;"
>
  <div
    data-tauri-drag-region
    class="flex flex-1 items-center gap-3 px-4 min-w-0"
  >
    <div class="flex items-center gap-2 min-w-0">
      <span
        class="text-[11px] tracking-[0.18em] uppercase text-wing-400 font-medium"
      >
        {title}
      </span>
      {#if subtitle}
        <span class="h-3 w-px bg-void-600" aria-hidden="true"></span>
        <span class="text-xs text-wing-600 truncate">{subtitle}</span>
      {/if}
    </div>
  </div>

  <div class="flex items-stretch shrink-0">
    <button
      class="flex w-[46px] items-center justify-center text-wing-400 transition-colors hover:bg-void-700 hover:text-wing-50 focus-flare"
      aria-label="Minimize"
      onclick={minimize}
    >
      <Minus size={16} />
    </button>
    <button
      class="flex w-[46px] items-center justify-center text-wing-400 transition-colors hover:bg-void-700 hover:text-wing-50 focus-flare"
      aria-label={maximized ? "Restore" : "Maximize"}
      onclick={toggleMaximize}
    >
      {#if maximized}
        <Copy size={13} />
      {:else}
        <Square size={13} />
      {/if}
    </button>
    <button
      class="flex w-[46px] items-center justify-center text-wing-400 transition-colors hover:bg-err hover:text-white focus-flare"
      aria-label="Close"
      onclick={close}
    >
      <X size={16} />
    </button>
  </div>
</header>
