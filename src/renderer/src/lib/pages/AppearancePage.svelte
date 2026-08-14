<script lang="ts">
  import type { AccentMode, ArtSlot as Slot, ThemeMode } from '@shared/settings'
  import { ART_SLOTS, DEFAULT_BOORU_TAGS } from '@shared/settings'
  import { api, errorMessage } from '../ipc'
  import { artSlot, forgetAllArt, loadAllArt, loadArt } from '../stores/art.svelte'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import { formatBytes, prettyTags } from '../utils/format'
  import ArtSlot from '../components/ArtSlot.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'
  import type { CacheStats } from '@shared/models'

  /**
   * Appearance: theme, accent, and the Safebooru art pipeline.
   *
   * Every slot's tag query is editable here, because the whole point of the
   * runtime pipeline is that the art is not baked into the app.
   */

  const SLOT_LABELS: Record<Slot, { title: string; description: string }> = {
    home_banner: {
      title: 'Home banner',
      description: 'The wide header on the Home page. Wide artwork works best.'
    },
    splash: {
      title: 'Splash',
      description: 'Shown while the app is starting up.'
    },
    sidebar: {
      title: 'Sidebar portrait',
      description: 'The tall portrait at the foot of the navigation rail.'
    },
    about_header: {
      title: 'About header',
      description: 'The banner on the About page.'
    },
    bootstrapper: {
      title: 'Bootstrapper',
      description: 'Full-bleed artwork behind the install and launch window.'
    }
  }

  const THEMES: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'Match system' }
  ]

  const ACCENTS: { value: AccentMode; label: string; hint: string }[] = [
    { value: 'gold', label: 'Soft gold', hint: 'A single warm accent. Calm and legible.' },
    { value: 'prism', label: 'Prism', hint: "Remielle's refraction, used as a faint iridescence." }
  ]

  /** Local draft of each slot's tag query so typing does not save on every key. */
  let drafts = $state<Record<string, string>>({})
  let stats = $state<CacheStats | null>(null)
  let clearing = $state(false)
  let refreshing = $state(false)

  $effect(() => {
    // Seed drafts from settings once they arrive, without clobbering edits.
    for (const slot of ART_SLOTS) {
      drafts[slot] ??= settings.value.booruTags[slot] ?? DEFAULT_BOORU_TAGS[slot]
    }
  })

  $effect(() => {
    void refreshStats()
  })

  async function refreshStats(): Promise<void> {
    try {
      stats = await api.booru.getCacheStats()
    } catch {
      stats = null
    }
  }

  async function commitTags(slot: Slot): Promise<void> {
    const next = (drafts[slot] ?? '').trim()
    const currentValue = settings.value.booruTags[slot] ?? ''
    if (next === currentValue) return

    if (next.length === 0) {
      drafts[slot] = currentValue
      pushToast({ kind: 'warning', title: 'A tag query cannot be empty' })
      return
    }

    await updateSettings({
      booruTags: { ...settings.value.booruTags, [slot]: next },
      // A new query invalidates the pinned post for that slot.
      chosenBooruPosts: { ...settings.value.chosenBooruPosts, [slot]: null }
    })

    await loadArt(slot, true)
    void refreshStats()
  }

  function resetTags(slot: Slot): void {
    drafts[slot] = DEFAULT_BOORU_TAGS[slot]
    void commitTags(slot)
  }

  async function fetchNewArtwork(): Promise<void> {
    if (refreshing) return
    refreshing = true

    try {
      // Keep requests sequential so Safebooru is not hit with a burst of five
      // searches and image downloads at once.
      for (const slot of ART_SLOTS) await loadArt(slot, true)
      await refreshStats()

      const loaded = ART_SLOTS.filter((slot) => Boolean(artSlot(slot).asset)).length
      pushToast({
        kind: loaded > 0 ? 'success' : 'warning',
        title: loaded > 0 ? 'Fetched new artwork from Safebooru' : 'No new artwork was found',
        message:
          loaded > 0 ? `Updated ${loaded} of ${ART_SLOTS.length} appearance slots.` : undefined
      })
    } finally {
      refreshing = false
    }
  }

  async function clearCache(): Promise<void> {
    clearing = true

    try {
      stats = await api.booru.clearCache()
      forgetAllArt()
      await loadAllArt()
      pushToast({ kind: 'success', title: 'Artwork cache cleared' })
    } catch (error) {
      pushToast({ kind: 'error', title: 'Could not clear the cache', message: errorMessage(error) })
    } finally {
      clearing = false
      void refreshStats()
    }
  }
</script>

<PageHeader
  title="Appearance"
  subtitle="How RemielleStrap looks, and where its artwork comes from."
/>

<Section
  title="Theme"
  description="RemielleStrap is designed for its dark treatment; the light theme is a lower-contrast variant of the same palette."
  class="mb-9"
>
  <SettingRow title="Colour theme" description="Applies across every page." for="theme-select">
    <Select
      id="theme-select"
      value={settings.value.theme}
      options={THEMES}
      label="Colour theme"
      onchange={(value) => void updateSettings({ theme: value as ThemeMode })}
    />
  </SettingRow>

  <SettingRow
    title="Accent"
    description="The colour reserved for the one important control on each screen."
    stacked
  >
    <div class="grid grid-cols-2 gap-2.5">
      {#each ACCENTS as accent (accent.value)}
        {@const active = settings.value.accentMode === accent.value}
        <button
          type="button"
          class="prism-edge rounded-control border p-3 text-left transition-colors {active
            ? 'border-gold-500/45 bg-gold-500/8'
            : 'border-ivory-200/10 bg-ink-950/40 hover:border-ivory-200/20'}"
          onclick={() => void updateSettings({ accentMode: accent.value })}
          aria-pressed={active}
        >
          <div class="flex items-center justify-between">
            <span class="text-[0.8125rem] font-medium text-ivory-100">{accent.label}</span>
            {#if active}
              <span class="text-gold-300"><Icon name="check" size={13} /></span>
            {/if}
          </div>

          <p class="mt-1 text-2xs leading-relaxed text-ivory-500">{accent.hint}</p>

          <div class="mt-2.5 flex gap-1">
            {#if accent.value === 'gold'}
              <span class="h-1.5 flex-1 rounded-full bg-gold-300"></span>
              <span class="h-1.5 flex-1 rounded-full bg-gold-500"></span>
              <span class="h-1.5 flex-1 rounded-full bg-gold-700"></span>
            {:else}
              <span class="h-1.5 flex-1 rounded-full bg-prism-rose"></span>
              <span class="h-1.5 flex-1 rounded-full bg-prism-violet"></span>
              <span class="h-1.5 flex-1 rounded-full bg-prism-cyan"></span>
              <span class="h-1.5 flex-1 rounded-full bg-prism-mint"></span>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  </SettingRow>

  <SettingRow
    title="Reduce motion"
    description="Disables the slow drift on artwork and shortens transitions."
  >
    <Switch
      checked={settings.value.reduceMotion}
      label="Reduce motion"
      onchange={(value) => void updateSettings({ reduceMotion: value })}
    />
  </SettingRow>

  <SettingRow
    title="Artwork behind the bootstrapper"
    description="Show Remielle artwork in the install and launch window."
  >
    <Switch
      checked={settings.value.showBootstrapperArt}
      label="Artwork behind the bootstrapper"
      onchange={(value) => void updateSettings({ showBootstrapperArt: value })}
    />
  </SettingRow>
</Section>

{#snippet cacheActions()}
  <span class="text-2xs text-ivory-500 tabular-nums">
    {#if stats}
      {stats.fileCount}
      {stats.fileCount === 1 ? 'file' : 'files'} · {formatBytes(stats.totalBytes)}
    {/if}
  </span>

  <button
    type="button"
    class="btn-secondary"
    onclick={() => void fetchNewArtwork()}
    disabled={refreshing || clearing}
  >
    <Icon
      name={refreshing ? 'spinner' : 'refresh'}
      size={12}
      class={refreshing ? 'animate-spin' : ''}
    />
    Fetch new images
  </button>

  <button
    type="button"
    class="btn-ghost"
    onclick={() => void clearCache()}
    disabled={clearing || refreshing}
  >
    <Icon name={clearing ? 'spinner' : 'trash'} size={12} class={clearing ? 'animate-spin' : ''} />
    Clear cache
  </button>
{/snippet}

<Section
  title="Artwork"
  description="Art is fetched from Safebooru at runtime and cached locally — nothing is bundled with the app. Each slot takes a space-separated tag query. Shuffle to pin a different post."
  actions={cacheActions}
  bare
>
  <div class="space-y-3">
    {#each ART_SLOTS as slot (slot)}
      {@const state = artSlot(slot)}
      <div class="surface overflow-hidden">
        <div class="flex gap-4 p-4">
          <ArtSlot
            {slot}
            class="h-[92px] w-[136px] shrink-0"
            focus="30%"
            scrim="none"
            attribution={false}
            shuffle={false}
          />

          <div class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="text-[0.8125rem] font-medium text-ivory-100">
                  {SLOT_LABELS[slot].title}
                </h3>
                <p class="mt-0.5 text-2xs leading-relaxed text-ivory-500">
                  {SLOT_LABELS[slot].description}
                </p>
              </div>

              <div class="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  class="btn-ghost px-2"
                  onclick={() => void loadArt(slot, true)}
                  disabled={state.loading}
                  title="Pin a different post"
                  aria-label="Shuffle {SLOT_LABELS[slot].title}"
                >
                  <Icon
                    name={state.loading ? 'spinner' : 'shuffle'}
                    size={13}
                    class={state.loading ? 'animate-spin' : ''}
                  />
                </button>

                <button
                  type="button"
                  class="btn-ghost px-2"
                  onclick={() => resetTags(slot)}
                  title="Restore the default tag query"
                  aria-label="Reset {SLOT_LABELS[slot].title} tags"
                >
                  <Icon name="refresh" size={13} />
                </button>
              </div>
            </div>

            <div class="mt-2.5 flex items-center gap-2">
              <input
                class="field field-mono"
                value={drafts[slot] ?? ''}
                spellcheck="false"
                autocomplete="off"
                aria-label="{SLOT_LABELS[slot].title} tags"
                placeholder={DEFAULT_BOORU_TAGS[slot]}
                oninput={(event) => (drafts[slot] = event.currentTarget.value)}
                onblur={() => void commitTags(slot)}
                onkeydown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </div>

            <p class="mt-1.5 truncate text-2xs text-ivory-600">
              {#if state.asset}
                Post #{state.asset.postId} · {state.asset.width}×{state.asset.height} · {prettyTags(
                  state.asset.tags,
                  5
                )}
              {:else if state.loading}
                Fetching…
              {:else}
                {state.error ?? 'No artwork loaded'}
              {/if}
            </p>
          </div>
        </div>
      </div>
    {/each}
  </div>
</Section>
