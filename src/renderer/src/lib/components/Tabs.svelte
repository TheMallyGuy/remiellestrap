<script lang="ts">
  /**
   * A row of tabs.
   *
   * Rendered as a real tablist so arrow keys move between tabs and the active
   * one is announced. The underline is a single gold rule — the same visual
   * language as the active nav marker in the sidebar.
   */

  interface Props {
    value: string
    /** Ordered id/label pairs; the labels are drawn as given. */
    tabs: readonly { id: string; label: string; hint?: string }[]
    onchange: (id: string) => void
  }

  const { value, tabs, onchange }: Props = $props()

  function onkeydown(event: KeyboardEvent, index: number): void {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (delta === 0) return

    event.preventDefault()
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    onchange(next.id)

    // Move focus with the selection, which is what a tablist should do.
    const list = (event.currentTarget as HTMLElement).parentElement
    const buttons = list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[tabs.findIndex((tab) => tab.id === next.id)]?.focus()
  }
</script>

<div class="mb-4 flex items-center gap-1 border-b border-ivory-200/8" role="tablist">
  {#each tabs as tab, index (tab.id)}
    {@const active = tab.id === value}
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={tab.hint}
      class="-mb-px border-b-2 px-3 py-2 text-[0.8125rem] transition-colors duration-150
        {active
        ? 'border-gold-400/80 text-ivory-50'
        : 'border-transparent text-ivory-500 hover:text-ivory-200'}"
      onclick={() => onchange(tab.id)}
      onkeydown={(event) => onkeydown(event, index)}
    >
      {tab.label}
    </button>
  {/each}
</div>
