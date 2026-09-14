<script lang="ts">
  import type { AllowlistSeverity, LaunchMode, ProcessPriority } from '@shared/settings'
  import { SUPPORTED_LANGUAGES } from '@shared/settings'
  import { api } from '../ipc'
  import { accounts } from '../stores/accounts.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import { languageOptions } from '../i18n'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'

  /**
   * Behaviour: what the bootstrapper does around a launch.
   */

  const LAUNCH_MODES: { value: LaunchMode; label: string }[] = [
    { value: 'player', label: 'Roblox Player' },
    { value: 'studio', label: 'Roblox Studio' }
  ]

  const PRIORITIES: { value: ProcessPriority; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'abovenormal', label: 'Above normal' },
    { value: 'high', label: 'High' }
  ]

  const LOCALES = [
    { value: 'en_us', label: 'English (US)' },
    { value: 'en_gb', label: 'English (UK)' },
    { value: 'de_de', label: 'German' },
    { value: 'es_es', label: 'Spanish' },
    { value: 'fr_fr', label: 'French' },
    { value: 'id_id', label: 'Indonesian' },
    { value: 'it_it', label: 'Italian' },
    { value: 'ja_jp', label: 'Japanese' },
    { value: 'ko_kr', label: 'Korean' },
    { value: 'pt_br', label: 'Portuguese (Brazil)' },
    { value: 'ru_ru', label: 'Russian' },
    { value: 'th_th', label: 'Thai' },
    { value: 'tr_tr', label: 'Turkish' },
    { value: 'vi_vn', label: 'Vietnamese' },
    { value: 'zh_cn', label: 'Chinese (Simplified)' },
    { value: 'zh_tw', label: 'Chinese (Traditional)' }
  ]

  let argumentsDraft = $state<string | null>(null)
  let affinityDraft = $state<string | null>(null)
  let savingAffinity = $state(false)

  const affinityValue = $derived(affinityDraft ?? settings.value.cpuAffinity)

  /** Parses "0-3,6" into core numbers, or null for "all cores". */
  function parseAffinity(text: string): number[] | null {
    const trimmed = text.trim()
    if (trimmed.length === 0) return null

    const cores = new Set<number>()

    for (const part of trimmed.split(',')) {
      const range = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(part.trim())
      if (range) {
        const from = Number.parseInt(range[1], 10)
        const to = Number.parseInt(range[2], 10)
        for (let core = Math.min(from, to); core <= Math.max(from, to); core += 1) cores.add(core)
        continue
      }

      if (/^\d{1,2}$/.test(part.trim())) cores.add(Number.parseInt(part.trim(), 10))
    }

    return cores.size > 0 ? [...cores].sort((a, b) => a - b) : null
  }

  async function commitAffinity(): Promise<void> {
    if (affinityDraft === null) return

    const next = affinityDraft.trim()
    affinityDraft = null

    if (next === settings.value.cpuAffinity) return

    void updateSettings({ cpuAffinity: next })

    const affinity = parseAffinity(next)
    if (!affinity) return

    savingAffinity = true
    try {
      await api.tweaks.apply({ affinity })
      pushToast({ kind: 'success', title: 'Affinity applied to the running client' })
    } catch {
      // The running client may simply not exist yet; the launch path applies it.
      pushToast({ kind: 'info', title: 'Saved — it will be applied at the next launch' })
    } finally {
      savingAffinity = false
    }
  }

  const argumentsValue = $derived(argumentsDraft ?? settings.value.launchArguments)

  function commitArguments(): void {
    if (argumentsDraft === null) return

    const next = argumentsDraft.trim()
    argumentsDraft = null
    if (next !== settings.value.launchArguments) {
      void updateSettings({ launchArguments: next })
    }
  }
</script>

<PageHeader title="Behaviour" subtitle="What happens before, during and after a launch." />

<Section title="Launching" class="mb-9">
  <SettingRow
    title="Preferred client"
    description="Used when you press Play without a deep link."
    for="launch-mode"
  >
    <Select
      id="launch-mode"
      value={settings.value.preferredLaunchMode}
      options={LAUNCH_MODES}
      label="Preferred client"
      onchange={(value) => void updateSettings({ preferredLaunchMode: value as LaunchMode })}
    />
  </SettingRow>

  <SettingRow
    title="Confirm before launching"
    description="Ask first when a website or another app hands RemielleStrap a launch link."
  >
    <Switch
      checked={settings.value.confirmLaunches}
      label="Confirm before launching"
      onchange={(value) => void updateSettings({ confirmLaunches: value })}
    />
  </SettingRow>

  <SettingRow
    title="Close the setup window automatically"
    description="Dismiss the install and launch window as soon as Roblox starts."
  >
    <Switch
      checked={settings.value.autoCloseBootstrapper}
      label="Close the setup window automatically"
      onchange={(value) => void updateSettings({ autoCloseBootstrapper: value })}
    />
  </SettingRow>

  <SettingRow
    title="Close RemielleStrap on launch"
    description="Exit once Roblox has started. Activity tracking and Discord presence stop too."
    warning={settings.value.closeOnRobloxLaunch && settings.value.enableDiscordRpc
      ? 'Discord presence will not be shown while RemielleStrap is closed.'
      : undefined}
  >
    <Switch
      checked={settings.value.closeOnRobloxLaunch}
      label="Close RemielleStrap on launch"
      onchange={(value) => void updateSettings({ closeOnRobloxLaunch: value })}
    />
  </SettingRow>

  <SettingRow
    title="Allow multiple instances"
    description="Skip the single-instance check so more than one client can run at once."
    warning="Roblox does not officially support this and may behave unpredictably."
  >
    <Switch
      checked={settings.value.multiInstanceLaunching}
      label="Allow multiple instances"
      onchange={(value) => void updateSettings({ multiInstanceLaunching: value })}
    />
  </SettingRow>

  <SettingRow
    title="Process priority"
    description="The Windows scheduling priority given to the client process."
    for="priority"
  >
    <Select
      id="priority"
      value={settings.value.processPriority}
      options={PRIORITIES}
      label="Process priority"
      onchange={(value) => void updateSettings({ processPriority: value as ProcessPriority })}
    />
  </SettingRow>
</Section>

<Section title="Window" class="mb-9">
  <SettingRow
    title="Close to the tray"
    description="Keep RemielleStrap running in the notification area instead of quitting."
  >
    <Switch
      checked={settings.value.minimizeToTray}
      label="Close to the tray"
      onchange={(value) => void updateSettings({ minimizeToTray: value })}
    />
  </SettingRow>
</Section>

<Section title="Notifications" class="mb-9">
  <SettingRow
    title="When an install finishes"
    description="A desktop notification once Roblox is installed or updated."
  >
    <Switch
      checked={settings.value.notifyOnInstallComplete}
      label="Notify when an install finishes"
      onchange={(value) => void updateSettings({ notifyOnInstallComplete: value })}
    />
  </SettingRow>

  <SettingRow title="When you join an experience">
    <Switch
      checked={settings.value.notifyOnActivityJoin}
      label="Notify when you join an experience"
      onchange={(value) => void updateSettings({ notifyOnActivityJoin: value })}
    />
  </SettingRow>

  <SettingRow title="When Roblox closes" description="Includes how long the session lasted.">
    <Switch
      checked={settings.value.notifyOnRobloxExit}
      label="Notify when Roblox closes"
      onchange={(value) => void updateSettings({ notifyOnRobloxExit: value })}
    />
  </SettingRow>
</Section>

<Section
  title="Locale and arguments"
  description="Passed to the client on every launch. Deep links from the website override the locale when they carry one."
>
  <SettingRow title="Interface language" for="roblox-locale">
    <Select
      id="roblox-locale"
      value={settings.value.robloxLocale}
      options={LOCALES}
      label="Interface language"
      class="w-52"
      onchange={(value) => void updateSettings({ robloxLocale: value })}
    />
  </SettingRow>

  <SettingRow
    title="Experience language"
    description="Used for in-experience text where the creator provides translations."
    for="game-locale"
  >
    <Select
      id="game-locale"
      value={settings.value.gameLocale}
      options={LOCALES}
      label="Experience language"
      class="w-52"
      onchange={(value) => void updateSettings({ gameLocale: value })}
    />
  </SettingRow>

  <SettingRow
    title="Extra launch arguments"
    description="Appended verbatim to the client command line. Shell metacharacters are rejected."
    stacked
    for="launch-arguments"
  >
    <input
      id="launch-arguments"
      class="field field-mono"
      value={argumentsValue}
      spellcheck="false"
      autocomplete="off"
      placeholder="--fullscreen"
      oninput={(event) => (argumentsDraft = event.currentTarget.value)}
      onblur={commitArguments}
      onkeydown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  </SettingRow>
</Section>

<div class="h-5"></div>

<Section
  title="Accounts"
  description="Which account a launch signs in as, and how that sign-in is performed."
>
  <SettingRow
    title="Launch account"
    description="Overrides the account chosen on the Accounts page for the next launch only."
  >
    <Select
      value={settings.value.activeAccountId ?? ''}
      options={[
        { value: '', label: 'Not signed in' },
        ...accounts.list.map((account) => ({ value: account.id, label: account.displayName }))
      ]}
      onchange={(value) => void updateSettings({ activeAccountId: value || null })}
    />
  </SettingRow>

  <SettingRow
    title="Sign-in method"
    description="A ticket is what Roblox's own launcher uses and always signs the right account in. Plain launch lets the client use whichever session it still has."
  >
    <Select
      value={settings.value.accountLaunchStrategy}
      options={[
        { value: 'ticket', label: 'Request a ticket (recommended)' },
        { value: 'plain', label: 'Plain launch' }
      ]}
      onchange={(value) =>
        void updateSettings({ accountLaunchStrategy: value as typeof settings.value.accountLaunchStrategy })}
    />
  </SettingRow>

  <SettingRow
    title="Refresh presence in the background"
    description={`Every ${settings.value.accountRefreshMinutes} minutes while the launcher is open.`}
  >
    <Switch
      checked={settings.value.accountBackgroundRefresh}
      onchange={(value) => void updateSettings({ accountBackgroundRefresh: value })}
    />
  </SettingRow>

  <SettingRow title="Refresh interval">
    <Select
      value={String(settings.value.accountRefreshMinutes)}
      options={[1, 5, 15, 30, 60].map((minutes) => ({
        value: String(minutes),
        label: `${minutes} minute${minutes === 1 ? '' : 's'}`
      }))}
      onchange={(value) => void updateSettings({ accountRefreshMinutes: Number(value) })}
    />
  </SettingRow>
</Section>

<div class="h-5"></div>

<Section
  title="Process"
  description="Applied to the client as it starts. Everything here is reversible and none of it changes files on disk."
>
  <SettingRow
    title="CPU affinity"
    description="Which cores the client may use, e.g. 0-3 or 0-3,6. Empty means every core."
  >
    <div class="flex items-center gap-2">
      <input
        class="field w-28 py-1.5 font-mono text-xs"
        placeholder="all cores"
        value={affinityValue}
        oninput={(event) => (affinityDraft = event.currentTarget.value)}
        onblur={() => void commitAffinity()}
        onkeydown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      {#if savingAffinity}
        <span class="text-2xs text-ivory-500">applying…</span>
      {/if}
    </div>
  </SettingRow>

  <SettingRow
    title="Multi-instance launching"
    description="Lets a second client start while one is already running. RemielleStrap holds the singleton objects Roblox checks, and releases them once every client has exited."
    warning={process.platform === 'win32' ? undefined : 'This is a Windows-only feature.'}
  >
    <Switch
      checked={settings.value.multiInstanceLaunching}
      onchange={(value) => void updateSettings({ multiInstanceLaunching: value })}
    />
  </SettingRow>

  <SettingRow
    title="Capture features"
    description="Turns off Roblox's screenshot and video capture entry points through engine flags. Reversible: switch it back off and they return."
  >
    <Switch
      checked={settings.value.disableCaptureFeatures}
      onchange={(value) => void updateSettings({ disableCaptureFeatures: value })}
    />
  </SettingRow>

  <SettingRow
    title="Voice chat capability"
    description="Keeps the voice-chat engine flags enabled regardless of the selected FastFlag profile."
  >
    <Switch
      checked={settings.value.enableVoiceChat}
      onchange={(value) => void updateSettings({ enableVoiceChat: value })}
    />
  </SettingRow>
</Section>

<div class="h-5"></div>

<Section
  title="Studio"
  description="Whether the same flags and settings are written for Roblox Studio as well as the player."
>
  <SettingRow
    title="Apply settings to Studio"
    description="Writes AppSettings.xml for the Studio install too. Harmless, and it means Studio and the player agree."
  >
    <Switch
      checked={settings.value.applySettingsToStudio}
      onchange={(value) => void updateSettings({ applySettingsToStudio: value })}
    />
  </SettingRow>
</Section>

<div class="h-5"></div>

<Section title="Safety" description="How strict the launcher is about FastFlags that are not on the allowlist.">
  <SettingRow
    title="Unknown flag policy"
    description="A warn keeps the flag and tells you; a block refuses to apply the profile."
  >
    <Select
      value={settings.value.flagAllowlistSeverity}
      options={[
        { value: 'off', label: 'Apply anything' },
        { value: 'warn', label: 'Warn about unknown flags' },
        { value: 'block', label: 'Block unknown flags' }
      ]}
      onchange={(value) => void updateSettings({ flagAllowlistSeverity: value as AllowlistSeverity })}
    />
  </SettingRow>
</Section>

<div class="h-5"></div>

<Section title="Language" description="The app's own interface language. Untranslated strings stay in English.">
  <SettingRow title="Interface language">
    <Select
      value={settings.value.language}
      options={languageOptions()}
      onchange={(value) => void updateSettings({ language: value })}
    />
  </SettingRow>

  <SettingRow
    title="Available translations"
    description={`${SUPPORTED_LANGUAGES.length} languages are listed; dictionaries can be added in src/renderer/src/lib/i18n.`}
  >
    <span class="text-2xs text-ivory-500">scaffolded</span>
  </SettingRow>
</Section>
