<script lang="ts">
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Card from "$lib/components/Card.svelte";
  import SettingRow from "$lib/components/SettingRow.svelte";
  import Select from "$lib/components/Select.svelte";
  import TextField from "$lib/components/TextField.svelte";
  import Toggle from "$lib/components/Toggle.svelte";
  import { settings, saveSettings } from "$lib/stores/settings.svelte";
  import { CHANNELS } from "$lib/const";

  async function patch(p: Partial<typeof settings.behaviour>) {
    settings.behaviour = { ...settings.behaviour, ...p };
    await saveSettings();
  }
</script>

<div class="flex flex-col gap-6">
  <PageHeader title="Behaviour" description="How RemielleStrap downloads, launches and re-launches Roblox." />

  <Card title="Deployment">
    <SettingRow label="Channel" description="The Roblox deployment channel to install and update from.">
      <Select
        value={settings.behaviour.channel}
        options={CHANNELS.map((c) => ({ value: c, label: c }))}
        onChange={(v) => patch({ channel: v })}
      />
    </SettingRow>

    <SettingRow label="Multi-instance" description="Allow more than one Roblox client to run at once.">
      <Toggle
        checked={settings.behaviour.multi_instance}
        onChange={(v) => patch({ multi_instance: v })}
        label="Multi-instance"
      />
    </SettingRow>
  </Card>

  <Card title="Launch">
    <SettingRow label="Confirm before launch" description="Ask for confirmation before starting a session.">
      <Toggle checked={settings.behaviour.confirm_launch} onChange={(v) => patch({ confirm_launch: v })} label="Confirm launch" />
    </SettingRow>

    <SettingRow label="Auto-close launcher" description="Close RemielleStrap once Roblox has started.">
      <Toggle checked={settings.behaviour.auto_close} onChange={(v) => patch({ auto_close: v })} label="Auto-close" />
    </SettingRow>

    <SettingRow label="Auto-rejoin" description="Rejoin the last game automatically after a disconnect.">
      <Toggle checked={settings.behaviour.auto_rejoin} onChange={(v) => patch({ auto_rejoin: v })} label="Auto-rejoin" />
    </SettingRow>
  </Card>

  <Card title="Locale">
    <SettingRow label="Force language" description="Override Roblox's client language (e.g. en-us, fr-fr). Leave blank for system default.">
      <TextField
        value={settings.behaviour.force_language}
        placeholder="system default"
        onChange={(v) => patch({ force_language: v })}
      />
    </SettingRow>
  </Card>
</div>
