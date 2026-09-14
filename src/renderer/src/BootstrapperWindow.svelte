<script lang="ts">
  import { untrack } from 'svelte'
  import type { BootstrapperProgress, BootstrapperStage, LauncherDefinition } from '@shared/models'
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
  import { formatBytes, formatDuration, percent, shortVersion } from './lib/utils/format'
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
   *
   * The status card at the bottom is the whole point of the window: the current
   * stage, a step tracker for the pipeline, live download figures (bytes,
   * speed, ETA), package progress and the version being installed.
   */

  const STAGE_LABELS: Record<BootstrapperStage, string> = {
    idle: 'Preparing Roblox',
    connecting: 'Connecting to Roblox',
    checking: 'Checking for updates',
    downloading: 'Downloading Roblox',
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

  const IDLE_FALLBACK: BootstrapperProgress = {
    stage: 'idle',
    progress: null,
    message: 'Ready',
    cancellable: false
  }

  // The panel below must never render empty: even if the main process has not
  // reported yet (or a stale payload arrives), the window shows idle status.
  const safe = $derived(bootstrapper.progress ?? IDLE_FALLBACK)
  const progress = $derived(safe)
  const failure = $derived(bootstrapper.failure)
  const stage = $derived(safe.stage ?? 'idle')
  const finished = $derived(stage === 'done' || stage === 'running')
  const stopped = $derived(stage === 'cancelled' || stage === 'error' || Boolean(failure))
  const terminal = $derived(finished || stopped)

  /** The stage label, overridden by the custom definition when it says so. */
  const label = $derived(theme.messages[stage] ?? STAGE_LABELS[stage] ?? STAGE_LABELS.idle)

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
  const detailLine = $derived(
    failure?.detail ?? progress.detail ?? progress.currentPackage ?? progress.version ?? ''
  )

  /* -------------------------------------------------- download speed + ETA */

  interface ByteSample {
    at: number
    bytes: number
  }

  let samples = $state<ByteSample[]>([])

  $effect(() => {
    const currentStage = safe.stage
    const bytes = safe.bytesDownloaded ?? 0

    // The sample list is managed inside `untrack` so appending a sample does
    // not re-trigger the effect it runs in.
    untrack(() => {
      if (currentStage !== 'downloading') {
        if (samples.length > 0) samples = []
        return
      }
      const last = samples[samples.length - 1]
      // A new run restarts the byte count from zero.
      if (last && bytes < last.bytes) {
        samples = [{ at: Date.now(), bytes }]
        return
      }
      if (last && bytes === last.bytes) return
      samples = [...samples.slice(-11), { at: Date.now(), bytes }]
    })
  })

  /** Rolling throughput over the last few seconds, or null while unknown. */
  const speedBps = $derived.by<number | null>(() => {
    if (samples.length < 2) return null
    const first = samples[0]
    const last = samples[samples.length - 1]
    const dt = (last.at - first.at) / 1000
    if (dt < 0.5) return null
    const db = last.bytes - first.bytes
    return db > 0 ? db / dt : null
  })

  const etaMs = $derived.by<number | null>(() => {
    if (safe.stage !== 'downloading' || !speedBps) return null
    const total = safe.bytesTotal ?? 0
    const done = safe.bytesDownloaded ?? 0
    if (total <= 0 || done >= total) return null
    return ((total - done) / speedBps) * 1000
  })

  const speedLine = $derived(
    safe.stage === 'downloading' ? (speedBps ? `${formatBytes(speedBps)}/s` : '…') : null
  )
  const etaLine = $derived(etaMs ? `ETA ${formatDuration(etaMs)}` : null)

  /* ---------------------------------------------------------- step tracker */

  interface StepDef {
    id: string
    label: string
  }

  const STEPS: StepDef[] = [
    { id: 'connecting', label: 'Connect' },
    { id: 'checking', label: 'Check' },
    { id: 'downloading', label: 'Download' },
    { id: 'extracting', label: 'Install' },
    { id: 'applying-mods', label: 'Mods' },
    { id: 'writing-flags', label: 'Flags' },
    { id: 'launching', label: 'Launch' },
    { id: 'running', label: 'Play' }
  ]

  /** Maps every stage onto its step index; -1 means "no step yet". */
  const STEP_INDEX: Record<BootstrapperStage, number> = {
    idle: -1,
    connecting: 0,
    checking: 1,
    downloading: 2,
    extracting: 3,
    configuring: 3,
    'applying-mods': 4,
    'writing-flags': 5,
    launching: 6,
    running: 7,
    done: 7,
    cancelled: -1,
    error: -1
  }

  /** Furthest step reached this run, so a failure can mark where it stopped. */
  let peakStep = $state(-1)

  $effect(() => {
    const current = STEP_INDEX[safe.stage] ?? -1
    untrack(() => {
      if (safe.stage === 'idle') {
        if (peakStep !== -1) peakStep = -1
        return
      }
      if (current > peakStep) peakStep = current
    })
  })

  type StepState = 'done' | 'current' | 'failed' | 'todo'

  const stepStates = $derived.by<StepState[]>(() => {
    if (finished) return STEPS.map(() => 'done' as StepState)
    if (stage === 'error' || stage === 'cancelled') {
      return STEPS.map((_step, index) => {
        if (index < peakStep) return 'done'
        if (index === peakStep) return 'failed'
        return 'todo'
      })
    }
    const current = STEP_INDEX[stage] ?? -1
    return STEPS.map((_step, index) => {
      if (index < current) return 'done'
      if (index === current) return 'current'
      return 'todo'
    })
  })

  /* ---------------------------------------------------------------- status */

  /** Eyebrow copy for the card header. */
  const eyebrow = $derived(
    custom?.title ??
      (stage === 'error'
        ? 'Failed'
        : stage === 'cancelled'
          ? 'Cancelled'
          : finished
            ? 'Ready'
            : stage === 'launching' || stage === 'running'
              ? 'Launching'
              : 'Roblox setup')
  )

  const statusColor = $derived(
    stage === 'error'
      ? 'var(--color-negative)'
      : stage === 'cancelled'
        ? theme.muted
        : finished
          ? 'var(--color-positive)'
          : theme.accent
  )

  const showArt = $derived(
    theme.art && settings.value.showBootstrapperArt && settings.value.launcherStyle !== 'classic'
  )

  let retrying = $state(false)

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

  /** Re-runs the install after a failure. Only offered on the error stage. */
  async function retry(): Promise<void> {
    if (retrying || stage !== 'error') return
    retrying = true
    try {
      await api.bootstrapper.install(false)
    } finally {
      retrying = false
    }
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
        style="background: linear-gradient(to top, {theme.background}, {theme.background}f2 52%, {theme.background}66)"
      ></div>
    {/if}

    <div class="relative flex h-full flex-col justify-end gap-2.5 p-5">
      <!-- Pipeline step tracker. -->
      <ol
        class="flex items-center rounded-full border px-4 py-2 backdrop-blur-md"
        style="background: {theme.surface}; border-color: {theme.border};"
        aria-label="Installation progress"
      >
        {#each STEPS as step, index (step.id)}
          {@const state = stepStates[index]}
          <li class="flex min-w-0 items-center gap-1.5">
            <span
              class="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border"
              style={state === 'done'
                ? `background: ${theme.accent}; border-color: ${theme.accent}; color: ${theme.background}`
                : state === 'current'
                  ? `border-color: ${theme.accent}; color: ${theme.accent}`
                  : state === 'failed'
                    ? 'background: var(--color-negative); border-color: var(--color-negative); color: #fff'
                    : `border-color: ${theme.border}; color: ${theme.muted}`}
              aria-hidden="true"
            >
              {#if state === 'done'}
                <Icon name="check" size={9} />
              {:else if state === 'failed'}
                <Icon name="x" size={9} />
              {:else if state === 'current'}
                <span
                  class="h-1.5 w-1.5 animate-pulse rounded-full"
                  style="background: {theme.accent}"
                ></span>
              {/if}
            </span>
            <span
              class="truncate text-2xs {state === 'current' || state === 'failed'
                ? 'font-medium'
                : ''}"
              style="color: {state === 'todo' ? theme.muted : theme.text}"
            >
              {step.label}
            </span>
          </li>
          {#if index < STEPS.length - 1}
            <li
              class="mx-2 h-px min-w-2 flex-1"
              style="background: {stepStates[index + 1] === 'todo'
                ? theme.border
                : theme.accent}; opacity: {stepStates[index + 1] === 'todo' ? 1 : 0.55}"
              aria-hidden="true"
            ></li>
          {/if}
        {/each}
      </ol>

      <!-- Status card: stage, message, bar, live figures and actions. -->
      <section
        class="border backdrop-blur-md"
        style="background: {theme.surface}; border-color: {theme.border}; border-radius: {theme.radius};"
        aria-live="polite"
      >
        <div class="p-4 pb-3.5">
          <div class="flex items-center justify-between gap-3">
            <p
              class="flex min-w-0 items-center gap-2 text-2xs font-medium uppercase tracking-[0.18em]"
              style="color: {statusColor}"
            >
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full {terminal ? '' : 'animate-pulse'}"
                style="background: {statusColor}"
              ></span>
              <span class="truncate">{eyebrow}</span>
            </p>
            {#if progress.version}
              <span
                class="chip shrink-0 font-mono"
                style="border-color: {theme.border}; color: {theme.muted}"
                title={progress.version}
              >
                {shortVersion(progress.version)}
              </span>
            {/if}
          </div>

          <div class="mt-1.5 flex items-end justify-between gap-4">
            <h1 class="display min-w-0 flex-1 truncate text-[1.6rem] leading-tight">
              {label}
            </h1>
            {#if fraction !== null && theme.progress === 'bar'}
              <span
                class="shrink-0 pb-1 font-mono text-xs tabular-nums"
                style="color: {statusColor}"
              >
                {percent(fraction)}
              </span>
            {/if}
          </div>

          <p class="mt-0.5 min-h-5 truncate text-[0.8125rem]" style="color: {theme.muted}">
            {failure?.message ?? progress.message}
          </p>

          <!-- The progress indicator, in whichever shape the style asks for. -->
          <div class="mt-2.5">
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
                style="height: {theme.bar}; background: {theme.background}; border: 1px solid {theme.border}"
              >
                {#if stopped}
                  <div
                    class="absolute inset-0"
                    style="background: {stage === 'cancelled'
                      ? theme.muted
                      : 'var(--color-negative)'}"
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
          </div>

          {#if byteLine || speedLine || etaLine || packageLine}
            <dl
              class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs tabular-nums"
              style="color: {theme.muted}"
            >
              {#if byteLine}
                <div class="flex items-center gap-1.5">
                  <Icon name="download" size={11} />
                  <span>{byteLine}</span>
                </div>
              {/if}
              {#if speedLine}
                <div class="flex items-center gap-1.5">
                  <Icon name="gauge" size={11} />
                  <span>{speedLine}</span>
                </div>
              {/if}
              {#if etaLine}
                <div class="flex items-center gap-1.5">
                  <Icon name="clock" size={11} />
                  <span>{etaLine}</span>
                </div>
              {/if}
              {#if packageLine}
                <div class="flex items-center gap-1.5">
                  <Icon name="layers" size={11} />
                  <span>{packageLine}</span>
                </div>
              {/if}
            </dl>
          {/if}

          <div class="mt-2.5 flex min-h-8 items-center justify-between gap-4">
            <p class="min-w-0 flex-1 truncate font-mono text-2xs" style="color: {theme.muted}">
              {detailLine}
            </p>

            <div class="flex shrink-0 items-center gap-2">
              {#if progress.cancellable && !terminal}
                <button
                  type="button"
                  class="rounded px-3 py-1.5 text-xs transition-opacity hover:opacity-85"
                  style="background: {theme.background}; border: 1px solid {theme.border}; color: {theme.text}"
                  onclick={() => void cancel()}
                >
                  Cancel
                </button>
              {:else if terminal}
                {#if stage === 'error'}
                  <button
                    type="button"
                    class="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90 disabled:opacity-60"
                    style="background: {theme.accent}; color: {theme.light
                      ? '#ffffff'
                      : theme.background}"
                    onclick={() => void retry()}
                    disabled={retrying}
                  >
                    <Icon
                      name={retrying ? 'spinner' : 'refresh'}
                      size={12}
                      class={retrying ? 'animate-spin' : ''}
                    />
                    Retry
                  </button>
                {/if}
                <button
                  type="button"
                  class="rounded px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
                  style={stage === 'error'
                    ? `background: ${theme.background}; border: 1px solid ${theme.border}; color: ${theme.text}`
                    : `background: ${theme.accent}; color: ${theme.light ? '#ffffff' : theme.background}`}
                  onclick={() => void api.window.close()}
                >
                  {finished ? 'Done' : 'Close'}
                </button>
              {/if}
            </div>
          </div>
        </div>
      </section>
    </div>
  </main>
</div>
