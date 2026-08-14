<script lang="ts">
  import { onMount } from "svelte";
  import { Download, Upload, RotateCcw, Trash2, FolderOpen, RefreshCw } from "lucide-svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Card from "$lib/components/Card.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { api, pickJson, pickSaveFile } from "$lib/ipc";
  import { settings, resetSettings } from "$lib/stores/settings.svelte";
  import { startBootstrap } from "$lib/stores/bootstrap.svelte";
  import { toast } from "$lib/stores/toasts.svelte";
  import type { PathsInfo, RobloxState } from "$lib/types";

  let paths = $state<PathsInfo | null>(null);
  let roblox = $state<RobloxState | null>(null);
  let confirmUninstall = $state(false);
  let confirmReset = $state(false);

  onMount(async () => {
    try {
      [paths, roblox] = await Promise.all([api.get_paths(), api.roblox_state_get()]);
    } catch {
      /* ignore */
    }
  });

  async function exportSettings() {
    const path = await pickSaveFile("Export settings", "RemielleStrap-Settings.json");
    if (!path) return;
    try {
      await api.settings_export(path);
      toast.ok("Exported", "Settings written to disk.");
    } catch (e) {
      toast.err("Export failed", String(e));
    }
  }

  async function importSettings() {
    const path = await pickJson("Import settings");
    if (!path) return;
    try {
      const s = await api.settings_import(path);
      Object.assign(settings, s);
      toast.ok("Imported", "Settings restored.");
    } catch (e) {
      toast.err("Import failed", String(e));
    }
  }

  function doReset() {
    confirmReset = false;
    void resetSettings().then(() => toast.ok("Reset", "Settings restored to defaults."));
  }

  function doUninstall() {
    confirmUninstall = false;
    void api.install_uninstall().then(() => {
      toast.ok("Uninstalled", "Roblox version directory was removed.");
    });
  }

  function openLogs() {
    if (paths) void api.open_path(paths.logs_dir);
  }

  const pathRows = $derived(
    paths
      ? [
          { label: "App data", value: paths.data_dir },
          { label: "Art cache", value: paths.cache_dir },
          { label: "Mods", value: paths.mods_dir },
          { label: "Downloads", value: paths.downloads_dir },
          { label: "Logs", value: paths.logs_dir },
          { label: "Roblox versions", value: paths.versions_dir },
        ]
      : [],
  );
</script>

<div class="flex flex-col gap-6">
  <PageHeader title="Installation" description="Paths, updates and settings management." />

  <Card title="Roblox deployment" description="The installed client version.">
    <div class="grid grid-cols-1 gap-3 py-3 sm:grid-cols-2">
      <div class="rounded-md bg-void-900 hairline px-3 py-2.5">
        <div class="text-xs uppercase tracking-wide text-wing-600">Installed GUID</div>
        <div class="mt-1 truncate font-mono text-sm text-wing-50" title={roblox?.installed_guid ?? ""}>
          {roblox?.installed_guid ?? "not installed"}
        </div>
      </div>
      <div class="rounded-md bg-void-900 hairline px-3 py-2.5">
        <div class="text-xs uppercase tracking-wide text-wing-600">Channel</div>
        <div class="mt-1 font-mono text-sm text-wing-50">{roblox?.channel ?? settings.behaviour.channel}</div>
      </div>
    </div>
    <div class="border-t border-white/[0.06] py-3">
      <button class="btn-secondary focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={() => startBootstrap(null, true)}>
        <RefreshCw size={14} /> Force reinstall
      </button>
    </div>
  </Card>

  <Card title="Paths">
    <div class="divide-y divide-white/[0.06]">
      {#each pathRows as row (row.label)}
        <div class="flex items-center justify-between gap-4 py-2.5">
          <span class="w-32 shrink-0 text-sm text-wing-400">{row.label}</span>
          <code class="min-w-0 flex-1 truncate text-right font-mono text-xs text-wing-600" title={row.value}>{row.value}</code>
        </div>
      {/each}
    </div>
    <div class="flex flex-wrap items-center gap-2 border-t border-white/[0.06] py-3">
      <button class="btn-ghost focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={openLogs}>
        <FolderOpen size={14} /> Open logs
      </button>
    </div>
  </Card>

  <Card title="Settings" description="Export, import or reset your configuration.">
    <div class="flex flex-wrap items-center gap-2 py-3">
      <button class="btn-secondary focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={exportSettings}>
        <Upload size={14} /> Export
      </button>
      <button class="btn-secondary focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={importSettings}>
        <Download size={14} /> Import
      </button>
      <button class="btn-ghost focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={() => (confirmReset = true)}>
        <RotateCcw size={14} /> Reset
      </button>
    </div>
  </Card>

  <Card title="Danger zone">
    <div class="flex items-center justify-between gap-4 py-3">
      <div class="text-sm text-wing-400">Remove the installed Roblox version directory.</div>
      <button class="btn-destructive focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={() => (confirmUninstall = true)}>
        <Trash2 size={14} /> Uninstall
      </button>
    </div>
  </Card>
</div>

<Modal open={confirmReset} title="Reset settings?" onClose={() => (confirmReset = false)}>
  <p>All preferences, FastFlag profiles and artwork choices will be restored to defaults.</p>
  {#snippet footer()}
    <button class="btn-ghost focus-flare rounded-md px-4 py-2 text-sm" onclick={() => (confirmReset = false)}>Cancel</button>
    <button class="btn-primary focus-flare rounded-md px-4 py-2 text-sm" onclick={doReset}>Reset</button>
  {/snippet}
</Modal>

<Modal open={confirmUninstall} title="Uninstall Roblox?" onClose={() => (confirmUninstall = false)}>
  <p>This deletes the installed version directory (not your settings). Roblox will be re-downloaded on next launch.</p>
  {#snippet footer()}
    <button class="btn-ghost focus-flare rounded-md px-4 py-2 text-sm" onclick={() => (confirmUninstall = false)}>Cancel</button>
    <button class="btn-destructive focus-flare rounded-md px-4 py-2 text-sm" onclick={doUninstall}>Uninstall</button>
  {/snippet}
</Modal>
