<script lang="ts">
  import type { LaunchMode, ProcessPriority } from '@shared/settings'
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
    title="Close the overlay automatically"
    description="Dismiss the bootstrapper as soon as the client window appears."
  >
    <Switch
      checked={settings.value.autoCloseBootstrapper}
      label="Close the overlay automatically"
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
