<script lang="ts">
  import { fade, scale } from 'svelte/transition'
  import type { ConfirmOptions } from '../types'
  import Icon from './../components/Icon.svelte'

  /**
   * A modal confirmation. Used for anything destructive — deleting a mod,
   * resetting settings, uninstalling Roblox.
   */

  interface Props {
    open: boolean
    options: ConfirmOptions
    onconfirm: () => void
    oncancel: () => void
    busy?: boolean
  }

  const { open, options, onconfirm, oncancel, busy = false }: Props = $props()

  let dialog = $state<HTMLDivElement | null>(null)

  // Focus the dialog when it appears so Escape and Tab are captured.
  $effect(() => {
    if (open && dialog) dialog.focus()
  })

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !busy) {
      event.stopPropagation()
      oncancel()
    }
  }
</script>

{#if open}
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-ink-950/70 p-6 backdrop-blur-sm"
    transition:fade={{ duration: 150 }}
  >
    <!-- Clicking the backdrop cancels; the panel stops propagation. -->
    <button
      type="button"
      class="absolute inset-0 cursor-default"
      onclick={() => !busy && oncancel()}
      tabindex="-1"
      aria-label="Cancel"
    ></button>

    <div
      bind:this={dialog}
      class="surface prism-edge relative w-full max-w-sm p-5 shadow-float"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      tabindex="-1"
      {onkeydown}
      transition:scale={{ duration: 170, start: 0.97 }}
    >
      <div class="flex items-start gap-3.5">
        <span
          class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border {options.danger
            ? 'border-negative/30 bg-negative/10 text-negative'
            : 'border-gold-500/30 bg-gold-500/10 text-gold-300'}"
        >
          <Icon name={options.danger ? 'alert' : 'info'} size={15} />
        </span>

        <div class="min-w-0 flex-1">
          <h2 id="confirm-title" class="text-sm font-medium text-ivory-50">{options.title}</h2>
          <p
            id="confirm-message"
            class="mt-1.5 text-xs leading-relaxed text-ivory-400 text-balance-pretty"
          >
            {options.message}
          </p>
        </div>
      </div>

      <div class="mt-5 flex justify-end gap-2">
        <button type="button" class="btn-ghost" onclick={oncancel} disabled={busy}>
          {options.cancelLabel ?? 'Cancel'}
        </button>

        <button
          type="button"
          class={options.danger ? 'btn-danger' : 'btn-primary'}
          onclick={onconfirm}
          disabled={busy}
        >
          {#if busy}
            <Icon name="spinner" size={13} class="animate-spin" />
          {/if}
          {options.confirmLabel ?? 'Confirm'}
        </button>
      </div>
    </div>
  </div>
{/if}
