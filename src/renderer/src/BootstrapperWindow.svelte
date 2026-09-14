<script lang="ts">
  import type { LauncherDefinition, BootstrapperStage } from '@shared/models'
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

  /**
   * The install and launch window.
   *
   * It carries the launcher style: five built-in looks plus a user-defined one,
   * which is why almost nothing here is hard-coded to a colour. The shipped
   * "Fluent" style is the design the app was drawn around; the others exist
   * because a bootstrapper is the one screen people look at for minutes at a
   * time, and some of them would rather it looked like 2016.
   */

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

  interface LauncherTheme {
    background: string
    text: string
    muted: string
    accent: string
    surface: string
    border: string
    radius: string
    bar: string
    progress: 'bar' | 'spinner' | 'dots'
    art: boolean
    /** Roblox's old installer had a light panel with dark type. */
    light: boolean
    css: string
    messages: Partial<Record<BootstrapperStage, string>>
  }

  /** The shipped looks, each one a colour decision rather than a layout one. */
  const STYLES: Record<string, Partial<LauncherTheme>> = {
    fluent: {},
    classic: {
      background: '#e8e8e8',
      text: '#26303a',
      muted: '#66707a',
      accent: '#1e7dd7',
      surface: 'rgba(255,255,255,0.62)',
      border: 'rgba(38,48,58,0.16)',
      radius: '3px',
      bar: '4px',
      art: false,
      light: true
    },
    byfron: {
      background: '#08090b',
      text: '#e7e9ec',
      muted: '#7d838c',
      accent: '#e7e9ec',
      surface: 'rgba(255,255,255,0.03)',
      border: 'rgba(255,255,255,0.08)',
      radius: '2px',
      bar: '2px',
      art: false,
      progress: 'bar'
    },
    minimal: {
      background: '#0a0a0b',
      text: '#f7f5ef',
      muted: '#8a8577',
      accent: '#c19d4e',
      surface: 'transparent',
      border: 'rgba(247,245,239,0.10)',
      radius: '0px',
      bar: '1px',
      art: false,
      progress: 'bar'
    }
  }

  const custom = $derived.by<LauncherDefinition | null>(() => {
    if (settings.value.launcherStyle !== 'custom') return null

    try {
      const parsed = JSON.parse(settings.value.launcherCustom) as Partial<LauncherDefinition>

      // The editor validates before saving; this guard only protects the
      // window from a settings file edited by hand.
      if (typeof parsed.name !== 'string' || typeof parsed.title !== 'string') return null
      return parsed as LauncherDefinition
    } catch {
      return null
    }
  })

  const theme = $derived.by<LauncherTheme>(() => {
    const base: LauncherTheme = {
      background: '#0a0a0b',
      text: '#f7f5ef',
      muted: '#8a8577',
      accent: '#c19d4e',
      surface: 'rgba(14,14,16,0.72)',
      border: 'rgba(247,245,239,0.08)',
      radius: '10px',
      bar: '4px',
      progress: 'bar',
      art: true,
      light: false,
      css: '',
      messages: {}
    }

    if (custom) {
      return {
        ...base,
        background: custom.background || base.background,
        text: custom.textColor || base.text,
        accent: custom.accent || base.accent,
        radius: '8px',
        progress: custom.progress,
        art: custom.showArt,
        css: custom.customCss ?? '',
        messages: custom.messages ?? {}
      }
    }

    return { ...base, ...(STYLES[settings.value.launcherStyle] ?? {}) }
  })

  const progress = $derived(bootstrapper.progress)
  const failure = $derived(bootstrapper.failure)
  const stage = $derived(progress.stage)
  const finished = $derived(stage === 'done' || stage === 'running')
  const stopped = $derived(stage === 'cancelled' || stage === 'error' || Boolean(failure))
  const terminal = $derived(finished || stopped)

  /** The stage label, overridden by the custom definition when it says so. */
  const label = $derived(theme.messages[stage] ?? STAGE_LABELS[stage])

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

  const showArt = $derived(
    theme.art && settings.value.showBootstrapperArt && settings.value.launcherStyle !== 'classic'
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
    if (showArt) void loadArt('bootstrapper')
  }

  /**
   * A custom launcher definition may carry its own CSS. It is applied as text
   * on a `<style>` element rather than injected as markup, so nothing in the
   * definition can ever be parsed as HTML.
   */
  $effect(() => {
    const css = theme.css
    if (!css) return

    const element = document.createElement('style')
    element.textContent = css
    document.head.appendChild(element)

    return () => element.remove()
  })
</script>

<svelte:head>
  <title
    >{stage === 'launching' || stage === 'running' ? 'Launching' : 'Installing'} Roblox — RemielleStrap</title
  >
</svelte:head>

<div
  class="flex h-screen flex-col overflow-hidden antialiased transition-colors duration-300"
  style="background: {theme.background}; color: {theme.text}; --launcher-accent: {theme.accent};"
>
  <header
    class="drag relative z-20 flex h-10 shrink-0 items-center justify-between pl-3 select-none"
    style="border-bottom: 1px solid {theme.border};"
  >
    <div class="flex items-center gap-2.5">
      <span style="color: {theme.accent}"><Icon name="prism" size={13} /></span>
      <span class="display text-[0.75rem] tracking-[0.18em] uppercase" style="color: {theme.muted}">
        Remielle<span style="color: {theme.accent}">Strap</span>
      </span>
      {#if settings.value.launcherStyle !== 'fluent'}
        <span class="chip" style="border-color: {theme.border}; color: {theme.muted}">
          {custom ? custom.name : settings.value.launcherStyle}
        </span>
      {/if}
    </div>

    <div class="no-drag flex h-full items-stretch">
      <button
        type="button"
        class="flex w-11 items-center justify-center transition-colors hover:bg-black/10"
        style="color: {theme.muted}"
        onclick={() => void api.window.minimize()}
        aria-label="Minimise"
        title="Minimise"
      >
        <Icon name="minus" size={13} />
      </button>
      <button
        type="button"
        class="flex w-11 items-center justify-center text-ivory-500 transition-colors hover:bg-negative/80 hover:text-ivory-50"
        style="color: {theme.muted}"
        onclick={() => void api.window.close()}
        aria-label="Close"
        title="Close (installation will continue)"
      >
        <Icon name="x" size={13} />
      </button>
    </div>
  </header>

  <main class="relative min-h-0 flex-1 overflow-hidden">
    {#if showArt}
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
        class="pointer-events-none absolute inset-0"
        style="background: linear-gradient(to top, {theme.background}, {theme.background}dd 45%, {theme.background}66)"
      ></div>
    {/if}

    <div class="relative flex h-full flex-col justify-end p-7">
      <div class="mb-2 flex items-end justify-between gap-4">
        <div class="min-w-0">
          <p
            class="mb-1 text-2xs font-medium uppercase tracking-[0.18em]"
            style="color: {theme.accent}; opacity: 0.8"
          >
            {custom?.title ??
              (stage === 'launching' || stage === 'running' ? 'Launching' : 'Roblox setup')}
          </p>
          <h1 class="display truncate text-[1.75rem] leading-none" style="color: {theme.text}">
            {label}
          </h1>
        </div>

        {#if fraction !== null && !terminal && theme.progress === 'bar'}
          <span class="shrink-0 font-mono text-xs tabular-nums" style="color: {theme.accent}">
            {percent(fraction)}
          </span>
        {/if}
      </div>

      <p class="mb-4 min-h-5 truncate text-[0.8125rem]" style="color: {theme.muted}">
        {failure?.message ?? progress.message}
      </p>

      <!-- The progress indicator, in whichever shape the style asks for. -->
      {#if theme.progress === 'spinner'}
        <div class="flex h-6 items-center">
          <span
            class="h-5 w-5 rounded-full border-2 border-transparent"
            style="border-top-color: {theme.accent}; border-right-color: {theme.accent}; animation: spin-slow 0.9s linear infinite"
          ></span>
        </div>
      {:else if theme.progress === 'dots'}
        <div class="flex h-6 items-center gap-1.5">
          {#each [0, 1, 2] as dot (dot)}
            <span
              class="h-1.5 w-1.5 rounded-full"
              style="background: {terminal ? theme.muted : theme.accent}; opacity: {dot === 0
                ? 1
                : dot === 1
                  ? 0.65
                  : 0.35}"
            ></span>
          {/each}
        </div>
      {:else}
        <div
          class="relative w-full overflow-hidden rounded-full"
          style="height: {theme.bar}; background: {theme.surface}; border: 1px solid {theme.border}"
        >
          {#if stopped}
            <div
              class="absolute inset-0"
              style="background: {stage === 'cancelled' ? theme.muted : 'var(--color-negative)'}"
            ></div>
          {:else if finished}
            <div class="absolute inset-0" style="background: var(--color-positive)"></div>
          {:else if fraction !== null}
            <div
              class="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
              style="width: {fraction * 100}%; background: {theme.accent}"
            ></div>
          {:else}
            <div
              class="absolute inset-y-0 w-1/3 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-full"
              style="background: linear-gradient(90deg, transparent, {theme.accent}, transparent);"
            ></div>
          {/if}
        </div>
      {/if}

      <div class="mt-3 flex min-h-8 items-start justify-between gap-4">
        <div class="min-w-0 text-2xs" style="color: {theme.muted}">
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
            <button
              type="button"
              class="rounded px-3 py-1.5 text-xs transition-opacity hover:opacity-85"
              style="background: {theme.surface}; border: 1px solid {theme.border}; color: {theme.text}"
              onclick={() => void cancel()}
            >
              Cancel
            </button>
          {:else if terminal}
            <button
              type="button"
              class="rounded px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
              style="background: {theme.accent}; color: {theme.light
                ? '#ffffff'
                : theme.background}"
              onclick={() => void api.window.close()}
            >
              {finished ? 'Done' : 'Close'}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </main>
</div>
