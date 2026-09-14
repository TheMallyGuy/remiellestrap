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
  import { pushToast } from './lib/stores/toasts.svelte'
  import { setLanguage } from './lib/i18n'

  import AppBackground from './lib/components/AppBackground.svelte'
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
      loadAppUpdate()
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

  // `reduceMotion` is honoured by every animation utility through this class,
  // so components never have to check the setting themselves.
  $effect(() => {
    document.documentElement.classList.toggle('reduce-motion', settings.value.reduceMotion)
  })

  // The accent picker is applied as a `data-accent` attribute on <html> so the
  // stylesheet can remap the accent ramp; components never read the setting.
  $effect(() => {
    document.documentElement.dataset.accent =
      settings.value.accentMode === 'prism' ? 'prism' : 'gold'
  })

  // The sidebar width is a display mode, not a layout hack: the rail itself
  // reads this attribute and hides its labels when it is set to icons.
  $effect(() => {
    document.documentElement.dataset.sidebar = settings.value.sidebarMode
  })

  // A custom font is loaded from the app's own folder and then named through a
  // single CSS variable, so no component has to know a font was chosen.
  $effect(() => {
    const file = settings.value.fontFile
    const family = settings.value.fontFamily
    const root = document.documentElement

    let element: HTMLStyleElement | null = null

    if (file) {
      const name = `RemielleUserFont`
      element = document.createElement('style')
      element.textContent = `@font-face { font-family: '${name}'; src: url('app://font/${encodeURIComponent(
        file.split(/[\\/]/).pop() ?? file
      )}'); font-display: swap; }`
      document.head.appendChild(element)
      root.style.setProperty('--font-sans', `'${name}', var(--font-sans-default)`)
    } else if (family) {
      root.style.setProperty('--font-sans', `'${family}', var(--font-sans-default)`)
    } else {
      root.style.removeProperty('--font-sans')
    }

    return () => {
      element?.remove()
      root.style.removeProperty('--font-sans')
    }
  })

  /* ------------------------------------------------------------ Themes */

  // Three of the built-in themes are not simple light/dark variants: they remap
  // the whole ramp (see `main.css`). They are applied as classes on <html> so
  // every utility picks them up at once.
  $effect(() => {
    const theme = settings.value.theme
    const root = document.documentElement

    const variants = ['prism-night', 'ivory-cathedral', 'gold-ember'] as const
    for (const variant of variants) {
      root.classList.toggle(`theme-${variant}`, theme === variant)
    }

    const media = window.matchMedia('(prefers-color-scheme: light)')

    const apply = (): void => {
      const light =
        theme === 'light' ||
        theme === 'ivory-cathedral' ||
        (theme === 'system' && media.matches)

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

    // Ctrl/Cmd+1..9 jumps between pages, in rail order.
    if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
      const order = [
        'home',
        'accounts',
        'servers',
        'appearance',
        'behaviour',
        'mods',
        'fastflags',
        'integrations',
        'utilities'
      ] as const

      const target = order[Number.parseInt(event.key, 10) - 1]
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

{#if showOnboarding && booted}
  <OnboardingDialog onclose={() => (showOnboarding = false)} />
{/if}
