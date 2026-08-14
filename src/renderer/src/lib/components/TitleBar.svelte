<script lang="ts">
  import { api } from '../ipc'
  import { activity } from '../stores/activity.svelte'
  import { navigation, setMaximized } from '../stores/navigation.svelte'
  import Icon from './Icon.svelte'

  /**
   * The custom frameless titlebar.
   *
   * The whole strip is a drag region; every interactive element opts out with
   * `.no-drag`. On macOS the traffic lights are drawn by the OS (the window
   * uses `hiddenInset`), so our own controls are hidden there and the left
   * padding makes room for them.
   */

  const isMac = navigator.userAgent.includes('Macintosh')

  async function toggleMaximize(): Promise<void> {
    setMaximized(await api.window.maximize())
  }

  /**
   * Double-click-to-maximise is bound imperatively rather than with
   * `ondblclick`. The strip is a landmark, not a control — the real, focusable
   * maximise button lives on the right — so attaching the listener here keeps
   * the OS-native gesture without pretending the header is interactive.
   */
  function dblclickToMaximize(node: HTMLElement): () => void {
    const handler = (): void => void toggleMaximize()
    node.addEventListener('dblclick', handler)
    return () => node.removeEventListener('dblclick', handler)
  }
</script>

<header
  class="drag relative z-30 flex h-9 shrink-0 items-center justify-between border-b border-ivory-200/6 bg-ink-900/80 pr-0 backdrop-blur-xl select-none"
  class:pl-20={isMac}
  class:pl-3={!isMac}
  {@attach dblclickToMaximize}
>
  <div class="flex min-w-0 items-center gap-2.5">
    <span class="text-gold-400/80" aria-hidden="true">
      <Icon name="prism" size={13} />
    </span>

    <span class="display text-[0.8125rem] tracking-[0.2em] text-ivory-300 uppercase">
      Remielle<span class="text-gold-400/90">Strap</span>
    </span>

    {#if activity.value.inGame && activity.value.activity}
      <span class="hidden items-center gap-1.5 sm:flex">
        <span class="h-3 w-px bg-ivory-200/12" aria-hidden="true"></span>
        <span class="h-1.5 w-1.5 rounded-full bg-positive shadow-[0_0_6px] shadow-positive/60"
        ></span>
        <span class="max-w-[22ch] truncate text-2xs text-ivory-400">
          {activity.value.activity.gameName ?? `Place ${activity.value.activity.placeId}`}
        </span>
      </span>
    {:else if activity.value.robloxRunning}
      <span class="hidden items-center gap-1.5 sm:flex">
        <span class="h-3 w-px bg-ivory-200/12" aria-hidden="true"></span>
        <span class="h-1.5 w-1.5 rounded-full bg-caution/80"></span>
        <span class="text-2xs text-ivory-500">Roblox running</span>
      </span>
    {/if}
  </div>

  {#if !isMac}
    <div class="no-drag flex h-full items-stretch">
      <button
        type="button"
        class="flex w-11 items-center justify-center text-ivory-400 transition-colors hover:bg-ivory-100/6 hover:text-ivory-100"
        onclick={() => void api.window.minimize()}
        aria-label="Minimise"
        title="Minimise"
      >
        <Icon name="minus" size={13} />
      </button>

      <button
        type="button"
        class="flex w-11 items-center justify-center text-ivory-400 transition-colors hover:bg-ivory-100/6 hover:text-ivory-100"
        onclick={toggleMaximize}
        aria-label={navigation.maximized ? 'Restore' : 'Maximise'}
        title={navigation.maximized ? 'Restore' : 'Maximise'}
      >
        <Icon name="square" size={navigation.maximized ? 11 : 12} />
      </button>

      <button
        type="button"
        class="flex w-11 items-center justify-center text-ivory-400 transition-colors hover:bg-negative/80 hover:text-ivory-50"
        onclick={() => void api.window.close()}
        aria-label="Close"
        title="Close"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  {:else}
    <div class="w-3"></div>
  {/if}
</header>
