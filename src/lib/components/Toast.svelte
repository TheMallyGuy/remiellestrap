<script lang="ts">
  import { X } from "lucide-svelte";
  import { getToasts, dismiss, type ToastKind } from "$lib/stores/toasts.svelte";

  const colors: Record<ToastKind, string> = {
    ok: "var(--color-ok)",
    warn: "var(--color-warn)",
    err: "var(--color-err)",
    info: "var(--color-info)",
  };
</script>

<div class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[320px] flex-col gap-2">
  {#each getToasts() as t (t.id)}
    <div
      class="toast-in pointer-events-auto relative overflow-hidden rounded-md bg-void-800 hairline shadow-2"
      style="border-left: 3px solid {colors[t.kind]};"
    >
      <div class="flex items-start justify-between gap-2 px-3 py-2.5">
        <div class="min-w-0">
          <div class="text-sm font-medium text-wing-50">{t.title}</div>
          {#if t.message}
            <div class="mt-0.5 text-xs text-wing-400">{t.message}</div>
          {/if}
        </div>
        <button
          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-wing-400 hover:text-wing-50 focus-flare"
          aria-label="Dismiss"
          onclick={() => dismiss(t.id)}
        >
          <X size={12} />
        </button>
      </div>
      <div
        class="toast-in h-[2px] w-full origin-left"
        style="background: {colors[t.kind]}; animation: toast-life 4s linear forwards;"
      ></div>
    </div>
  {/each}
</div>

<style>
  @keyframes toast-life {
    from {
      transform: scaleX(1);
    }
    to {
      transform: scaleX(0);
    }
  }
</style>
