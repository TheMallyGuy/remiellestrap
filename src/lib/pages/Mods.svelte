<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { FolderOpen, Upload, FolderPlus, Trash2, GripVertical, Files } from "lucide-svelte";
  import PageHeader from "$lib/components/PageHeader.svelte";
  import Card from "$lib/components/Card.svelte";
  import Toggle from "$lib/components/Toggle.svelte";
  import Modal from "$lib/components/Modal.svelte";
  import { api, pickFolder, pickZip } from "$lib/ipc";
  import { mods, loadMods, setModEnabled, reorderMods, deleteMod, importMod } from "$lib/stores/mods.svelte";
  import { toast } from "$lib/stores/toasts.svelte";

  let draggingOver = $state(false);
  let dragIndex = $state<number | null>(null);
  let confirmDelete = $state<string | null>(null);

  onMount(() => void loadMods());

  // Native file/folder drop via Tauri drag-drop events.
  $effect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "over") draggingOver = true;
        else if (p.type === "drop") {
          draggingOver = false;
          void handleDrop(p.paths);
        } else draggingOver = false;
      })
      .then((u) => (disposed ? u() : (un = u)));
    return () => {
      disposed = true;
      un?.();
    };
  });

  async function handleDrop(paths: string[]) {
    for (const path of paths) {
      try {
        await importMod(path);
        toast.ok("Mod imported", `Added “${path.split(/[\\/]/).pop()}”.`);
      } catch (e) {
        toast.err("Import failed", String(e));
      }
    }
  }

  async function importZip() {
    const path = await pickZip("Choose a mod zip");
    if (!path) return;
    try {
      await importMod(path);
      toast.ok("Mod imported");
    } catch (e) {
      toast.err("Import failed", String(e));
    }
  }

  async function importFolder() {
    const path = await pickFolder("Choose a mod folder");
    if (!path) return;
    try {
      await importMod(path);
      toast.ok("Mod imported");
    } catch (e) {
      toast.err("Import failed", String(e));
    }
  }

  function openFolder() {
    void api.mods_open_folder();
  }

  function onDragStart(i: number) {
    dragIndex = i;
  }

  function onDropAt(i: number) {
    if (dragIndex === null || dragIndex === i) return;
    const next = [...mods];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(i, 0, moved);
    const order = next.map((m) => m.name);
    mods.splice(0, mods.length, ...next);
    dragIndex = null;
    void reorderMods(order);
  }

  function doDelete() {
    if (!confirmDelete) return;
    void deleteMod(confirmDelete).then(() => {
      toast.ok("Mod deleted", `Removed “${confirmDelete}”.`);
    });
    confirmDelete = null;
  }
</script>

<div class="flex flex-col gap-6">
  <PageHeader
    title="Mods"
    description="Overlay mod folders onto the installed Roblox version. Priority runs top to bottom."
  />

  <Card title="Installed mods" description={`${mods.length} mod folder${mods.length === 1 ? "" : "s"} in the Mods directory.`}>
    <div
      class="relative min-h-[120px] rounded-md py-3 transition-colors {draggingOver
        ? 'bg-void-700/40'
        : ''}"
    >
      {#if draggingOver}
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center rounded-md border border-dashed border-flare-500 bg-void-700/40">
          <span class="text-sm text-flare-300">Drop to import</span>
        </div>
      {/if}

      {#if mods.length === 0}
        <div class="flex flex-col items-center gap-2 py-8 text-center text-sm text-wing-600">
          <Files size={22} />
          <span>No mods yet. Drag a zip or folder here, or use Import below.</span>
        </div>
      {:else}
        <div class="space-y-2" role="list">
          {#each mods as mod, i (mod.name)}
            <div
              class="card-hover flex items-center gap-3 rounded-md bg-void-800 hairline px-3 py-2.5"
              role="listitem"
              draggable="true"
              ondragstart={() => onDragStart(i)}
              ondragover={(e: DragEvent) => e.preventDefault()}
              ondrop={(e: DragEvent) => {
                e.preventDefault();
                onDropAt(i);
              }}
            >
              <button
                class="cursor-grab text-wing-600 hover:text-wing-400 focus-flare"
                aria-label={`Reorder ${mod.name}`}
                title="Drag to reorder"
              >
                <GripVertical size={16} />
              </button>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm text-wing-50">{mod.name}</div>
                <div class="text-xs text-wing-400">{mod.file_count} files</div>
              </div>
              <Toggle checked={mod.enabled} onChange={(v) => void setModEnabled(mod.name, v)} label={`Enable ${mod.name}`} />
              <button
                class="btn-destructive focus-flare flex h-8 w-8 items-center justify-center rounded-md"
                aria-label={`Delete ${mod.name}`}
                onclick={() => (confirmDelete = mod.name)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="flex flex-wrap items-center gap-2 border-t border-white/[0.06] py-3">
      <button class="btn-secondary focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={importZip}>
        <Upload size={14} /> Import ZIP
      </button>
      <button class="btn-secondary focus-flare flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={importFolder}>
        <FolderPlus size={14} /> Import folder
      </button>
      <button class="btn-ghost focus-flare ml-auto flex items-center gap-1.5 rounded-md px-3 py-2 text-sm" onclick={openFolder}>
        <FolderOpen size={14} /> Open folder
      </button>
    </div>
  </Card>
</div>

<Modal open={confirmDelete !== null} title="Delete mod?" onClose={() => (confirmDelete = null)}>
  <p>
    “{confirmDelete}” will be removed from disk. This cannot be undone.
  </p>
  {#snippet footer()}
    <button class="btn-ghost focus-flare rounded-md px-4 py-2 text-sm" onclick={() => (confirmDelete = null)}>Cancel</button>
    <button class="btn-destructive focus-flare rounded-md px-4 py-2 text-sm" onclick={doDelete}>Delete</button>
  {/snippet}
</Modal>
