<script lang="ts">
  import type { BootstrapperStage } from '@shared/models'
  import { api, listen } from './lib/ipc'
  import { loadArt } from './lib/stores/art.svelte'
  import {
    applyComplete,
    applyError,
    applyProgress,
    bootstrapper,
    cancel,
    syncProgress
  } from './lib/stores/bootstrapper.svelte'
  import { loadSettings, settings } from './lib/stores/settings.svelte'
  import { formatBytes, percent } from './lib/utils/format'
  import ArtSlot from './lib/components/ArtSlot.svelte'
  import Icon from './lib/components/Icon.svelte'

  const STAGE_LABELS: Record<BootstrapperStage, string> = {
    idle: 'Preparing Roblox',
    connecting: 'Connecting to Roblox',
    checking: 'Checking for updates',
    downloading: 'Installing Roblox',
    extracting: 'Installing Roblox',
    configuring: 'Finishing installation',
    'applying-mods': 'Applying mods',
    'writing-flags': 'Writing FastFlags',
    launching: 'Launching Roblox',
    running: 'Roblox is running',
    cancelled: 'Installation cancelled',
    done: 'Roblox is ready',
    error: 'Installation failed'
  }

  const progress = $derived(bootstrapper.progress)
  const failure = $derived(bootstrapper.failure)
  const stage = $derived(progress.stage)
  const finished = $derived(stage === 'done' || stage === 'running')
  const stopped = $derived(stage === 'cancelled' || stage === 'error' || Boolean(failure))
  const terminal = $derived(finished || stopped)
  const fraction = $derived(
    progress.progress !== null && Number.isFinite(progress.progress)
      ? Math.min(1, Math.max(0, progress.progress))
      : null
  )
  const byteLine = $derived(
    progress.bytesTotal
      ? `${formatBytes(progress.bytesDownloaded ?? 0)} of ${formatBytes(progress.bytesTotal)}`
      : null
  )
  const packageLine = $derived(
    progress.packagesTotal
      ? `Package ${progress.packagesDone ?? 0} of ${progress.packagesTotal}`
      : null
  )

  $effect(() => {
    const off = [
      listen('bootstrapper:progress', applyProgress),
      listen('bootstrapper:complete', applyComplete),
      listen('bootstrapper:error', applyError)
    ]

    void initialise()
    return () => off.forEach((unsubscribe) => unsubscribe())
  })

  async function initialise(): Promise<void> {
    await Promise.all([loadSettings(), syncProgress()])
    if (settings.value.showBootstrapperArt) void loadArt('bootstrapper')
  }
</script>

<svelte:head>
  <title
    >{stage === 'launching' || stage === 'running' ? 'Launching' : 'Installing'} Roblox — RemielleStrap</title
  >
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden bg-ink-950 text-ivory-200 antialiased">
  <header
    class="drag relative z-20 flex h-10 shrink-0 items-center justify-between border-b border-ivory-200/8 bg-ink-900/90 pl-3 select-none"
  >
    <div class="flex items-center gap-2.5">
      <span class="text-gold-400/80"><Icon name="prism" size={13} /></span>
      <span class="display text-[0.75rem] tracking-[0.18em] text-ivory-300 uppercase">
        Remielle<span class="text-gold-400/90">Strap</span>
      </span>
    </div>

    <div class="no-drag flex h-full items-stretch">
      <button
        type="button"
        class="flex w-11 items-center justify-center text-ivory-500 transition-colors hover:bg-ivory-100/6 hover:text-ivory-100"
        onclick={() => void api.window.minimize()}
        aria-label="Minimise"
        title="Minimise"
      >
        <Icon name="minus" size={13} />
      </button>
      <button
        type="button"
        class="flex w-11 items-center justify-center text-ivory-500 transition-colors hover:bg-negative/80 hover:text-ivory-50"
        onclick={() => void api.window.close()}
        aria-label="Close"
        title="Close (installation will continue)"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  </header>

  <main class="relative min-h-0 flex-1 overflow-hidden">
    {#if settings.value.showBootstrapperArt}
      <ArtSlot
        slot="bootstrapper"
        class="absolute inset-0 h-full w-full"
        focus="30%"
        scrim="none"
        attribution={false}
        shuffle={false}
        drift={!settings.value.reduceMotion}
        rounded="rounded-none"
      />
      <div
        class="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/88 to-ink-950/55"
      ></div>
    {/if}

    <div class="relative flex h-full flex-col justify-end p-7">
      <div class="mb-2 flex items-end justify-between gap-4">
        <div class="min-w-0">
          <p class="mb-1 text-2xs font-medium uppercase tracking-[0.18em] text-gold-300/75">
            {stage === 'launching' || stage === 'running' ? 'Launching' : 'Roblox setup'}
          </p>
          <h1 class="display truncate text-[1.75rem] leading-none text-ivory-50">
            {STAGE_LABELS[stage]}
          </h1>
        </div>

        {#if fraction !== null && !terminal}
          <span class="shrink-0 font-mono text-xs tabular-nums text-gold-300">
            {percent(fraction)}
          </span>
        {/if}
      </div>

      <p class="mb-4 min-h-5 truncate text-[0.8125rem] text-ivory-400">
        {failure?.message ?? progress.message}
      </p>

      <div class="relative h-1 w-full overflow-hidden rounded-full bg-ivory-200/10">
        {#if stopped}
          <div
            class="absolute inset-0 {stage === 'cancelled' ? 'bg-ivory-500/60' : 'bg-negative/85'}"
          ></div>
        {:else if finished}
          <div class="absolute inset-0 bg-positive/85"></div>
        {:else if fraction !== null}
          <div
            class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-500 to-gold-300 transition-[width] duration-300"
            style="width: {fraction * 100}%"
          ></div>
        {:else}
          <div
            class="absolute inset-y-0 w-1/3 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-full"
            style="background: linear-gradient(90deg, transparent, var(--color-gold-300), transparent);"
          ></div>
        {/if}
      </div>

      <div class="mt-3 flex min-h-8 items-start justify-between gap-4">
        <div class="min-w-0 text-2xs text-ivory-500">
          <p class="truncate font-mono">
            {failure?.detail ??
              progress.detail ??
              progress.currentPackage ??
              progress.version ??
              ''}
          </p>
          {#if byteLine || packageLine}
            <p class="mt-1 flex gap-3 tabular-nums">
              {#if byteLine}<span>{byteLine}</span>{/if}
              {#if packageLine}<span>{packageLine}</span>{/if}
            </p>
          {/if}
        </div>

        <div class="shrink-0">
          {#if progress.cancellable && !terminal}
            <button type="button" class="btn-secondary" onclick={() => void cancel()}>
              Cancel
            </button>
          {:else if terminal}
            <button type="button" class="btn-primary" onclick={() => void api.window.close()}>
              {finished ? 'Done' : 'Close'}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </main>
</div>
