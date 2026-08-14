<script lang="ts">
  import { fade } from 'svelte/transition'
  import type { BootstrapperStage } from '@shared/models'
  import { bootstrapper, cancel, closeOverlay } from '../stores/bootstrapper.svelte'
  import { settings } from '../stores/settings.svelte'
  import { formatBytes, percent } from '../utils/format'
  import ArtSlot from '../components/ArtSlot.svelte'
  import Icon from '../components/Icon.svelte'

  /**
   * The install / launch overlay.
   *
   * This is what a deep link opens straight into: full-bleed Remielle art, a
   * single determinate bar, and the stage written out in plain language. It
   * covers the whole window so nothing else competes with it.
   */

  const STAGE_LABELS: Record<BootstrapperStage, string> = {
    idle: 'Ready',
    connecting: 'Connecting',
    checking: 'Checking for updates',
    downloading: 'Downloading',
    extracting: 'Extracting',
    configuring: 'Configuring',
    'applying-mods': 'Applying mods',
    'writing-flags': 'Writing FastFlags',
    launching: 'Launching',
    running: 'Running',
    cancelled: 'Cancelled',
    done: 'Finished',
    error: 'Failed'
  }

  const progress = $derived(bootstrapper.progress)
  const failure = $derived(bootstrapper.failure)
  const stage = $derived(progress.stage)

  const finished = $derived(stage === 'done' || stage === 'running')
  const stopped = $derived(stage === 'cancelled' || stage === 'error' || Boolean(failure))
  const closable = $derived(finished || stopped)

  /** Determinate bars get a width; indeterminate ones get a travelling sliver. */
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

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && closable) closeOverlay()
  }
</script>

<svelte:window on:keydown={onkeydown} />

{#if bootstrapper.overlayOpen}
  <div
    class="fixed inset-0 top-9 z-30 flex flex-col overflow-hidden bg-ink-950"
    transition:fade={{ duration: 180 }}
    role="dialog"
    aria-modal="true"
    aria-label="Roblox bootstrapper"
  >
    {#if settings.value.showBootstrapperArt}
      <!-- The dedicated bootstrapper art slot, full bleed behind everything. -->
      <ArtSlot
        slot="bootstrapper"
        class="absolute inset-0 h-full w-full"
        focus="32%"
        scrim="none"
        attribution={true}
        shuffle={!bootstrapper.busy}
        drift={!settings.value.reduceMotion}
        rounded="rounded-none"
      />
      <div
        class="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/80 to-ink-950/45"
      ></div>
      <div
        class="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_-10%,transparent,var(--color-ink-950)_78%)]"
      ></div>
    {:else}
      <div class="absolute inset-0 bg-ink-950"></div>
    {/if}

    <div class="relative flex flex-1 flex-col justify-end p-9">
      <div class="mx-auto w-full max-w-xl">
        <!-- Stage -->
        <div class="mb-2 flex items-baseline justify-between gap-4">
          <h2 class="display text-2xl leading-none text-ivory-50">
            {STAGE_LABELS[stage] ?? 'Working'}
          </h2>

          {#if fraction !== null && !stopped && !finished}
            <span class="font-mono text-xs tabular-nums text-gold-300/90">
              {percent(fraction)}
            </span>
          {/if}
        </div>

        <p class="mb-5 min-h-[1.25rem] text-[0.8125rem] text-ivory-400">
          {failure?.message ?? progress.message}
        </p>

        <!-- Progress bar -->
        <div class="relative h-[3px] w-full overflow-hidden rounded-full bg-ivory-200/10">
          {#if stopped}
            <div
              class="absolute inset-y-0 left-0 w-full {stage === 'cancelled'
                ? 'bg-ivory-500/60'
                : 'bg-negative/80'}"
            ></div>
          {:else if finished}
            <div class="absolute inset-y-0 left-0 w-full bg-positive/80"></div>
          {:else if fraction !== null}
            <div
              class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-gold-500 to-gold-300 transition-[width] duration-300 ease-out"
              style="width: {fraction * 100}%"
            ></div>
          {:else}
            <!-- Indeterminate: a refracted sliver sweeping the track. -->
            <div
              class="absolute inset-y-0 w-1/3 animate-[shimmer_1.4s_ease-in-out_infinite] rounded-full"
              style="background: linear-gradient(90deg, transparent, var(--color-gold-300), transparent); background-size: 100% 100%;"
            ></div>
          {/if}
        </div>

        <!-- Detail line -->
        <div
          class="mt-3 flex min-h-[1rem] flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-ivory-500"
        >
          {#if progress.currentPackage}
            <span class="font-mono">{progress.currentPackage}</span>
          {/if}
          {#if byteLine}
            <span class="tabular-nums">{byteLine}</span>
          {/if}
          {#if packageLine}
            <span class="tabular-nums">{packageLine}</span>
          {/if}
          {#if progress.version}
            <span class="font-mono">{progress.version}</span>
          {/if}
          {#if failure?.detail}
            <span class="text-negative/80" data-selectable>{failure.detail}</span>
          {:else if progress.detail}
            <span>{progress.detail}</span>
          {/if}
        </div>

        <!-- Actions: exactly one primary at a time. -->
        <div class="mt-7 flex items-center justify-end gap-2">
          {#if progress.cancellable && !closable}
            <button type="button" class="btn-secondary" onclick={() => void cancel()}>
              <Icon name="x" size={13} />
              Cancel
            </button>
          {:else if closable}
            <button type="button" class="btn-primary" onclick={closeOverlay}>
              {finished ? 'Done' : 'Close'}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
