<script lang="ts">
  import { api, errorMessage } from '../ipc'
  import { goTo } from '../stores/navigation.svelte'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import { t } from '../i18n'

  import Icon from '../components/Icon.svelte'
  import type { IconName } from '../components/icons'

  /**
   * First run.
   *
   * Four short steps, each one a real decision rather than a slide of prose:
   * which account to launch as, where the artwork comes from, how the window
   * should look, and whether updates should be automatic. Every step can be
   * skipped, and the whole tour is remembered so it never appears twice.
   */

  interface Props {
    onclose: () => void
  }

  const { onclose }: Props = $props()

  interface Step {
    icon: IconName
    title: string
    body: string
  }

  const steps: Step[] = [
    {
      icon: 'prism',
      title: t('onboarding.welcome.title', 'Welcome to RemielleStrap'),
      body: t(
        'onboarding.welcome.body',
        'A bootstrapper for Roblox in Remielle’s colours: mods, FastFlags, accounts, regions and Discord presence, all in one quiet place.'
      )
    },
    {
      icon: 'user',
      title: t('onboarding.accounts.title', 'Sign in once'),
      body: t(
        'onboarding.accounts.body',
        'Add an account with a real sign-in window, a Quick Log In code from your phone, or a pasted cookie. Cookies are sealed with your OS credential store and never stored in the clear.'
      )
    },
    {
      icon: 'palette',
      title: t('onboarding.art.title', 'Dress it up — or not'),
      body: t(
        'onboarding.art.body',
        'Every art slot can show Remielle artwork from Safebooru, a picture of your own, or nothing at all. Shuffle a slot at any time; the choice is remembered per slot.'
      )
    },
    {
      icon: 'play',
      title: t('onboarding.launch.title', 'Ready to launch'),
      body: t(
        'onboarding.launch.body',
        'Press Play on the Home page. Mods and flags are applied on the way in, and the Cleaner keeps the folders from piling up.'
      )
    }
  ]

  let index = $state(0)
  let finishing = $state(false)

  const step = $derived(steps[index])
  const last = $derived(index === steps.length - 1)

  async function finish(): Promise<void> {
    finishing = true

    try {
      await api.state.completeOnboarding()
    } catch (error) {
      // Not fatal: the worst case is that the tour is offered once more.
      pushToast({ kind: 'warning', title: 'Could not save that', message: errorMessage(error) })
    } finally {
      finishing = false
      onclose()
    }
  }

  function openPage(page: 'accounts' | 'appearance' | 'integrations'): void {
    goTo(page)
    void finish()
  }
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center p-6"
  role="dialog"
  aria-modal="true"
>
  <div class="absolute inset-0 bg-ink-950/80 backdrop-blur-sm"></div>

  <div class="surface relative w-full max-w-xl overflow-hidden p-0 animate-fade-up">
    <!-- A prism edge on the first panel only: one bright thing at a time. -->
    <div class="prism-edge"></div>

    <div class="p-6">
      <div class="flex items-start gap-3">
        <span
          class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-gold-500/30 text-gold-300"
        >
          <Icon name={step.icon} size={16} />
        </span>

        <div class="min-w-0">
          <h2 class="display text-xl">{step.title}</h2>
          <p class="mt-1.5 text-xs leading-relaxed text-ivory-400 text-balance-pretty">
            {step.body}
          </p>
        </div>
      </div>

      {#if index === 1}
        <div class="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            class="btn-secondary gap-1.5 text-xs"
            onclick={() => openPage('accounts')}
          >
            <Icon name="user" size={14} />
            Open Accounts
          </button>
        </div>
      {/if}

      {#if index === 2}
        <div class="mt-4 space-y-2">
          <label class="flex items-center gap-2.5 text-xs text-ivory-300">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 accent-[var(--color-gold-400)]"
              checked={settings.value.reduceMotion}
              onchange={(event) =>
                void updateSettings({ reduceMotion: event.currentTarget.checked })}
            />
            Calm the animations
          </label>

          <button
            type="button"
            class="btn-ghost gap-1.5 text-xs"
            onclick={() => openPage('appearance')}
          >
            <Icon name="palette" size={14} />
            Choose a theme and artwork
          </button>
        </div>
      {/if}

      {#if last}
        <div class="mt-4 space-y-2">
          <label class="flex items-center gap-2.5 text-xs text-ivory-300">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 accent-[var(--color-gold-400)]"
              checked={!settings.value.disableUpdates}
              onchange={(event) =>
                void updateSettings({ disableUpdates: !event.currentTarget.checked })}
            />
            Check for updates to RemielleStrap automatically
          </label>
        </div>
      {/if}
    </div>

    <footer class="flex items-center justify-between gap-3 border-t border-ivory-200/8 px-6 py-4">
      <div class="flex items-center gap-1.5" aria-hidden="true">
        {#each steps.keys() as dot (dot)}
          <span
            class="h-1 w-4 rounded-full transition-colors {dot === index
              ? 'bg-gold-400/80'
              : 'bg-ivory-200/12'}"
          ></span>
        {/each}
      </div>

      <div class="flex items-center gap-2">
        <button type="button" class="btn-ghost text-xs" onclick={() => void finish()}
          >Skip the tour</button
        >

        {#if !last}
          <button type="button" class="btn-primary text-xs" onclick={() => (index += 1)}>
            Next
          </button>
        {:else}
          <button
            type="button"
            class="btn-primary text-xs"
            disabled={finishing}
            onclick={() => void finish()}
          >
            Start using RemielleStrap
          </button>
        {/if}
      </div>
    </footer>
  </div>
</div>
