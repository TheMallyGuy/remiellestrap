<script lang="ts">
  import { settings } from '../stores/settings.svelte'
  import { artSlot } from '../stores/art.svelte'

  /**
   * The window backdrop.
   *
   * Four styles, in increasing order of boldness: nothing, a solid colour, a
   * gradient, an imported image, or a piece of Remielle artwork fetched from
   * the booru. Whatever is chosen sits *behind* everything at low opacity, so
   * text contrast is never a casualty of a busy picture.
   *
   * When the window material is Mica or Acrylic the backdrop is suppressed:
   * the desktop itself is showing through, and painting over it would waste the
   * effect.
   */

  const style = $derived(settings.value.backgroundStyle)
  const effect = $derived(settings.value.windowEffect)
  const transparent = $derived(effect === 'mica' || effect === 'acrylic' || effect === 'blur')

  const art = $derived(artSlot('background'))

  const backgroundImage = $derived(
    style === 'image' && settings.value.backgroundImage
      ? `app://media/${encodeURIComponent(settings.value.backgroundImage)}`
      : style === 'art' && art.asset
        ? art.asset.url
        : null
  )

  const gradient = $derived(
    `linear-gradient(${settings.value.backgroundGradientAngle}deg, ${settings.value.backgroundGradientFrom}, ${settings.value.backgroundGradientTo})`
  )
</script>

{#if style !== 'none' && !transparent}
  <div class="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
    {#if style === 'solid'}
      <div class="absolute inset-0" style="background: {settings.value.backgroundSolid}"></div>
    {:else if style === 'gradient'}
      <div class="absolute inset-0" style="background: {gradient}"></div>
    {:else if backgroundImage}
      <img
        src={backgroundImage}
        alt=""
        class="absolute inset-0 h-full w-full object-cover {settings.value.backgroundAnimate &&
        !settings.value.reduceMotion
          ? 'animate-[drift_22s_ease-in-out_infinite]'
          : ''}"
        style="opacity: {settings.value.backgroundOpacity}; filter: blur({settings.value
          .backgroundBlur}px)"
      />
    {/if}

    <!-- A dark veil keeps text legible over any picture. -->
    <div
      class="absolute inset-0 bg-ink-950/{settings.value.backgroundStyle === 'solid' ? '0' : '55'}"
    ></div>
  </div>
{/if}
