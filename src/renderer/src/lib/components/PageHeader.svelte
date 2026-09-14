<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * The title block at the top of every page. The display serif here is the
   * app's strongest type statement and is used nowhere else at this size.
   */

  interface Props {
    title: string
    /** The one-line explanation under the title. */
    subtitle?: string
    /** Alias for `subtitle`, for pages where the wording reads as a lede. */
    lede?: string
    actions?: Snippet
  }

  const { title, subtitle, lede, actions }: Props = $props()
</script>

<header class="mb-7 flex items-end justify-between gap-6 animate-fade-up">
  <div class="min-w-0">
    <h1 class="display text-[1.75rem] leading-tight">{title}</h1>
    {#if subtitle || lede}
      <p class="mt-1 max-w-prose text-[0.8125rem] text-ivory-500 text-balance-pretty">
        {subtitle ?? lede}
      </p>
    {/if}
  </div>

  {#if actions}
    <div class="flex shrink-0 items-center gap-2 pb-1">
      {@render actions()}
    </div>
  {/if}
</header>
