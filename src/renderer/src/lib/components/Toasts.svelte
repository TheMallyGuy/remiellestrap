<script lang="ts">
  import { fly } from 'svelte/transition'
  import type { IconName } from './icons'
  import { dismissToast, toasts } from '../stores/toasts.svelte'
  import Icon from './Icon.svelte'

  /**
   * The toast stack. Anchored bottom-right, above everything, and never
   * blocking pointer events except on the toasts themselves.
   */

  const ICONS: Record<string, IconName> = {
    info: 'info',
    success: 'check',
    warning: 'alert',
    error: 'alert'
  }

  const ACCENTS: Record<string, string> = {
    info: 'text-ivory-300',
    success: 'text-positive',
    warning: 'text-caution',
    error: 'text-negative'
  }
</script>

<div
  class="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2"
  role="region"
  aria-live="polite"
  aria-label="Notifications"
>
  {#each toasts.value as toast (toast.id)}
    <div
      class="surface prism-edge pointer-events-auto flex items-start gap-3 px-3.5 py-3 shadow-float backdrop-blur-xl"
      transition:fly={{ y: 12, duration: 220 }}
    >
      <span class="mt-px shrink-0 {ACCENTS[toast.kind] ?? 'text-ivory-300'}">
        <Icon name={ICONS[toast.kind] ?? 'info'} size={15} />
      </span>

      <div class="min-w-0 flex-1">
        <p class="text-[0.8125rem] font-medium leading-snug text-ivory-100">{toast.title}</p>
        {#if toast.message}
          <p class="mt-0.5 break-words text-xs leading-relaxed text-ivory-500" data-selectable>
            {toast.message}
          </p>
        {/if}
      </div>

      <button
        type="button"
        class="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-ivory-500 transition-colors hover:text-ivory-100"
        onclick={() => dismissToast(toast.id)}
        aria-label="Dismiss notification"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  {/each}
</div>
