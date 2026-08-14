<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    title,
    description,
    children,
    actions,
  }: {
    title: string;
    description?: string;
    children: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<section class="rounded-lg bg-void-800 hairline">
  <header class="flex items-end justify-between gap-4 border-b border-white/[0.07] px-5 pb-3 pt-4">
    <div class="min-w-0">
      <h3 class="font-display text-xl leading-none text-wing-50">{title}</h3>
      <span class="mt-2 block h-[2px] w-8 rounded-full bg-flare-500" aria-hidden="true"></span>
      {#if description}
        <p class="mt-2 text-sm text-wing-400">{description}</p>
      {/if}
    </div>
    {#if actions}
      <div class="flex shrink-0 items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </header>
  <div class="px-5 py-1">
    {@render children()}
  </div>
</section>
