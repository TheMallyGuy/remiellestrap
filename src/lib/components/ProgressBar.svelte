<script lang="ts">
  let {
    value,
    label,
  }: {
    value: number;
    label?: string;
  } = $props();

  const pct = $derived(Math.max(0, Math.min(100, value * 100)));
</script>

<div class="flex items-center gap-3">
  <div class="h-[6px] flex-1 overflow-hidden rounded-full bg-void-700">
    <div
      class="progress-prism h-full rounded-full transition-[width] duration-200"
      style="width: {pct}%;"
    ></div>
  </div>
  {#if label !== undefined}
    <span class="font-mono text-xs text-flare-300 tabular-nums">{label}</span>
  {/if}
</div>
