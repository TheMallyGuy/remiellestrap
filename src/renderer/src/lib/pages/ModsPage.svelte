<script lang="ts">
  import type { ModEntry } from '@shared/models'
  import { api, errorMessage } from '../ipc'
  import { pushToast } from '../stores/toasts.svelte'
  import { formatBytes, formatRelative } from '../utils/format'
  import type { ConfirmOptions } from '../types'
  import ConfirmDialog from '../dialogs/ConfirmDialog.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'

  /**
   * Mods are folders of client files overlaid onto the Roblox install directory
   * immediately before launch. Order matters: later entries win, so the list is
   * reorderable and the priority is what the overlay walks.
   */

  let mods = $state<ModEntry[]>([])
  let loading = $state(true)
  let working = $state(false)

  let dragId = $state<string | null>(null)
  let dragOverId = $state<string | null>(null)

  let confirmOpen = $state(false)
  let confirmOptions = $state<ConfirmOptions>({ title: '', message: '' })
  let confirmAction = $state<(() => Promise<void>) | null>(null)

  // Colour-mod generator
  let colorName = $state('Remielle Ink')
  let colorValue = $state('#0b0b0d')
  let accentValue = $state('#c8a24a')

  const enabledCount = $derived(mods.filter((mod) => mod.enabled).length)
  const totalBytes = $derived(mods.reduce((sum, mod) => sum + mod.sizeBytes, 0))

  $effect(() => {
    void load()
  })

  async function load(): Promise<void> {
    loading = true

    try {
      mods = await api.mods.list()
    } catch (error) {
      pushToast({
        kind: 'error',
        title: 'Could not read the mods folder',
        message: errorMessage(error)
      })
    } finally {
      loading = false
    }
  }

  async function run(action: () => Promise<ModEntry[]>, success?: string): Promise<void> {
    working = true

    try {
      mods = await action()
      if (success) pushToast({ kind: 'success', title: success })
    } catch (error) {
      pushToast({ kind: 'error', title: 'That did not work', message: errorMessage(error) })
    } finally {
      working = false
    }
  }

  async function importZip(): Promise<void> {
    working = true

    try {
      const result = await api.mods.importZip()

      if (result.ok && result.data) {
        mods = result.data
        pushToast({ kind: 'success', title: 'Mod imported' })
      } else if (result.error) {
        pushToast({ kind: 'warning', title: 'Import cancelled', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Import failed', message: errorMessage(error) })
    } finally {
      working = false
    }
  }

  async function importFolder(): Promise<void> {
    working = true

    try {
      const result = await api.mods.importFolder()

      if (result.ok && result.data) {
        mods = result.data
        pushToast({ kind: 'success', title: 'Mod imported' })
      } else if (result.error) {
        pushToast({ kind: 'warning', title: 'Import cancelled', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Import failed', message: errorMessage(error) })
    } finally {
      working = false
    }
  }

  function remove(mod: ModEntry): void {
    confirmOptions = {
      title: `Delete “${mod.name}”?`,
      message: `${mod.fileCount} ${mod.fileCount === 1 ? 'file' : 'files'} will be removed from the mods folder. This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true
    }
    confirmAction = async () => run(() => api.mods.delete(mod.id), 'Mod deleted')
    confirmOpen = true
  }

  async function openFolder(id?: string): Promise<void> {
    const result = await api.mods.openFolder(id)
    if (!result.ok && result.error) {
      pushToast({ kind: 'error', title: 'Could not open the folder', message: result.error })
    }
  }

  async function generateColorMod(): Promise<void> {
    const name = colorName.trim()

    if (name.length === 0) {
      pushToast({ kind: 'warning', title: 'Give the mod a name first' })
      return
    }

    working = true

    try {
      const result = await api.mods.generateColorMod({
        name,
        color: colorValue,
        accent: accentValue
      })

      if (result.ok && result.data) {
        mods = result.data
        pushToast({ kind: 'success', title: `“${name}” created` })
      } else if (result.error) {
        pushToast({ kind: 'error', title: 'Could not generate the mod', message: result.error })
      }
    } catch (error) {
      pushToast({
        kind: 'error',
        title: 'Could not generate the mod',
        message: errorMessage(error)
      })
    } finally {
      working = false
    }
  }

  /* ------------------------------------------------------------ Reordering */

  function onDragStart(event: DragEvent, id: string): void {
    dragId = id
    event.dataTransfer?.setData('text/plain', id)
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(event: DragEvent, id: string): void {
    if (dragId === null || dragId === id) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dragOverId = id
  }

  function onDrop(event: DragEvent, id: string): void {
    event.preventDefault()

    const source = dragId
    dragId = null
    dragOverId = null

    if (source === null || source === id) return
    commitOrder(reorderIds(source, id))
  }

  function reorderIds(source: string, target: string): string[] {
    const ids = mods.map((mod) => mod.id)
    const from = ids.indexOf(source)
    const to = ids.indexOf(target)

    if (from < 0 || to < 0) return ids

    ids.splice(from, 1)
    ids.splice(to, 0, source)
    return ids
  }

  /** Keyboard reordering, so the list is usable without a pointer. */
  function nudge(id: string, delta: number): void {
    const ids = mods.map((mod) => mod.id)
    const from = ids.indexOf(id)
    const to = from + delta

    if (from < 0 || to < 0 || to >= ids.length) return

    ids.splice(from, 1)
    ids.splice(to, 0, id)
    commitOrder(ids)
  }

  function commitOrder(ids: string[]): void {
    // Reflect the new order immediately; the main process is the final word.
    const byId = new Map(mods.map((mod) => [mod.id, mod]))
    mods = ids.map((id, index) => ({ ...byId.get(id)!, priority: index }))
    void run(() => api.mods.reorder(ids))
  }

  async function runConfirm(): Promise<void> {
    const action = confirmAction
    confirmOpen = false
    confirmAction = null
    if (action) await action()
  }
</script>

<PageHeader
  title="Mods"
  subtitle="Files layered over the Roblox client at launch. Lower entries are applied last and win any conflict."
>
  {#snippet actions()}
    <button type="button" class="btn-ghost" onclick={() => void openFolder()}>
      <Icon name="folder" size={12} />
      Open folder
    </button>
    <button
      type="button"
      class="btn-secondary"
      onclick={() => void importFolder()}
      disabled={working}
    >
      Import folder
    </button>
    <button type="button" class="btn-primary" onclick={() => void importZip()} disabled={working}>
      <Icon name="download" size={13} />
      Import .zip
    </button>
  {/snippet}
</PageHeader>

<Section
  title="Installed mods"
  description={mods.length > 0
    ? `${enabledCount} of ${mods.length} enabled · ${formatBytes(totalBytes)} on disk`
    : 'Nothing installed yet.'}
  bare
>
  {#if loading}
    <div class="surface px-4 py-10 text-center text-xs text-ivory-500">
      Reading the mods folder…
    </div>
  {:else if mods.length === 0}
    <EmptyState
      icon="layers"
      title="No mods installed"
      message="Import a .zip or a folder containing client files — for example content/textures or ExtraContent — and they will be copied over the install before Roblox starts."
    >
      {#snippet action()}
        <button type="button" class="btn-primary" onclick={() => void importZip()}>
          <Icon name="download" size={13} />
          Import a .zip
        </button>
      {/snippet}
    </EmptyState>
  {:else}
    <ul class="surface overflow-hidden">
      {#each mods as mod, index (mod.id)}
        <li
          class="group flex items-center gap-3 border-b border-ivory-200/5 px-3 py-3 transition-colors last:border-b-0 {dragOverId ===
          mod.id
            ? 'bg-gold-500/6'
            : ''} {dragId === mod.id ? 'opacity-40' : ''}"
          draggable="true"
          ondragstart={(event) => onDragStart(event, mod.id)}
          ondragover={(event) => onDragOver(event, mod.id)}
          ondragleave={() => {
            if (dragOverId === mod.id) dragOverId = null
          }}
          ondrop={(event) => onDrop(event, mod.id)}
          ondragend={() => {
            dragId = null
            dragOverId = null
          }}
        >
          <span
            class="shrink-0 cursor-grab text-ivory-700 transition-colors group-hover:text-ivory-500 active:cursor-grabbing"
            title="Drag to reorder"
          >
            <Icon name="grip" size={14} />
          </span>

          <span class="w-5 shrink-0 text-center text-2xs tabular-nums text-ivory-600">
            {index + 1}
          </span>

          <div class="min-w-0 flex-1">
            <p class="truncate text-[0.8125rem] text-ivory-100">{mod.name}</p>
            <p class="mt-0.5 truncate text-2xs text-ivory-600">
              {mod.fileCount}
              {mod.fileCount === 1 ? 'file' : 'files'} · {formatBytes(mod.sizeBytes)} · added
              {formatRelative(mod.addedAt)}{#if mod.description}
                · {mod.description}{/if}
            </p>
          </div>

          <div
            class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          >
            <button
              type="button"
              class="btn-ghost px-1.5"
              onclick={() => nudge(mod.id, -1)}
              disabled={index === 0}
              aria-label="Move {mod.name} up"
              title="Move up"
            >
              <Icon name="chevron-down" size={12} class="rotate-180" />
            </button>
            <button
              type="button"
              class="btn-ghost px-1.5"
              onclick={() => nudge(mod.id, 1)}
              disabled={index === mods.length - 1}
              aria-label="Move {mod.name} down"
              title="Move down"
            >
              <Icon name="chevron-down" size={12} />
            </button>
            <button
              type="button"
              class="btn-ghost px-1.5"
              onclick={() => void openFolder(mod.id)}
              aria-label="Open {mod.name} in the file browser"
              title="Open folder"
            >
              <Icon name="folder" size={12} />
            </button>
            <button
              type="button"
              class="btn-ghost px-1.5 hover:text-negative"
              onclick={() => remove(mod)}
              aria-label="Delete {mod.name}"
              title="Delete"
            >
              <Icon name="trash" size={12} />
            </button>
          </div>

          <label class="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              class="peer sr-only"
              checked={mod.enabled}
              aria-label="Enable {mod.name}"
              onchange={(event) => {
                const enabled = event.currentTarget.checked
                void run(() => api.mods.toggle(mod.id, enabled))
              }}
            />
            <span
              class="h-4 w-7 rounded-full border border-ivory-200/14 bg-ink-900 transition-colors peer-checked:border-gold-500/50 peer-checked:bg-gold-500/25 peer-focus-visible:ring-1 peer-focus-visible:ring-gold-400/60"
            ></span>
            <span
              class="pointer-events-none absolute left-[3px] h-2.5 w-2.5 rounded-full bg-ivory-500 transition-transform peer-checked:translate-x-3 peer-checked:bg-gold-200"
            ></span>
          </label>
        </li>
      {/each}
    </ul>
  {/if}
</Section>

<Section
  title="Generate a colour mod"
  description="Writes a small texture pack that recolours the client's loading and menu surfaces. Useful for matching RemielleStrap's palette without hunting for files."
  class="mt-9"
>
  <div class="flex flex-wrap items-end gap-4 py-3">
    <div class="min-w-40 flex-1">
      <label
        class="mb-1.5 block text-2xs uppercase tracking-[0.14em] text-ivory-600"
        for="mod-name"
      >
        Name
      </label>
      <input
        id="mod-name"
        class="field w-full"
        value={colorName}
        maxlength="48"
        oninput={(event) => (colorName = event.currentTarget.value)}
      />
    </div>

    <div>
      <label
        class="mb-1.5 block text-2xs uppercase tracking-[0.14em] text-ivory-600"
        for="mod-color"
      >
        Base
      </label>
      <div class="flex items-center gap-2">
        <input
          id="mod-color"
          type="color"
          class="h-8 w-9 cursor-pointer rounded-control border border-ivory-200/12 bg-transparent p-0.5"
          value={colorValue}
          oninput={(event) => (colorValue = event.currentTarget.value)}
        />
        <span class="font-mono text-2xs uppercase text-ivory-500">{colorValue}</span>
      </div>
    </div>

    <div>
      <label
        class="mb-1.5 block text-2xs uppercase tracking-[0.14em] text-ivory-600"
        for="mod-accent"
      >
        Accent
      </label>
      <div class="flex items-center gap-2">
        <input
          id="mod-accent"
          type="color"
          class="h-8 w-9 cursor-pointer rounded-control border border-ivory-200/12 bg-transparent p-0.5"
          value={accentValue}
          oninput={(event) => (accentValue = event.currentTarget.value)}
        />
        <span class="font-mono text-2xs uppercase text-ivory-500">{accentValue}</span>
      </div>
    </div>

    <button
      type="button"
      class="btn-secondary"
      onclick={() => void generateColorMod()}
      disabled={working}
    >
      <Icon name="palette" size={12} />
      Generate
    </button>
  </div>
</Section>

<p class="mt-6 max-w-prose text-2xs leading-relaxed text-ivory-600">
  Mods are copied into the version folder at launch and the affected files are recorded, so
  disabling a mod restores the original client files on the next start. Reinstalling the client
  always begins from clean packages.
</p>

<ConfirmDialog
  open={confirmOpen}
  options={confirmOptions}
  busy={working}
  onconfirm={() => void runConfirm()}
  oncancel={() => {
    confirmOpen = false
    confirmAction = null
  }}
/>
