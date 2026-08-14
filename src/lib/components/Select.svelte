<script lang="ts">
  let {
    value,
    options,
    onChange,
    id,
  }: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (v: string) => void;
    id?: string;
  } = $props();
</script>

<select
  {id}
  value={value}
  onchange={(e) => onChange(e.currentTarget.value)}
  class="focus-flare h-10 rounded-md bg-void-700 px-3 text-base text-wing-50 outline-none transition-[border-color,box-shadow] border border-white/[0.07] focus:border-flare-500 focus:shadow-flare"
>
  {#each options as opt (opt.value)}
    <option value={opt.value} class="bg-void-800 text-wing-200">{opt.label}</option>
  {/each}
</select>
