<script lang="ts">
  import { acceleratorLabel } from '@shared/catalog'
  import {
    closePalette,
    movePaletteSelection,
    palette,
    runCommand,
    runSelected,
    setPaletteQuery
  } from '../stores/palette.svelte'
  import { settings } from '../stores/settings.svelte'
  import Icon from './Icon.svelte'

  /**
   * The command palette: a search field, a scored list, and nothing else.
   *
   * It is an overlay in the literal sense — it sits on top of whatever page you
   * were on, it costs one keystroke to summon and one to dismiss, and it never
   * navigates you somewhere you did not ask to go. Rows are ranked by the fuzzy
   * matcher, so the list is short enough to read without scrolling.
   */

  let input = $state<HTMLInputElement | null>(null)
  let list = $state<HTMLDivElement | null>(null)
  let restoreFocus: HTMLElement | null = null

  // Focus moves into the field on open and back to wherever it was on close,
  // which is what makes the palette safe to summon from a half-filled form.
  $effect(() => {
    if (!palette.open) return

    restoreFocus = document.activeElement as HTMLElement | null
    input?.focus()
    input?.select()

    return () => restoreFocus?.focus?.()
  })

  // Keep the selected row visible without scrolling the whole list around.
  $effect(() => {
    const index = palette.selected
    if (!palette.open || !list) return

    list.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  function onkeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        closePalette()
        break
      case 'ArrowDown':
        event.preventDefault()
        movePaletteSelection(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        movePaletteSelection(-1)
        break
      case 'Home':
        if (palette.results.length > 0) {
          event.preventDefault()
          movePaletteSelection(-palette.selected)
        }
        break
      case 'End':
        if (palette.results.length > 0) {
          event.preventDefault()
          movePaletteSelection(palette.results.length - 1 - palette.selected)
        }
        break
      case 'Tab':
        // Trapping Tab keeps the focus inside the palette while it is open.
        event.preventDefault()
        movePaletteSelection(event.shiftKey ? -1 : 1)
        break
      case 'Enter':
        event.preventDefault()
        void runSelected()
        break
      default:
        break
    }
  }
</script>

{#if palette.open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center px-6 pt-[12vh]"
    role="dialog"
    aria-modal="true"
    aria-label="Command palette"
  >
    <button
      type="button"
      class="absolute inset-0 cursor-default bg-ink-950/72 backdrop-blur-[3px]"
      aria-label="Close the palette"
      tabindex="-1"
      onclick={closePalette}
    ></button>

    <div
      class="surface prism-edge relative w-full max-w-xl overflow-hidden shadow-[var(--shadow-float)] animate-fade-up"
    >
      <div class="flex items-center gap-2.5 border-b border-ivory-200/8 px-4 py-3">
        <span class="shrink-0 text-ivory-500" aria-hidden="true">
          <Icon name="search" size={15} />
        </span>

        <input
          bind:this={input}
          type="text"
          class="min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ivory-50 outline-none placeholder:text-ivory-600"
          placeholder="Search pages, launch, switch accounts, toggle mods…"
          aria-label="Search commands"
          aria-controls="palette-list"
          autocomplete="off"
          autocorrect="off"
          spellcheck="false"
          value={palette.query}
          oninput={(event) => setPaletteQuery(event.currentTarget.value)}
          {onkeydown}
        />

        {#if palette.searching}
          <span class="chip shrink-0 text-ivory-500">Searching Roblox…</span>
        {:else}
          <kbd class="chip shrink-0 font-sans">
            {acceleratorLabel(settings.value.paletteHotkey)}
          </kbd>
        {/if}
      </div>

      <div
        bind:this={list}
        id="palette-list"
        class="max-h-[46vh] overflow-y-auto py-1.5"
        role="listbox"
        aria-label="Commands"
      >
        {#each palette.results as command, index (command.id)}
          {@const active = index === palette.selected}
          <button
            type="button"
            data-index={index}
            role="option"
            aria-selected={active}
            class="group relative flex w-full items-start gap-3 px-4 py-2 text-left transition-colors duration-100
              {active ? 'bg-ivory-100/7' : 'hover:bg-ivory-100/4'}"
            onclick={() => void runCommand(command)}
            onmouseenter={() => movePaletteSelection(index - palette.selected)}
            {onkeydown}
            disabled={palette.running !== null}
          >
            <!-- The active marker: the same gold tick the sidebar uses. -->
            <span
              class="absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-gold-400 transition-opacity duration-150 {active
                ? 'opacity-100'
                : 'opacity-0'}"
              aria-hidden="true"
            ></span>

            <span
              class="mt-0.5 shrink-0 {active ? 'text-gold-300/90' : 'text-ivory-500'}"
              aria-hidden="true"
            >
              <Icon name={command.icon} size={15} />
            </span>

            <span class="min-w-0 flex-1">
              <span class="flex items-baseline gap-2">
                <span class="truncate text-[0.8125rem] font-medium text-ivory-100">
                  {command.title}
                </span>

                {#if command.busy || palette.running === command.id}
                  <span class="shrink-0 text-ivory-500 animate-[spin-slow_1.1s_linear_infinite]">
                    <Icon name="spinner" size={11} />
                  </span>
                {/if}
              </span>

              {#if command.hint}
                <span class="mt-0.5 block truncate text-2xs text-ivory-500">{command.hint}</span>
              {/if}
            </span>

            <span class="flex shrink-0 items-center gap-2 self-center">
              {#if command.badge}
                <span class="chip font-mono">{command.badge}</span>
              {/if}
              <span class="text-2xs uppercase tracking-[0.12em] text-ivory-600">
                {command.group}
              </span>
            </span>
          </button>
        {:else}
          <div class="px-4 py-8 text-center">
            <p class="text-[0.8125rem] text-ivory-400">Nothing matches “{palette.query}”.</p>
            <p class="mt-1 text-2xs text-ivory-600">
              Try a page name, an account, a mod, or an experience to launch.
            </p>
          </div>
        {/each}
      </div>

      <footer
        class="flex items-center justify-between gap-4 border-t border-ivory-200/8 px-4 py-2 text-2xs text-ivory-600"
      >
        <span class="flex items-center gap-3">
          <span><kbd class="font-sans">↑</kbd> <kbd class="font-sans">↓</kbd> navigate</span>
          <span><kbd class="font-sans">↵</kbd> run</span>
          <span><kbd class="font-sans">esc</kbd> close</span>
        </span>

        <span class="truncate">
          {palette.results.length}
          {palette.results.length === 1 ? 'command' : 'commands'}
        </span>
      </footer>
    </div>
  </div>
{/if}
