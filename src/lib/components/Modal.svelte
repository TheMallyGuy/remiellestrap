<script lang="ts">
  import { X } from "lucide-svelte";
  import type { Snippet } from "svelte";

  let {
    open,
    title,
    onClose,
    children,
    footer,
  }: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: Snippet;
    footer?: Snippet;
  } = $props();
</script>

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-void-950/70 p-6 backdrop-blur-sm"
    onclick={(e: MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    }}
    onkeydown={(e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    }}
    role="presentation"
  >
    <div
      class="fade-up w-full max-w-[440px] rounded-lg bg-void-800 hairline shadow-3"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabindex="-1"
    >
      <div class="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
        <h2 class="font-display text-xl text-wing-50">{title}</h2>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-md text-wing-400 transition-colors hover:bg-void-700 hover:text-wing-50 focus-flare"
          aria-label="Close"
          onclick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      <div class="px-5 py-4 text-sm text-wing-200">
        {@render children()}
      </div>
      {#if footer}
        <div class="flex justify-end gap-2 border-t border-white/[0.07] px-5 py-3.5">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
