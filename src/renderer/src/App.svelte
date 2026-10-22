<script lang="ts">
  import { api, listen } from './lib/ipc'
  import {
    applyActivity,
    applyExit,
    applyLeave,
    applyRpc,
    loadActivity,
    loadAppState,
    activity
  } from './lib/stores/activity.svelte'
  import { applyAccounts, loadAccounts } from './lib/stores/accounts.svelte'
  import { applyArtUpdate, artSlot, loadAllArt, loadArt } from './lib/stores/art.svelte'
  import { applyAppUpdate, loadAppUpdate } from './lib/stores/appUpdate.svelte'
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
  import { applyPlaytime, loadPlaytime } from './lib/stores/playtime.svelte'
  import { applyExternalSettings, loadSettings, settings } from './lib/stores/settings.svelte'
  import { applyOverlayState, applyOverlayStats, loadOverlay } from './lib/stores/overlay.svelte'
  import { isPaletteShortcut, togglePalette } from './lib/stores/palette.svelte'
  import { pushToast } from './lib/stores/toasts.svelte'
  import { setLanguage } from './lib/i18n'
  import { PAGE_SHORTCUT_ORDER } from './lib/nav'
  import {
    applyAccent,
    applyCustomFont,
    applyReduceMotion,
    applySidebarMode,
    applyThemeMode
  } from './lib/appearance'

  import AppBackground from './lib/components/AppBackground.svelte'
  import CommandPalette from './lib/components/CommandPalette.svelte'
  import Sidebar from './lib/components/Sidebar.svelte'
  import TitleBar from './lib/components/TitleBar.svelte'
  import Toasts from './lib/components/Toasts.svelte'
  import OnboardingDialog from './lib/dialogs/OnboardingDialog.svelte'

  import AboutPage from './lib/pages/AboutPage.svelte'
  import AccountsPage from './lib/pages/AccountsPage.svelte'
  import AppearancePage from './lib/pages/AppearancePage.svelte'
  import BehaviourPage from './lib/pages/BehaviourPage.svelte'
  import FastFlagsPage from './lib/pages/FastFlagsPage.svelte'
  import HomePage from './lib/pages/HomePage.svelte'
  import InstallationPage from './lib/pages/InstallationPage.svelte'
  import IntegrationsPage from './lib/pages/IntegrationsPage.svelte'
  import ModsPage from './lib/pages/ModsPage.svelte'
  import OverlaysPage from './lib/pages/OverlaysPage.svelte'
  import ServersPage from './lib/pages/ServersPage.svelte'
  import UtilitiesPage from './lib/pages/UtilitiesPage.svelte'

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
  let showOnboarding = $state(false)

  /* --------------------------------------------------------------- Boot up */

  $effect(() => {
    void boot()
  })

  async function boot(): Promise<void> {
    const config = await loadSettings()
    restorePage(config.lastOpenedPage)

    // Fire these together; none depends on another.
    await Promise.all([
      loadActivity(),
      loadAppState(),
      loadAccounts(),
      loadPlaytime(),
      syncProgress(),
      loadAllArt(),
      loadAppUpdate(),
      loadOverlay()
    ])

    booted = true

    // A first run shows the tour once, after settings are known.
    showOnboarding = !activity.state.onboardingComplete

    // The background slot is only fetched when it is actually going to be seen.
    if (config.backgroundStyle === 'art' && !artSlot('background').asset) {
      void loadArt('background')
    }

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
        void loadPlaytime()
      }),

      listen('accounts:changed', (payload) => applyAccounts(payload)),
      listen('playtime:update', (payload) => applyPlaytime(payload)),

      listen('theme:artUpdated', (payload) => applyArtUpdate(payload.slot, payload.asset)),
      listen('toast:show', (payload) => pushToast(payload)),
      listen('settings:changed', (payload) => applyExternalSettings(payload)),
      listen('app:update', (payload) => applyAppUpdate(payload)),
      listen('window:state', (payload) => applyWindowState(payload)),

      // The overlay lives in the main process; the page only mirrors it, so the
      // two arrive as separate streams — state when it changes, samples per tick.
      listen('overlay:state', (payload) => applyOverlayState(payload)),
      listen('overlay:stats', (payload) => applyOverlayStats(payload)),

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

  // The UI language is read once from settings; every `t()` call falls back to
  // the English string at the call site when a key is missing.
  $effect(() => {
    setLanguage(settings.value.language)
  })

  // Everything below is one call per setting, implemented in `lib/appearance.ts`
  // rather than here: the install window and the in-game overlay are separate
  // documents that have to look like this one, and a second copy of the theme
  // logic is a copy that drifts.

  // `reduceMotion` is honoured by every animation utility through this class,
  // so components never have to check the setting themselves.
  $effect(() => applyReduceMotion(settings.value.reduceMotion))

  // The accent picker remaps the gold ramp to prism rose, in the stylesheet.
  $effect(() => applyAccent(settings.value.accentMode))

  // The sidebar width is a display mode: the rail reads the attribute.
  $effect(() => applySidebarMode(settings.value.sidebarMode))

  // A custom font is loaded from the app's own folder and named through a single
  // CSS variable, so no component has to know a font was chosen.
  $effect(() => applyCustomFont(settings.value.fontFile, settings.value.fontFamily))

  // Three of the built-in themes remap the whole ramp rather than flipping a
  // light/dark flag; `system` additionally follows the operating system.
  $effect(() => applyThemeMode(settings.value.theme))

  /* ------------------------------------------------------------- Shortcuts */

  function onkeydown(event: KeyboardEvent): void {
    // Ctrl/Cmd+R would reload the renderer and drop in-flight progress.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r' && !event.shiftKey) {
      event.preventDefault()
    }

    // The command palette is the launcher's own overlay: one keystroke to
    // summon, one to dismiss, and it never fires from inside a text field that
    // already handled the key.
    if (isPaletteShortcut(event)) {
      event.preventDefault()
      togglePalette()
      return
    }

    // Ctrl/Cmd+1..9 jumps between pages in rail order, and Ctrl/Cmd+0 the tenth,
    // so every daily page keeps a number now that Overlays joined the rail.
    if ((event.ctrlKey || event.metaKey) && /^[0-9]$/.test(event.key)) {
      const digit = Number.parseInt(event.key, 10)
      const index = digit === 0 ? 9 : digit - 1
      const target = PAGE_SHORTCUT_ORDER[index]

      if (target) {
        event.preventDefault()
        applyNavigation(target)
      }
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="relative flex h-screen flex-col overflow-hidden bg-ink-950 text-ivory-200 antialiased">
  <AppBackground />

  <div class="relative flex min-h-0 flex-1 flex-col">
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
          {:else if navigation.page === 'accounts'}
            <AccountsPage />
          {:else if navigation.page === 'servers'}
            <ServersPage />
          {:else if navigation.page === 'appearance'}
            <AppearancePage />
          {:else if navigation.page === 'behaviour'}
            <BehaviourPage />
          {:else if navigation.page === 'overlays'}
            <OverlaysPage />
          {:else if navigation.page === 'fastflags'}
            <FastFlagsPage />
          {:else if navigation.page === 'mods'}
            <ModsPage />
          {:else if navigation.page === 'integrations'}
            <IntegrationsPage />
          {:else if navigation.page === 'utilities'}
            <UtilitiesPage />
          {:else if navigation.page === 'installation'}
            <InstallationPage />
          {:else}
            <AboutPage />
          {/if}
        </div>
      </main>
    </div>
  </div>
</div>

<Toasts />

<!-- Drawn last so it sits above the page, the toasts and any dialog. It renders
     nothing at all until summoned. -->
<CommandPalette />

{#if showOnboarding && booted}
  <OnboardingDialog onclose={() => (showOnboarding = false)} />
{/if}
