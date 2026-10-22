<script lang="ts">
  import type { OverlayStats } from '@shared/models'
  import { OVERLAY_WIDGET_CATALOG, regionById, type OverlayWidgetDefinition } from '@shared/catalog'
  import { api, listen } from './lib/ipc'
  import { applyAccent, applyCustomFont, applyReduceMotion, applyThemeMode } from './lib/appearance'
  import { applyExternalSettings, loadSettings, settings } from './lib/stores/settings.svelte'
  import { formatBytes } from './lib/utils/format'

  /**
   * The in-game overlay.
   *
   * A card drawn on top of the Roblox client, sized by its own content: the
   * window reports what it measured back to the main process, which pins that
   * rectangle to a corner of the client window. Nothing here knows where it is
   * on screen, only what it should say.
   *
   * Two rules shaped it:
   *
   *  * **It never takes focus, and by default never takes a click.** Dragging is
   *    only possible while click-through is switched off, which is a deliberate
   *    trade the Overlays page explains.
   *  * **Every figure says where it came from.** Roblox publishes an average
   *    framerate and ping per server, reported by other players; those are drawn
   *    with an `avg` marker rather than pretending to be a local measurement.
   *    Anything unavailable is an em dash, never a zero.
   */

  let stats = $state<OverlayStats | null>(null)
  let previewMode = $state(false)
  let clickThrough = $state(true)
  let card = $state<HTMLElement | null>(null)

  /** The sample carries its own caveats; the card only has to pass them on. */
  const notices = $derived(stats?.notices ?? [])

  /** Ticks locally so the session clock does not wait on the sample cadence. */
  let now = $state(Date.now())

  /* ------------------------------------------------------------------ Boot */

  $effect(() => {
    void (async () => {
      await loadSettings()
      const state = await api.overlay.getState()
      previewMode = state.preview
      clickThrough = state.clickThrough
      stats = state.stats
    })()

    const unsubscribe = [
      listen('overlay:stats', (payload) => {
        stats = payload
      }),
      listen('overlay:state', (payload) => {
        previewMode = payload.preview
        clickThrough = payload.clickThrough
      }),
      listen('settings:changed', (payload) => applyExternalSettings(payload))
    ]

    return () => {
      for (const off of unsubscribe) off()
    }
  })

  // The clock ticks once a second; the samples arrive on their own cadence.
  $effect(() => {
    const timer = setInterval(() => {
      now = Date.now()
    }, 1000)
    return () => clearInterval(timer)
  })

  /* ----------------------------------------------------------- Appearance */

  $effect(() => applyThemeMode(settings.value.theme))
  $effect(() => applyAccent(settings.value.accentMode))
  $effect(() => applyReduceMotion(settings.value.reduceMotion))
  $effect(() => applyCustomFont(settings.value.fontFile, settings.value.fontFamily))

  /* ---------------------------------------------------------- Measurement */

  /**
   * Reports the card's own size so the window can be exactly that large.
   *
   * Without this the window would have to guess, and an oversized transparent
   * rectangle swallows clicks from the game the moment click-through is off.
   */
  $effect(() => {
    const element = card
    if (!element) return

    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect()
      void api.overlay.setContentSize(Math.ceil(rect.width), Math.ceil(rect.height))
    })

    observer.observe(element)
    return () => observer.disconnect()
  })

  /* ----------------------------------------------------------------- Drag */

  let dragging = $state(false)
  let dragStart = { pointerX: 0, pointerY: 0, windowX: 0, windowY: 0 }
  let pending: { x: number; y: number } | null = null
  let queued = 0

  function sendPosition(commit: boolean): void {
    if (!pending) return
    void api.overlay.setPosition({ ...pending, commit })
  }

  function onpointerdown(event: PointerEvent): void {
    // Click-through means the game owns the pointer; there is nothing to drag.
    if (clickThrough || event.button !== 0) return

    dragging = true
    dragStart = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      windowX: window.screenX,
      windowY: window.screenY
    }

    card?.setPointerCapture(event.pointerId)
  }

  function onpointermove(event: PointerEvent): void {
    if (!dragging) return

    pending = {
      x: Math.round(dragStart.windowX + (event.clientX - dragStart.pointerX)),
      y: Math.round(dragStart.windowY + (event.clientY - dragStart.pointerY))
    }

    // One move per frame: the main process is doing real work per call.
    if (queued) return
    queued = requestAnimationFrame(() => {
      queued = 0
      sendPosition(false)
    })
  }

  function onpointerup(event: PointerEvent): void {
    if (!dragging) return

    dragging = false
    card?.releasePointerCapture(event.pointerId)

    if (queued) {
      cancelAnimationFrame(queued)
      queued = 0
    }

    // Committing stores the position as an offset from the client window, so
    // the overlay keeps following the game from wherever it was left.
    sendPosition(true)
    pending = null
  }

  /* --------------------------------------------------------------- Values */

  const widgets = $derived(
    OVERLAY_WIDGET_CATALOG.filter((widget) => settings.value.overlayWidgets.includes(widget.id))
  )

  const headerWidget = $derived(widgets.find((widget) => widget.id === 'game') ?? null)
  const rows = $derived(widgets.filter((widget) => widget.id !== 'game'))

  /** Session time, carried forward from the last sample rather than frozen. */
  const sessionMs = $derived.by<number | null>(() => {
    const sample = stats
    if (!sample || sample.sessionMs === null) return null
    return Math.max(0, sample.sessionMs + (now - sample.sampledAt))
  })

  interface Drawn {
    value: string
    /** Unit drawn after the value, e.g. "ms". */
    unit: string | null
    /** Marker for a figure that is not a measurement of this machine. */
    marker: string | null
    /** True when there is nothing to show, so the row is drawn muted. */
    absent: boolean
    title: string
  }

  /** h:mm:ss — an overlay clock, not a playtime summary. */
  function clock(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000))
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    const pad = (value: number): string => String(value).padStart(2, '0')

    return hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${pad(minutes)}:${pad(seconds)}`
  }

  function absentValue(widget: OverlayWidgetDefinition): Drawn {
    return {
      value: '—',
      unit: null,
      marker: null,
      absent: true,
      title: notices[0] ?? widget.hint
    }
  }

  function draw(widget: OverlayWidgetDefinition): Drawn {
    const sample = stats

    switch (widget.id) {
      case 'time':
        return sessionMs === null
          ? absentValue(widget)
          : {
              value: clock(sessionMs),
              unit: null,
              marker: null,
              absent: false,
              title: widget.hint
            }

      case 'fps':
        return sample?.fps === null || sample?.fps === undefined
          ? absentValue(widget)
          : {
              value: String(Math.round(sample.fps)),
              unit: 'fps',
              marker: sample.fpsSource === 'server-reported' ? 'avg' : null,
              absent: false,
              title: widget.hint
            }

      case 'ping':
        return sample?.ping === null || sample?.ping === undefined
          ? absentValue(widget)
          : {
              value: String(Math.round(sample.ping)),
              unit: 'ms',
              marker: sample.pingSource === 'server-reported' ? 'avg' : null,
              absent: false,
              title: widget.hint
            }

      case 'region': {
        if (!sample?.region) return absentValue(widget)
        const region = regionById(sample.region)
        return {
          value: region.label,
          unit: null,
          marker: sample.datacenter ? sample.datacenter.toUpperCase() : null,
          absent: false,
          title: sample.datacenter ? `Datacenter ${sample.datacenter.toUpperCase()}` : region.hint
        }
      }

      case 'players':
        if (sample?.players === null || sample?.players === undefined) return absentValue(widget)
        return {
          value: sample.maxPlayers
            ? `${sample.players}/${sample.maxPlayers}`
            : String(sample.players),
          unit: null,
          marker: 'avg',
          absent: false,
          title: widget.hint
        }

      case 'memory':
        return sample?.workingSetBytes === null || sample?.workingSetBytes === undefined
          ? absentValue(widget)
          : {
              value: formatBytes(sample.workingSetBytes),
              unit: null,
              marker: null,
              absent: false,
              title: widget.hint
            }

      case 'cpu':
        return sample?.cpuPercent === null || sample?.cpuPercent === undefined
          ? absentValue(widget)
          : {
              value: sample.cpuPercent.toFixed(1),
              unit: '%',
              marker: null,
              absent: false,
              title: widget.hint
            }

      case 'account':
        return sample?.accountName
          ? {
              value: sample.accountName,
              unit: null,
              marker: null,
              absent: false,
              title: widget.hint
            }
          : absentValue(widget)

      case 'server':
        if (!sample?.jobId) return absentValue(widget)
        return {
          value: sample.jobId.slice(0, 8),
          unit: null,
          marker: null,
          absent: false,
          title: sample.jobId
        }

      default:
        return absentValue(widget)
    }
  }

  /** What the header says when nothing is being played. */
  const headerTitle = $derived(
    stats?.gameName ??
      (stats?.clientRunning
        ? 'Roblox is running'
        : previewMode
          ? 'RemielleStrap preview'
          : 'RemielleStrap')
  )

  const liveClass = $derived(
    stats?.inGame ? 'live' : stats?.clientRunning ? 'running' : previewMode ? 'preview' : 'idle'
  )
</script>

<svelte:head>
  <title>RemielleStrap Overlay</title>
</svelte:head>

<div
  class="overlay-root"
  style="--overlay-scale: {settings.value.overlayScale};"
  style:opacity={settings.value.overlayOpacity}
>
  <div
    bind:this={card}
    class="overlay-card"
    class:draggable={!clickThrough}
    class:dragging
    role="status"
    aria-label="Session overlay"
    title={notices.join('\n') || undefined}
    {onpointerdown}
    {onpointermove}
    {onpointerup}
    onpointercancel={onpointerup}
  >
    {#if notices.length > 0}
      <!-- Read by screen readers and by the Overlays page; on the card itself it
           is a hairline marker, because a tooltip needs a hover the game owns. -->
      <span class="sr-only">{notices.join(' ')}</span>
    {/if}

    {#if headerWidget}
      <header class="overlay-head">
        <span class="dot {liveClass}" aria-hidden="true"></span>
        <span class="title">{headerTitle}</span>
        {#if previewMode}
          <span class="ribbon">Preview</span>
        {/if}
      </header>
    {/if}

    {#if rows.length > 0}
      <dl class="overlay-rows">
        {#each rows as widget (widget.id)}
          {@const drawn = draw(widget)}
          <div class="row" title={drawn.title}>
            <dt>{widget.label}</dt>
            <dd class:absent={drawn.absent}>
              {drawn.value}
              {#if drawn.unit}<span class="unit">{drawn.unit}</span>{/if}
              {#if drawn.marker}<span class="marker">{drawn.marker}</span>{/if}
            </dd>
          </div>
        {/each}
      </dl>
    {/if}
  </div>
</div>

<style>
  /*
   * Everything is sized in `em` off one root font size, so the scale setting
   * grows the card *and* the rectangle the window reports — the two can never
   * disagree, which is what keeps the click-through margin honest.
   */
  .overlay-root {
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    width: max-content;
    font-size: calc(11px * var(--overlay-scale, 1));
    font-family: var(--font-sans);
    transition: opacity 0.2s var(--ease-out-soft);
  }

  .overlay-card {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    gap: 0.45em;
    max-width: 24em;
    padding: 0.7em 0.85em;
    border: 1px solid --alpha(var(--color-ivory-200) / 12%);
    border-radius: 0.6em;
    background-color: --alpha(var(--color-ink-950) / 78%);
    box-shadow:
      0 1px 2px rgb(0 0 0 / 0.5),
      0 10px 30px -14px rgb(0 0 0 / 0.9);
    backdrop-filter: blur(6px);
    color: var(--color-ivory-200);
    line-height: 1.35;
  }

  /* The prism sliver, one pixel, at the top of the card only. */
  .overlay-card::before {
    content: '';
    position: absolute;
    inset-inline: 0.6em;
    margin-top: -0.7em;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent,
      --alpha(var(--color-prism-rose) / 40%) 22%,
      --alpha(var(--color-prism-violet) / 40%) 45%,
      --alpha(var(--color-prism-cyan) / 40%) 68%,
      transparent
    );
    pointer-events: none;
  }

  .overlay-card.draggable {
    cursor: grab;
  }

  .overlay-card.dragging {
    cursor: grabbing;
    border-color: --alpha(var(--color-gold-400) / 45%);
  }

  .overlay-head {
    display: flex;
    align-items: center;
    gap: 0.5em;
    min-width: 0;
  }

  .dot {
    flex: none;
    width: 0.5em;
    height: 0.5em;
    border-radius: 999px;
    background-color: var(--color-ivory-500);
  }

  .dot.live {
    background-color: var(--color-positive);
    box-shadow: 0 0 0.5em --alpha(var(--color-positive) / 70%);
  }

  .dot.running {
    background-color: var(--color-caution);
  }

  .dot.preview {
    background-color: var(--color-gold-400);
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
    letter-spacing: 0.005em;
    color: var(--color-ivory-100);
  }

  .ribbon {
    flex: none;
    padding: 0.05em 0.4em;
    border: 1px solid --alpha(var(--color-gold-400) / 40%);
    border-radius: 999px;
    font-size: 0.82em;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-gold-300);
  }

  .overlay-rows {
    display: flex;
    flex-direction: column;
    gap: 0.2em;
    margin: 0;
  }

  .row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1.2em;
  }

  dt {
    flex: none;
    font-size: 0.92em;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-ivory-500);
  }

  dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 1em;
    font-variant-numeric: tabular-nums;
    color: var(--color-ivory-100);
    text-align: right;
    white-space: nowrap;
  }

  dd.absent {
    color: var(--color-ivory-600);
  }

  .unit {
    margin-left: 0.25em;
    font-size: 0.85em;
    color: var(--color-ivory-500);
  }

  /* The provenance marker: this figure came from the server, not from here. */
  .marker {
    margin-left: 0.4em;
    padding: 0 0.3em;
    border: 1px solid --alpha(var(--color-ivory-200) / 16%);
    border-radius: 0.3em;
    font-family: var(--font-sans);
    font-size: 0.78em;
    letter-spacing: 0.04em;
    color: var(--color-ivory-500);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
