<script lang="ts">
  import type { Snippet } from 'svelte'

  /**
   * One setting: a title, an explanation, and a control on the right.
   *
   * Rows are deliberately airy and separated by hairlines rather than boxed in
   * a table — the goal is a written page of options, not a spreadsheet.
   */

  interface Props {
    title: string
    description?: string
    /** The control. */
    children: Snippet
    /** Extra content below the row, e.g. an expanded editor. */
    expanded?: Snippet
    /** Stack the control beneath the text (for wide controls). */
    stacked?: boolean
    warning?: string
    for?: string
  }

  const {
    title,
    description,
    children,
    expanded,
    stacked = false,
    warning,
    for: htmlFor
  }: Props = $props()
</script>

<div class="border-b border-ivory-200/6 py-3.5 last:border-b-0">
  <div class={stacked ? 'block' : 'flex items-start justify-between gap-6'}>
    <div class="min-w-0 {stacked ? 'mb-2.5' : 'flex-1'}">
      <label
        class="block text-[0.8125rem] font-medium text-ivory-100 {htmlFor ? 'cursor-pointer' : ''}"
        for={htmlFor}
      >
        {title}
      </label>

      {#if description}
        <p class="mt-0.5 max-w-prose text-xs leading-relaxed text-ivory-500 text-balance-pretty">
          {description}
        </p>
      {/if}

      {#if warning}
        <p class="mt-1.5 flex items-start gap-1.5 text-xs text-caution/90">
          <span aria-hidden="true">·</span>
          {warning}
        </p>
      {/if}
    </div>

    <div class={stacked ? '' : 'flex shrink-0 items-center gap-2 pt-0.5'}>
      {@render children()}
    </div>
  </div>

  {#if expanded}
    <div class="mt-3">
      {@render expanded()}
    </div>
  {/if}
</div>
