<script lang="ts">
  let {
    value,
    onChange,
    placeholder = "",
    type = "text",
    id,
    error = false,
    mono = false,
    spellcheck = true,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    type?: string;
    id?: string;
    error?: boolean;
    mono?: boolean;
    spellcheck?: boolean;
  } = $props();
</script>

<input
  {id}
  {type}
  {placeholder}
  value={value}
  spellcheck={spellcheck}
  oninput={(e) => onChange(e.currentTarget.value)}
  class="focus-flare h-10 rounded-md bg-void-700 px-3 text-base text-wing-50 outline-none transition-[border-color,box-shadow] border placeholder:text-wing-600 {error
    ? 'border-err'
    : 'border-white/[0.07] focus:border-flare-500 focus:shadow-flare'}"
  class:font-mono={mono}
  class:text-sm={mono}
/>
