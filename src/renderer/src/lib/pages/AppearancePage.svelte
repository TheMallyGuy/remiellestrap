<script lang="ts">
  import type {
    AccentMode,
    ArtSlot as Slot,
    BackgroundStyle,
    IconStyle,
    LauncherStyle,
    SidebarMode,
    ThemeMode,
    WindowEffect
  } from '@shared/settings'
  import { ART_SLOTS, DEFAULT_BOORU_TAGS } from '@shared/settings'
  import {
    BACKGROUND_STYLES,
    LAUNCHER_STYLES,
    SIDEBAR_MODES,
    THEME_CATALOG,
    WINDOW_EFFECT_OPTIONS
  } from '@shared/catalog'
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
  import type { CacheStats, FontCatalog, WindowEffectState } from '@shared/models'

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
    },
    background: {
      title: 'App background',
      description: 'Used by the App background style below, behind every page.'
    }
  }

  // The theme list is the shared catalogue, so a new theme only has to be
  // added in one place: `src/shared/catalog.ts`.
  const THEMES: { value: ThemeMode; label: string }[] = THEME_CATALOG.map((theme) => ({
    value: theme.id as ThemeMode,
    label: theme.label
  }))

  const ACCENTS: { value: AccentMode; label: string; hint: string }[] = [
    { value: 'gold', label: 'Soft gold', hint: 'A single warm accent. Calm and legible.' },
    { value: 'prism', label: 'Prism', hint: "Remielle's refraction, used as a faint iridescence." }
  ]

  /** Local draft of each slot's tag query so typing does not save on every key. */
  let drafts = $state<Record<string, string>>({})
  let stats = $state<CacheStats | null>(null)
  let clearing = $state(false)
  let refreshing = $state(false)

  /* ------------------------------------------------ Window, font, launcher */

  let fonts = $state<FontCatalog | null>(null)
  let material = $state<WindowEffectState | null>(null)
  let launcherDraft = $state('')
  let launcherError = $state<string | null>(null)
  let savingLauncher = $state(false)

  const LAUNCHER_TEMPLATE = `{
  "name": "My launcher",
  "title": "RemielleStrap",
  "width": 460,
  "height": 160,
  "background": "#0a0a0b",
  "textColor": "#f7f5ef",
  "accent": "#d4b671",
  "progress": "bar",
  "showArt": true,
  "customCss": "",
  "messages": {
    "connecting": "Connecting to Roblox…",
    "downloading": "Downloading the client…",
    "extracting": "Unpacking files…",
    "configuring": "Applying your settings…",
    "launching": "Starting Roblox…",
    "done": "Playing. Have fun.",
    "error": "Something went wrong."
  }
}`

  $effect(() => {
    void loadAppearanceAssets()
  })

  async function loadAppearanceAssets(): Promise<void> {
    try {
      fonts = await api.system.listFonts()
    } catch {
      fonts = null
    }

    try {
      material = await api.window.getEffect()
    } catch {
      material = null
    }

    // Seed the launcher editor from what is stored, so the text always shows
    // what the bootstrapper window is actually using.
    if (!launcherDraft) launcherDraft = settings.value.launcherCustom || LAUNCHER_TEMPLATE
  }

  async function applyMaterial(next: WindowEffect): Promise<void> {
    await updateSettings({ windowEffect: next })
    try {
      material = await api.window.setEffect(next)
    } catch (error) {
      pushToast({
        kind: 'warning',
        title: 'That material did not take',
        message: errorMessage(error)
      })
    }
  }

  async function pickBackgroundImage(): Promise<void> {
    const result = await api.system.chooseImage()
    if (result.ok && result.data) {
      await updateSettings({ backgroundStyle: 'image', backgroundImage: result.data })
    } else if (result.error) {
      pushToast({ kind: 'info', title: 'No image chosen', message: result.error })
    }
  }

  async function pickFontFile(): Promise<void> {
    const result = await api.system.chooseFont()
    if (result.ok && result.data) {
      await updateSettings({ fontFile: result.data, fontFamily: '' })
      fonts = await api.system.listFonts().catch(() => fonts)
      pushToast({
        kind: 'success',
        title: 'Font loaded',
        message: 'Applied everywhere in the app.'
      })
    } else if (result.error) {
      pushToast({ kind: 'info', title: 'No font chosen', message: result.error })
    }
  }

  function saveLauncher(): void {
    launcherError = null
    savingLauncher = true

    try {
      const parsed = JSON.parse(launcherDraft) as Partial<Record<string, unknown>>

      // The window renders whatever it is given, so the definition is checked
      // here: the fields it reads must exist and be the right shape.
      if (typeof parsed.name !== 'string' || typeof parsed.title !== 'string') {
        throw new Error('"name" and "title" are required strings')
      }

      if (
        parsed.progress !== 'bar' &&
        parsed.progress !== 'spinner' &&
        parsed.progress !== 'dots'
      ) {
        throw new Error('"progress" must be "bar", "spinner" or "dots"')
      }

      void updateSettings({
        launcherCustom: launcherDraft,
        launcherStyle: 'custom'
      })

      pushToast({ kind: 'success', title: 'Launcher definition saved' })
    } catch (error) {
      launcherError = errorMessage(error)
    } finally {
      savingLauncher = false
    }
  }

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

<div class="h-5"></div>

<Section
  title="Window"
  description="The material behind the app. Transparent materials let the desktop through, so the backdrop below is hidden while one is active."
>
  <SettingRow
    title="Window material"
    description={material
      ? (material.reason ?? `Applied: ${material.applied}`)
      : 'Reading what this system supports…'}
  >
    <Select
      value={settings.value.windowEffect}
      options={WINDOW_EFFECT_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label
      }))}
      onchange={(value) => void applyMaterial(value as WindowEffect)}
    />
  </SettingRow>

  <SettingRow title="Sidebar" description="How much room the navigation rail takes.">
    <Select
      value={settings.value.sidebarMode}
      options={SIDEBAR_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
      onchange={(value) => void updateSettings({ sidebarMode: value as SidebarMode })}
    />
  </SettingRow>

  <SettingRow
    title="Window and tray icon"
    description="Which icon the window and tray use. Classic is the Roblox mark for people who want the old muscle memory."
  >
    <Select
      value={settings.value.iconStyle}
      options={[
        { value: 'remielle', label: 'RemielleStrap' },
        { value: 'classic', label: 'Classic Roblox' },
        { value: 'modern', label: 'Modern Roblox' }
      ]}
      onchange={(value) => void updateSettings({ iconStyle: value as IconStyle })}
    />
  </SettingRow>
</Section>

<div class="h-5"></div>

<Section
  title="Backdrop"
  description="What sits behind the pages. Kept at low opacity so text stays readable whatever the picture is."
>
  <SettingRow
    title="Style"
    description={BACKGROUND_STYLES.find((entry) => entry.value === settings.value.backgroundStyle)
      ?.hint}
  >
    <Select
      value={settings.value.backgroundStyle}
      options={BACKGROUND_STYLES.map((entry) => ({ value: entry.value, label: entry.label }))}
      onchange={(value) => void updateSettings({ backgroundStyle: value as BackgroundStyle })}
    />
  </SettingRow>

  {#if settings.value.backgroundStyle === 'solid'}
    <SettingRow title="Colour" description="A flat colour behind the app.">
      <input
        type="color"
        class="h-8 w-14 cursor-pointer rounded border border-ivory-200/12 bg-transparent"
        value={settings.value.backgroundSolid}
        oninput={(event) => void updateSettings({ backgroundSolid: event.currentTarget.value })}
      />
    </SettingRow>
  {/if}

  {#if settings.value.backgroundStyle === 'gradient'}
    <SettingRow title="From / to" description="Two colours, blended at the angle below.">
      <div class="flex items-center gap-2">
        <input
          type="color"
          class="h-8 w-14 cursor-pointer rounded border border-ivory-200/12 bg-transparent"
          value={settings.value.backgroundGradientFrom}
          oninput={(event) =>
            void updateSettings({ backgroundGradientFrom: event.currentTarget.value })}
        />
        <input
          type="color"
          class="h-8 w-14 cursor-pointer rounded border border-ivory-200/12 bg-transparent"
          value={settings.value.backgroundGradientTo}
          oninput={(event) =>
            void updateSettings({ backgroundGradientTo: event.currentTarget.value })}
        />
      </div>
    </SettingRow>

    <SettingRow title="Angle" description={`${settings.value.backgroundGradientAngle}°`}>
      <input
        type="range"
        min="0"
        max="360"
        class="w-40 accent-[var(--color-gold-400)]"
        value={settings.value.backgroundGradientAngle}
        oninput={(event) =>
          void updateSettings({ backgroundGradientAngle: Number(event.currentTarget.value) })}
      />
    </SettingRow>
  {/if}

  {#if settings.value.backgroundStyle === 'image'}
    <SettingRow
      title="Image"
      description={settings.value.backgroundImage ?? 'No image chosen yet.'}
    >
      <button
        type="button"
        class="btn-secondary gap-1.5"
        onclick={() => void pickBackgroundImage()}
      >
        <Icon name="image" size={14} />
        Choose image
      </button>
    </SettingRow>
  {/if}

  {#if settings.value.backgroundStyle === 'art'}
    <SettingRow
      title="Artwork"
      description="Pulled through the App background slot above, so its tags and shuffle live with the other slots."
    >
      <button
        type="button"
        class="btn-secondary gap-1.5"
        onclick={() => void loadArt('background', true)}
      >
        <Icon name="shuffle" size={14} />
        Shuffle
      </button>
    </SettingRow>
  {/if}

  {#if settings.value.backgroundStyle !== 'none'}
    <SettingRow
      title="Opacity"
      description={`${Math.round(settings.value.backgroundOpacity * 100)}%`}
    >
      <input
        type="range"
        min="0"
        max="100"
        class="w-40 accent-[var(--color-gold-400)]"
        value={Math.round(settings.value.backgroundOpacity * 100)}
        oninput={(event) =>
          void updateSettings({ backgroundOpacity: Number(event.currentTarget.value) / 100 })}
      />
    </SettingRow>

    <SettingRow
      title="Blur"
      description={`${settings.value.backgroundBlur}px — softens a busy picture.`}
    >
      <input
        type="range"
        min="0"
        max="24"
        class="w-40 accent-[var(--color-gold-400)]"
        value={settings.value.backgroundBlur}
        oninput={(event) =>
          void updateSettings({ backgroundBlur: Number(event.currentTarget.value) })}
      />
    </SettingRow>

    <SettingRow
      title="Slow drift"
      description="A very slow pan. Ignored while Calm animations is on."
    >
      <Switch
        checked={settings.value.backgroundAnimate}
        onchange={(value) => void updateSettings({ backgroundAnimate: value })}
      />
    </SettingRow>
  {/if}
</Section>

<div class="h-5"></div>

<Section
  title="Typography"
  description="The app's typeface. A loaded file is used before any system family."
>
  <SettingRow
    title="Font file"
    description={settings.value.fontFile ?? 'No custom font loaded; the bundled families are used.'}
  >
    <div class="flex items-center gap-2">
      <button type="button" class="btn-secondary gap-1.5" onclick={() => void pickFontFile()}>
        <Icon name="type" size={14} />
        Load a font
      </button>

      {#if settings.value.fontFile}
        <button
          type="button"
          class="btn-ghost px-2 py-1 text-2xs"
          onclick={() => void updateSettings({ fontFile: null })}
        >
          Remove
        </button>
      {/if}
    </div>
  </SettingRow>

  <SettingRow title="System family" description="Used when no font file is loaded.">
    <Select
      value={settings.value.fontFamily}
      options={[
        { value: '', label: 'Inter (default)' },
        ...(fonts?.families ?? []).map((family) => ({ value: family, label: family }))
      ]}
      onchange={(value) => void updateSettings({ fontFamily: value })}
    />
  </SettingRow>
</Section>

<div class="h-5"></div>

<Section
  title="Bootstrapper window"
  description="The window that shows while Roblox installs, updates and launches."
>
  <SettingRow
    title="Style"
    description={LAUNCHER_STYLES.find((entry) => entry.value === settings.value.launcherStyle)
      ?.hint}
  >
    <Select
      value={settings.value.launcherStyle}
      options={LAUNCHER_STYLES.map((entry) => ({ value: entry.value, label: entry.label }))}
      onchange={(value) => void updateSettings({ launcherStyle: value as LauncherStyle })}
    />
  </SettingRow>

  <SettingRow title="Artwork" description="Show the Bootstrapper art slot behind the progress.">
    <Switch
      checked={settings.value.showBootstrapperArt}
      onchange={(value) => void updateSettings({ showBootstrapperArt: value })}
    />
  </SettingRow>
</Section>

{#if settings.value.launcherStyle === 'custom'}
  <div class="h-5"></div>

  <Section
    title="Custom definition"
    description="A JSON definition for the launcher window: colours, size, progress style and the messages shown at each stage."
  >
    <div class="py-3">
      <textarea
        class="field h-72 w-full resize-y p-3 font-mono text-[0.6875rem] leading-relaxed"
        spellcheck="false"
        bind:value={launcherDraft}
      ></textarea>

      {#if launcherError}
        <p class="mt-2 text-2xs text-negative/90">{launcherError}</p>
      {/if}

      <div class="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          class="btn-ghost text-xs"
          onclick={() => (launcherDraft = LAUNCHER_TEMPLATE)}
        >
          Reset to the template
        </button>
        <button
          type="button"
          class="btn-primary text-xs"
          disabled={savingLauncher}
          onclick={saveLauncher}
        >
          Save definition
        </button>
      </div>
    </div>
  </Section>
{/if}
