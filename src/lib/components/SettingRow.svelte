<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    label,
    description,
    children,
  }: {
    label: string;
    description?: string;
    children: Snippet;
  } = $props();
</script>

<div class="flex min-h-[56px] items-center justify-between gap-6 py-2">
  <div class="min-w-0">
    <div class="text-base text-wing-200">{label}</div>
    {#if description}
      <div class="mt-0.5 text-sm text-wing-400">{description}</div>
    {/if}
  </div>
  <div class="flex shrink-0 items-center gap-2">
    {@render children()}
  </div>
</div>
