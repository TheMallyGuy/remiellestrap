<script lang="ts">
  import { PlugZap } from "lucide-svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Card from "$lib/components/Card.svelte";
  import SettingRow from "$lib/components/SettingRow.svelte";
  import Toggle from "$lib/components/Toggle.svelte";
  import TextField from "$lib/components/TextField.svelte";
  import DiscordPreview from "$lib/components/DiscordPreview.svelte";
  import { api } from "$lib/ipc";
  import { settings, saveSettings } from "$lib/stores/settings.svelte";
  import { toast } from "$lib/stores/toasts.svelte";

  async function patch(p: Partial<typeof settings.integrations>) {
    settings.integrations = { ...settings.integrations, ...p };
    await saveSettings();
  }

  async function testDiscord() {
    try {
      const ok = await api.integrations_test_discord();
      if (ok) toast.ok("Discord connected", "A test presence was sent to Discord.");
      else toast.warn("Discord not detected", "Is the Discord desktop client running?");
    } catch (e) {
      toast.err("Test failed", String(e));
    }
  }
</script>

<div class="flex flex-col gap-6">
  <PageHeader title="Integrations" description="Discord Rich Presence and friends." />

  <div class="grid gap-6 lg:grid-cols-[1fr_300px]">
    <div class="flex flex-col gap-6">
      <Card title="Discord Rich Presence" description="Show your Roblox session on your Discord profile.">
        <SettingRow label="Enable Discord Rich Presence" description="Connects to the local Discord client.">
          <Toggle checked={settings.integrations.discord_rpc} onChange={(v) => patch({ discord_rpc: v })} label="Discord Rich Presence" />
        </SettingRow>

        <SettingRow label="Show game name" description="Display the current game's title.">
          <Toggle checked={settings.integrations.discord_show_game} onChange={(v) => patch({ discord_show_game: v })} label="Show game name" />
        </SettingRow>

        <SettingRow label="Show elapsed time" description="Display the session timer.">
          <Toggle checked={settings.integrations.discord_show_elapsed} onChange={(v) => patch({ discord_show_elapsed: v })} label="Show elapsed" />
        </SettingRow>

        <SettingRow label="Show details" description="Extra session details line.">
          <Toggle checked={settings.integrations.discord_show_details} onChange={(v) => patch({ discord_show_details: v })} label="Show details" />
        </SettingRow>

        <SettingRow label="Discord client ID" description="A custom Discord application ID (defaults to RemielleStrap's).">
          <TextField
            value={settings.integrations.discord_client_id}
            placeholder="application id"
            mono
            onChange={(v) => patch({ discord_client_id: v })}
          />
        </SettingRow>

        <div class="flex items-center justify-between gap-4 border-t border-white/[0.06] py-3">
          <div class="text-sm text-wing-400">Verify the connection and push a test presence.</div>
          <button class="btn-secondary focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={testDiscord}>
            <PlugZap size={14} /> Test connection
          </button>
        </div>
      </Card>
    </div>

    <div class="flex flex-col gap-3">
      <h3 class="font-display text-xl text-wing-50">Preview</h3>
      <DiscordPreview />
    </div>
  </div>
</div>
