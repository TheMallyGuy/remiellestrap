<script lang="ts">
  import type {
    FlagAllowlist,
    FlagAllowlistEntry,
    FlagAudit,
    FlagCleanResult,
    FlagPreset,
    FlagProfile,
    FlagValue
  } from '@shared/models'
  import { api, errorMessage } from '../ipc'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import type { ConfirmOptions, FlagRow } from '../types'
  import ConfirmDialog from '../dialogs/ConfirmDialog.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import { formatRelative } from '../utils/format'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'
  import Tabs from '../components/Tabs.svelte'

  /**
   * FastFlags: named profiles of client engine flags.
   *
   * Values are edited as text and parsed on save — Roblox writes them into
   * ClientAppSettings.json as JSON, so `true`, `42` and `"text"` all need to
   * survive the round trip. Only the active profile is written at launch.
   */

  let profiles = $state<FlagProfile[]>([])
  let selected = $state<string>(settings.value.activeFlagProfile)
  let rows = $state<FlagRow[]>([])
  let dirty = $state(false)
  let loading = $state(true)
  let saving = $state(false)
  let filter = $state('')

  let confirmOpen = $state(false)
  let confirmOptions = $state<ConfirmOptions>({ title: '', message: '' })
  let confirmAction = $state<(() => Promise<void>) | null>(null)

  let renaming = $state(false)
  let nameDraft = $state('')

  /**
   * The exact flag map the main process will write at launch. This is read back
   * over `fastflags:preview` rather than derived from `rows`, because the main
   * process sanitises names and coerces values on save — showing the editor's
   * view here would hide any discrepancy between what was typed and what
   * Roblox will actually receive.
   */
  let preview = $state<Record<string, FlagValue>>({})
  let previewOpen = $state(false)

  let rowCounter = 0

  /* ------------------------------------------------- Allowlist, presets, clean */

  type ToolTab = 'editor' | 'presets' | 'allowlist'

  let tool = $state<ToolTab>('editor')
  let allowlist = $state<FlagAllowlist | null>(null)
  let allowlistBusy = $state(false)
  let audit = $state<FlagAudit | null>(null)
  let cleanResult = $state<(FlagCleanResult & { dryRun: boolean }) | null>(null)
  let presets = $state<FlagPreset[]>([])
  let allowFilter = $state('')
  let allowCategory = $state('all')
  let applyingPreset = $state<string | null>(null)

  $effect(() => {
    void loadTools()
  })

  async function loadTools(): Promise<void> {
    presets = await api.fastflags.presets().catch(() => [])

    allowlistBusy = true
    try {
      allowlist = await api.fastflags.allowlist(false)
      audit = await api.fastflags.audit(selected)
    } catch (error) {
      pushToast({ kind: 'warning', title: 'The allowlist is unavailable', message: errorMessage(error) })
    } finally {
      allowlistBusy = false
    }
  }

  async function refreshAllowlist(): Promise<void> {
    allowlistBusy = true
    try {
      allowlist = await api.fastflags.allowlist(true)
      audit = await api.fastflags.audit(selected)
      pushToast({
        kind: 'success',
        title: 'Allowlist refreshed',
        message: `${allowlist.entries.length} flags, source: ${allowlist.source}`
      })
    } catch (error) {
      pushToast({ kind: 'warning', title: 'Could not refresh the allowlist', message: errorMessage(error) })
    } finally {
      allowlistBusy = false
    }
  }

  async function applyPreset(preset: FlagPreset): Promise<void> {
    applyingPreset = preset.id

    try {
      profiles = await api.fastflags.applyPreset({
        presetId: preset.id,
        profile: selected,
        replace: false
      })

      hydrateRows()

      audit = await api.fastflags.audit(selected)
      preview = await api.fastflags.preview()

      pushToast({
        kind: 'success',
        title: `${preset.name} applied`,
        message: `${Object.keys(preset.flags).length} flag(s) written into ${selected}`
      })
    } catch (error) {
      pushToast({ kind: 'error', title: 'Could not apply that preset', message: errorMessage(error) })
    } finally {
      applyingPreset = null
    }
  }

  async function cleanFlags(dryRun: boolean): Promise<void> {
    try {
      cleanResult = { ...(await api.fastflags.clean({ name: selected, dryRun })), dryRun }
      audit = await api.fastflags.audit(selected)

      if (!dryRun) {
        profiles = await api.fastflags.getProfiles()
        hydrateRows()
        preview = await api.fastflags.preview()
      }

      pushToast({
        kind: 'success',
        title: dryRun ? 'Dry run complete' : 'Cleaned',
        message: `${cleanResult.removed.length} flag(s) ${dryRun ? 'would be' : 'were'} removed, ${cleanResult.kept} kept`
      })
    } catch (error) {
      pushToast({ kind: 'error', title: 'Cleaning failed', message: errorMessage(error) })
    }
  }

  /** Adds an allowlisted flag to the profile being edited. */
  function addFromAllowlist(entry: FlagAllowlistEntry): void {
    if (rows.some((row) => row.key === entry.name)) {
      pushToast({ kind: 'info', title: 'That flag is already in this profile' })
      return
    }

    const value =
      entry.defaultValue !== null
        ? String(entry.defaultValue)
        : entry.kind === 'boolean'
          ? 'true'
          : entry.kind === 'number'
            ? String(entry.min ?? 1)
            : 'text'

    rowCounter += 1
    rows = [...rows, { id: `allow-${rowCounter}`, key: entry.name, value, error: null }]
    dirty = true
  }

  const allowCategories = $derived(
    ['all', ...new Set((allowlist?.entries ?? []).map((entry) => entry.category))]
  )

  const visibleAllowlist = $derived(
    (allowlist?.entries ?? []).filter((entry) => {
      if (allowCategory !== 'all' && entry.category !== allowCategory) return false
      if (allowFilter.trim().length === 0) return true

      const needle = allowFilter.trim().toLowerCase()
      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle)
      )
    })
  )

  /** True when the edited profile already contains this flag. */
  function hasFlag(name: string): boolean {
    return rows.some((row) => row.key === name)
  }



  const current = $derived(profiles.find((profile) => profile.name === selected) ?? null)

  const visibleRows = $derived(
    filter.trim().length === 0
      ? rows
      : rows.filter((row) => row.key.toLowerCase().includes(filter.trim().toLowerCase()))
  )

  const invalidCount = $derived(rows.filter((row) => row.error !== null).length)

  $effect(() => {
    void load()
  })

  async function load(): Promise<void> {
    loading = true

    try {
      profiles = await api.fastflags.getProfiles()

      if (!profiles.some((profile) => profile.name === selected)) {
        selected = profiles.find((profile) => profile.isActive)?.name ?? profiles[0]?.name ?? ''
      }

      hydrateRows()
      await refreshPreview()
    } catch (error) {
      pushToast({ kind: 'error', title: 'Could not load profiles', message: errorMessage(error) })
    } finally {
      loading = false
    }
  }

  /** Pulls the sanitised launch-time flag map back from the main process. */
  async function refreshPreview(): Promise<void> {
    try {
      preview = await api.fastflags.preview()
    } catch {
      // A preview is a convenience, never a blocker; the editor stays usable.
      preview = {}
    }
  }

  const previewJson = $derived(JSON.stringify(preview, null, 2))
  const previewCount = $derived(Object.keys(preview).length)

  async function copyPreview(): Promise<void> {
    const copied = await api.system.copyToClipboard(previewJson)

    pushToast(
      copied.ok
        ? { kind: 'success', title: 'ClientAppSettings.json copied' }
        : { kind: 'error', title: 'Could not copy', message: copied.error }
    )
  }

  function hydrateRows(): void {
    const profile = profiles.find((entry) => entry.name === selected)

    rows = Object.entries(profile?.flags ?? {}).map(([key, value]) => ({
      id: `row-${(rowCounter += 1)}`,
      key,
      value: stringifyValue(value),
      error: null
    }))

    dirty = false
  }

  function stringifyValue(value: FlagValue): string {
    return typeof value === 'string' ? value : String(value)
  }

  /**
   * Roblox accepts booleans, integers and strings. Anything that parses as a
   * boolean or a finite number is sent as that type; everything else is a
   * string, which is what the client expects for enum-style flags.
   */
  function parseValue(raw: string): FlagValue {
    const trimmed = raw.trim()

    if (trimmed === 'true') return true
    if (trimmed === 'false') return false

    if (/^-?\d+$/.test(trimmed)) {
      const parsed = Number(trimmed)
      if (Number.isSafeInteger(parsed)) return parsed
    }

    return trimmed
  }

  function validate(): boolean {
    const seen = new Set<string>()
    let ok = true

    for (const row of rows) {
      const key = row.key.trim()

      if (key.length === 0) {
        row.error = 'A flag name is required'
        ok = false
      } else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        row.error = 'Letters, digits and underscores only'
        ok = false
      } else if (seen.has(key)) {
        row.error = 'Duplicate flag name'
        ok = false
      } else {
        row.error = null
        seen.add(key)
      }
    }

    return ok
  }

  function selectProfile(name: string): void {
    if (name === selected) return

    if (dirty) {
      askConfirm(
        {
          title: 'Discard unsaved changes?',
          message: `You have unsaved edits to “${selected}”. Switching profiles will lose them.`,
          confirmLabel: 'Discard',
          danger: true
        },
        async () => {
          selected = name
          hydrateRows()
        }
      )
      return
    }

    selected = name
    hydrateRows()
  }

  function addRow(): void {
    rows = [...rows, { id: `row-${(rowCounter += 1)}`, key: '', value: '', error: null }]
    dirty = true
  }

  function removeRow(id: string): void {
    rows = rows.filter((row) => row.id !== id)
    dirty = true
  }

  async function save(setActive = false): Promise<void> {
    if (!validate()) {
      pushToast({ kind: 'warning', title: 'Fix the highlighted flags first' })
      return
    }

    saving = true

    try {
      const flags: Record<string, FlagValue> = {}
      for (const row of rows) flags[row.key.trim()] = parseValue(row.value)

      profiles = await api.fastflags.saveProfile({ name: selected, flags, setActive })
      dirty = false
      await refreshPreview()
      pushToast({
        kind: 'success',
        title: setActive ? `“${selected}” saved and applied` : `“${selected}” saved`
      })
    } catch (error) {
      pushToast({ kind: 'error', title: 'Save failed', message: errorMessage(error) })
    } finally {
      saving = false
    }
  }

  async function createProfile(): Promise<void> {
    const base = 'New profile'
    let name = base
    let index = 2
    while (profiles.some((profile) => profile.name === name)) name = `${base} ${index++}`

    try {
      profiles = await api.fastflags.saveProfile({ name, flags: {} })
      selected = name
      hydrateRows()
      renaming = true
      nameDraft = name
    } catch (error) {
      pushToast({
        kind: 'error',
        title: 'Could not create the profile',
        message: errorMessage(error)
      })
    }
  }

  async function duplicateProfile(): Promise<void> {
    if (!current) return

    let name = `${current.name} copy`
    let index = 2
    while (profiles.some((profile) => profile.name === name))
      name = `${current.name} copy ${index++}`

    try {
      profiles = await api.fastflags.duplicateProfile(current.name, name)
      selected = name
      hydrateRows()
    } catch (error) {
      pushToast({ kind: 'error', title: 'Duplicate failed', message: errorMessage(error) })
    }
  }

  async function commitRename(): Promise<void> {
    const next = nameDraft.trim()
    renaming = false

    if (!current || next.length === 0 || next === current.name) return

    try {
      profiles = await api.fastflags.renameProfile(current.name, next)
      selected = next
      hydrateRows()
    } catch (error) {
      pushToast({ kind: 'error', title: 'Rename failed', message: errorMessage(error) })
    }
  }

  function deleteProfile(): void {
    if (!current) return

    askConfirm(
      {
        title: `Delete “${current.name}”?`,
        message: 'This profile and its flags will be removed. This cannot be undone.',
        confirmLabel: 'Delete',
        danger: true
      },
      async () => {
        try {
          profiles = await api.fastflags.deleteProfile(selected)
          selected = profiles.find((profile) => profile.isActive)?.name ?? profiles[0]?.name ?? ''
          hydrateRows()
          await refreshPreview()
          pushToast({ kind: 'success', title: 'Profile deleted' })
        } catch (error) {
          pushToast({ kind: 'error', title: 'Delete failed', message: errorMessage(error) })
        }
      }
    )
  }

  async function setActive(): Promise<void> {
    try {
      profiles = await api.fastflags.setActive(selected)
      await refreshPreview()
      pushToast({ kind: 'success', title: `“${selected}” is now active` })
    } catch (error) {
      pushToast({ kind: 'error', title: 'Could not activate', message: errorMessage(error) })
    }
  }

  async function importJson(): Promise<void> {
    try {
      const result = await api.fastflags.importJson(selected)

      if (result.ok && result.data) {
        profiles = result.data
        hydrateRows()
        await refreshPreview()
        pushToast({ kind: 'success', title: 'Flags imported' })
      } else if (result.error) {
        pushToast({ kind: 'warning', title: 'Import cancelled', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Import failed', message: errorMessage(error) })
    }
  }

  async function exportJson(): Promise<void> {
    try {
      const result = await api.fastflags.exportJson(selected)

      if (result.ok) {
        pushToast({ kind: 'success', title: 'Flags exported', message: result.data })
      } else if (result.error) {
        pushToast({ kind: 'warning', title: 'Export cancelled', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Export failed', message: errorMessage(error) })
    }
  }

  function askConfirm(options: ConfirmOptions, action: () => Promise<void>): void {
    confirmOptions = options
    confirmAction = action
    confirmOpen = true
  }

  async function runConfirm(): Promise<void> {
    const action = confirmAction
    confirmOpen = false
    confirmAction = null
    if (action) await action()
  }
</script>

<PageHeader
  title="FastFlags"
  subtitle="Engine flags written to the client before it starts. Only the active profile is applied."
>
  {#snippet actions()}
    <button type="button" class="btn-ghost" onclick={() => void importJson()}>
      <Icon name="download" size={12} />
      Import
    </button>
    <button type="button" class="btn-ghost" onclick={() => void exportJson()} disabled={!current}>
      <Icon name="external" size={12} />
      Export
    </button>
  {/snippet}
</PageHeader>

<div class="flex gap-5">
  <!-- Profile list -->
  <aside class="w-48 shrink-0">
    <div class="mb-2 flex items-center justify-between">
      <span class="eyebrow">Profiles</span>
      <button
        type="button"
        class="btn-ghost px-1.5 py-1"
        onclick={() => void createProfile()}
        title="New profile"
        aria-label="New profile"
      >
        <Icon name="plus" size={13} />
      </button>
    </div>

    <ul class="surface space-y-px p-1.5">
      {#each profiles as profile (profile.name)}
        {@const active = profile.name === selected}
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-xs transition-colors {active
              ? 'bg-ivory-100/7 text-ivory-50'
              : 'text-ivory-400 hover:bg-ivory-100/4'}"
            onclick={() => selectProfile(profile.name)}
          >
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full {profile.isActive
                ? 'bg-gold-400'
                : 'bg-transparent'}"
              title={profile.isActive ? 'Active profile' : undefined}
            ></span>
            <span class="flex-1 truncate">{profile.name}</span>
            <span class="shrink-0 tabular-nums text-ivory-600">{profile.flagCount}</span>
          </button>
        </li>
      {/each}
    </ul>

    {#if current && !current.isActive}
      <button type="button" class="btn-secondary mt-2 w-full" onclick={() => void setActive()}>
        <Icon name="check" size={12} />
        Make active
      </button>
    {/if}
  </aside>

  <!-- Editor -->
  <div class="min-w-0 flex-1">
    {#if loading}
      <div class="surface p-6 text-center text-xs text-ivory-500">Loading profiles…</div>
    {:else if !current}
      <EmptyState
        icon="flag"
        title="No profiles"
        message="Create a profile to start collecting engine flags."
      >
        {#snippet action()}
          <button type="button" class="btn-primary" onclick={() => void createProfile()}>
            <Icon name="plus" size={13} />
            New profile
          </button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="surface mb-3 flex flex-wrap items-center gap-2 px-3 py-2.5">
        {#if renaming}
          <input
            class="field flex-1"
            value={nameDraft}
            aria-label="Profile name"
            {@attach (node: HTMLInputElement) => node.select()}
            oninput={(event) => (nameDraft = event.currentTarget.value)}
            onblur={() => void commitRename()}
            onkeydown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') renaming = false
            }}
          />
        {:else}
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-left text-sm text-ivory-50 hover:text-gold-200"
            onclick={() => {
              renaming = true
              nameDraft = current.name
            }}
            title="Rename this profile"
          >
            {current.name}
            {#if current.isActive}
              <span class="ml-1.5 text-2xs font-normal text-gold-400/80">active</span>
            {/if}
          </button>
        {/if}

        <div class="relative">
          <Icon
            name="search"
            size={12}
            class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ivory-600"
          />
          <input
            class="field w-40 py-1 pl-7 text-xs"
            placeholder="Filter flags"
            value={filter}
            aria-label="Filter flags"
            oninput={(event) => (filter = event.currentTarget.value)}
          />
        </div>

        <button
          type="button"
          class="btn-ghost px-2"
          onclick={() => void duplicateProfile()}
          title="Duplicate"
          aria-label="Duplicate profile"
        >
          <Icon name="copy" size={13} />
        </button>

        <button
          type="button"
          class="btn-ghost px-2 hover:text-negative"
          onclick={deleteProfile}
          title="Delete"
          aria-label="Delete profile"
        >
          <Icon name="trash" size={13} />
        </button>
      </div>

      <div class="surface overflow-hidden">
        {#if rows.length === 0}
          <div class="px-4 py-10 text-center">
            <p class="text-xs text-ivory-500">No flags in this profile.</p>
            <button type="button" class="btn-secondary mt-3" onclick={addRow}>
              <Icon name="plus" size={12} />
              Add a flag
            </button>
          </div>
        {:else}
          <div
            class="flex items-center gap-2 border-b border-ivory-200/6 px-3 py-2 text-2xs uppercase tracking-[0.14em] text-ivory-600"
          >
            <span class="flex-[3]">Flag</span>
            <span class="flex-[2]">Value</span>
            <span class="w-7"></span>
          </div>

          <ul class="max-h-[52vh] overflow-y-auto">
            {#each visibleRows as row (row.id)}
              <li class="border-b border-ivory-200/5 px-3 py-1.5 last:border-b-0">
                <div class="flex items-center gap-2">
                  <input
                    class="field field-mono flex-[3] py-1 {row.error ? 'border-negative/50' : ''}"
                    value={row.key}
                    spellcheck="false"
                    autocomplete="off"
                    placeholder="DFIntTaskSchedulerTargetFps"
                    aria-label="Flag name"
                    oninput={(event) => {
                      row.key = event.currentTarget.value
                      row.error = null
                      dirty = true
                    }}
                  />

                  <input
                    class="field field-mono flex-[2] py-1"
                    value={row.value}
                    spellcheck="false"
                    autocomplete="off"
                    placeholder="240"
                    aria-label="Flag value"
                    oninput={(event) => {
                      row.value = event.currentTarget.value
                      dirty = true
                    }}
                  />

                  <button
                    type="button"
                    class="btn-ghost w-7 shrink-0 px-0 hover:text-negative"
                    onclick={() => removeRow(row.id)}
                    aria-label="Remove {row.key || 'flag'}"
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>

                {#if row.error}
                  <p class="mt-1 pl-1 text-2xs text-negative/90">{row.error}</p>
                {/if}
              </li>
            {/each}
          </ul>

          {#if visibleRows.length === 0}
            <p class="px-3 py-6 text-center text-xs text-ivory-500">
              No flags match “{filter}”.
            </p>
          {/if}
        {/if}
      </div>

      <div class="mt-3 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2">
          <button type="button" class="btn-secondary" onclick={addRow}>
            <Icon name="plus" size={12} />
            Add flag
          </button>

          {#if invalidCount > 0}
            <span class="text-2xs text-negative/90">
              {invalidCount}
              {invalidCount === 1 ? 'problem' : 'problems'}
            </span>
          {:else if dirty}
            <span class="text-2xs text-caution/90">Unsaved changes</span>
          {/if}
        </div>

        <div class="flex items-center gap-2">
          {#if dirty}
            <button type="button" class="btn-ghost" onclick={hydrateRows} disabled={saving}>
              Revert
            </button>
          {/if}

          <button
            type="button"
            class="btn-primary"
            onclick={() => void save(false)}
            disabled={saving || !dirty}
          >
            {#if saving}
              <Icon name="spinner" size={13} class="animate-spin" />
            {/if}
            Save profile
          </button>
        </div>
      </div>
    {/if}
  </div>
</div>

<Section
  title="How flags are applied"
  description="The active profile is written to ClientAppSettings.json in the client's ClientSettings folder immediately before launch, exactly as Bloxstrap does. Flags you remove here are removed from the file on the next launch."
  class="mt-9"
  bare
>
  <div class="surface overflow-hidden">
    <p class="px-4 py-3 text-xs leading-relaxed text-ivory-500">
      Values are typed automatically: <code class="font-mono text-ivory-300">true</code> and
      <code class="font-mono text-ivory-300">false</code> become booleans, whole numbers become integers,
      and everything else is written as a string. Unknown flags are harmless — the engine ignores what
      it does not recognise.
    </p>

    <div class="flex items-center gap-2 border-t border-ivory-200/6 px-3 py-2">
      <button
        type="button"
        class="btn-ghost"
        onclick={() => {
          previewOpen = !previewOpen
          if (previewOpen) void refreshPreview()
        }}
        aria-expanded={previewOpen}
      >
        <Icon name="code" size={12} />
        {previewOpen ? 'Hide' : 'Show'} ClientAppSettings.json
      </button>

      <span class="text-2xs text-ivory-600">
        {previewCount}
        {previewCount === 1 ? 'flag' : 'flags'} will be written at launch
      </span>

      {#if previewOpen}
        <button type="button" class="btn-ghost ml-auto" onclick={() => void copyPreview()}>
          <Icon name="copy" size={12} />
          Copy
        </button>
      {/if}
    </div>

    {#if previewOpen}
      <pre
        class="max-h-64 overflow-auto border-t border-ivory-200/6 bg-ink-950/60 px-4 py-3 font-mono text-2xs leading-relaxed text-ivory-300">{previewJson}</pre>
    {/if}
  </div>
</Section>

<ConfirmDialog
  open={confirmOpen}
  options={confirmOptions}
  onconfirm={() => void runConfirm()}
  oncancel={() => {
    confirmOpen = false
    confirmAction = null
  }}
/>

<div class="h-5"></div>

<Section
  title="Tools"
  description="The allowlist is what Roblox actually reads; a flag outside it is usually ignored, and sometimes worse. Presets are curated starting points built only from allowlisted flags."
>
  {#snippet actions()}
    <button
      type="button"
      class="btn-ghost gap-1.5"
      disabled={allowlistBusy}
      onclick={() => void refreshAllowlist()}
    >
      <Icon name={allowlistBusy ? 'spinner' : 'refresh'} size={13} />
      Refresh allowlist
    </button>
  {/snippet}

  <Tabs
    value={tool}
    onchange={(next) => (tool = next as ToolTab)}
    tabs={[
      { id: 'editor', label: 'Editor', hint: 'Edit the selected profile' },
      { id: 'presets', label: 'Presets', hint: 'Curated flag sets' },
      { id: 'allowlist', label: 'Allowlist', hint: 'What the client accepts' }
    ]}
  />

  {#if tool === 'editor'}
    <div class="py-1">
      <SettingRow
        title="Flag availability"
        description={audit
          ? `Allowed by Roblox's own flag system: ${audit.allowed} of ${audit.total}. ${audit.unknown.length} unknown.`
          : 'Reading the allowlist…'}
        warning={audit && audit.unknown.length > 0
          ? 'Unknown flags are usually ignored by the client — they are not errors, just noise.'
          : undefined}
      >
        <div class="flex items-center gap-2">
          <span class="chip">
            {audit ? `${audit.allowed}/${audit.total}` : '—'}
          </span>
          <button
            type="button"
            class="btn-ghost px-2.5 py-1 text-2xs"
            onclick={() => void cleanFlags(true)}
            title="Count what a clean would remove"
          >
            Dry run
          </button>
          <button
            type="button"
            class="btn-secondary px-2.5 py-1 text-2xs"
            onclick={() => void cleanFlags(false)}
            title="Remove flags that are not on the allowlist"
          >
            Clean list
          </button>
        </div>
      </SettingRow>

      {#if audit && audit.unknown.length > 0}
        <SettingRow title="Unknown flags" stacked>
          <div class="flex flex-wrap gap-1">
            {#each audit.unknown.slice(0, 40) as name (name)}
              <span class="chip font-mono text-[0.625rem]">{name}</span>
            {/each}
          </div>
        </SettingRow>
      {/if}

      {#if cleanResult}
        <SettingRow
          title={cleanResult.dryRun ? 'A clean would remove' : 'Last clean removed'}
          stacked
        >
          <p class="text-2xs text-ivory-500">
            {cleanResult.removed.length} flag(s), {cleanResult.kept} kept.
            {#if cleanResult.removed.length > 0}
              {cleanResult.removed.slice(0, 12).join(', ')}{cleanResult.removed.length > 12 ? '…' : ''}
            {/if}
          </p>
        </SettingRow>
      {/if}
    </div>
  {:else if tool === 'presets'}
    {#if presets.length === 0}
      <div class="py-6 text-center text-xs text-ivory-500">No presets available.</div>
    {:else}
      <ul class="divide-y divide-ivory-200/6">
        {#each presets as preset (preset.id)}
          <li class="flex items-start gap-3 py-3">
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1.5 text-xs text-ivory-200">
                {preset.name}
                <span class="chip">{preset.category}</span>
                {#if preset.risk === 'caution' || preset.risk === 'advanced'}
                  <span class="chip border-caution/30 text-caution/90">{preset.risk}</span>
                {/if}
              </span>
              <span class="mt-0.5 block text-2xs leading-relaxed text-ivory-500">{preset.description}</span>
              <span class="mt-1 block truncate font-mono text-[0.625rem] text-ivory-600">
                {Object.keys(preset.flags).join(', ')}
              </span>
            </span>

            <button
              type="button"
              class="btn-secondary shrink-0 px-2.5 py-1 text-2xs"
              disabled={applyingPreset !== null}
              onclick={() => void applyPreset(preset)}
            >
              {applyingPreset === preset.id ? 'Applying…' : `Apply to ${selected}`}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {:else}
    <div class="flex flex-wrap items-center gap-2 py-3">
      <input
        class="field min-w-40 flex-1 py-1.5 text-xs"
        placeholder="Search flags and descriptions"
        bind:value={allowFilter}
      />

      <Select
        value={allowCategory}
        options={allowCategories.map((category) => ({
          value: category,
          label: category === 'all' ? 'All categories' : category
        }))}
        onchange={(value) => (allowCategory = value)}
      />

      <span class="text-2xs text-ivory-500">
        {visibleAllowlist.length} of {allowlist?.entries.length ?? 0}
        {#if allowlist}
          · {allowlist.source}
          {#if allowlist.updatedAt}· {formatRelative(allowlist.updatedAt)}{/if}
        {/if}
      </span>
    </div>

    <ul class="max-h-[28rem] divide-y divide-ivory-200/6 overflow-y-auto border-t border-ivory-200/8">
      {#each visibleAllowlist as entry (entry.name)}
        {@const present = hasFlag(entry.name)}
        <li class="flex items-start gap-3 py-2.5">
          <span class="mt-0.5 shrink-0 {present ? 'text-positive' : 'text-ivory-600'}">
            <Icon name={present ? 'check' : 'x'} size={13} />
          </span>

          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-1.5">
              <span class="truncate font-mono text-[0.6875rem] text-ivory-200">{entry.name}</span>
              <span class="chip">{entry.kind}</span>
              {#if entry.risk !== 'safe'}
                <span class="chip border-caution/30 text-caution/90">{entry.risk}</span>
              {/if}
            </span>
            <span class="mt-0.5 block text-2xs leading-relaxed text-ivory-500">{entry.description}</span>
            {#if entry.options.length > 0}
              <span class="mt-0.5 block font-mono text-[0.625rem] text-ivory-600">
                {entry.options.map((option) => String(option)).join(' · ')}
              </span>
            {/if}
          </span>

          <button
            type="button"
            class="btn-ghost shrink-0 px-2.5 py-1 text-2xs"
            disabled={present}
            title={present ? 'Already in this profile' : 'Add to the profile being edited'}
            onclick={() => addFromAllowlist(entry)}
          >
            {present ? 'added' : 'Add'}
          </button>
        </li>
      {/each}
    </ul>

    <p class="py-3 text-2xs leading-relaxed text-ivory-600">
      The allowlist is merged from a built-in set and the configured remote list
      ({settings.value.flagAllowlistUrl}). A check means Roblox's flag system knows the
      name; a cross means the client will most likely ignore it.
    </p>
  {/if}
</Section>

<div class="h-5"></div>

<Section title="Allowlist behaviour" description="How the launcher treats a flag it does not recognise.">
  <SettingRow
    title="Update the allowlist automatically"
    description="Re-fetch the remote list once a week."
  >
    <Switch
      checked={settings.value.flagAllowlistAutoUpdate}
      onchange={(value) => void updateSettings({ flagAllowlistAutoUpdate: value })}
    />
  </SettingRow>

  <SettingRow
    title="Allowlist source"
    description="Any URL returning a flag list: an array of names, an array of objects, or a name-to-type map."
    stacked
  >
    <input
      class="field w-full py-1.5 font-mono text-2xs"
      value={settings.value.flagAllowlistUrl}
      onblur={(event) => void updateSettings({ flagAllowlistUrl: event.currentTarget.value })}
    />
  </SettingRow>
</Section>
