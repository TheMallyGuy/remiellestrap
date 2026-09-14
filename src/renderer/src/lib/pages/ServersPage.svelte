<script lang="ts">
  import type { ServerInstance } from '@shared/models'
  import { REGION_CATALOG, regionById, regionForDatacenter } from '@shared/catalog'
  import type { ServerSizePreference, ServerSortKey } from '@shared/settings'
  import { api } from '../ipc'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import { accounts } from '../stores/accounts.svelte'
  import { activity } from '../stores/activity.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import {
    joinServer,
    loadServers,
    pingServers,
    serverPing,
    servers,
    setPlaceId,
    sortServers
  } from '../stores/servers.svelte'

  import EmptyState from '../components/EmptyState.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'
  import { formatDuration, formatRelative, placeLabel } from '../utils/format'

  /**
   * The region selector and server browser.
   *
   * Roblox picks a server for you, once, with no say in it. This page exists to
   * give the say back: pick a region, see what is actually running there, and
   * join the one you want — or let RemielleStrap sort by your preference and
   * join the best match in a single click.
   */

  let sortKey = $state<ServerSortKey>('players')
  let joinBusy = $state<string | null>(null)
  let autoLoaded = $state(false)

  const regionOptions = REGION_CATALOG.map((region) => ({
    value: region.id,
    label: region.label
  }))

  const activeRegion = $derived(regionById(settings.value.preferredRegion))
  const ordered = $derived(sortServers(sortKey, settings.value.serverSizePreference))
  const currentPlace = $derived(servers.placeId || activity.value.activity?.placeId || '')

  $effect(() => {
    if (autoLoaded || servers.value || !currentPlace) return
    autoLoaded = true
    void loadServers()
  })

  /** Which region a server actually sits in, from the datacenter code. */
  function regionOf(server: ServerInstance): string {
    const fromPing = serverPing(server).region
    if (fromPing) return regionById(fromPing).label
    if (server.region) return regionById(server.region).label
    return regionForDatacenter(server.datacenter)
      ? regionById(regionForDatacenter(server.datacenter)!).label
      : 'Unknown'
  }

  function regionMatchesPreference(server: ServerInstance): boolean {
    const preference = settings.value.preferredRegion
    if (preference === 'any') return true
    const region =
      serverPing(server).region ?? server.region ?? regionForDatacenter(server.datacenter)
    return region === preference
  }

  function loadPercent(server: ServerInstance): number {
    if (server.maxPlayers <= 0) return 0
    return Math.min(100, Math.round((server.playing / server.maxPlayers) * 100))
  }

  async function join(server: ServerInstance): Promise<void> {
    joinBusy = server.id
    await joinServer({ serverId: server.id })
    joinBusy = null
  }

  async function joinBest(): Promise<void> {
    joinBusy = 'best'
    await joinServer({ region: settings.value.preferredRegion })
    joinBusy = null
  }

  async function copyJobId(server: ServerInstance): Promise<void> {
    await api.system.copyToClipboard(server.id)
    pushToast({ kind: 'success', title: 'Job id copied', message: server.id })
  }
</script>

<PageHeader
  title="Servers"
  lede="Pick the region you want to play in, look at what is actually running there, and join the server you choose — or let RemielleStrap choose the best one."
/>

<Section
  title="Place"
  description="A place id, or whatever the client is playing right now."
  actions={undefined}
>
  <div class="flex flex-wrap items-center gap-2 py-3">
    <input
      class="field w-56 py-1.5 text-xs"
      placeholder="Place id"
      value={servers.placeId}
      oninput={(event) => setPlaceId(event.currentTarget.value)}
      onkeydown={(event) => {
        if (event.key === 'Enter') void loadServers({ refresh: true })
      }}
    />

    <button
      type="button"
      class="btn-secondary gap-1.5"
      disabled={servers.loading || !servers.placeId}
      onclick={() => void loadServers({ refresh: true })}
    >
      <Icon name={servers.loading ? 'spinner' : 'refresh'} size={14} />
      Refresh list
    </button>

    {#if activity.value.activity?.placeId && activity.value.activity.placeId !== servers.placeId}
      <button
        type="button"
        class="btn-ghost gap-1.5"
        onclick={() => {
          setPlaceId(activity.value.activity?.placeId ?? '')
          void loadServers()
        }}
      >
        Use current game
      </button>
    {/if}

    <button
      type="button"
      class="btn-ghost ml-auto gap-1.5"
      disabled={servers.pinging || servers.list.length === 0}
      onclick={() => void pingServers()}
      title="Roblox does not publish ping; these figures are derived from region and server health"
    >
      <Icon name={servers.pinging ? 'spinner' : 'gauge'} size={14} />
      Sample ping
    </button>
  </div>
</Section>

<div class="h-5"></div>

<Section
  title="Preferences"
  description="These apply here, in the tray menu and to auto-rejoin after a disconnect."
>
  <SettingRow
    title="Preferred region"
    description={activeRegion.hint ??
      'Servers in this region are sorted first and joined by default.'}
  >
    <Select
      value={settings.value.preferredRegion}
      options={regionOptions}
      onchange={(value) => void updateSettings({ preferredRegion: value })}
    />
  </SettingRow>

  <SettingRow
    title="Server size"
    description="Whether to favour the fuller, busier servers or the quieter ones."
  >
    <Select
      value={settings.value.serverSizePreference}
      options={[
        { value: 'any', label: 'Any size' },
        { value: 'big', label: 'Fuller servers' },
        { value: 'small', label: 'Quieter servers' }
      ]}
      onchange={(value) =>
        void updateSettings({ serverSizePreference: value as ServerSizePreference })}
    />
  </SettingRow>

  <SettingRow title="Sort by" description="Order of the list below.">
    <Select
      value={sortKey}
      options={[
        { value: 'players', label: 'Players' },
        { value: 'ping', label: 'Ping' },
        { value: 'region', label: 'Region' },
        { value: 'uptime', label: 'Uptime' }
      ]}
      onchange={(value) => (sortKey = value as ServerSortKey)}
    />
  </SettingRow>

  <SettingRow
    title="Sort automatically"
    description="Apply the same ordering when a launch picks a server for you."
  >
    <Switch
      checked={settings.value.autoSortServers}
      onchange={(value) => void updateSettings({ autoSortServers: value })}
    />
  </SettingRow>

  <SettingRow
    title="Region-aware auto-rejoin"
    description="After an unexpected disconnect, rejoin the same region rather than a random server."
  >
    <Switch
      checked={settings.value.autoRejoinRegionAware}
      onchange={(value) => void updateSettings({ autoRejoinRegionAware: value })}
    />
  </SettingRow>

  <SettingRow
    title="Datacenter lookup"
    description="Where region and datacenter names come from. Leave the default unless you have a mirror."
    stacked
  >
    <input
      class="field w-full py-1.5 font-mono text-2xs"
      value={settings.value.serverRegionApi}
      onblur={(event) => void updateSettings({ serverRegionApi: event.currentTarget.value })}
    />
  </SettingRow>
</Section>

<div class="h-5"></div>

<Section
  title="Public servers"
  description={currentPlace
    ? placeLabel(servers.value?.placeName ?? null, currentPlace)
    : 'Enter a place id above, or start a game so the launcher knows where you are.'}
>
  {#if servers.loading && servers.list.length === 0}
    <div class="space-y-2 py-3">
      {#each [0, 1, 2] as row (row)}
        <div class="skeleton h-12 rounded-control"></div>
      {/each}
    </div>
  {:else if servers.error && servers.list.length === 0}
    <EmptyState icon="alert" title="The server list did not come back" message={servers.error}>
      {#snippet action()}
        <button
          type="button"
          class="btn-secondary"
          onclick={() => void loadServers({ refresh: true })}
        >
          Try again
        </button>
      {/snippet}
    </EmptyState>
  {:else if ordered.length === 0}
    <EmptyState
      icon="server"
      title="No servers are listed for this place"
      message="Private or brand-new experiences often have none. Try another place id."
    />
  {:else}
    <div class="flex flex-wrap items-center gap-2 py-3">
      <button
        type="button"
        class="btn-primary gap-1.5"
        disabled={joinBusy !== null}
        onclick={() => void joinBest()}
      >
        <Icon name={joinBusy === 'best' ? 'spinner' : 'play'} size={14} />
        Join best in {settings.value.preferredRegion === 'any' ? 'any region' : activeRegion.label}
      </button>

      <span class="text-2xs text-ivory-500">
        {ordered.length} listed · fetched {formatRelative(servers.value?.fetchedAt)}
        {#if servers.value?.cached}· from cache{/if}
      </span>

      {#if servers.value?.stale}
        <span class="chip border-caution/30 text-caution/90"
          >rate limited — showing the last good list</span
        >
      {/if}

      {#if accounts.active}
        <span class="ml-auto text-2xs text-ivory-500">
          Joining as <span class="text-ivory-300">{accounts.active.displayName}</span>
        </span>
      {/if}
    </div>

    <ul class="divide-y divide-ivory-200/6 border-t border-ivory-200/8">
      {#each ordered as server (server.id)}
        {@const sample = serverPing(server)}
        {@const percent = loadPercent(server)}
        <li class="flex items-center gap-3 py-2.5">
          <!-- Region and datacenter -->
          <span class="w-28 shrink-0">
            <span class="flex items-center gap-1 text-xs text-ivory-200">
              {#if regionMatchesPreference(server) && settings.value.preferredRegion !== 'any'}
                <span class="text-gold-300"><Icon name="map-pin" size={12} /></span>
              {/if}
              {regionOf(server)}
            </span>
            <span class="block truncate text-2xs text-ivory-500"
              >{server.datacenter ?? 'datacenter unknown'}</span
            >
          </span>

          <!-- Ping -->
          <span class="w-16 shrink-0 text-xs">
            {#if sample.ping === null}
              <span class="text-ivory-500">—</span>
            {:else}
              <span
                class={sample.ping < 80
                  ? 'text-positive'
                  : sample.ping < 160
                    ? 'text-gold-300'
                    : 'text-caution'}
              >
                {sample.ping} ms
              </span>
              <span class="block text-2xs text-ivory-600">est.</span>
            {/if}
          </span>

          <!-- Players -->
          <span class="min-w-0 flex-1">
            <span class="flex items-center justify-between text-2xs text-ivory-500">
              <span>{server.playing}/{server.maxPlayers} players</span>
              {#if server.uptimeSeconds}· {formatDuration(server.uptimeSeconds * 1000)}<span>
                  uptime</span
                >{/if}
            </span>
            <span class="mt-1 block h-1 overflow-hidden rounded-full bg-ink-700">
              <span
                class="block h-full rounded-full {percent > 90
                  ? 'bg-caution/70'
                  : 'bg-gold-500/60'}"
                style="width: {percent}%"
              ></span>
            </span>
          </span>

          <!-- Actions -->
          <span class="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              class="btn-ghost px-2 py-1"
              title="Copy the job id"
              onclick={() => void copyJobId(server)}
            >
              <Icon name="copy" size={13} />
            </button>
            <button
              type="button"
              class="btn-secondary gap-1.5 px-2.5 py-1 text-2xs"
              disabled={joinBusy !== null}
              onclick={() => void join(server)}
            >
              {#if joinBusy === server.id}
                <Icon name="spinner" size={12} />
              {:else}
                <Icon name="play" size={12} />
              {/if}
              Join
            </button>
          </span>
        </li>
      {/each}
    </ul>

    <p class="py-3 text-2xs leading-relaxed text-ivory-600">
      Ping is not published by Roblox for a running server; the figure here is derived from the
      datacenter and the server's own health report, and is labelled as an estimate for that reason.
    </p>
  {/if}
</Section>
