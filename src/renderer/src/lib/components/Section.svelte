<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * A titled group of related settings or content. Sections carry the page's
   * rhythm: eyebrow label, optional lede, then the panel itself.
   */

  interface Props {
    title: string
    description?: string
    children: Snippet
    /** Right-aligned controls in the section header. */
    actions?: Snippet
    /** Render without the surface panel, for full-bleed content. */
    bare?: boolean
    class?: string
  }

  const {
    title,
    description,
    children,
    actions,
    bare = false,
    class: className = ''
  }: Props = $props()
</script>

<section class="animate-fade-up {className}">
  <header class="mb-3 flex items-end justify-between gap-4">
    <div class="min-w-0">
      <h2 class="eyebrow">{title}</h2>
      {#if description}
        <p class="mt-1.5 max-w-prose text-xs leading-relaxed text-ivory-500 text-balance-pretty">
          {description}
        </p>
      {/if}
    </div>

    {#if actions}
      <div class="flex shrink-0 items-center gap-2">
        {@render actions()}
      </div>
    {/if}
  </header>

  {#if bare}
    {@render children()}
  {:else}
    <div class="surface px-4 py-1">
      {@render children()}
    </div>
  {/if}
</section>
