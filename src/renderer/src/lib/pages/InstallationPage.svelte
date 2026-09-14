<script lang="ts">
  import type { ChannelInfo, InstalledVersion, SystemInfo } from '@shared/models'
  import type { RobloxState } from '@shared/state'
  import { KNOWN_CHANNELS } from '@shared/settings'
  import { api, errorMessage } from '../ipc'
  import {
    bootstrapper,
    checkForUpdates,
    forceReinstall,
    install
  } from '../stores/bootstrapper.svelte'
  import {
    exportSettings,
    importSettings,
    resetSettings,
    settings,
    updateSettings
  } from '../stores/settings.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import {
    ellipsisPath,
    formatBytes,
    formatDateTime,
    formatRelative,
    shortVersion
  } from '../utils/format'
  import type { ConfirmOptions } from '../types'
  import ConfirmDialog from '../dialogs/ConfirmDialog.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'

  /**
   * Everything about the Roblox install itself: which channel it tracks, where
   * it lives on disk, and the destructive operations that rebuild or remove it.
   */

  const config = $derived(settings.value)

  let info = $state<SystemInfo | null>(null)
  let robloxState = $state<RobloxState | null>(null)
  let busy = $state(false)

  let channelDraft = $state(settings.value.channel)
  let customChannel = $state(
    !(KNOWN_CHANNELS as readonly string[]).includes(settings.value.channel)
  )

  let confirmOpen = $state(false)
  let confirmOptions = $state<ConfirmOptions>({ title: '', message: '' })
  let confirmAction = $state<(() => Promise<void>) | null>(null)

  const check = $derived(bootstrapper.updateCheck)

  /* ------------------------------------------- Channel browser and versions */

  let channels = $state<ChannelInfo[]>([])
  let channelsBusy = $state(false)
  let versions = $state<InstalledVersion[]>([])
  let versionsBusy = $state(false)
  let busyVersion = $state<string | null>(null)

  $effect(() => {
    void loadChannels(false)
    void loadVersions()
  })

  async function loadChannels(refresh: boolean): Promise<void> {
    channelsBusy = true
    try {
      channels = await api.channels.list(refresh)
    } catch (error) {
      pushToast({
        kind: 'warning',
        title: 'Could not read the channel list',
        message: errorMessage(error)
      })
    } finally {
      channelsBusy = false
    }
  }

  async function selectChannel(name: string): Promise<void> {
    try {
      channels = await api.channels.set(name)
      channelDraft = name
      customChannel = false
      pushToast({ kind: 'success', title: `Channel set to ${name}` })
    } catch (error) {
      pushToast({ kind: 'error', title: 'That channel was rejected', message: errorMessage(error) })
    }
  }

  async function loadVersions(): Promise<void> {
    versionsBusy = true
    try {
      versions = await api.versions.list()
    } catch {
      versions = []
    } finally {
      versionsBusy = false
    }
  }

  async function versionAction(
    action: 'setCurrent' | 'delete' | 'downgrade',
    version: InstalledVersion
  ): Promise<void> {
    busyVersion = version.id

    try {
      if (action === 'downgrade') {
        const result = await api.versions.downgrade({
          versionHash: version.versionHash,
          appType: version.appType
        })
        pushToast({
          kind: result.ok ? 'success' : 'warning',
          title: result.ok ? 'Reinstalling that version' : 'Could not reinstall it',
          message: result.message
        })
      } else {
        versions = await api.versions[action]({
          versionHash: version.versionHash,
          appType: version.appType
        })
      }

      await loadVersions()
      robloxState = await api.system.getRobloxState()
    } catch (error) {
      pushToast({ kind: 'error', title: 'That did not work', message: errorMessage(error) })
    } finally {
      busyVersion = null
    }
  }

  const channelOptions = $derived([
    ...KNOWN_CHANNELS.map((channel) => ({ value: channel, label: channel })),
    { value: '__custom', label: 'Custom channel…' }
  ])

  const parallelOptions = [1, 2, 4, 6, 8].map((count) => ({
    value: String(count),
    label: `${count} ${count === 1 ? 'file' : 'files'}`
  }))

  $effect(() => {
    void refresh()
  })

  async function refresh(): Promise<void> {
    try {
      const [systemInfo, state] = await Promise.all([
        api.system.getInfo(),
        api.system.getRobloxState()
      ])
      info = systemInfo
      robloxState = state
    } catch (error) {
      pushToast({
        kind: 'error',
        title: 'Could not read system info',
        message: errorMessage(error)
      })
    }
  }

  function onChannelSelect(value: string): void {
    if (value === '__custom') {
      customChannel = true
      channelDraft = config.channel
      return
    }

    customChannel = false
    commitChannel(value)
  }

  function commitChannel(value: string): void {
    const next = value.trim()

    if (next.length === 0) {
      channelDraft = config.channel
      pushToast({ kind: 'warning', title: 'A channel name is required' })
      return
    }

    if (next === config.channel) return

    void updateSettings({ channel: next })
    pushToast({
      kind: 'info',
      title: `Now tracking ${next}`,
      message: 'Check for updates to pull this channel’s current version.'
    })
  }

  async function chooseLocation(): Promise<void> {
    busy = true

    try {
      const result = await api.system.chooseInstallLocation()

      if (result.ok && result.data) {
        await refresh()
        pushToast({ kind: 'success', title: 'Install location changed', message: result.data })
      } else if (result.error) {
        pushToast({ kind: 'warning', title: 'Location unchanged', message: result.error })
      }
    } catch (error) {
      pushToast({
        kind: 'error',
        title: 'Could not set the location',
        message: errorMessage(error)
      })
    } finally {
      busy = false
    }
  }

  function askReinstall(): void {
    ask(
      {
        title: 'Reinstall the client?',
        message:
          'Every package is downloaded again from scratch and the version folder is rebuilt. Mods and FastFlags are reapplied on the next launch.',
        confirmLabel: 'Reinstall'
      },
      async () => {
        await forceReinstall()
        await refresh()
      }
    )
  }

  function askUninstall(keepSettings: boolean): void {
    ask(
      {
        title: keepSettings ? 'Uninstall Roblox?' : 'Uninstall everything?',
        message: keepSettings
          ? 'The Roblox client, its versions and the download cache are deleted. Your RemielleStrap settings, mods and FastFlag profiles are kept.'
          : 'The Roblox client and every RemielleStrap file — settings, mods, FastFlag profiles, cached artwork and logs — are deleted.',
        confirmLabel: 'Uninstall',
        danger: true
      },
      async () => {
        busy = true

        try {
          const result = await api.system.uninstall(keepSettings)

          if (result.ok) {
            pushToast({ kind: 'success', title: 'Uninstalled' })
            await refresh()
          } else {
            pushToast({ kind: 'error', title: 'Uninstall failed', message: result.error })
          }
        } catch (error) {
          pushToast({ kind: 'error', title: 'Uninstall failed', message: errorMessage(error) })
        } finally {
          busy = false
        }
      }
    )
  }

  function askReset(): void {
    ask(
      {
        title: 'Reset all settings?',
        message:
          'Every option returns to its default, including art tags and the chosen artwork. Mods and FastFlag profiles are not touched.',
        confirmLabel: 'Reset',
        danger: true
      },
      async () => {
        await resetSettings()
        channelDraft = settings.value.channel
        customChannel = !(KNOWN_CHANNELS as readonly string[]).includes(settings.value.channel)
      }
    )
  }

  function ask(options: ConfirmOptions, action: () => Promise<void>): void {
    confirmOptions = options
    confirmAction = action
    confirmOpen = true
  }

  async function runConfirm(): Promise<void> {
    const action = confirmAction
    confirmOpen = false
    confirmAction = null
    if (action) await action()
  }

  async function open(target: 'logs' | 'appData' | 'roblox'): Promise<void> {
    const result =
      target === 'logs'
        ? await api.system.openLogs()
        : target === 'appData'
          ? await api.system.openAppData()
          : await api.system.openRobloxDir()

    if (!result.ok && result.error) {
      pushToast({ kind: 'warning', title: 'Could not open that folder', message: result.error })
    }
  }
</script>

<PageHeader
  title="Installation"
  subtitle="Where the Roblox client comes from, where it lives, and how to rebuild it."
>
  {#snippet actions()}
    <button
      type="button"
      class="btn-secondary"
      onclick={() => void checkForUpdates()}
      disabled={bootstrapper.checking || bootstrapper.busy}
    >
      {#if bootstrapper.checking}
        <Icon name="spinner" size={12} class="animate-spin" />
      {:else}
        <Icon name="refresh" size={12} />
      {/if}
      Check for updates
    </button>
  {/snippet}
</PageHeader>

<!-- Status -->
<Section title="Client" bare>
  <div class="surface prism-edge px-4 py-4">
    <div class="flex flex-wrap items-start justify-between gap-6">
      <div class="min-w-0">
        <p class="text-2xs uppercase tracking-[0.14em] text-ivory-600">Installed version</p>
        <p class="mt-1.5 font-mono text-sm text-ivory-50">
          {robloxState?.installedVersion
            ? shortVersion(robloxState.installedVersion)
            : 'Not installed'}
        </p>
        {#if robloxState?.installedAt}
          <p class="mt-1 text-2xs text-ivory-600">
            installed {formatDateTime(robloxState.installedAt)}
          </p>
        {/if}
      </div>

      <div class="min-w-0">
        <p class="text-2xs uppercase tracking-[0.14em] text-ivory-600">
          Latest on {config.channel}
        </p>
        <p class="mt-1.5 font-mono text-sm text-ivory-200">
          {check?.latestVersion ? shortVersion(check.latestVersion) : '—'}
        </p>
        <p class="mt-1 text-2xs {check?.error ? 'text-caution' : 'text-ivory-600'}">
          {#if check?.error}
            {check.error}
          {:else if check?.checkedAt}
            checked {formatDateTime(check.checkedAt)}
          {:else}
            not checked yet
          {/if}
        </p>
      </div>

      <div class="min-w-0">
        <p class="text-2xs uppercase tracking-[0.14em] text-ivory-600">Status</p>
        <p class="mt-1.5 flex items-center gap-2 text-sm">
          <span
            class="h-1.5 w-1.5 rounded-full {check === null
              ? 'bg-ivory-700'
              : !check.installed
                ? 'bg-caution'
                : check.upToDate
                  ? 'bg-positive'
                  : 'bg-gold-400'}"
          ></span>
          <span class="text-ivory-200">
            {#if check === null}
              Unknown
            {:else if !check.installed}
              Not installed
            {:else if check.upToDate}
              Up to date
            {:else}
              Update available
            {/if}
          </span>
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        {#if check && !check.upToDate}
          <button
            type="button"
            class="btn-primary"
            onclick={() => void install(false)}
            disabled={bootstrapper.busy}
          >
            <Icon name="download" size={13} />
            {check.installed ? 'Update now' : 'Install Roblox'}
          </button>
        {/if}
      </div>
    </div>
  </div>
</Section>

<!-- Channel and location -->
<Section
  title="Source"
  description="RemielleStrap downloads packages straight from Roblox's deployment CDN, the same way the official bootstrapper does."
  class="mt-9"
>
  <SettingRow
    title="Update channel"
    description="LIVE is what everyone gets. The Z-channels are Roblox's own test deployments and may be unavailable or broken."
    for="channel"
  >
    <div class="flex items-center gap-2">
      {#if customChannel}
        <input
          id="channel"
          class="field field-mono w-44"
          value={channelDraft}
          spellcheck="false"
          autocomplete="off"
          placeholder="ZNext"
          oninput={(event) => (channelDraft = event.currentTarget.value)}
          onblur={() => commitChannel(channelDraft)}
          onkeydown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        <button
          type="button"
          class="btn-ghost"
          onclick={() => {
            customChannel = false
            commitChannel('LIVE')
          }}
        >
          Use a preset
        </button>
      {:else}
        <Select
          id="channel"
          value={config.channel}
          options={channelOptions}
          label="Update channel"
          onchange={onChannelSelect}
          class="w-44"
        />
      {/if}
    </div>
  </SettingRow>

  <SettingRow
    title="Automatic update checks"
    description="Check the channel for a newer client each time RemielleStrap starts and before every launch."
    for="auto-updates"
  >
    <Switch
      id="auto-updates"
      checked={!config.disableUpdates}
      onchange={(value) => void updateSettings({ disableUpdates: !value })}
    />
  </SettingRow>

  <SettingRow
    title="Parallel downloads"
    description="How many Roblox packages are downloaded at the same time. More is faster, but only up to the speed of your connection."
    for="parallel-downloads"
  >
    <Select
      id="parallel-downloads"
      value={String(config.parallelDownloads)}
      options={parallelOptions}
      label="Parallel downloads"
      onchange={(value) => void updateSettings({ parallelDownloads: Number(value) })}
      class="w-32"
    />
  </SettingRow>

  <SettingRow
    title="Install location"
    description="Where client versions are extracted. Moving this does not copy an existing install — reinstall afterwards."
    stacked
  >
    <div class="flex items-center gap-2">
      <code
        class="min-w-0 flex-1 truncate rounded-control border border-ivory-200/8 bg-ink-950/50 px-3 py-2 font-mono text-2xs text-ivory-400"
        title={robloxState?.installPath ?? info?.paths.versions ?? ''}
      >
        {ellipsisPath(
          config.installLocation ?? robloxState?.installPath ?? info?.paths.versions ?? '—',
          64
        )}
      </code>

      <button
        type="button"
        class="btn-secondary"
        onclick={() => void chooseLocation()}
        disabled={busy}
      >
        <Icon name="folder" size={12} />
        Change
      </button>

      {#if config.installLocation}
        <button
          type="button"
          class="btn-ghost"
          onclick={() => void updateSettings({ installLocation: null })}
        >
          Default
        </button>
      {/if}
    </div>
  </SettingRow>
</Section>

<!-- Folders -->
<Section
  title="Folders"
  description="Everything RemielleStrap writes lives under a single application data directory."
  class="mt-9"
>
  <SettingRow title="Application data" description={info?.paths.appData ?? ''}>
    <button type="button" class="btn-ghost" onclick={() => void open('appData')}>
      <Icon name="folder" size={12} />
      Open
    </button>
  </SettingRow>

  <SettingRow title="Logs" description={info?.paths.logs ?? ''}>
    <button type="button" class="btn-ghost" onclick={() => void open('logs')}>
      <Icon name="folder" size={12} />
      Open
    </button>
  </SettingRow>

  <SettingRow title="Roblox versions" description={info?.paths.versions ?? ''}>
    <button type="button" class="btn-ghost" onclick={() => void open('roblox')}>
      <Icon name="folder" size={12} />
      Open
    </button>
  </SettingRow>
</Section>

<!-- Settings file -->
<Section
  title="Your settings"
  description="Settings are a single JSON file. Export it to move RemielleStrap to another machine."
  class="mt-9"
>
  <SettingRow title="Export settings" description="Write Settings.json to a location you choose.">
    <button type="button" class="btn-ghost" onclick={() => void exportSettings()}>
      <Icon name="external" size={12} />
      Export
    </button>
  </SettingRow>

  <SettingRow
    title="Import settings"
    description="Replace the current settings with a previously exported file."
  >
    <button type="button" class="btn-ghost" onclick={() => void importSettings()}>
      <Icon name="download" size={12} />
      Import
    </button>
  </SettingRow>

  <SettingRow title="Reset to defaults" description="Restores every option, including art tags.">
    <button type="button" class="btn-ghost hover:text-negative" onclick={askReset}>Reset</button>
  </SettingRow>
</Section>

<!-- Danger zone -->
<Section
  title="Rebuild and remove"
  description="These operations delete files. There is no undo."
  class="mt-9"
  bare
>
  <div class="rounded-card border border-negative/25 bg-negative/4">
    <div class="flex items-center justify-between gap-6 border-b border-negative/15 px-4 py-3.5">
      <div class="min-w-0">
        <p class="text-[0.8125rem] text-ivory-100">Reinstall the client</p>
        <p class="mt-0.5 text-2xs text-ivory-500">
          Downloads every package again. Use this when the client crashes on start or a mod broke a
          file.
        </p>
      </div>
      <button
        type="button"
        class="btn-secondary shrink-0"
        onclick={askReinstall}
        disabled={busy || bootstrapper.busy}
      >
        <Icon name="refresh" size={12} />
        Reinstall
      </button>
    </div>

    <div class="flex items-center justify-between gap-6 border-b border-negative/15 px-4 py-3.5">
      <div class="min-w-0">
        <p class="text-[0.8125rem] text-ivory-100">Uninstall Roblox</p>
        <p class="mt-0.5 text-2xs text-ivory-500">
          Removes the client and the download cache but keeps your RemielleStrap configuration.
        </p>
      </div>
      <button
        type="button"
        class="btn-secondary shrink-0"
        onclick={() => askUninstall(true)}
        disabled={busy || bootstrapper.busy}
      >
        Uninstall
      </button>
    </div>

    <div class="flex items-center justify-between gap-6 px-4 py-3.5">
      <div class="min-w-0">
        <p class="text-[0.8125rem] text-ivory-100">Remove everything</p>
        <p class="mt-0.5 text-2xs text-ivory-500">
          Deletes the client and all RemielleStrap data: settings, mods, FastFlag profiles, cached
          artwork and logs.
        </p>
      </div>
      <button
        type="button"
        class="btn-danger shrink-0"
        onclick={() => askUninstall(false)}
        disabled={busy || bootstrapper.busy}
      >
        <Icon name="trash" size={12} />
        Remove everything
      </button>
    </div>
  </div>
</Section>

<ConfirmDialog
  open={confirmOpen}
  options={confirmOptions}
  busy={busy || bootstrapper.busy}
  onconfirm={() => void runConfirm()}
  oncancel={() => {
    confirmOpen = false
    confirmAction = null
  }}
/>

<div class="h-5"></div>

<Section
  title="Channel browser"
  description="Every deployment Roblox publishes can be tracked here. Staging channels are usually ahead of LIVE, which is why they are listed with what they are currently serving."
>
  {#snippet actions()}
    <button
      type="button"
      class="btn-ghost gap-1.5"
      disabled={channelsBusy}
      onclick={() => void loadChannels(true)}
    >
      <Icon name={channelsBusy ? 'spinner' : 'refresh'} size={13} />
      Re-check
    </button>
  {/snippet}

  {#if channels.length === 0}
    <div class="space-y-2 py-3">
      {#each [0, 1, 2] as row (row)}
        <div class="skeleton h-10 rounded-control"></div>
      {/each}
    </div>
  {:else}
    <ul class="divide-y divide-ivory-200/6">
      {#each channels as channel (channel.name)}
        <li class="flex items-center gap-3 py-2.5">
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 text-xs text-ivory-200">
              {channel.name}
              {#if channel.isCurrent}
                <span class="chip border-gold-500/40 text-gold-200">current</span>
              {/if}
              {#if channel.isInstalled}
                <span class="chip">installed</span>
              {/if}
            </span>
            <span class="mt-0.5 block truncate text-2xs text-ivory-500">
              {#if channel.error}
                {channel.error}
              {:else}
                client {shortVersion(channel.playerVersion) ??
                  channel.playerClientVersion ??
                  'unknown'}
                {#if channel.studioVersion}· studio {shortVersion(channel.studioVersion)}{/if}
              {/if}
            </span>
          </span>

          {#if !channel.isCurrent}
            <button
              type="button"
              class="btn-secondary px-2.5 py-1 text-2xs"
              disabled={Boolean(channel.error)}
              onclick={() => void selectChannel(channel.name)}
            >
              Track
            </button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</Section>

<div class="h-5"></div>

<Section
  title="Installed versions"
  description="Every client build on disk. Switching which one the launcher uses takes effect immediately; deleting frees the space."
>
  {#snippet actions()}
    <button type="button" class="btn-ghost gap-1.5" onclick={() => void api.versions.openFolder()}>
      <Icon name="folder" size={13} />
      Open folder
    </button>
  {/snippet}

  {#if versionsBusy && versions.length === 0}
    <div class="space-y-2 py-3">
      {#each [0, 1] as row (row)}
        <div class="skeleton h-12 rounded-control"></div>
      {/each}
    </div>
  {:else if versions.length === 0}
    <div class="py-6 text-center text-xs text-ivory-500">
      Nothing installed yet. Install the client above and it will appear here.
    </div>
  {:else}
    <ul class="divide-y divide-ivory-200/6">
      {#each versions as version (version.id)}
        <li class="flex items-center gap-3 py-2.5">
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5 text-xs text-ivory-200">
              {shortVersion(version.versionHash) ?? version.versionHash}
              <span class="chip">{version.appType === 'studio' ? 'studio' : 'player'}</span>
              {#if version.isCurrent}
                <span class="chip border-gold-500/40 text-gold-200">in use</span>
              {/if}
              {#if version.missing}
                <span class="chip border-negative/30 text-negative/90">missing</span>
              {/if}
            </span>
            <span class="mt-0.5 block truncate text-2xs text-ivory-500">
              {version.channel} · {formatBytes(version.sizeBytes)} · installed
              {formatRelative(Date.parse(version.installedAt) || Date.now())}
            </span>
          </span>

          {#if !version.isCurrent && !version.missing}
            <button
              type="button"
              class="btn-secondary px-2.5 py-1 text-2xs"
              disabled={busyVersion === version.id}
              onclick={() => void versionAction('setCurrent', version)}
            >
              Use
            </button>
          {/if}

          <button
            type="button"
            class="btn-ghost px-2.5 py-1 text-2xs"
            disabled={busyVersion === version.id}
            title="Reinstall this exact build"
            onclick={() => void versionAction('downgrade', version)}
          >
            Reinstall
          </button>

          <button
            type="button"
            class="btn-ghost px-2 py-1 text-2xs text-negative/80 hover:text-negative"
            disabled={busyVersion === version.id || version.isCurrent}
            onclick={() => void versionAction('delete', version)}
          >
            <Icon name="trash" size={13} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Section>

<div class="h-5"></div>

<Section
  title="Fixed version folder"
  description="Client tools usually look for the executable at a predictable path. Installing into one stable folder instead of version-&lt;guid&gt; keeps those tools working across updates."
>
  <SettingRow
    title="Use a fixed folder"
    description="The folder is created beside the versioned installs, and the launcher keeps pointing at it as the client updates."
  >
    <Switch
      checked={config.fixedVersionFolder}
      onchange={(value) => void updateSettings({ fixedVersionFolder: value })}
    />
  </SettingRow>

  {#if config.fixedVersionFolder}
    <SettingRow
      title="Folder name"
      description="Letters, numbers, spaces, dots, dashes and underscores only."
    >
      <input
        class="field w-48 py-1.5 font-mono text-xs"
        value={config.fixedVersionFolderName}
        onblur={(event) =>
          void updateSettings({ fixedVersionFolderName: event.currentTarget.value })}
      />
    </SettingRow>

    <SettingRow
      title="Currently installed"
      description={robloxState?.fixedFolderVersion
        ? `Serving ${shortVersion(robloxState.fixedFolderVersion) ?? robloxState.fixedFolderVersion}`
        : 'Nothing has been installed into a fixed folder yet.'}
    >
      <span class="text-2xs text-ivory-500">applies from the next install</span>
    </SettingRow>
  {/if}
</Section>
