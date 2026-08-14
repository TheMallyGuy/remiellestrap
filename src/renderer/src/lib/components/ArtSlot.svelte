<script lang="ts">
  import type { ArtSlot as Slot } from '@shared/settings'
  import { artSlot, loadArt } from '../stores/art.svelte'
  import { api } from '../ipc'
  import { prettyTags } from '../utils/format'
  import Icon from './Icon.svelte'

  /**
   * Renders one Remielle art slot.
   *
   * The image always comes from the local cache over `app://` — never a
   * hotlink — and every slot carries its Safebooru post id as an attribution
   * chip that opens the source page. While loading, a shimmering skeleton
   * holds the layout; if Safebooru is unreachable the slot degrades to a quiet
   * prism-tinted panel rather than a broken image.
   */

  interface Props {
    slot: Slot
    class?: string
    /** Vertical focus of the crop, e.g. '38%' to favour a character's face. */
    focus?: string
    /** Show the post-id attribution chip. */
    attribution?: boolean
    /** Show the shuffle control on hover. */
    shuffle?: boolean
    /** Dim the artwork so overlaid text stays legible. */
    scrim?: 'none' | 'soft' | 'strong'
    /** Slow parallax drift, used on large hero areas. */
    drift?: boolean
    rounded?: string
  }

  const {
    slot,
    class: className = '',
    focus = '50%',
    attribution = true,
    shuffle = true,
    scrim = 'soft',
    drift = false,
    rounded = 'rounded-card'
  }: Props = $props()

  const slotState = $derived(artSlot(slot))
  const asset = $derived(slotState.asset)

  let shuffling = $state(false)

  async function onShuffle(event: MouseEvent): Promise<void> {
    event.stopPropagation()
    if (shuffling) return

    shuffling = true
    try {
      await loadArt(slot, true)
    } finally {
      shuffling = false
    }
  }

  function openPost(event: MouseEvent): void {
    event.stopPropagation()
    if (asset) void api.booru.openPost(asset.postId)
  }
</script>

<div class="group relative overflow-hidden {rounded} {className}">
  {#if slotState.loading && !asset}
    <div class="skeleton absolute inset-0"></div>
  {:else if asset}
    {#key `${asset.postId}-${slotState.nonce}`}
      <img
        src={asset.url}
        alt=""
        width={asset.width}
        height={asset.height}
        draggable="false"
        class="absolute inset-0 h-full w-full object-cover animate-fade-in {drift
          ? 'animate-drift'
          : ''}"
        style="object-position: 50% {focus};"
      />
    {/key}
  {:else}
    <!-- Fallback: no artwork available. A faint refracted wash, no imagery. -->
    <div
      class="absolute inset-0 bg-ink-850"
      style="background-image:
        radial-gradient(120% 90% at 12% 0%, color-mix(in oklab, var(--color-prism-violet) 9%, transparent), transparent 60%),
        radial-gradient(100% 80% at 88% 100%, color-mix(in oklab, var(--color-prism-cyan) 7%, transparent), transparent 55%);"
    ></div>
    {#if slotState.error}
      <div class="absolute inset-0 flex items-end p-3">
        <span class="chip">
          <Icon name="alert" size={11} />
          {slotState.error}
        </span>
      </div>
    {/if}
  {/if}

  {#if scrim !== 'none'}
    <div
      class="pointer-events-none absolute inset-0 {scrim === 'strong'
        ? 'bg-gradient-to-t from-ink-950/95 via-ink-950/60 to-ink-950/20'
        : 'bg-gradient-to-t from-ink-950/85 via-ink-950/25 to-transparent'}"
    ></div>
  {/if}

  <!-- Inner hairline: keeps art from sitting flush against the panel edge. -->
  <div
    class="pointer-events-none absolute inset-0 {rounded} ring-1 ring-inset ring-ivory-200/10"
  ></div>

  {#if asset && (attribution || shuffle)}
    <div
      class="absolute bottom-2 right-2 flex items-center gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-within:opacity-100"
    >
      {#if attribution}
        <button
          type="button"
          class="chip hover:border-gold-400/40 hover:text-ivory-200 transition-colors"
          onclick={openPost}
          title={prettyTags(asset.tags) || 'View on Safebooru'}
        >
          <Icon name="external" size={10} />
          Safebooru #{asset.postId}
        </button>
      {/if}

      {#if shuffle}
        <button
          type="button"
          class="chip hover:border-gold-400/40 hover:text-ivory-200 transition-colors disabled:opacity-50"
          onclick={onShuffle}
          disabled={shuffling}
          title="Show different artwork"
          aria-label="Shuffle artwork"
        >
          <Icon
            name={shuffling ? 'spinner' : 'shuffle'}
            size={11}
            class={shuffling ? 'animate-spin' : ''}
          />
        </button>
      {/if}
    </div>
  {/if}
</div>
