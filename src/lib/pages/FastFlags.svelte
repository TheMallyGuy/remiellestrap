<script lang="ts">
  import { Plus, Copy, Pencil, Trash2, Upload, Download, Search } from "lucide-svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Card from "$lib/components/Card.svelte";
  import Select from "$lib/components/Select.svelte";
  import TextField from "$lib/components/TextField.svelte";
  import Toggle from "$lib/components/Toggle.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { api, pickJson, pickSaveFile } from "$lib/ipc";
  import { settings, saveSettings } from "$lib/stores/settings.svelte";
  import { toast } from "$lib/stores/toasts.svelte";
  import { flagTypeOf } from "$lib/const";
  import type { FlagProfile, FlagValue } from "$lib/types";

  let search = $state("");
  let modal = $state<null | { kind: "new" | "rename" | "duplicate"; name: string; target?: string }>(null);
  let newFlagKey = $state("");
  let newFlagType = $state<FlagValue["type"]>("bool");

  const profiles = $derived(settings.fast_flags.profiles);
  const active = $derived(
    profiles.find((p) => p.name === settings.fast_flags.active_profile) ?? profiles[0],
  );

  const filtered = $derived.by(() => {
    const flags = active?.flags ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return flags;
    return flags.filter((f) => f.key.toLowerCase().includes(q));
  });

  async function persist() {
    await saveSettings();
  }

  function setActive(name: string) {
    settings.fast_flags.active_profile = name;
    void persist();
  }

  function openModal(kind: "new" | "rename" | "duplicate", target?: string) {
    modal = {
      kind,
      name: kind === "new" ? "" : kind === "rename" ? target ?? "" : `${target ?? "Default"} copy`,
      target,
    };
  }

  function confirmModal() {
    const m = modal;
    if (!m) return;
    const name = m.name.trim();
    if (!name) return;
    if (m.kind === "new") {
      settings.fast_flags.profiles = [...profiles, { name, flags: [] }];
      settings.fast_flags.active_profile = name;
    } else if (m.kind === "rename" && m.target) {
      settings.fast_flags.profiles = profiles.map((p) =>
        p.name === m.target ? { ...p, name } : p,
      );
      if (settings.fast_flags.active_profile === m.target) settings.fast_flags.active_profile = name;
    } else if (m.kind === "duplicate" && m.target) {
      const src = profiles.find((p) => p.name === m.target);
      settings.fast_flags.profiles = [
        ...profiles,
        { name, flags: src ? src.flags.map((f) => ({ ...f, value: structuredClone(f.value) })) : [] },
      ];
    }
    modal = null;
    void persist();
  }

  function deleteProfile(name: string) {
    const remaining = profiles.filter((p) => p.name !== name);
    if (remaining.length === 0) {
      remaining.push({ name: "Default", flags: [] });
    }
    settings.fast_flags.profiles = remaining;
    if (settings.fast_flags.active_profile === name) settings.fast_flags.active_profile = remaining[0].name;
    void persist();
  }

  function addFlag() {
    const key = newFlagKey.trim();
    if (!key || !active) return;
    const existing = active.flags.some((f) => f.key === key);
    if (existing) {
      toast.warn("Flag exists", `${key} is already in this profile.`);
      return;
    }
    const value: FlagValue =
      newFlagType === "bool"
        ? { type: "bool", value: false }
        : newFlagType === "number"
          ? { type: "number", value: 0 }
          : { type: "string", value: "" };
    active.flags = [...active.flags, { key, value }];
    newFlagKey = "";
    void persist();
  }

  function setFlagValue(index: number, value: FlagValue) {
    if (!active) return;
    active.flags = active.flags.map((f, i) => (i === index ? { ...f, value } : f));
    void persist();
  }

  function removeFlag(index: number) {
    if (!active) return;
    active.flags = active.flags.filter((_, i) => i !== index);
    void persist();
  }

  async function exportProfile() {
    if (!active) return;
    const path = await pickSaveFile("Export FastFlags", `${active.name}.json`);
    if (!path) return;
    try {
      await api.fastflags_export(path);
      toast.ok("Exported", `“${active.name}” written to disk.`);
    } catch (e) {
      toast.err("Export failed", String(e));
    }
  }

  async function importProfile() {
    const path = await pickJson("Import FastFlags");
    if (!path) return;
    try {
      const s = await api.fastflags_import(path);
      Object.assign(settings, s);
      toast.ok("Imported", "Profile merged as the active profile.");
    } catch (e) {
      toast.err("Import failed", String(e));
    }
  }
</script>

<div class="flex flex-col gap-6">
  <PageHeader title="FastFlags" description="Client settings applied to every launch." />

  <Card
    title="Profiles"
    description={`${profiles.length} profile${profiles.length === 1 ? "" : "s"} — “${active?.name ?? ""}” is active (${active?.flags.length ?? 0} flags).`}
  >
    <div class="flex flex-wrap items-center gap-2 py-3">
      <Select
        value={settings.fast_flags.active_profile}
        options={profiles.map((p) => ({ value: p.name, label: p.name }))}
        onChange={setActive}
      />
      <button class="btn-secondary focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={() => openModal("new")}>
        <Plus size={14} /> New
      </button>
      <button class="btn-secondary focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={() => openModal("duplicate", active?.name)}>
        <Copy size={14} /> Duplicate
      </button>
      <button class="btn-secondary focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={() => openModal("rename", active?.name)}>
        <Pencil size={14} /> Rename
      </button>
      <button
        class="btn-destructive focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm"
        disabled={profiles.length <= 1}
        onclick={() => deleteProfile(active?.name ?? "")}
      >
        <Trash2 size={14} /> Delete
      </button>
      <span class="ml-auto flex items-center gap-2">
        <button class="btn-ghost focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={importProfile}>
          <Upload size={14} /> Import
        </button>
        <button class="btn-ghost focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={exportProfile}>
          <Download size={14} /> Export
        </button>
      </span>
    </div>
  </Card>

  <Card title="Flags">
    <div class="flex items-center gap-3 py-3">
      <div class="relative flex-1">
        <Search size={14} class="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-wing-600" />
        <input
          value={search}
          oninput={(e) => (search = e.currentTarget.value)}
          placeholder="Search flags…"
          class="focus-flare h-10 w-full rounded-md border border-white/[0.07] bg-void-700 pl-9 pr-3 text-base text-wing-50 outline-none placeholder:text-wing-600 focus:border-flare-500"
        />
      </div>
    </div>

    <div class="divide-y divide-white/[0.06]">
      {#if filtered.length === 0}
        <div class="py-8 text-center text-sm text-wing-600">No flags match{search ? " your search" : " — add one below"}.</div>
      {/if}
      {#each filtered as f, i (f.key)}
        {@const realIndex = (active?.flags ?? []).indexOf(f)}
        <div class="flex items-center gap-3 py-2.5">
          <div class="min-w-0 flex-1">
            <div class="truncate font-mono text-sm text-wing-200" title={f.key}>{f.key}</div>
            <div class="text-xs text-wing-600">{f.value.type}</div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            {#if f.value.type === "bool"}
              <Toggle checked={f.value.value} onChange={(v) => setFlagValue(realIndex, { type: "bool", value: v })} />
            {:else if f.value.type === "number"}
              <input
                type="number"
                value={f.value.value}
                oninput={(e) => setFlagValue(realIndex, { type: "number", value: Number(e.currentTarget.value) })}
                class="focus-flare h-9 w-32 rounded-md border border-white/[0.07] bg-void-700 px-3 font-mono text-sm text-wing-50 outline-none focus:border-flare-500"
              />
            {:else}
              <TextField value={f.value.value} onChange={(v) => setFlagValue(realIndex, { type: "string", value: v })} mono />
            {/if}

            <button class="btn-destructive focus-flare flex h-8 w-8 items-center justify-center rounded-md" aria-label={`Remove ${f.key}`} onclick={() => removeFlag(realIndex)}>
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      {/each}
    </div>

    <div class="flex items-end gap-2 border-t border-white/[0.06] py-3">
      <div class="flex-1">
        <TextField value={newFlagKey} onChange={(v) => (newFlagKey = v)} placeholder="FFlagExample" mono />
      </div>
      <Select
        value={newFlagType}
        options={[
          { value: "bool", label: "bool" },
          { value: "number", label: "number" },
          { value: "string", label: "string" },
        ]}
        onChange={(v) => (newFlagType = v as FlagValue["type"])}
      />
      <button class="btn-primary focus-flare flex h-10 items-center gap-1.5 rounded-md px-4 text-sm" onclick={addFlag}>
        <Plus size={14} /> Add
      </button>
    </div>
  </Card>
</div>

<Modal
  open={modal !== null}
  title={modal?.kind === "new" ? "New profile" : modal?.kind === "rename" ? "Rename profile" : "Duplicate profile"}
  onClose={() => (modal = null)}
>
  <TextField value={modal?.name ?? ""} onChange={(v) => modal && (modal.name = v)} placeholder="Profile name" />

  {#snippet footer()}
    <button class="btn-ghost focus-flare rounded-md px-4 py-2 text-sm" onclick={() => (modal = null)}>Cancel</button>
    <button class="btn-primary focus-flare rounded-md px-4 py-2 text-sm" onclick={confirmModal}>Save</button>
  {/snippet}
</Modal>
