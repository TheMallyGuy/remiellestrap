<script lang="ts">
  import Icon from './Icon.svelte'

  /**
   * A styled native `<select>`. Native is deliberate: the OS popup handles
   * keyboard navigation, overflow and screen readers better than anything
   * hand-rolled, and it never escapes the window bounds.
   */

  interface Option {
    value: string
    label: string
  }

  interface Props {
    value: string
    options: readonly Option[]
    onchange: (value: string) => void
    disabled?: boolean
    id?: string
    label?: string
    class?: string
  }

  const {
    value,
    options,
    onchange,
    disabled = false,
    id,
    label,
    class: className = ''
  }: Props = $props()
</script>

<div class="relative inline-flex items-center {className}">
  <select
    {id}
    {value}
    {disabled}
    aria-label={label}
    class="field w-full cursor-pointer appearance-none py-1.5 pr-8 disabled:cursor-not-allowed disabled:opacity-50"
    onchange={(event) => onchange(event.currentTarget.value)}
  >
    {#each options as option (option.value)}
      <option value={option.value} class="bg-ink-800 text-ivory-100">{option.label}</option>
    {/each}
  </select>

  <Icon
    name="chevron-down"
    size={13}
    class="pointer-events-none absolute right-2.5 text-ivory-500"
  />
</div>
