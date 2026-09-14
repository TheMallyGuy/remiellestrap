<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon from './Icon.svelte'

  /**
   * A modal panel.
   *
   * Deliberately plain: a scrim, a surface, a heading and a footer. Everything
   * that makes a dialog *a_ dialog — Escape to close, focus moved into the
   * panel, the page behind it frozen — is handled here so the pages that use it
   * only have to think about content.
   */

  interface Props {
    title: string
    description?: string
    children: Snippet
    /** Buttons, right-aligned. */
    footer?: Snippet
    /** Widen the panel for two-column content. */
    wide?: boolean
    /** Allow closing by clicking the scrim or pressing Escape. */
    dismissable?: boolean
    onclose: () => void
  }

  const {
    title,
    description,
    children,
    footer,
    wide = false,
    dismissable = true,
    onclose
  }: Props = $props()

  let panel = $state<HTMLDivElement | null>(null)
  let restoreFocus: HTMLElement | null = null

  $effect(() => {
    restoreFocus = document.activeElement as HTMLElement | null

    // Focus the first control in the panel so keyboard users start inside it.
    const target = panel?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-close])'
    )
    target?.focus()

    return () => restoreFocus?.focus?.()
  })

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && dismissable) {
      event.stopPropagation()
      onclose()
    }
  }
</script>

<svelte:window {onkeydown} />

<div
  class="fixed inset-0 z-40 flex items-center justify-center p-6"
  role="dialog"
  aria-modal="true"
  aria-label={title}
>
  <!-- The scrim is a button so that a click outside closes the dialog for
       mouse users without adding a global click handler. -->
  <button
    type="button"
    class="absolute inset-0 cursor-default bg-ink-950/70 backdrop-blur-[2px]"
    aria-label="Close"
    tabindex="-1"
    data-close
    onclick={() => dismissable && onclose()}
  ></button>

  <div
    bind:this={panel}
    class="surface relative max-h-[85vh] w-full overflow-y-auto p-5 shadow-[var(--shadow-float,0_24px_60px_-20px_rgb(0_0_0/0.85))] animate-fade-up {wide
      ? 'max-w-3xl'
      : 'max-w-lg'}"
  >
    <header class="mb-4 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <h2 class="text-[0.9375rem] font-medium text-ivory-100">{title}</h2>
        {#if description}
          <p class="mt-1 text-xs leading-relaxed text-ivory-500">{description}</p>
        {/if}
      </div>

      {#if dismissable}
        <button
          type="button"
          class="shrink-0 rounded-control p-1 text-ivory-500 transition-colors hover:bg-ivory-100/6 hover:text-ivory-200"
          aria-label="Close"
          data-close
          onclick={onclose}
        >
          <Icon name="x" size={15} />
        </button>
      {/if}
    </header>

    {@render children()}

    {#if footer}
      <footer class="mt-5 flex items-center justify-end gap-2 border-t border-ivory-200/8 pt-4">
        {@render footer()}
      </footer>
    {/if}
  </div>
</div>
