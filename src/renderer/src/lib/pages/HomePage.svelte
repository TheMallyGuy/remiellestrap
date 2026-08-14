<script lang="ts">
  import {
    activity,
    closeRoblox,
    copyJoinScript,
    openGamePage,
    rejoin
  } from '../stores/activity.svelte'
  import { bootstrapper, checkForUpdates, install, launch } from '../stores/bootstrapper.svelte'
  import { settings } from '../stores/settings.svelte'
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
</div>
