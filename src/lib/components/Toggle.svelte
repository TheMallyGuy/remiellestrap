<script lang="ts">
  let {
    checked,
    onChange,
    disabled = false,
    label,
  }: {
    checked: boolean;
    onChange: (v: boolean) => void;
    disabled?: boolean;
    label?: string;
  } = $props();

  function toggle() {
    if (!disabled) onChange(!checked);
  }
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  aria-label={label}
  disabled={disabled}
  onclick={toggle}
  class="relative h-[22px] w-10 shrink-0 rounded-full transition-colors duration-200 focus-flare disabled:opacity-50"
  style="background: {checked ? 'var(--color-flare-500)' : 'var(--color-void-600)'};"
>
  <span
    class="toggle-thumb absolute top-[3px] left-[3px] h-4 w-4 rounded-full"
    style="background: {checked ? 'var(--color-void-950)' : 'var(--color-wing-600)'}; transform: {checked ? 'translateX(18px)' : 'translateX(0)'};"
    aria-hidden="true"
  ></span>
</button>
