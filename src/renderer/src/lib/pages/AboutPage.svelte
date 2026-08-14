<script lang="ts">
  import type { SystemInfo } from '@shared/models'
  import { api, errorMessage } from '../ipc'
  import { artSlot } from '../stores/art.svelte'
  import { activity } from '../stores/activity.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import { formatDateTime } from '../utils/format'
  import ArtSlot from '../components/ArtSlot.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'

  /**
   * Credits, versions and the attribution that the artwork pipeline requires.
   */

  const REPOSITORY = 'https://github.com/TheMallyGuy/remiellestrap'

  let info = $state<SystemInfo | null>(null)

  const header = artSlot('about_header')
  const appState = $derived(activity.state)

  $effect(() => {
    void (async () => {
      try {
        info = await api.system.getInfo()
      } catch (error) {
        pushToast({
          kind: 'error',
          title: 'Could not read version info',
          message: errorMessage(error)
        })
      }
    })()
  })

  const versionRows = $derived([
    { label: 'RemielleStrap', value: info?.appVersion ?? '—' },
    { label: 'Electron', value: info?.electronVersion ?? '—' },
    { label: 'Chromium', value: info?.chromeVersion ?? '—' },
    { label: 'Node', value: info?.nodeVersion ?? '—' },
    {
      label: 'Platform',
      value: info ? `${info.platform} ${info.arch} · ${info.osRelease}` : '—'
    }
  ])

  async function openExternal(url: string): Promise<void> {
    const result = await api.system.openExternal(url)
    if (!result.ok && result.error) {
      pushToast({ kind: 'warning', title: 'Link blocked', message: result.error })
    }
  }

  async function copyVersions(): Promise<void> {
    if (!info) return

    const text = versionRows.map((row) => `${row.label}: ${row.value}`).join('\n')

    try {
      await navigator.clipboard.writeText(text)
      pushToast({ kind: 'success', title: 'Version details copied' })
    } catch {
      pushToast({ kind: 'warning', title: 'Clipboard unavailable' })
    }
  }
</script>

<PageHeader title="About" subtitle="Versions, credits and where the artwork comes from.">
  {#snippet actions()}
    <button type="button" class="btn-ghost" onclick={() => void openExternal(REPOSITORY)}>
      <Icon name="github" size={12} />
      Repository
    </button>
  {/snippet}
</PageHeader>

<!-- Masthead -->
<div class="relative mb-9 overflow-hidden rounded-card border border-ivory-200/8">
  <ArtSlot
    slot="about_header"
    class="h-44 w-full"
    focus="34%"
    scrim="strong"
    attribution={false}
    shuffle={false}
  />

  <div class="pointer-events-none absolute inset-0 flex items-end p-6">
    <div>
      <p class="eyebrow text-gold-300/70">Roblox bootstrapper</p>
      <h2 class="display mt-1.5 text-[2rem] leading-none text-ivory-50">RemielleStrap</h2>
      <p class="mt-2 max-w-md text-xs leading-relaxed text-ivory-300 text-balance-pretty">
        A quiet, fast launcher for the Roblox client — versions, mods, engine flags and presence,
        wrapped in cathedral light.
      </p>
    </div>
  </div>

  <span
    class="pointer-events-none absolute right-5 top-5 rounded-full border border-ivory-200/12 bg-ink-950/60 px-2.5 py-1 font-mono text-2xs text-ivory-300 backdrop-blur-sm"
  >
    v{info?.appVersion ?? '—'}
  </span>
</div>

<div class="grid gap-9 lg:grid-cols-2">
  <!-- Versions -->
  <Section title="Versions" bare>
    <div class="surface overflow-hidden">
      {#each versionRows as row (row.label)}
        <div
          class="flex items-center justify-between gap-4 border-b border-ivory-200/5 px-4 py-2.5 last:border-b-0"
        >
          <span class="text-xs text-ivory-400">{row.label}</span>
          <span class="truncate font-mono text-2xs text-ivory-200">{row.value}</span>
        </div>
      {/each}
    </div>

    <button type="button" class="btn-ghost mt-2.5" onclick={() => void copyVersions()}>
      <Icon name="copy" size={12} />
      Copy for a bug report
    </button>
  </Section>

  <!-- Usage -->
  <Section title="This install" bare>
    <div class="surface overflow-hidden">
      <div class="flex items-center justify-between gap-4 border-b border-ivory-200/5 px-4 py-2.5">
        <span class="text-xs text-ivory-400">Launches</span>
        <span class="font-mono text-2xs text-ivory-200 tabular-nums">{appState.totalLaunches}</span>
      </div>
      <div class="flex items-center justify-between gap-4 border-b border-ivory-200/5 px-4 py-2.5">
        <span class="text-xs text-ivory-400">Last launch</span>
        <span class="font-mono text-2xs text-ivory-200">
          {appState.lastLaunchAt ? formatDateTime(appState.lastLaunchAt) : 'never'}
        </span>
      </div>
      <div class="flex items-center justify-between gap-4 border-b border-ivory-200/5 px-4 py-2.5">
        <span class="text-xs text-ivory-400">Sessions recorded</span>
        <span class="font-mono text-2xs text-ivory-200 tabular-nums">
          {appState.recentActivity.length}
        </span>
      </div>
      <div class="flex items-center justify-between gap-4 px-4 py-2.5">
        <span class="text-xs text-ivory-400">Roblox supported</span>
        <span class="font-mono text-2xs text-ivory-200">
          {info ? (info.robloxSupported ? 'yes' : 'no — Windows only') : '—'}
        </span>
      </div>
    </div>
  </Section>
</div>

<!-- Artwork attribution -->
<Section
  title="Artwork"
  description="Every Remielle Dan image in RemielleStrap is fetched from Safebooru at runtime and cached locally. No artwork ships with the application, and nothing is generated."
  class="mt-9"
>
  <div class="py-3.5">
    <p class="max-w-prose text-xs leading-relaxed text-ivory-400">
      Images are downloaded through Safebooru's public DAPI, stored in the local cache directory and
      served to this window over the app's own <code class="font-mono text-ivory-300">app://</code>
      protocol — never hotlinked. Each slot remembers its chosen post so the interface stays stable between
      launches, and every slot shows the post id it is displaying.
    </p>

    <p class="mt-3 max-w-prose text-xs leading-relaxed text-ivory-400">
      Rights to the artwork belong to the original artists. Please follow the credit on the source
      page before reusing anything.
    </p>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        class="btn-secondary"
        onclick={() => void openExternal('https://safebooru.org/')}
      >
        <Icon name="external" size={12} />
        Safebooru
      </button>

      {#if header.asset}
        <button
          type="button"
          class="chip"
          onclick={() => void api.booru.openPost(header.asset!.postId)}
        >
          <Icon name="prism" size={11} />
          this header is post #{header.asset.postId}
        </button>
      {/if}
    </div>
  </div>
</Section>

<!-- Credits -->
<Section title="Credits" class="mt-9">
  <div class="grid gap-x-8 gap-y-4 py-3.5 sm:grid-cols-2">
    <div>
      <p class="text-[0.8125rem] text-ivory-100">Remielle Dan</p>
      <p class="mt-1 text-xs leading-relaxed text-ivory-500">
        A character from <span class="text-ivory-300">Zenless Zone Zero</span>, by HoYoverse. This
        project is a fan work and is not affiliated with or endorsed by HoYoverse.
      </p>
    </div>

    <div>
      <p class="text-[0.8125rem] text-ivory-100">Roblox</p>
      <p class="mt-1 text-xs leading-relaxed text-ivory-500">
        Roblox is a trademark of Roblox Corporation. RemielleStrap is an unofficial launcher and is
        not affiliated with or endorsed by Roblox Corporation.
      </p>
    </div>

    <div>
      <p class="text-[0.8125rem] text-ivory-100">Prior art</p>
      <p class="mt-1 text-xs leading-relaxed text-ivory-500">
        Deployment, mod overlay and FastFlag behaviour follow the approach established by
        <span class="text-ivory-300">Bloxstrap</span> and
        <span class="text-ivory-300">FrostStrap</span>.
      </p>
    </div>

    <div>
      <p class="text-[0.8125rem] text-ivory-100">Built with</p>
      <p class="mt-1 text-xs leading-relaxed text-ivory-500">
        Electron, Svelte 5 and Tailwind CSS. Released under the MIT licence.
      </p>
    </div>
  </div>
</Section>

<footer
  class="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-ivory-200/6 pt-5"
>
  <p class="text-2xs text-ivory-600">
    RemielleStrap · MIT licence · made for people who launch Roblox far too often
  </p>

  <div class="flex items-center gap-2">
    <button
      type="button"
      class="btn-ghost"
      onclick={() => void openExternal(`${REPOSITORY}/issues`)}
    >
      Report an issue
    </button>
    <button
      type="button"
      class="btn-ghost"
      onclick={() => void openExternal('https://www.roblox.com/')}
    >
      Roblox
    </button>
  </div>
</footer>
