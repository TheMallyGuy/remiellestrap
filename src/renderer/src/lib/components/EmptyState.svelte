<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { IconName } from './icons'
  import Icon from './Icon.svelte'

  /**
   * Shown where a list has nothing in it yet. Quiet by design: a thin outlined
   * glyph, a sentence, and at most one action.
   */

  interface Props {
    icon: IconName
    title: string
    message?: string
    action?: Snippet
    class?: string
  }

  const { icon, title, message, action, class: className = '' }: Props = $props()
</script>

<div
  class="flex flex-col items-center justify-center rounded-card border border-dashed border-ivory-200/10 px-6 py-12 text-center {className}"
>
  <div
    class="mb-3.5 flex h-11 w-11 items-center justify-center rounded-full border border-ivory-200/10 bg-ink-950/50 text-ivory-500"
  >
    <Icon name={icon} size={19} />
  </div>

  <p class="text-sm text-ivory-200">{title}</p>

  {#if message}
    <p class="mt-1 max-w-sm text-xs leading-relaxed text-ivory-500 text-balance-pretty">
      {message}
    </p>
  {/if}

  {#if action}
    <div class="mt-4">
      {@render action()}
    </div>
  {/if}
</div>
