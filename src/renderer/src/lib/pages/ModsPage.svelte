<script lang="ts">
  import type {
    CommunityIndex,
    FileReplacementResult,
    ModConflict,
    ModEntry,
    ModFileSlot,
    RichModTargets
  } from '@shared/models'
  import type { ModTarget } from '@shared/settings'
  import { MOD_FILE_SLOTS, MOD_TARGETS } from '@shared/catalog'
  import { api, errorMessage } from '../ipc'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import { formatBytes, formatRelative } from '../utils/format'
  import type { ConfirmOptions } from '../types'
  import ConfirmDialog from '../dialogs/ConfirmDialog.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Dialog from '../components/Dialog.svelte'
  import Section from '../components/Section.svelte'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'
  import Tabs from '../components/Tabs.svelte'

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

  /* --------------------------------------------- Generator, slots, community */

  let tool = $state<'library' | 'slots' | 'community'>('library')
  type SlotResult = FileReplacementResult

  let slotResults = $state<Record<string, SlotResult | null>>({})
  let conflicts = $state<ModConflict[]>([])
  let community = $state<CommunityIndex | null>(null)
  let communityBusy = $state(false)
  let communityQuery = $state('')
  let installingCommunity = $state<string | null>(null)

  // Rich generator
  let richOpen = $state(false)
  let richName = $state('Remielle Prism')
  let richColor = $state('#0b0b0d')
  let richAccent = $state('#e9a8c9')
  let richGradient = $state('#a89ae0')
  let richUseGradient = $state(true)
  let richTarget: ModTarget = $state('player')
  let richParts = $state<RichModTargets>({
    uiSurfaces: true,
    cursor: true,
    shiftLock: true,
    emoteWheel: true,
    voiceChat: false
  })

  async function refreshConflicts(): Promise<void> {
    conflicts = await api.mods.conflicts().catch(() => [])
  }

  async function setTarget(mod: ModEntry, target: ModTarget): Promise<void> {
    await run(() => api.mods.setTarget({ id: mod.id, target }), `Target set to ${target}`)
  }

  async function pickSlot(slot: ModFileSlot): Promise<void> {
    const picked = await api.system.chooseFile(`Choose a file for ${slot.label}`, slot.extensions)

    if (!picked.ok || !picked.data) {
      if (picked.error) pushToast({ kind: 'info', title: 'Nothing chosen', message: picked.error })
      return
    }

    // The main process copies the chosen file into a new mod at the slot's
    // client path — the renderer never handles the file itself.
    const result = await api.mods.replaceFile({
      slot: slot.id,
      name: `${slot.label} replacement`,
      target: settings.value.defaultModTarget
    }).catch((error: unknown) => ({ ok: false as const, error: errorMessage(error) }))

    if (result.ok && result.data) {
      slotResults = { ...slotResults, [slot.id]: result.data }
      pushToast({ kind: 'success', title: `${slot.label} replaced`, message: result.data.relativePath })
      await load()
    } else {
      pushToast({ kind: 'warning', title: 'That file was not accepted', message: result.error })
    }
  }

  async function createCursorSet(): Promise<void> {
    const cursor = await api.system.chooseFile('Choose the arrow cursor image', ['png'])
    if (!cursor.ok || !cursor.data) {
      if (cursor.error) pushToast({ kind: 'info', title: 'Nothing chosen', message: cursor.error })
      return
    }

    const far = await api.system.chooseFile('Choose the far-away cursor image (optional)', ['png'])

    const result = await api.mods
      .createCursorSet({
        name: `Cursor set ${new Date().toLocaleDateString()}`,
        cursor: cursor.data,
        farCursor: far.ok ? (far.data ?? undefined) : undefined,
        target: settings.value.defaultModTarget
      })
      .catch((error: unknown) => ({ ok: false as const, error: errorMessage(error) }))

    if (result.ok && result.data) {
      pushToast({ kind: 'success', title: 'Cursor set created', message: 'Enable it in the library list.' })
      await load()
    } else {
      pushToast({ kind: 'warning', title: 'Cursor set not created', message: result.error })
    }
  }

  async function loadCommunity(refresh = false): Promise<void> {
    communityBusy = true
    try {
      community = await api.mods.communityIndex({ refresh, query: communityQuery || undefined })
    } catch (error) {
      pushToast({ kind: 'warning', title: 'The community list is unavailable', message: errorMessage(error) })
    } finally {
      communityBusy = false
    }
  }

  async function installCommunity(ids: string[]): Promise<void> {
    installingCommunity = ids.join(',')
    try {
      const result = await api.mods.installCommunity({
        ids,
        target: settings.value.defaultModTarget
      })

      if (result.ok) {
        pushToast({ kind: 'success', title: `Installed ${result.data?.length ?? 0} mod(s)` })
        await load()
        await refreshConflicts()
      } else {
        pushToast({ kind: 'warning', title: 'Nothing was installed', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Install failed', message: errorMessage(error) })
    } finally {
      installingCommunity = null
    }
  }

  async function generateRich(): Promise<void> {
    working = true

    try {
      const result = await api.mods.generateRichMod({
        name: richName,
        color: richColor,
        accent: richAccent,
        gradientTo: richUseGradient ? richGradient : null,
        targets: richParts,
        target: richTarget,
        cursorImage: null,
        shiftLockImage: null
      })

      if (result.ok) {
        pushToast({ kind: 'success', title: `${richName} generated` })
        richOpen = false
        await load()
      } else {
        pushToast({ kind: 'warning', title: 'The generator refused', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Generation failed', message: errorMessage(error) })
    } finally {
      working = false
    }
  }

  async function applyNow(): Promise<void> {
    working = true
    try {
      const result = await api.mods.applyNow()
      pushToast(
        result.ok
          ? {
              kind: 'success',
              title: 'Applied to the install',
              message: `${result.data?.files ?? 0} file(s), ${result.data?.flags ?? 0} flag(s)`
            }
          : { kind: 'warning', title: 'Could not apply yet', message: result.error }
      )
    } finally {
      working = false
    }
  }

  const enabledCount = $derived(mods.filter((mod) => mod.enabled).length)
  const totalBytes = $derived(mods.reduce((sum, mod) => sum + mod.sizeBytes, 0))

  const visibleCommunity = $derived(
    (community?.mods ?? []).filter((mod) => {
      if (communityQuery.trim().length === 0) return true
      const needle = communityQuery.trim().toLowerCase()
      return mod.name.toLowerCase().includes(needle) || mod.tags.some((tag) => tag.includes(needle))
    })
  )

  $effect(() => {
    void load()
    void refreshConflicts()
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

            <div class="mt-1 flex items-center gap-1.5">
              <span class="chip">{mod.kind}</span>
              {#if mod.author}
                <span class="chip">by {mod.author}</span>
              {/if}
              {#if conflicts.some((conflict) => conflict.modIds.includes(mod.id))}
                <span class="chip border-caution/30 text-caution/90">conflict</span>
              {/if}
              <Select
                class="scale-90"
                value={mod.target}
                options={MOD_TARGETS.map((target) => ({
                  value: target.value,
                  label: target.label
                }))}
                onchange={(value) => void setTarget(mod, value as ModTarget)}
              />
            </div>
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

<div class="h-5"></div>

<Section
  title="Mod library"
  description="Every mod is a folder of client files. Player, Studio or both decides which install it lands in; the order decides who wins a shared path."
>
  {#snippet actions()}
    <button type="button" class="btn-secondary gap-1.5" disabled={working} onclick={() => void applyNow()}>
      <Icon name={working ? 'spinner' : 'zap'} size={13} />
      Apply now
    </button>
  {/snippet}

  <Tabs
    value={tool}
    onchange={(next) => (tool = next as typeof tool)}
    tabs={[
      { id: 'library', label: 'Library' },
      { id: 'slots', label: 'File replacements' },
      { id: 'community', label: 'Community' }
    ]}
  />

  {#if tool === 'library'}
    <div class="py-1">
      <SettingRow
        title="Default target for new mods"
        description="Used by imports, replacements and the generators below."
      >
        <Select
          value={settings.value.defaultModTarget}
          options={MOD_TARGETS.map((target) => ({ value: target.value, label: target.label }))}
          onchange={(value) => void updateSettings({ defaultModTarget: value as ModTarget })}
        />
      </SettingRow>

      <SettingRow
        title="Apply straight after importing"
        description="Off means the change lands at the next launch, which is safer while playing."
      >
        <Switch
          checked={settings.value.applyModsImmediately}
          onchange={(value) => void updateSettings({ applyModsImmediately: value })}
        />
      </SettingRow>

      {#if conflicts.length > 0}
        <SettingRow
          title="Conflicts"
          description="Two or more enabled mods write the same client path. The one lower in the list wins."
          stacked
        >
          <ul class="space-y-1">
            {#each conflicts.slice(0, 8) as conflict (conflict.relativePath)}
              <li class="flex items-center gap-2 text-2xs">
                <span class="font-mono text-ivory-400">{conflict.relativePath}</span>
                <span class="text-ivory-600">← {conflict.modIds.join(' › ')}</span>
              </li>
            {/each}
          </ul>
        </SettingRow>
      {/if}

      <SettingRow
        title="Rich generator"
        description="Builds a themed set of client images — UI surfaces, cursors, the Shift Lock icon, the emote wheel and the voice-chat bubble — from a colour or a gradient."
        stacked
      >
        <button type="button" class="btn-secondary gap-1.5" onclick={() => (richOpen = true)}>
          <Icon name="palette" size={13} />
          Open the generator
        </button>
      </SettingRow>

      <SettingRow
        title="Quick colour mod"
        description="A single colour over the client's flat UI surfaces. The same pipeline, one colour."
        stacked
      >
        <button type="button" class="btn-ghost gap-1.5" onclick={() => (richOpen = true)}>
          <Icon name="prism" size={13} />
          Use the full generator instead
        </button>
      </SettingRow>
    </div>
  {:else if tool === 'slots'}
    <div class="py-1">
      <p class="pb-2 text-2xs leading-relaxed text-ivory-500">
        Drop your own file into one of the client's replaceable slots. Each one becomes a mod of its
        own, so it can be switched off without touching the rest.
      </p>

      <ul class="divide-y divide-ivory-200/6">
        {#each MOD_FILE_SLOTS as slot (slot.id)}
          <li class="flex items-center gap-3 py-2.5">
            <span class="mt-0.5 shrink-0 text-ivory-500">
              <Icon
                name={slot.kind === 'audio' ? 'music' : slot.kind === 'font' ? 'type' : 'image'}
                size={14}
              />
            </span>

            <span class="min-w-0 flex-1">
              <span class="block text-xs text-ivory-200">{slot.label}</span>
              <span class="mt-0.5 block truncate text-2xs text-ivory-500">{slot.description}</span>
              <span class="mt-0.5 block truncate font-mono text-[0.625rem] text-ivory-600">
                {slotResults[slot.id]?.relativePath ?? slot.relative}
              </span>
            </span>

            <button
              type="button"
              class="btn-secondary shrink-0 px-2.5 py-1 text-2xs"
              onclick={() => void pickSlot(slot)}
            >
              Choose file
            </button>
          </li>
        {/each}
      </ul>

      <div class="flex items-center justify-between gap-3 border-t border-ivory-200/8 py-3">
        <div class="min-w-0">
          <p class="text-xs text-ivory-200">Cursor sets</p>
          <p class="mt-0.5 text-2xs text-ivory-500">
            Pick both cursor images and they are written as one mod, ready to switch on or off.
          </p>
        </div>

        <button type="button" class="btn-secondary shrink-0 gap-1.5 text-xs" onclick={() => void createCursorSet()}>
          <Icon name="plus" size={13} />
          Create a set
        </button>
      </div>
    </div>
  {:else}
    <div class="py-1">
      <div class="flex flex-wrap items-center gap-2 py-3">
        <input
          class="field min-w-40 flex-1 py-1.5 text-xs"
          placeholder="Search community mods"
          bind:value={communityQuery}
          onkeydown={(event) => {
            if (event.key === 'Enter') void loadCommunity(false)
          }}
        />

        <button
          type="button"
          class="btn-secondary gap-1.5"
          disabled={communityBusy}
          onclick={() => void loadCommunity(false)}
        >
          <Icon name={communityBusy ? 'spinner' : 'search'} size={13} />
          Search
        </button>

        <button
          type="button"
          class="btn-ghost gap-1.5"
          disabled={communityBusy}
          onclick={() => void loadCommunity(true)}
        >
          <Icon name="refresh" size={13} />
          Refresh index
        </button>
      </div>

      {#if community?.error}
        <p class="pb-3 text-2xs text-caution/90">{community.error}</p>
      {/if}

      {#if visibleCommunity.length === 0}
        <div class="py-6 text-center text-xs text-ivory-500">
          {communityBusy ? 'Fetching the index…' : 'Nothing in the community index yet.'}
        </div>
      {:else}
        <ul class="divide-y divide-ivory-200/6 border-t border-ivory-200/8">
          {#each visibleCommunity as mod (mod.id)}
            <li class="flex items-start gap-3 py-3">
              {#if mod.previewUrl}
                <img src={mod.previewUrl} alt="" class="h-10 w-14 shrink-0 rounded object-cover" loading="lazy" />
              {/if}

              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5 text-xs text-ivory-200">
                  {mod.name}
                  <span class="chip">{mod.target}</span>
                  {#if mod.sizeBytes}
                    <span class="chip">{formatBytes(mod.sizeBytes)}</span>
                  {/if}
                </span>
                <span class="mt-0.5 block text-2xs leading-relaxed text-ivory-500">{mod.description}</span>
                <span class="mt-0.5 block text-2xs text-ivory-600">
                  by {mod.author} · v{mod.version}
                  {#if mod.sha256}· checksum verified on install{/if}
                </span>
              </span>

              <button
                type="button"
                class="btn-secondary shrink-0 px-2.5 py-1 text-2xs"
                disabled={installingCommunity !== null}
                onclick={() => void installCommunity([mod.id])}
              >
                <Icon name="download" size={12} />
                Install
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <SettingRow
        title="Index URL"
        description="Any HTTPS JSON file listing community mods. Only https and checksum-verified archives are installed."
        stacked
      >
        <input
          class="field w-full py-1.5 font-mono text-2xs"
          value={settings.value.communityModIndexUrl}
          onblur={(event) => void updateSettings({ communityModIndexUrl: event.currentTarget.value })}
        />
      </SettingRow>
    </div>
  {/if}
</Section>

{#if richOpen}
  <Dialog
    title="Rich mod generator"
    description="Everything is drawn in memory as PNGs, so nothing needs to be downloaded."
    wide
    onclose={() => (richOpen = false)}
  >
    <div class="grid gap-4 sm:grid-cols-2">
      <label class="block">
        <span class="eyebrow">Name</span>
        <input class="field mt-1 w-full py-1.5 text-xs" bind:value={richName} />
      </label>

      <label class="block">
        <span class="eyebrow">Applies to</span>
        <Select
          class="mt-1"
          value={richTarget}
          options={MOD_TARGETS.map((target) => ({ value: target.value, label: target.label }))}
          onchange={(value) => (richTarget = value as ModTarget)}
        />
      </label>

      <label class="block">
        <span class="eyebrow">Base colour</span>
        <input
          type="color"
          class="mt-1 h-8 w-full cursor-pointer rounded border border-ivory-200/12 bg-transparent"
          bind:value={richColor}
        />
      </label>

      <label class="block">
        <span class="eyebrow">Accent</span>
        <input
          type="color"
          class="mt-1 h-8 w-full cursor-pointer rounded border border-ivory-200/12 bg-transparent"
          bind:value={richAccent}
        />
      </label>
    </div>

    <div class="mt-4">
      <label class="flex items-center gap-2 text-xs text-ivory-300">
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-[var(--color-gold-400)]"
          bind:checked={richUseGradient}
        />
        Blend into a second colour instead of a flat fill
      </label>

      {#if richUseGradient}
        <input
          type="color"
          class="mt-2 h-8 w-24 cursor-pointer rounded border border-ivory-200/12 bg-transparent"
          bind:value={richGradient}
        />
      {/if}
    </div>

    <div class="mt-4">
      <p class="eyebrow mb-2">What to generate</p>
      <div class="grid gap-2 sm:grid-cols-2">
        {#each Object.entries(richParts) as [key, value] (key)}
          <label class="surface-inset flex items-center gap-2.5 px-2.5 py-2 text-xs text-ivory-300">
            <input
              type="checkbox"
              class="h-3.5 w-3.5 accent-[var(--color-gold-400)]"
              checked={value}
              onchange={(event) =>
                (richParts = { ...richParts, [key]: event.currentTarget.checked })}
            />
            {key === 'uiSurfaces'
              ? 'UI surfaces'
              : key === 'cursor'
                ? 'Cursors'
                : key === 'shiftLock'
                  ? 'Shift Lock icon'
                  : key === 'emoteWheel'
                    ? 'Emote wheel'
                    : 'Voice chat bubble'}
          </label>
        {/each}
      </div>
    </div>

    <div class="mt-5 flex justify-end gap-2">
      <button type="button" class="btn-ghost" onclick={() => (richOpen = false)}>Cancel</button>
      <button type="button" class="btn-primary" disabled={working} onclick={() => void generateRich()}>
        Generate mod
      </button>
    </div>
  </Dialog>
{/if}

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
