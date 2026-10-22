<script lang="ts">
  import type { OverlayAnchor, OverlayWidget } from '@shared/settings'
  import {
    OVERLAY_ANCHORS,
    OVERLAY_HOTKEY_PRESETS,
    OVERLAY_WIDGET_CATALOG,
    PALETTE_HOTKEY_PRESETS,
    acceleratorLabel,
    regionById,
    type OverlayWidgetDefinition
  } from '@shared/catalog'
  import {
    loadOverlay,
    overlay,
    sampleOverlay,
    setOverlayPreview,
    setOverlayVisible
  } from '../stores/overlay.svelte'
  import { openPalette } from '../stores/palette.svelte'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'
  import Tabs from '../components/Tabs.svelte'
  import { formatBytes, formatDuration } from '../utils/format'

  /**
   * Overlays.
   *
   * Two surfaces that sit on top of something else: the card drawn over the
   * game, and the palette drawn over the launcher. They share a page because
   * they share a question — what is allowed to cover what you were looking at,
   * and how do you get rid of it.
   *
   * The page is deliberately loud about provenance. Most of the figures an
   * overlay can show are not measurements of this machine, and the switches say
   * so rather than leaving it to a footnote.
   */

  type Tab = 'ingame' | 'palette'

  let tab = $state<Tab>('ingame')
  let hotkeyDraft = $state<string | null>(null)
  let paletteHotkeyDraft = $state<string | null>(null)

  $effect(() => {
    void loadOverlay()
  })

  const hotkeyValue = $derived(hotkeyDraft ?? settings.value.overlayHotkey)
  const paletteHotkeyValue = $derived(paletteHotkeyDraft ?? settings.value.paletteHotkey)

  /** What the overlay is doing, in one line, taken from the main process. */
  const statusLine = $derived(
    overlay.value.reason ??
      (overlay.value.tracking
        ? 'Following the client window.'
        : overlay.value.visible
          ? 'On screen.'
          : 'Not on screen.')
  )

  function commitHotkey(): void {
    if (hotkeyDraft === null) return
    const next = hotkeyDraft.trim()
    hotkeyDraft = null
    if (next !== settings.value.overlayHotkey) void updateSettings({ overlayHotkey: next })
  }

  function commitPaletteHotkey(): void {
    if (paletteHotkeyDraft === null) return
    const next = paletteHotkeyDraft.trim()
    paletteHotkeyDraft = null
    if (next !== settings.value.paletteHotkey) void updateSettings({ paletteHotkey: next })
  }

  /** One widget switch: the list is stored in settings, order included. */
  function toggleWidget(id: OverlayWidget): void {
    const current = settings.value.overlayWidgets
    const next = current.includes(id) ? current.filter((widget) => widget !== id) : [...current, id]

    void updateSettings({ overlayWidgets: next })
  }

  /** The widget switches, in the order the sections read. */
  const WIDGET_GROUPS = ['session', 'server', 'system'] as const
  type WidgetGroup = (typeof WIDGET_GROUPS)[number]

  function widgetsIn(group: WidgetGroup): OverlayWidgetDefinition[] {
    return OVERLAY_WIDGET_CATALOG.filter((widget) => widget.group === group)
  }

  const REFRESH_RATES = [
    { value: '1000', label: 'Every second' },
    { value: '2000', label: 'Every 2 seconds' },
    { value: '5000', label: 'Every 5 seconds' },
    { value: '10000', label: 'Every 10 seconds' }
  ]

  const SERVER_RATES = [
    { value: '10', label: 'Every 10 seconds' },
    { value: '20', label: 'Every 20 seconds' },
    { value: '60', label: 'Every minute' },
    { value: '180', label: 'Every 3 minutes' }
  ]

  async function resetPosition(): Promise<void> {
    await updateSettings({
      overlayAnchor: 'top-right',
      overlayOffsetX: 16,
      overlayOffsetY: 16
    })
    pushToast({ kind: 'success', title: 'The overlay is back in the top-right corner' })
  }

  /** Asks for a sample so the panel below has something to show on demand. */
  async function refreshSample(): Promise<void> {
    await sampleOverlay()
  }

  const sample = $derived(overlay.stats)

  /** The same figures the overlay draws, so the page is a preview of the truth. */
  const panelRows = $derived.by(() => {
    const stats = sample
    if (!stats) return []

    return [
      {
        label: 'Experience',
        value: stats.gameName ?? (stats.clientRunning ? 'Roblox is running' : 'Nothing running'),
        note: null
      },
      {
        label: 'Session',
        value: stats.sessionMs === null ? '—' : formatDuration(stats.sessionMs),
        note: null
      },
      {
        label: 'Framerate',
        value: stats.fps === null ? '—' : `${Math.round(stats.fps)} fps`,
        note: stats.fpsSource === 'server-reported' ? 'server average' : null
      },
      {
        label: 'Ping',
        value: stats.ping === null ? '—' : `${Math.round(stats.ping)} ms`,
        note: stats.pingSource === 'server-reported' ? 'server average' : null
      },
      {
        label: 'Region',
        value: stats.region ? regionById(stats.region).label : '—',
        note: stats.datacenter ? stats.datacenter.toUpperCase() : null
      },
      {
        label: 'Players',
        value:
          stats.players === null
            ? '—'
            : stats.maxPlayers
              ? `${stats.players}/${stats.maxPlayers}`
              : String(stats.players),
        note: null
      },
      {
        label: 'Client memory',
        value: stats.workingSetBytes === null ? '—' : formatBytes(stats.workingSetBytes),
        note: null
      },
      {
        label: 'Client CPU',
        value: stats.cpuPercent === null ? '—' : `${stats.cpuPercent.toFixed(1)}%`,
        note: null
      },
      { label: 'Account', value: stats.accountName ?? '—', note: null },
      { label: 'Server id', value: stats.jobId ?? '—', note: null }
    ]
  })

  /** Opens the palette from its own settings page, switching it on if needed. */
  async function testPalette(): Promise<void> {
    if (!settings.value.paletteEnabled) {
      await updateSettings({ paletteEnabled: true })
    }
    openPalette()
  }

  /** Warns before switching click-through off, because it takes clicks from the game. */
  function onClickThroughChange(next: boolean): void {
    void updateSettings({ overlayClickThrough: next })

    if (!next) {
      pushToast({
        kind: 'warning',
        title: 'The overlay now takes clicks',
        message: 'Drag it where you want it, then switch this back on.',
        timeout: 9000
      })
    }
  }
</script>

<PageHeader
  title="Overlays"
  lede="Two things RemielleStrap can draw on top of something else: a session card over the game, and a command palette over the launcher."
/>

<Tabs
  value={tab}
  onchange={(next) => (tab = next as Tab)}
  tabs={[
    { id: 'ingame', label: 'In-game overlay' },
    { id: 'palette', label: 'Command palette' }
  ]}
/>

{#if tab === 'ingame'}
  <Section
    title="The card over the game"
    description="A transparent, always-on-top window pinned to a corner of the Roblox client. It never takes focus, and it disappears when the client does."
    class="mb-9"
  >
    <SettingRow
      title="In-game overlay"
      description="Off by default: it draws over another application's window, so it should be something you chose."
      for="overlay-enabled"
    >
      <Switch
        id="overlay-enabled"
        label="In-game overlay"
        checked={settings.value.overlayEnabled}
        onchange={(value) => void updateSettings({ overlayEnabled: value })}
      />
    </SettingRow>

    <SettingRow
      title="Show it when a session starts"
      description="Otherwise it only appears when you press the shortcut."
      for="overlay-auto"
    >
      <Switch
        id="overlay-auto"
        label="Show automatically"
        checked={settings.value.overlayAutoShow}
        disabled={!settings.value.overlayEnabled}
        onchange={(value) => void updateSettings({ overlayAutoShow: value })}
      />
    </SettingRow>

    <SettingRow
      title="Shortcut"
      description="A global shortcut: it works while the game has focus. Leave it empty for none."
      stacked
      warning={overlay.value.hotkeyError ?? undefined}
    >
      <div class="flex flex-wrap items-center gap-2">
        <input
          class="field field-mono w-56"
          value={hotkeyValue}
          placeholder="CommandOrControl+Shift+O"
          aria-label="Overlay shortcut"
          oninput={(event) => (hotkeyDraft = event.currentTarget.value)}
          onblur={commitHotkey}
          onkeydown={(event) => {
            if (event.key === 'Enter') commitHotkey()
          }}
        />

        <span class="chip">
          {overlay.value.hotkey
            ? `${acceleratorLabel(overlay.value.hotkey)} is registered`
            : acceleratorLabel(hotkeyValue)}
        </span>

        {#each OVERLAY_HOTKEY_PRESETS.filter((preset) => preset.length > 0) as preset (preset)}
          <button
            type="button"
            class="btn-ghost"
            onclick={() => void updateSettings({ overlayHotkey: preset })}
          >
            {acceleratorLabel(preset)}
          </button>
        {/each}

        {#if settings.value.overlayHotkey}
          <button
            type="button"
            class="btn-ghost"
            onclick={() => void updateSettings({ overlayHotkey: '' })}
          >
            Clear
          </button>
        {/if}
      </div>
    </SettingRow>
  </Section>

  <Section
    title="Right now"
    description="What the main process reports, not a mock-up: the same sample the overlay draws from."
    class="mb-9"
  >
    <div class="py-3.5">
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="h-2 w-2 shrink-0 rounded-full {overlay.value.visible
            ? 'bg-positive shadow-[0_0_6px] shadow-positive/60'
            : 'bg-ivory-600'}"
          aria-hidden="true"
        ></span>
        <span class="text-[0.8125rem] text-ivory-100">{statusLine}</span>

        {#if overlay.value.preview}
          <span class="chip border-gold-400/40 text-gold-300">Preview</span>
        {/if}
        {#if !overlay.value.supported}
          <span class="chip">No window tracking on this platform</span>
        {/if}
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="btn-secondary gap-1.5"
          disabled={!settings.value.overlayEnabled}
          onclick={() => void setOverlayVisible(!overlay.value.visible)}
        >
          <Icon name="eye" size={14} />
          {overlay.value.visible && !overlay.value.preview ? 'Hide it' : 'Show it'}
        </button>

        <button
          type="button"
          class="btn-secondary gap-1.5"
          onclick={() => void setOverlayPreview(!overlay.value.preview)}
        >
          <Icon name="image" size={14} />
          {overlay.value.preview ? 'End the preview' : 'Preview with sample figures'}
        </button>

        <button type="button" class="btn-ghost gap-1.5" onclick={() => void refreshSample()}>
          <Icon name="refresh" size={13} />
          Sample now
        </button>
      </div>

      <dl class="surface-inset mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 px-3.5 py-3">
        {#each panelRows as row (row.label)}
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-2xs uppercase tracking-[0.1em] text-ivory-600">{row.label}</dt>
            <dd class="truncate font-mono text-2xs text-ivory-200">
              {row.value}
              {#if row.note}
                <span class="ml-1 text-ivory-600">{row.note}</span>
              {/if}
            </dd>
          </div>
        {/each}
      </dl>

      {#if sample && sample.notices.length > 0}
        <ul class="mt-3 space-y-1">
          {#each sample.notices as notice (notice)}
            <li class="flex items-start gap-1.5 text-2xs leading-relaxed text-ivory-500">
              <span class="mt-px shrink-0 text-caution/90" aria-hidden="true">
                <Icon name="alert" size={11} />
              </span>
              {notice}
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </Section>

  <Section
    title="What it shows"
    description="Each figure is its own switch. An overlay over a game is only welcome while it is small."
    class="mb-9"
  >
    {#each WIDGET_GROUPS as group (group)}
      <div class="border-b border-ivory-200/6 py-3 last:border-b-0">
        <p class="eyebrow mb-1">
          {group === 'session'
            ? 'This session'
            : group === 'server'
              ? 'The server'
              : 'This machine'}
        </p>

        {#if group === 'server'}
          <p class="mb-2 max-w-prose text-2xs leading-relaxed text-ivory-600 text-balance-pretty">
            Roblox publishes one server list per experience, carrying the average framerate and
            average ping reported by the clients connected to it. Those are the only such figures an
            outside process can obtain, so the overlay draws them with an <span
              class="font-mono text-ivory-400">avg</span
            > marker and never as a reading of your own machine.
          </p>
        {/if}

        {#each widgetsIn(group) as widget (widget.id)}
          <SettingRow title={widget.label} description={widget.hint} for={`widget-${widget.id}`}>
            <Switch
              id={`widget-${widget.id}`}
              label={widget.label}
              checked={settings.value.overlayWidgets.includes(widget.id)}
              onchange={() => toggleWidget(widget.id)}
            />
          </SettingRow>
        {/each}
      </div>
    {/each}
  </Section>

  <Section title="Where it sits" class="mb-9">
    <SettingRow
      title="Corner"
      description="Relative to the client window, not to the screen."
      for="overlay-anchor"
    >
      <Select
        id="overlay-anchor"
        label="Overlay corner"
        value={settings.value.overlayAnchor}
        options={OVERLAY_ANCHORS}
        onchange={(value) => void updateSettings({ overlayAnchor: value as OverlayAnchor })}
      />
    </SettingRow>

    <SettingRow title="Margin" description={`${settings.value.overlayMargin}px from the edge.`}>
      <input
        type="range"
        min="0"
        max="80"
        class="w-40 accent-[var(--color-gold-400)]"
        aria-label="Overlay margin"
        value={settings.value.overlayMargin}
        oninput={(event) =>
          void updateSettings({ overlayMargin: Number(event.currentTarget.value) })}
      />
    </SettingRow>

    <SettingRow
      title="Follow the client window"
      description="Keeps the overlay on the game as it moves, resizes or changes display."
      for="overlay-follow"
    >
      <Switch
        id="overlay-follow"
        label="Follow the client window"
        checked={settings.value.overlayFollowWindow}
        onchange={(value) => void updateSettings({ overlayFollowWindow: value })}
      />
    </SettingRow>

    {#if settings.value.overlayAnchor === 'custom'}
      <SettingRow
        title="Custom position"
        description="Stored as an offset from the client window's top-left corner, so it still follows the game."
        stacked
      >
        <div class="flex flex-wrap items-center gap-3">
          <label class="flex items-center gap-2 text-2xs text-ivory-500">
            X
            <input
              type="number"
              class="field field-mono w-24"
              value={settings.value.overlayOffsetX}
              aria-label="Horizontal offset"
              onchange={(event) =>
                void updateSettings({ overlayOffsetX: Number(event.currentTarget.value) })}
            />
          </label>

          <label class="flex items-center gap-2 text-2xs text-ivory-500">
            Y
            <input
              type="number"
              class="field field-mono w-24"
              value={settings.value.overlayOffsetY}
              aria-label="Vertical offset"
              onchange={(event) =>
                void updateSettings({ overlayOffsetY: Number(event.currentTarget.value) })}
            />
          </label>

          <button type="button" class="btn-ghost" onclick={() => void resetPosition()}>
            Back to the corner
          </button>
        </div>
      </SettingRow>
    {/if}

    <SettingRow
      title="Clicks fall through to the game"
      description="On by default, and the only way the overlay can be dragged is to switch it off — a window that receives clicks cannot pass them on."
      warning={settings.value.overlayClickThrough
        ? undefined
        : 'While this is off, the rectangle the overlay occupies takes clicks away from the game.'}
      for="overlay-clickthrough"
    >
      <Switch
        id="overlay-clickthrough"
        label="Click through"
        checked={settings.value.overlayClickThrough}
        onchange={onClickThroughChange}
      />
    </SettingRow>
  </Section>

  <Section title="How it looks" class="mb-9">
    <SettingRow title="Opacity" description={`${Math.round(settings.value.overlayOpacity * 100)}%`}>
      <input
        type="range"
        min="35"
        max="100"
        class="w-40 accent-[var(--color-gold-400)]"
        aria-label="Overlay opacity"
        value={Math.round(settings.value.overlayOpacity * 100)}
        oninput={(event) =>
          void updateSettings({ overlayOpacity: Number(event.currentTarget.value) / 100 })}
      />
    </SettingRow>

    <SettingRow
      title="Size"
      description={`${Math.round(settings.value.overlayScale * 100)}% of the default.`}
    >
      <input
        type="range"
        min="80"
        max="160"
        step="5"
        class="w-40 accent-[var(--color-gold-400)]"
        aria-label="Overlay size"
        value={Math.round(settings.value.overlayScale * 100)}
        oninput={(event) =>
          void updateSettings({ overlayScale: Number(event.currentTarget.value) / 100 })}
      />
    </SettingRow>

    <SettingRow
      title="Sampling"
      description="How often the window and the client process are read. The server figures have their own, slower cadence, because they come from an API."
      for="overlay-refresh"
    >
      <Select
        id="overlay-refresh"
        label="Sampling rate"
        value={String(settings.value.overlayRefreshMs)}
        options={REFRESH_RATES}
        onchange={(value) => void updateSettings({ overlayRefreshMs: Number(value) })}
      />
    </SettingRow>

    <SettingRow
      title="Server figures"
      description="How often the public server list is asked for this server's averages."
      for="overlay-server-rate"
    >
      <Select
        id="overlay-server-rate"
        label="Server figure rate"
        value={String(settings.value.overlayServerStatsSeconds)}
        options={SERVER_RATES}
        onchange={(value) => void updateSettings({ overlayServerStatsSeconds: Number(value) })}
      />
    </SettingRow>
  </Section>
{:else}
  <Section
    title="The palette over the launcher"
    description="One keystroke, a search field, and every action the app already has — ranked, not filed."
    class="mb-9"
  >
    <SettingRow
      title="Command palette"
      description="Searches pages, launches, accounts, servers, mods, FastFlag profiles and experiences."
      for="palette-enabled"
    >
      <Switch
        id="palette-enabled"
        label="Command palette"
        checked={settings.value.paletteEnabled}
        onchange={(value) => void updateSettings({ paletteEnabled: value })}
      />
    </SettingRow>

    <SettingRow
      title="Shortcut"
      description="This one is in-app: it fires while the launcher has focus, so it cannot collide with a game."
      stacked
    >
      <div class="flex flex-wrap items-center gap-2">
        <input
          class="field field-mono w-52"
          value={paletteHotkeyValue}
          placeholder="CommandOrControl+K"
          aria-label="Palette shortcut"
          disabled={!settings.value.paletteEnabled}
          oninput={(event) => (paletteHotkeyDraft = event.currentTarget.value)}
          onblur={commitPaletteHotkey}
          onkeydown={(event) => {
            // The palette's own shortcut must not open it mid-edit.
            event.stopPropagation()
            if (event.key === 'Enter') commitPaletteHotkey()
          }}
        />

        <span class="chip">{acceleratorLabel(paletteHotkeyValue)}</span>

        {#each PALETTE_HOTKEY_PRESETS.filter((preset) => preset.length > 0) as preset (preset)}
          <button
            type="button"
            class="btn-ghost"
            disabled={!settings.value.paletteEnabled}
            onclick={() => void updateSettings({ paletteHotkey: preset })}
          >
            {acceleratorLabel(preset)}
          </button>
        {/each}

        <button
          type="button"
          class="btn-secondary gap-1.5"
          disabled={!settings.value.paletteEnabled}
          onclick={() => void testPalette()}
        >
          <Icon name="search" size={14} />
          Try it
        </button>
      </div>
    </SettingRow>

    <SettingRow
      title="Search Roblox as you type"
      description="The only palette source that leaves this machine: it asks Roblox for experiences matching what you typed, after two characters and a short pause."
      for="palette-games"
    >
      <Switch
        id="palette-games"
        label="Search Roblox for experiences"
        checked={settings.value.paletteGameSearch}
        disabled={!settings.value.paletteEnabled}
        onchange={(value) => void updateSettings({ paletteGameSearch: value })}
      />
    </SettingRow>
  </Section>

  <Section
    title="What it can run"
    description="Everything here already exists as a button somewhere; the palette is the keyboard path to it."
  >
    <ul class="divide-y divide-ivory-200/6">
      {#each [{ label: 'Navigate', detail: 'Every page, in rail order.' }, { label: 'Launch', detail: 'Play, check for a client update, reinstall, close Roblox.' }, { label: 'Servers', detail: 'Rejoin the last server, join the best in your region, copy the join script.' }, { label: 'Accounts', detail: 'Launch as any stored account, or sign in to another.' }, { label: 'Mods', detail: 'Toggle any mod, and apply mods and flags immediately.' }, { label: 'FastFlags', detail: 'Switch the active profile.' }, { label: 'Overlays', detail: 'Show, hide or preview the in-game overlay.' }, { label: 'System', detail: 'Open the log and install folders, export settings, check for launcher updates.' }, { label: 'Experiences', detail: 'Search Roblox and launch what comes back.' }] as entry (entry.label)}
        <li class="flex items-baseline justify-between gap-6 py-2.5">
          <span class="text-[0.8125rem] text-ivory-100">{entry.label}</span>
          <span class="max-w-prose text-right text-2xs text-ivory-500">{entry.detail}</span>
        </li>
      {/each}
    </ul>
  </Section>
{/if}
