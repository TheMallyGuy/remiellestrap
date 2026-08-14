<script lang="ts">
  /**
   * A compact toggle. Rendered as a real checkbox so keyboard and screen
   * reader behaviour comes for free; the visual track is a sibling element.
   */

  interface Props {
    checked: boolean
    onchange: (value: boolean) => void
    disabled?: boolean
    label?: string
    id?: string
  }

  const { checked, onchange, disabled = false, label, id }: Props = $props()
</script>

<label
  class="relative inline-flex shrink-0 items-center {disabled
    ? 'cursor-not-allowed opacity-45'
    : 'cursor-pointer'}"
>
  <input
    {id}
    type="checkbox"
    class="peer sr-only"
    {checked}
    {disabled}
    aria-label={label}
    onchange={(event) => onchange(event.currentTarget.checked)}
  />

  <span
    class="h-[20px] w-[34px] rounded-full border border-ivory-200/12 bg-ink-950/70 transition-colors duration-200 peer-checked:border-gold-500/50 peer-checked:bg-gold-500/25 peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold-400/70"
  ></span>

  <span
    class="pointer-events-none absolute left-[3px] h-[14px] w-[14px] rounded-full bg-ivory-400 shadow-sm transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] peer-checked:left-[17px] peer-checked:bg-gold-200"
  ></span>
</label>
