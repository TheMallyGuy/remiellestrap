<script lang="ts">
  import {
    activity,
    closeRoblox,
    copyJoinScript,
    openGamePage,
    rejoin
  } from '../stores/activity.svelte'
  import { bootstrapper, checkForUpdates, install, launch } from '../stores/bootstrapper.svelte'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import { accounts, setActiveAccount } from '../stores/accounts.svelte'
  import { playtime } from '../stores/playtime.svelte'
  import { goTo } from '../stores/navigation.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import { api, errorMessage } from '../ipc'
  import { REGION_CATALOG, regionById } from '@shared/catalog'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import { formatDuration, formatRelative, placeLabel, shortVersion } from '../utils/format'
  import ArtSlot from '../components/ArtSlot.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Icon from '../components/Icon.svelte'
  import Section from '../components/Section.svelte'

  /**
   * Home: launch, current session, recent history.
   *
   * There is exactly one high-emphasis control on this page — the launch
   * button in the banner. Everything else is secondary or ghost.
   */

  const check = $derived(bootstrapper.updateCheck)
  const current = $derived(activity.value)
  const history = $derived(activity.history)

  const needsInstall = $derived(check !== null && !check.installed)
  const needsUpdate = $derived(
    check !== null && check.installed && !check.upToDate && !settings.value.disableUpdates
  )

  const primaryLabel = $derived(
    needsInstall ? 'Install Roblox' : needsUpdate ? 'Update and play' : 'Play'
  )

  function onPrimary(): void {
    if (needsInstall) void install(false)
    else void launch({ mode: settings.value.preferredLaunchMode })
  }

  /* ------------------------------------------------- Quick play and region */

  let quickPlace = $state('')
  let joining = $state(false)

  const activeRegion = $derived(regionById(settings.value.preferredRegion))

  /** Jump straight into the best server in the preferred region. */
  async function joinInRegion(): Promise<void> {
    const target =
      quickPlace.trim() || current.activity?.placeId || activity.state.lastActivity?.placeId
    if (!target) {
      pushToast({
        kind: 'warning',
        title: 'Which game?',
        message: 'Enter a place id, or play something first.'
      })
      return
    }

    joining = true

    try {
      const result = await api.servers.join({
        placeId: target,
        region:
          settings.value.preferredRegion === 'any' ? undefined : settings.value.preferredRegion,
        size: settings.value.serverSizePreference,
        sort: settings.value.autoSortServers ? undefined : 'players'
      })

      pushToast(
        result.launched
          ? { kind: 'success', title: 'Joining a server', message: result.message }
          : { kind: 'error', title: 'Could not join', message: result.message }
      )
    } catch (error) {
      pushToast({ kind: 'error', title: 'Could not join', message: errorMessage(error) })
    } finally {
      joining = false
    }
  }

  async function switchAccount(id: string): Promise<void> {
    await setActiveAccount(id || null)
  }

  const topGames = $derived(playtime.topGames)

  const REGION_OPTIONS = REGION_CATALOG.map((region) => ({ value: region.id, label: region.label }))
</script>

<div class="mx-auto max-w-3xl">
  <!-- Banner: the app's front door. -->
  <div class="relative mb-8 overflow-hidden rounded-card animate-fade-up">
    <ArtSlot
      slot="home_banner"
      class="h-[248px] w-full"
      focus="28%"
      scrim="strong"
      drift={!settings.value.reduceMotion}
    />

    <div class="pointer-events-none absolute inset-0 flex flex-col justify-end p-6">
      <div class="pointer-events-auto flex items-end justify-between gap-6">
        <div class="min-w-0">
          <p class="eyebrow mb-1.5">
            {check?.channel ?? settings.value.channel} channel
          </p>

          <h1 class="display text-3xl leading-none">
            {#if current.inGame && current.activity}
              In an experience
            {:else if needsInstall}
              Roblox is not installed
            {:else if needsUpdate}
              An update is waiting
            {:else}
              Ready when you are
            {/if}
          </h1>

          <p class="mt-1.5 truncate text-xs text-ivory-400">
            {#if current.inGame && current.activity}
              {placeLabel(current.activity.gameName, current.activity.placeId)}
            {:else if check?.error}
              {check.error}
            {:else if needsUpdate}
              {shortVersion(check?.installedVersion)} → {shortVersion(check?.latestVersion)}
            {:else if check?.installedVersion}
              {check.installedVersion}
            {:else}
              Checking the deployment channel…
            {/if}
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          {#if current.robloxRunning}
            <button type="button" class="btn-secondary" onclick={() => void closeRoblox()}>
              <Icon name="x" size={13} />
              Close Roblox
            </button>
          {/if}

          <button
            type="button"
            class="btn-primary"
            onclick={onPrimary}
            disabled={bootstrapper.busy}
          >
            {#if bootstrapper.busy}
              <Icon name="spinner" size={14} class="animate-spin" />
              Working…
            {:else}
              <Icon name={needsInstall ? 'download' : 'play'} size={13} />
              {primaryLabel}
            {/if}
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- Current session -->
  <Section
    title="Current session"
    description="Read from the Roblox client log as you join and leave servers."
    class="mb-8"
  >
    {#if current.activity}
      {@const entry = current.activity}
      <div class="py-3.5">
        <div class="flex items-start justify-between gap-6">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full {current.inGame
                  ? 'bg-positive shadow-[0_0_6px] shadow-positive/60'
                  : 'bg-ivory-500'}"
              ></span>
              <p class="truncate text-sm text-ivory-50">
                {placeLabel(entry.gameName, entry.placeId)}
              </p>
            </div>

            <dl class="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5 text-2xs text-ivory-500">
              <div class="flex gap-1.5">
                <dt>Place</dt>
                <dd class="font-mono text-ivory-400" data-selectable>{entry.placeId}</dd>
              </div>

              {#if entry.jobId}
                <div class="flex gap-1.5">
                  <dt>Server</dt>
                  <dd class="font-mono text-ivory-400" data-selectable>
                    {entry.jobId.slice(0, 8)}…
                  </dd>
                </div>
              {/if}

              <div class="flex gap-1.5">
                <dt>Type</dt>
                <dd class="capitalize text-ivory-400">{entry.serverType}</dd>
              </div>

              <div class="flex gap-1.5">
                <dt>Joined</dt>
                <dd class="text-ivory-400">{formatRelative(entry.joinedAt)}</dd>
              </div>

              {#if entry.isTeleport}
                <div class="text-gold-400/80">via teleport</div>
              {/if}
            </dl>
          </div>

          <div class="flex shrink-0 flex-col items-end gap-1.5">
            <button type="button" class="btn-ghost" onclick={() => void openGamePage()}>
              <Icon name="external" size={12} />
              Experience page
            </button>
            <button type="button" class="btn-ghost" onclick={() => void copyJoinScript()}>
              <Icon name="copy" size={12} />
              Copy join script
            </button>
          </div>
        </div>
      </div>
    {:else}
      <div class="py-6 text-center">
        <p class="text-xs text-ivory-500">
          {#if !settings.value.enableActivityTracking}
            Activity tracking is switched off.
          {:else if current.robloxRunning}
            Roblox is running but has not joined a server yet.
          {:else}
            Not in an experience.
          {/if}
        </p>

        {#if activity.canRejoin}
          <button type="button" class="btn-secondary mt-3" onclick={() => void rejoin()}>
            <Icon name="refresh" size={12} />
            Rejoin last server
          </button>
        {/if}
      </div>
    {/if}
  </Section>

  <!-- History -->
  {#snippet historyActions()}
    <button
      type="button"
      class="btn-ghost"
      onclick={() => void checkForUpdates(false)}
      disabled={bootstrapper.checking}
    >
      <Icon
        name={bootstrapper.checking ? 'spinner' : 'refresh'}
        size={12}
        class={bootstrapper.checking ? 'animate-spin' : ''}
      />
      Check for updates
    </button>
  {/snippet}

  <Section
    title="Recent experiences"
    description="The last servers you joined, kept locally."
    actions={historyActions}
    bare={history.length === 0}
  >
    {#if history.length === 0}
      <EmptyState
        icon="clock"
        title="No sessions yet"
        message="Once you play something, your recent servers appear here so you can rejoin them."
      />
    {:else}
      <ul>
        {#each history.slice(0, 8) as entry (`${entry.placeId}-${entry.joinedAt}`)}
          <li class="border-b border-ivory-200/6 py-2.5 last:border-b-0">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="truncate text-[0.8125rem] text-ivory-200">
                  {placeLabel(entry.gameName, entry.placeId)}
                </p>
                <p class="mt-0.5 flex flex-wrap gap-x-3 text-2xs text-ivory-500">
                  <span>{formatRelative(entry.joinedAt)}</span>
                  {#if entry.leftAt}
                    <span class="tabular-nums">
                      played {formatDuration(entry.leftAt - entry.joinedAt)}
                    </span>
                  {:else}
                    <span class="text-positive/80">still open</span>
                  {/if}
                  <span class="capitalize">{entry.serverType}</span>
                </p>
              </div>

              <span class="shrink-0 font-mono text-2xs text-ivory-600">{entry.placeId}</span>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </Section>

  <div class="h-5"></div>

  <Section
    title="Quick play"
    description="Skip the website. Join the best server in your preferred region for any place id, as the selected account."
  >
    <div class="flex flex-wrap items-center gap-2 py-3">
      <input class="field w-44 py-1.5 text-xs" placeholder="Place id" bind:value={quickPlace} />

      <button
        type="button"
        class="btn-primary gap-1.5"
        disabled={joining}
        onclick={() => void joinInRegion()}
      >
        <Icon name={joining ? 'spinner' : 'map-pin'} size={13} />
        Join a {activeRegion.label} server
      </button>

      <button type="button" class="btn-ghost gap-1.5" onclick={() => goTo('servers')}>
        <Icon name="globe" size={13} />
        Browse servers
      </button>
    </div>

    <SettingRow
      title="Preferred region"
      description={`${activeRegion.hint ?? ''} Used here, by the tray menu and by region-aware auto-rejoin.`}
    >
      <Select
        value={settings.value.preferredRegion}
        options={REGION_OPTIONS}
        onchange={(value) => void updateSettings({ preferredRegion: value })}
      />
    </SettingRow>

    <SettingRow
      title="Launching as"
      description={accounts.active
        ? `${accounts.active.displayName} · ${accounts.active.valid ? 'session valid' : 'session expired'}`
        : 'No stored account — the client will use whatever session it has.'}
    >
      <div class="flex items-center gap-2">
        <Select
          value={accounts.active?.id ?? ''}
          options={[
            { value: '', label: 'Not signed in' },
            ...accounts.list.map((account) => ({ value: account.id, label: account.displayName }))
          ]}
          onchange={(value) => void switchAccount(value)}
        />
        <button type="button" class="btn-ghost px-2 py-1 text-2xs" onclick={() => goTo('accounts')}>
          Manage
        </button>
      </div>
    </SettingRow>
  </Section>

  {#if playtime.value.sessions > 0}
    <div class="h-5"></div>

    <Section
      title="Playtime"
      description="Lifetime totals for this machine, banked as each session ends."
    >
      <div class="grid grid-cols-3 gap-3 py-3">
        <div class="surface-inset px-3 py-2.5">
          <p class="text-2xs uppercase tracking-[0.14em] text-ivory-600">Total</p>
          <p class="mt-1 text-sm text-ivory-100">{formatDuration(playtime.value.totalMs)}</p>
        </div>

        <div class="surface-inset px-3 py-2.5">
          <p class="text-2xs uppercase tracking-[0.14em] text-ivory-600">Sessions</p>
          <p class="mt-1 text-sm text-ivory-100">{playtime.value.sessions}</p>
        </div>

        <div class="surface-inset px-3 py-2.5">
          <p class="text-2xs uppercase tracking-[0.14em] text-ivory-600">Games</p>
          <p class="mt-1 text-sm text-ivory-100">{playtime.value.games.length}</p>
        </div>
      </div>

      {#if topGames.length > 0}
        <ul class="space-y-1.5 pb-3">
          {#each topGames as game (game.placeId)}
            <li class="flex items-center gap-2.5 text-2xs">
              {#if game.thumbnailUrl}
                <img
                  src={game.thumbnailUrl}
                  alt=""
                  class="h-7 w-10 rounded object-cover"
                  loading="lazy"
                />
              {/if}
              <span class="min-w-0 flex-1 truncate text-ivory-300">
                {game.name || placeLabel(null, game.placeId)}
              </span>
              <span class="text-ivory-500">{formatDuration(game.totalMs)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </Section>
  {/if}
</div>
