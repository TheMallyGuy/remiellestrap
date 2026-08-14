<script lang="ts">
  import { api, listen } from './lib/ipc'
  import {
    applyActivity,
    applyExit,
    applyLeave,
    applyRpc,
    loadActivity,
    loadAppState
  } from './lib/stores/activity.svelte'
  import { applyArtUpdate, loadAllArt } from './lib/stores/art.svelte'
  import {
    applyComplete,
    applyError,
    applyProgress,
    checkForUpdates,
    launch,
    syncProgress
  } from './lib/stores/bootstrapper.svelte'
  import {
    applyNavigation,
    applyWindowState,
    navigation,
    restorePage
  } from './lib/stores/navigation.svelte'
  import { applyExternalSettings, loadSettings, settings } from './lib/stores/settings.svelte'
  import { pushToast } from './lib/stores/toasts.svelte'

  import Sidebar from './lib/components/Sidebar.svelte'
  import TitleBar from './lib/components/TitleBar.svelte'
  import Toasts from './lib/components/Toasts.svelte'

  import AboutPage from './lib/pages/AboutPage.svelte'
  import AppearancePage from './lib/pages/AppearancePage.svelte'
  import BehaviourPage from './lib/pages/BehaviourPage.svelte'
  import FastFlagsPage from './lib/pages/FastFlagsPage.svelte'
  import HomePage from './lib/pages/HomePage.svelte'
  import InstallationPage from './lib/pages/InstallationPage.svelte'
  import IntegrationsPage from './lib/pages/IntegrationsPage.svelte'
  import ModsPage from './lib/pages/ModsPage.svelte'

  /**
   * The application shell.
   *
   * Responsibilities, and nothing else:
   *  - boot the renderer's stores once,
   *  - subscribe every main-process push event to its store,
   *  - draw the frame (titlebar, rail, page, toasts, overlay).
   *
   * Pages own their own data. Anything that has to survive navigation lives in
   * a store, so switching pages never re-runs a download or loses progress.
   */

  let booted = $state(false)

  /* --------------------------------------------------------------- Boot up */

  $effect(() => {
    void boot()
  })

  async function boot(): Promise<void> {
    const config = await loadSettings()
    restorePage(config.lastOpenedPage)

    // Fire these together; none depends on another.
    await Promise.all([loadActivity(), loadAppState(), syncProgress(), loadAllArt()])

    booted = true

    // A deep link may already be waiting from a cold start. Consuming it here
    // (rather than in the Home page) guarantees the overlay opens immediately,
    // whichever page was restored.
    const uri = await api.bootstrapper.getPendingUri()

    if (uri) {
      await launch({ uri, force: true })
      return
    }

    if (!config.disableUpdates) void checkForUpdates(true)
  }

  /* ------------------------------------------------------- Push event wiring */

  $effect(() => {
    const unsubscribe = [
      listen('bootstrapper:progress', (payload) => applyProgress(payload)),
      listen('bootstrapper:complete', (payload) => applyComplete(payload)),
      listen('bootstrapper:error', (payload) => applyError(payload)),

      listen('activity:update', (payload) => applyActivity(payload)),
      listen('activity:leave', () => {
        applyLeave()
        void loadAppState()
      }),
      listen('rpc:update', (payload) => applyRpc(payload)),
      listen('roblox:exit', (payload) => {
        applyExit(payload)
        void loadAppState()
      }),

      listen('theme:artUpdated', (payload) => applyArtUpdate(payload.slot, payload.asset)),
      listen('toast:show', (payload) => pushToast(payload)),
      listen('settings:changed', (payload) => applyExternalSettings(payload)),
      listen('window:state', (payload) => applyWindowState(payload)),

      // A deep link that arrived while the app was already running, or a tray
      // menu item. Both come through as a navigation request; the bootstrapper
      // overlay is opened by the main process sending progress right after.
      listen('navigate:page', (payload) => applyNavigation(payload.page))
    ]

    return () => {
      for (const off of unsubscribe) off()
    }
  })

  /* --------------------------------------------------- Global UI preferences */

  // `reduceMotion` is honoured by every animation utility through this class,
  // so components never have to check the setting themselves.
  $effect(() => {
    document.documentElement.classList.toggle('reduce-motion', settings.value.reduceMotion)
  })

  $effect(() => {
    const theme = settings.value.theme
    const root = document.documentElement

    const media = window.matchMedia('(prefers-color-scheme: light)')

    const apply = (): void => {
      const light = theme === 'light' || (theme === 'system' && media.matches)
      root.classList.toggle('theme-light', light)
      root.style.colorScheme = light ? 'light' : 'dark'
    }

    apply()

    // Only the 'system' setting needs to follow the OS; the explicit modes are
    // already applied above.
    if (theme === 'system') media.addEventListener('change', apply)

    return () => media.removeEventListener('change', apply)
  })

  /* ------------------------------------------------------------- Shortcuts */

  function onkeydown(event: KeyboardEvent): void {
    // Ctrl/Cmd+R would reload the renderer and drop in-flight progress.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r' && !event.shiftKey) {
      event.preventDefault()
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="flex h-screen flex-col overflow-hidden bg-ink-950 text-ivory-200 antialiased">
  <TitleBar />

  <div class="flex min-h-0 flex-1">
    <Sidebar />

    <main class="relative min-w-0 flex-1 overflow-y-auto">
      <!-- A single faint prism wash anchored to the top-right of the content
           area. It is the only decorative gradient in the app. -->
      <div
        class="pointer-events-none absolute -top-32 right-0 h-72 w-72 rounded-full bg-prism-violet/6 blur-3xl"
        aria-hidden="true"
      ></div>

      <div class="relative mx-auto max-w-4xl px-8 py-8">
        {#if !booted}
          <div class="flex h-[60vh] flex-col items-center justify-center gap-3">
            <span class="skeleton h-10 w-10 rounded-full"></span>
            <p class="text-2xs uppercase tracking-[0.2em] text-ivory-600">Starting</p>
          </div>
        {:else if navigation.page === 'home'}
          <HomePage />
        {:else if navigation.page === 'appearance'}
          <AppearancePage />
        {:else if navigation.page === 'behaviour'}
          <BehaviourPage />
        {:else if navigation.page === 'fastflags'}
          <FastFlagsPage />
        {:else if navigation.page === 'mods'}
          <ModsPage />
        {:else if navigation.page === 'integrations'}
          <IntegrationsPage />
        {:else if navigation.page === 'installation'}
          <InstallationPage />
        {:else}
          <AboutPage />
        {/if}
      </div>
    </main>
  </div>
</div>

<Toasts />
