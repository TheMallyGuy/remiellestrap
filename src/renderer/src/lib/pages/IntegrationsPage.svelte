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
  import { formatDuration, formatRelative, placeLabel } from '../utils/format'
  import EmptyState from '../components/EmptyState.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'

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
