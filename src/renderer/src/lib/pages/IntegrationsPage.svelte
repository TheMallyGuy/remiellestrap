<script lang="ts">
  import {
    activity,
    closeRoblox,
    copyJoinScript,
    loadActivity,
    loadAppState,
    openGamePage,
    rejoin
  } from '../stores/activity.svelte'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import type { PlaytimeSummary, StudioBridgeInfo } from '@shared/models'
  import { api, errorMessage } from '../ipc'
  import { playtime, loadPlaytime, resetPlaytime } from '../stores/playtime.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import { formatDuration, formatRelative, placeLabel } from '../utils/format'
  import EmptyState from '../components/EmptyState.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'
  import Dialog from '../components/Dialog.svelte'

  /**
   * Discord presence and Roblox activity tracking — everything RemielleStrap
   * reads out of the client log and everything it reports to other apps.
   */

  const config = $derived(settings.value)
  const session = $derived(activity.value)
  const presence = $derived(activity.rpc)

  // A local tick so the "in game for 4m" reading advances without an event.
  let now = $state(Date.now())

  $effect(() => {
    void loadActivity()
    void loadAppState()

    const timer = window.setInterval(() => (now = Date.now()), 1000)
    return () => window.clearInterval(timer)
  })

  const elapsed = $derived(
    session.activity ? formatDuration(now - session.activity.joinedAt) : null
  )

  const serverLabel = $derived.by(() => {
    switch (session.activity?.serverType) {
      case 'private':
        return 'Private server'
      case 'reserved':
        return 'Reserved server'
      case 'public':
        return 'Public server'
      default:
        return null
    }
  })

  const history = $derived(activity.history.slice(0, 8))

  /* ------------------------------------------------- Playtime and Studio */

  let bridge = $state<StudioBridgeInfo | null>(null)
  let installingPlugin = $state(false)
  let confirmReset = $state(false)

  const totals = $derived<PlaytimeSummary>(playtime.value)

  $effect(() => {
    void loadPlaytime()
    void refreshBridge()
  })

  async function refreshBridge(): Promise<void> {
    try {
      bridge = await api.studio.getBridge()
    } catch {
      bridge = null
    }
  }

  async function installPlugin(): Promise<void> {
    installingPlugin = true
    try {
      const result = await api.studio.installPlugin()

      if (result.ok && result.data) {
        bridge = result.data
        pushToast({
          kind: 'success',
          title: 'Studio plugin installed',
          message: 'Studio picks it up the next time it starts.'
        })
      } else {
        pushToast({ kind: 'warning', title: 'Plugin not installed', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Plugin not installed', message: errorMessage(error) })
    } finally {
      installingPlugin = false
    }
  }

  const sessionLabel = $derived(
    totals.currentSessionMs === null ? null : formatDuration(totals.currentSessionMs)
  )
</script>

<PageHeader
  title="Integrations"
  subtitle="What RemielleStrap watches while you play, and what it tells Discord about it."
/>

<!-- Live session -->
<Section title="Current session" bare>
  {#if session.activity}
    <div class="surface prism-edge overflow-hidden">
      <div class="flex items-start gap-4 px-4 py-4">
        <div
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-gold-500/30 bg-gold-500/8 text-gold-300"
        >
          <Icon name="play" size={17} />
        </div>

        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-ivory-50">
            {placeLabel(session.activity.gameName, session.activity.placeId)}
          </p>
          <p class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ivory-500">
            {#if serverLabel}<span>{serverLabel}</span>{/if}
            {#if elapsed}<span class="text-ivory-700">·</span><span>in game for {elapsed}</span
              >{/if}
            {#if session.activity.isTeleport}
              <span class="text-ivory-700">·</span><span>teleported</span>
            {/if}
            {#if session.activity.jobId}
              <span class="text-ivory-700">·</span>
              <span class="font-mono">{session.activity.jobId.slice(0, 8)}</span>
            {/if}
          </p>
        </div>

        <div class="flex shrink-0 items-center gap-2">
          <button type="button" class="btn-ghost" onclick={() => void openGamePage()}>
            <Icon name="external" size={12} />
            Experience page
          </button>
          <button type="button" class="btn-secondary" onclick={() => void copyJoinScript()}>
            <Icon name="copy" size={12} />
            Copy join script
          </button>
        </div>
      </div>
    </div>
  {:else if session.robloxRunning}
    <div class="surface flex items-center justify-between gap-4 px-4 py-4">
      <div class="flex items-center gap-3">
        <span class="h-1.5 w-1.5 rounded-full bg-caution"></span>
        <p class="text-xs text-ivory-400">
          Roblox is running but no experience has been joined yet.
        </p>
      </div>
      <button
        type="button"
        class="btn-ghost hover:text-negative"
        onclick={() => void closeRoblox()}
      >
        Close Roblox
      </button>
    </div>
  {:else}
    <div class="surface flex items-center justify-between gap-4 px-4 py-4">
      <div class="flex items-center gap-3">
        <span class="h-1.5 w-1.5 rounded-full bg-ivory-700"></span>
        <p class="text-xs text-ivory-500">Not in an experience.</p>
      </div>
      {#if activity.canRejoin}
        <button type="button" class="btn-secondary" onclick={() => void rejoin()}>
          <Icon name="refresh" size={12} />
          Rejoin last server
        </button>
      {/if}
    </div>
  {/if}
</Section>

<!-- Discord -->
<Section
  title="Discord"
  description="Rich presence uses Discord's local socket only — no account, token or network call is involved."
  class="mt-9"
>
  <SettingRow
    title="Rich presence"
    description="Show the experience you are playing on your Discord profile."
    for="rpc-enabled"
  >
    <Switch
      id="rpc-enabled"
      checked={config.enableDiscordRpc}
      onchange={(value) => void updateSettings({ enableDiscordRpc: value })}
    />
  </SettingRow>

  <SettingRow
    title="Include the server type"
    description="Adds “Public server” or “Private server” to the presence line. Turn this off to keep sessions vague."
    for="rpc-account"
  >
    <Switch
      id="rpc-account"
      checked={config.showAccountOnRpc}
      disabled={!config.enableDiscordRpc}
      onchange={(value) => void updateSettings({ showAccountOnRpc: value })}
    />
  </SettingRow>

  <SettingRow
    title="Discord application"
    description="The client ID Discord uses to name the presence. Create an application at discord.com/developers to make it read “RemielleStrap”."
    for="rpc-client-id"
  >
    <input
      id="rpc-client-id"
      class="field field-mono max-w-64"
      value={config.discordClientId}
      spellcheck="false"
      autocomplete="off"
      placeholder="1005469189907173486"
      disabled={!config.enableDiscordRpc}
      onblur={(event) => {
        const value = event.currentTarget.value.trim()
        if (value && /^\d{10,30}$/.test(value) && value !== config.discordClientId) {
          void updateSettings({ discordClientId: value })
        } else {
          event.currentTarget.value = config.discordClientId
        }
      }}
      onkeydown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  </SettingRow>

  <SettingRow title="Connection" description="Status of the local Discord IPC socket." stacked>
    <div
      class="flex items-center gap-3 rounded-control border border-ivory-200/8 bg-ink-950/40 px-3 py-2.5"
    >
      <span
        class="h-1.5 w-1.5 shrink-0 rounded-full {config.enableDiscordRpc && presence?.connected
          ? 'bg-positive'
          : 'bg-ivory-700'}"
      ></span>

      <div class="min-w-0 flex-1">
        {#if !config.enableDiscordRpc}
          <p class="text-xs text-ivory-500">Rich presence is off.</p>
        {:else if presence?.connected}
          <p class="truncate text-xs text-ivory-200">{presence.details ?? 'Connected'}</p>
          {#if presence.state}
            <p class="mt-0.5 truncate text-2xs text-ivory-600">{presence.state}</p>
          {/if}
        {:else}
          <p class="text-xs text-ivory-500">
            Waiting for Discord. RemielleStrap retries the socket every few seconds.
          </p>
        {/if}
      </div>

      <Icon
        name="discord"
        size={15}
        class={config.enableDiscordRpc && presence?.connected ? 'text-ivory-300' : 'text-ivory-700'}
      />
    </div>
  </SettingRow>
</Section>

<!-- Activity tracking -->
<Section
  title="Activity tracking"
  description="RemielleStrap tails the client log to learn which experience and server you joined. Nothing is uploaded; the log never leaves your machine."
  class="mt-9"
>
  <SettingRow
    title="Track experiences"
    description="Required for rejoining, the tray menu, session history and Discord presence."
    for="activity-enabled"
  >
    <Switch
      id="activity-enabled"
      checked={config.enableActivityTracking}
      onchange={(value) => void updateSettings({ enableActivityTracking: value })}
    />
  </SettingRow>

  <SettingRow
    title="Offer to rejoin after a disconnect"
    description="When the client closes while you were still in a server, RemielleStrap keeps the join details ready so one click puts you back."
    for="activity-rejoin"
    warning={config.enableActivityTracking ? undefined : 'Turn activity tracking on to use this.'}
  >
    <Switch
      id="activity-rejoin"
      checked={config.autoRejoinOnDisconnect}
      disabled={!config.enableActivityTracking}
      onchange={(value) => void updateSettings({ autoRejoinOnDisconnect: value })}
    />
  </SettingRow>
</Section>

<!-- History -->
<Section
  title="Recent experiences"
  description="The last few servers you joined, kept locally in State.json."
  class="mt-9"
  bare
>
  {#if history.length === 0}
    <EmptyState
      icon="clock"
      title="No sessions recorded yet"
      message="Launch an experience and it will appear here with its server and duration."
    />
  {:else}
    <ul class="surface overflow-hidden">
      {#each history as entry (entry.joinedAt + entry.placeId)}
        <li class="flex items-center gap-3 border-b border-ivory-200/5 px-4 py-3 last:border-b-0">
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs text-ivory-200">
              {placeLabel(entry.gameName, entry.placeId)}
            </p>
            <p class="mt-0.5 text-2xs text-ivory-600">
              {formatRelative(entry.joinedAt)}
              {#if entry.leftAt}
                · played for {formatDuration(entry.leftAt - entry.joinedAt)}
              {:else}
                · session not closed
              {/if}
            </p>
          </div>

          <span class="shrink-0 text-2xs uppercase tracking-[0.12em] text-ivory-700">
            {entry.serverType}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</Section>

<div class="h-5"></div>

<Section title="Presence" description="Exactly what the Discord card says, and when.">
  <SettingRow
    title="Mention the page you are on"
    description="While you are in the launcher, the presence follows you around the app — Accounts, Mods, Servers — instead of saying “In the launcher”."
  >
    <Switch
      checked={settings.value.rpcShowPage}
      onchange={(value) => void updateSettings({ rpcShowPage: value })}
    />
  </SettingRow>

  <SettingRow
    title="Show session playtime"
    description="Once a session has run for a minute, the state line becomes how long you have been playing."
  >
    <Switch
      checked={settings.value.rpcShowPlaytime}
      onchange={(value) => void updateSettings({ rpcShowPlaytime: value })}
    />
  </SettingRow>

  <SettingRow title="Idle line" description="What the second line says while nothing is running.">
    <Select
      value={settings.value.rpcStatusMode}
      options={[
        { value: 'game', label: 'The last experience played' },
        { value: 'generic', label: 'A plain tagline' }
      ]}
      onchange={(value) =>
        void updateSettings({ rpcStatusMode: value as typeof settings.value.rpcStatusMode })}
    />
  </SettingRow>

  <SettingRow
    title="Show the account name"
    description="Adds which stored account you are launching as."
  >
    <Switch
      checked={settings.value.showAccountOnRpc}
      onchange={(value) => void updateSettings({ showAccountOnRpc: value })}
    />
  </SettingRow>
</Section>

<div class="h-5"></div>

<Section
  title="Playtime"
  description="Sessions are timed between the client starting and exiting; anything under twenty seconds is ignored."
>
  <SettingRow
    title="Track playtime"
    description="Keeps per-game totals and the session history above."
  >
    <Switch
      checked={settings.value.trackPlaytime}
      onchange={(value) => void updateSettings({ trackPlaytime: value })}
    />
  </SettingRow>

  <SettingRow title="Tell me when a session ends" description="One toast with how long you played.">
    <Switch
      checked={settings.value.notifyPlaytimeOnExit}
      onchange={(value) => void updateSettings({ notifyPlaytimeOnExit: value })}
    />
  </SettingRow>

  <SettingRow
    title="Totals"
    description={`${totals.sessions} session(s) recorded${totals.firstLaunchAt ? ` since ${formatRelative(totals.firstLaunchAt)}` : ''}.`}
  >
    <div class="flex items-center gap-3 text-xs text-ivory-300">
      <span class="font-medium">{formatDuration(totals.totalMs)}</span>
      {#if sessionLabel}
        <span class="chip border-positive/30 text-positive">now: {sessionLabel}</span>
      {/if}
      <button
        type="button"
        class="btn-ghost px-2 py-1 text-2xs"
        onclick={() => (confirmReset = true)}
      >
        Clear
      </button>
    </div>
  </SettingRow>

  {#if totals.games.length > 0}
    <SettingRow title="Most played" stacked>
      <ul class="space-y-1">
        {#each [...totals.games]
          .sort((a, b) => b.totalMs - a.totalMs)
          .slice(0, 6) as game (game.placeId)}
          <li class="flex items-center gap-2 text-2xs">
            {#if game.thumbnailUrl}
              <img
                src={game.thumbnailUrl}
                alt=""
                class="h-6 w-9 rounded object-cover"
                loading="lazy"
              />
            {/if}
            <span class="min-w-0 flex-1 truncate text-ivory-300"
              >{game.name || `Place ${game.placeId}`}</span
            >
            <span class="text-ivory-500">{formatDuration(game.totalMs)}</span>
          </li>
        {/each}
      </ul>
    </SettingRow>
  {/if}
</Section>

<div class="h-5"></div>

<Section
  title="Roblox Studio"
  description="Studio cannot be observed the way the player can, so a small companion plugin reports what you have open over a loopback connection."
>
  <SettingRow
    title="Publish Studio presence"
    description="Shows the place you are editing on Discord while Studio is open."
  >
    <Switch
      checked={settings.value.studioRpc}
      onchange={(value) => void updateSettings({ studioRpc: value })}
    />
  </SettingRow>

  <SettingRow
    title="Bridge"
    description={bridge
      ? bridge.listening
        ? `Listening on 127.0.0.1:${bridge.port}.`
        : 'Enabled, but not listening — the port may be in use.'
      : 'The bridge is switched off.'}
  >
    <Switch
      checked={settings.value.studioBridgeEnabled}
      onchange={(value) => void updateSettings({ studioBridgeEnabled: value })}
    />
  </SettingRow>

  <SettingRow
    title="Port"
    description="Change it if something else on this machine has taken the default."
  >
    <input
      type="number"
      class="field w-28 py-1.5 text-xs"
      min="1024"
      max="65535"
      value={settings.value.studioBridgePort}
      onblur={(event) =>
        void updateSettings({ studioBridgePort: Number(event.currentTarget.value) })}
    />
  </SettingRow>

  <SettingRow
    title="Companion plugin"
    description={bridge?.pluginInstalled
      ? `Installed at ${bridge.pluginPath ?? 'the Studio plugins folder'}.`
      : 'Writes RemielleStrap Presence.client.lua into Studio’s plugins folder.'}
  >
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="btn-secondary gap-1.5"
        disabled={installingPlugin}
        onclick={() => void installPlugin()}
      >
        <Icon name={installingPlugin ? 'spinner' : 'plug'} size={14} />
        {bridge?.pluginInstalled ? 'Reinstall' : 'Install plugin'}
      </button>

      {#if bridge?.lastReportAt}
        <span class="text-2xs text-ivory-500">
          last report {formatRelative(bridge.lastReportAt)}
        </span>
      {/if}
    </div>
  </SettingRow>

  {#if bridge?.placeName}
    <SettingRow title="Studio right now" description={`Editing ${bridge.placeName}`}>
      <span class="chip border-gold-500/30 text-gold-200">live</span>
    </SettingRow>
  {/if}
</Section>

{#if confirmReset}
  <Dialog
    title="Clear recorded playtime?"
    description="Totals and per-game figures are deleted. The session history in the activity list is left alone."
    onclose={() => (confirmReset = false)}
  >
    <div class="mt-4 flex justify-end gap-2">
      <button type="button" class="btn-ghost" onclick={() => (confirmReset = false)}>Keep it</button
      >
      <button
        type="button"
        class="btn-danger"
        onclick={() => {
          confirmReset = false
          void resetPlaytime()
        }}
      >
        Clear playtime
      </button>
    </div>
  </Dialog>
{/if}
