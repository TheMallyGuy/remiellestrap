<script lang="ts">
  let {
    title,
    description,
  }: {
    title: string;
    description?: string;
  } = $props();
</script>

<div class="mb-6">
  <h1 class="font-display text-3xl leading-tight text-wing-50">{title}</h1>
  {#if description}
    <p class="mt-1 text-sm text-wing-400">{description}</p>
  {/if}
  <div class="phase-flow mt-4"></div>
</div>
