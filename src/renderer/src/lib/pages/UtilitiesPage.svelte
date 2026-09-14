<script lang="ts">
  import type {
    CleanerScan,
    ClientLogEvent,
    ClientSettingsState,
    LogFileInfo,
    LogLine,
    PowerPlan,
    ProcessTweakState,
    StrapDetection
  } from '@shared/models'
  import type { CleanerCategory } from '@shared/settings'
  import { CLEANER_TARGETS, REGION_CATALOG } from '@shared/catalog'
  import { api, errorMessage, listen, safeInvoke } from '../ipc'
  import { accounts } from '../stores/accounts.svelte'
  import { settings, updateSettings } from '../stores/settings.svelte'
  import { pushToast } from '../stores/toasts.svelte'

  import Dialog from '../components/Dialog.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import Select from '../components/Select.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Switch from '../components/Switch.svelte'
  import Tabs from '../components/Tabs.svelte'
  import { formatBytes, formatDateTime, formatRelative } from '../utils/format'

  /**
   * Everything that keeps the machine tidy and the client honest: the cleaner,
   * the log viewer, the GlobalBasicSettings editor, the process tweaks, game
   * shortcuts and the backup archive. Each lives in its own tab so the page can
   * stay a page.
   */

  type Tab = 'cleaner' | 'logs' | 'client' | 'tweaks' | 'shortcuts' | 'backup'

  let tab = $state<Tab>('cleaner')

  const REGION_OPTIONS = REGION_CATALOG.filter((region) => region.id !== 'any').map((region) => ({
    value: region.id,
    label: region.label
  }))

  /* ------------------------------------------------------------- Cleaner */

  let scan = $state<CleanerScan | null>(null)
  let scanning = $state(false)
  let cleaning = $state(false)
  let dryRun = $state(false)
  let selectedTargets = $state<CleanerCategory[]>([...settings.value.cleanerTargets])
  let confirmClean = $state(false)

  /* ---------------------------------------------------------------- Logs */

  let files = $state<LogFileInfo[]>([])
  let selectedLog = $state<string | null>(null)
  let lines = $state<LogLine[]>([])
  let logFilter = $state('')
  let following = $state(false)
  let events = $state<ClientLogEvent[]>([])

  /* ------------------------------------------------------- Client settings */

  let clientSettings = $state<ClientSettingsState | null>(null)
  let clientDraft = $state<Record<string, number | string | boolean>>({})
  let clientBusy = $state(false)

  /* -------------------------------------------------------------- Tweaks */

  let process = $state<ProcessTweakState | null>(null)
  let plans = $state<PowerPlan[]>([])

  /* ----------------------------------------------------------- Shortcuts */

  let shortcutName = $state('')
  let shortcutPlace = $state('')
  let shortcutRegion = $state('any')
  let shortcutAccount = $state('active')
  let shortcutBusy = $state(false)

  /* -------------------------------------------------------------- Backup */

  let includeSettings = $state(true)
  let includeFlags = $state(true)
  let includePlaytime = $state(true)
  let includeMods = $state(false)
  let includeAccounts = $state(true)
  let passphrase = $state('')
  let backupBusy = $state(false)
  let importPassword = $state('')
  let confirmImport = $state(false)

  /* --------------------------------------------------------- Other straps */

  let detections = $state<StrapDetection[]>([])

  $effect(() => {
    void refreshScan()
    void loadLogs()
    void loadClientSettings()
    void loadTweaks()
    void loadStraps()

    return listen('logs:line', (payload) => {
      if (payload.path !== selectedLog) return
      lines = [...lines.slice(-settings.value.logBufferLines + 1), payload.line]
    })
  })

  async function refreshScan(): Promise<void> {
    scanning = true
    try {
      scan = await api.cleaner.scan(selectedTargets)
    } catch (error) {
      pushToast({ kind: 'warning', title: 'Scan failed', message: errorMessage(error) })
    } finally {
      scanning = false
    }
  }

  function toggleTarget(id: CleanerCategory): void {
    selectedTargets = selectedTargets.includes(id)
      ? selectedTargets.filter((target) => target !== id)
      : [...selectedTargets, id]
  }

  async function runCleaner(): Promise<void> {
    cleaning = true
    confirmClean = false

    try {
      const result = await api.cleaner.run({ targets: selectedTargets, dryRun })
      if (result.errors.length > 0) {
        pushToast({ kind: 'warning', title: 'Finished with problems', message: result.errors[0] })
      } else {
        pushToast({
          kind: 'success',
          title: dryRun ? 'Dry run complete' : 'Cleaned',
          message: `${result.removedFiles.toLocaleString()} file(s) · ${formatBytes(result.freedBytes)}`
        })
      }

      await refreshScan()
    } catch (error) {
      pushToast({ kind: 'error', title: 'Cleaning failed', message: errorMessage(error) })
    } finally {
      cleaning = false
    }
  }

  /* -------------------------------------------------------------- Logs */

  async function loadLogs(): Promise<void> {
    files = await safeInvoke(() => api.logs.list(), [])
    if (!selectedLog && files.length > 0) await selectLog(files[0].path)
  }

  async function selectLog(path: string): Promise<void> {
    selectedLog = path
    await stopFollowing()

    const result = await safeInvoke(
      () => api.logs.read({ path, tailLines: 500 }),
      { file: null, lines: [], error: null }
    )

    lines = result.lines
    if (result.error) pushToast({ kind: 'warning', title: 'Could not read that log', message: result.error })

    events = await safeInvoke(() => api.logs.events({ path, tailLines: 4000 }), [])
  }

  async function startFollowing(): Promise<void> {
    if (!selectedLog) return

    const result = await safeInvoke(
      () => api.logs.read({ path: selectedLog ?? undefined, tailLines: 200, filter: logFilter || undefined, follow: true }),
      { file: null, lines: [], error: null }
    )

    lines = result.lines
    following = true
  }

  async function stopFollowing(): Promise<void> {
    if (!following) return
    following = false
    await safeInvoke(() => api.logs.unfollow(), { ok: true })
  }

  async function applyFilter(): Promise<void> {
    if (!selectedLog) return

    const result = await safeInvoke(
      () => api.logs.read({ path: selectedLog ?? undefined, tailLines: 800, filter: logFilter || undefined }),
      { file: null, lines: [], error: null }
    )

    lines = result.lines
  }

  /* --------------------------------------------------- Client settings */

  async function loadClientSettings(): Promise<void> {
    clientSettings = await safeInvoke(() => api.clientSettings.read(), null)
    if (clientSettings) clientDraft = { ...clientSettings.values } as Record<string, number | string | boolean>
  }

  async function saveClientSettings(): Promise<void> {
    if (!clientSettings) return

    // Only send what actually changed, so one field cannot overwrite another.
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(clientDraft)) {
      if (clientSettings.values[key] !== value) patch[key] = value
    }

    if (Object.keys(patch).length === 0) {
      pushToast({ kind: 'info', title: 'Nothing to save' })
      return
    }

    clientBusy = true
    try {
      const next = await api.clientSettings.write(patch as Record<string, number | string | boolean>)
      clientSettings = next
      clientDraft = { ...next.values } as Record<string, number | string | boolean>
      pushToast({ kind: 'success', title: 'Client settings saved', message: 'Applied on the next launch.' })
    } catch (error) {
      pushToast({ kind: 'error', title: 'Could not write the settings file', message: errorMessage(error) })
    } finally {
      clientBusy = false
    }
  }

  /* -------------------------------------------------------------- Tweaks */

  async function loadTweaks(): Promise<void> {
    process = await safeInvoke(() => api.tweaks.getProcessState(), null)
    plans = await safeInvoke(() => api.tweaks.listPowerPlans(), [])
  }

  async function applyPriority(priority: 'normal' | 'abovenormal' | 'high'): Promise<void> {
    process = await safeInvoke(() => api.tweaks.apply({ priority }), process)
  }

  async function trimNow(): Promise<void> {
    process = await safeInvoke(() => api.tweaks.apply({ trim: true }), process)
    pushToast({ kind: 'success', title: 'Working set trimmed' })
  }

  async function setPlan(guid: string): Promise<void> {
    const result = await safeInvoke(() => api.tweaks.setPowerPlan(guid), {
      ok: false as const,
      error: 'Power plans are not available on this system'
    })
    if (result.data) plans = result.data
    if (!result.ok && result.error) {
      pushToast({ kind: 'warning', title: 'Could not switch power plan', message: result.error })
    }
  }

  /* ----------------------------------------------------------- Shortcuts */

  async function createShortcut(): Promise<void> {
    if (!/^\d{3,}$/.test(shortcutPlace.trim())) {
      pushToast({ kind: 'warning', title: 'A numeric place id is required' })
      return
    }

    shortcutBusy = true
    try {
      const result = await api.shortcuts.create({
        name: shortcutName.trim() || `Roblox ${shortcutPlace.trim()}`,
        placeId: shortcutPlace.trim(),
        accountId: shortcutAccount === 'active' ? null : shortcutAccount,
        region: shortcutRegion === 'any' ? null : shortcutRegion,
        locations: ['desktop']
      })

      if (result.ok) {
        pushToast({
          kind: 'success',
          title: 'Shortcut created',
          message: result.data?.created[0] ?? ''
        })
      } else {
        pushToast({ kind: 'warning', title: 'Shortcut not created', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Shortcut failed', message: errorMessage(error) })
    } finally {
      shortcutBusy = false
    }
  }

  /* -------------------------------------------------------------- Backup */

  async function exportBackup(): Promise<void> {
    backupBusy = true
    try {
      const result = await api.backup.export({
        includeSettings,
        includeFlags,
        includePlaytime,
        includeMods,
        includeAccounts,
        password: passphrase
      })

      if (result.ok) {
        pushToast({
          kind: 'success',
          title: 'Backup written',
          message: formatBytes(result.data?.bytes ?? 0)
        })
      } else {
        pushToast({ kind: 'warning', title: 'Backup not written', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Backup failed', message: errorMessage(error) })
    } finally {
      backupBusy = false
    }
  }

  async function importBackup(): Promise<void> {
    confirmImport = false
    backupBusy = true

    try {
      const result = await api.backup.import(importPassword)
      if (result.ok && result.data) {
        const summary = [
          result.data.settings ? 'settings' : null,
          result.data.accounts > 0 ? `${result.data.accounts} account(s)` : null,
          result.data.flagProfiles.length > 0 ? `${result.data.flagProfiles.length} flag profile(s)` : null
        ]
          .filter(Boolean)
          .join(', ')

        pushToast({ kind: 'success', title: 'Backup imported', message: summary || 'Nothing to apply' })

        for (const note of result.data.skipped) {
          pushToast({ kind: 'info', title: 'Skipped', message: note })
        }
      } else if (result.error) {
        pushToast({ kind: 'warning', title: 'Import cancelled', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Import failed', message: errorMessage(error) })
    } finally {
      backupBusy = false
    }
  }

  /* -------------------------------------------------------- Other straps */

  async function loadStraps(): Promise<void> {
    detections = await safeInvoke(() => api.straps.detect(), [])
  }

  async function importFrom(id: StrapDetection['id']): Promise<void> {
    try {
      const result = await api.straps.import({ id, settings: true, flagProfiles: true, mods: false })
      if (result.ok && result.data) {
        pushToast({
          kind: 'success',
          title: 'Imported',
          message: `${result.data.settingsApplied.length} setting(s), ${result.data.flagProfiles.length} flag profile(s)`
        })

        for (const note of result.data.skipped) {
          pushToast({ kind: 'info', title: 'Not imported', message: note })
        }
      } else {
        pushToast({ kind: 'warning', title: 'Import failed', message: result.error })
      }
    } catch (error) {
      pushToast({ kind: 'error', title: 'Import failed', message: errorMessage(error) })
    }
  }

  const totalSelected = $derived(
    scan?.targets.filter((target) => selectedTargets.includes(target.id)) ?? []
  )
  const selectedBytes = $derived(totalSelected.reduce((sum, target) => sum + target.bytes, 0))
  const logLineTone = (line: LogLine): string =>
    line.level === 'Error' || line.level === 'ERROR'
      ? 'text-negative/90'
      : line.level === 'Warn' || line.level === 'WARNING'
        ? 'text-caution/90'
        : 'text-ivory-300'
</script>

<PageHeader
  title="Utilities"
  lede="Housekeeping for Roblox itself: reclaim space, read the client's own logs, adjust its settings file, tune the process, and keep a backup of everything RemielleStrap knows."
/>

<Tabs
  value={tab}
  onchange={(next) => (tab = next as Tab)}
  tabs={[
    { id: 'cleaner', label: 'Cleaner' },
    { id: 'logs', label: 'Logs' },
    { id: 'client', label: 'Client settings' },
    { id: 'tweaks', label: 'PC tweaks' },
    { id: 'shortcuts', label: 'Shortcuts' },
    { id: 'backup', label: 'Backup' }
  ]}
/>

{#if tab === 'cleaner'}
  <Section
    title="What can be cleaned"
    description="Choose what to remove. Nothing outside these folders is ever touched."
  >
    <div class="py-2">
      {#if scanning && !scan}
        <div class="space-y-2 py-2">
          {#each [0, 1, 2, 3] as row (row)}
            <div class="skeleton h-11 rounded-control"></div>
          {/each}
        </div>
      {:else if scan}
        <ul class="divide-y divide-ivory-200/6">
          {#each scan.targets as target (target.id)}
            {@const definition = CLEANER_TARGETS.find((entry) => entry.id === target.id)}
            <li class="flex items-center gap-3 py-2.5">
              <input
                type="checkbox"
                class="h-3.5 w-3.5 accent-[var(--color-gold-400)]"
                checked={selectedTargets.includes(target.id)}
                onchange={() => toggleTarget(target.id)}
                aria-label={target.label}
              />

              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5 text-xs text-ivory-200">
                  {target.label}
                  {#if !target.safe}
                    <span class="chip border-caution/30 text-caution/90">careful</span>
                  {/if}
                  {#if !target.exists}
                    <span class="chip">not present</span>
                  {/if}
                </span>
                <span class="mt-0.5 block truncate text-2xs text-ivory-500">
                  {definition?.description ?? target.description}
                </span>
              </span>

              <span class="shrink-0 text-right">
                <span class="block text-xs text-ivory-300">{formatBytes(target.bytes)}</span>
                <span class="block text-2xs text-ivory-600">{target.fileCount.toLocaleString()} files</span>
              </span>
            </li>
          {/each}
        </ul>

        <div class="flex flex-wrap items-center gap-2 border-t border-ivory-200/8 py-3">
          <button
            type="button"
            class="btn-primary gap-1.5"
            disabled={cleaning || selectedTargets.length === 0}
            onclick={() => (dryRun ? void runCleaner() : (confirmClean = true))}
          >
            <Icon name={cleaning ? 'spinner' : 'broom'} size={14} />
            {dryRun ? 'Count what would go' : 'Clean selected'}
          </button>

          <button type="button" class="btn-ghost gap-1.5" disabled={scanning} onclick={() => void refreshScan()}>
            <Icon name={scanning ? 'spinner' : 'refresh'} size={14} />
            Rescan
          </button>

          <span class="text-2xs text-ivory-500">
            {selectedBytes > 0 ? `${formatBytes(selectedBytes)} recoverable` : 'nothing to recover'}
          </span>

          <label class="ml-auto flex items-center gap-2 text-2xs text-ivory-400">
            <Switch checked={dryRun} onchange={(value) => (dryRun = value)} />
            Dry run
          </label>
        </div>
      {:else}
        <EmptyState icon="broom" title="Nothing to scan yet" message="Run a scan to see what is taking up space." />
      {/if}
    </div>
  </Section>

  <div class="h-5"></div>

  <Section title="Schedule" description="Run the cleaner on its own, so the folders never pile up.">
    <SettingRow title="When to clean" description="Scheduled runs use the selection above at the time they run.">
      <Select
        value={settings.value.cleanerSchedule}
        options={[
          { value: 'manual', label: 'Only when I ask' },
          { value: 'launch', label: 'Before each launch' },
          { value: 'daily', label: 'Once a day' },
          { value: 'weekly', label: 'Once a week' }
        ]}
        onchange={(value) =>
          void updateSettings({ cleanerSchedule: value as typeof settings.value.cleanerSchedule })
        }
      />
    </SettingRow>

    <SettingRow
      title="Close the crash handler for me"
      description="When the client crashes, Roblox opens its own reporter. Closing it automatically is convenient — and means no crash report is ever sent."
    >
      <Switch
        checked={settings.value.crashHandlerAutoClose}
        onchange={(value) => void updateSettings({ crashHandlerAutoClose: value })}
      />
    </SettingRow>
  </Section>
{:else if tab === 'logs'}
  <Section
    title="Log files"
    description="Roblox writes one log per client session; RemielleStrap writes its own next to them."
  >
    <div class="grid gap-4 py-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <ul class="max-h-80 space-y-1 overflow-y-auto pr-1">
        {#each files as file (file.path)}
          <li>
            <button
              type="button"
              class="w-full rounded-control px-2 py-1.5 text-left text-2xs transition-colors
                {file.path === selectedLog ? 'bg-ivory-100/7 text-ivory-100' : 'text-ivory-400 hover:bg-ivory-100/4'}"
              onclick={() => void selectLog(file.path)}
            >
              <span class="block truncate">{file.name}</span>
              <span class="block text-ivory-600">
                {file.kind === 'roblox' ? 'client' : 'launcher'} · {formatBytes(file.size)} ·
                {formatRelative(file.modifiedAt)}
              </span>
            </button>
          </li>
        {/each}

        {#if files.length === 0}
          <li class="px-2 py-4 text-2xs text-ivory-500">
            No logs yet. They appear after the first launch.
          </li>
        {/if}
      </ul>

      <div class="min-w-0">
        <div class="mb-2 flex flex-wrap items-center gap-2">
          <input
            class="field min-w-40 flex-1 py-1.5 text-2xs"
            placeholder="Filter lines"
            bind:value={logFilter}
            onkeydown={(event) => {
              if (event.key === 'Enter') void applyFilter()
            }}
          />

          <button type="button" class="btn-secondary px-2.5 py-1 text-2xs" onclick={() => void applyFilter()}>
            Filter
          </button>

          {#if following}
            <button type="button" class="btn-secondary gap-1.5 px-2.5 py-1 text-2xs" onclick={() => void stopFollowing()}>
              <Icon name="spinner" size={12} />
              Following — stop
            </button>
          {:else}
            <button
              type="button"
              class="btn-secondary gap-1.5 px-2.5 py-1 text-2xs"
              disabled={!selectedLog}
              onclick={() => void startFollowing()}
            >
              <Icon name="eye" size={12} />
              Follow live
            </button>
          {/if}

          <button
            type="button"
            class="btn-ghost px-2.5 py-1 text-2xs"
            disabled={!selectedLog}
            onclick={() => void api.system.openLogs()}
          >
            <Icon name="folder" size={12} />
            Open folder
          </button>
        </div>

        <pre
          class="surface-inset h-80 overflow-auto p-2.5 font-mono text-[0.6875rem] leading-relaxed"
          data-selectable
        >{#each lines as line, index (index)}
{formatDateTime(line.at)} {line.level ?? ''} > <span class={logLineTone(line)}>{line.text}</span>
        {/each}{#if lines.length === 0}
No lines to show.
        {/if}</pre>

        {#if events.length > 0}
          <div class="mt-3">
            <p class="eyebrow mb-1.5">Session events</p>
            <ul class="max-h-40 space-y-1 overflow-y-auto">
              {#each events.slice(-40) as event, index (index)}
                <li class="flex items-center gap-2 text-2xs text-ivory-400">
                  <span class="chip shrink-0">{event.kind}</span>
                  <span class="text-ivory-600">{formatDateTime(event.at)}</span>
                  <span class="truncate text-ivory-300">{event.text}</span>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
  </Section>
{:else if tab === 'client'}
  <Section
    title="Client settings"
    description="A safe subset of GlobalBasicSettings_13.xml. Only values that already exist in the file are written, and a one-time backup is kept beside it."
  >
    {#if !clientSettings?.present}
      <EmptyState
        icon="sliders"
        title="Roblox has not written its settings file yet"
        message="Launch the client once and it will appear here."
      />
    {:else}
      <div class="py-1">
        {#each clientSettings.fields as field (field.key)}
          <SettingRow title={field.label} description={field.description}>
            {#if field.kind === 'boolean'}
              <Switch
                checked={Boolean(clientDraft[field.key])}
                onchange={(value) => (clientDraft = { ...clientDraft, [field.key]: value })}
              />
            {:else if field.kind === 'select'}
              <Select
                value={String(clientDraft[field.key] ?? '')}
                options={field.options.map((option) => ({
                  value: String(option.value),
                  label: option.label
                }))}
                onchange={(value) => (clientDraft = { ...clientDraft, [field.key]: value })}
              />
            {:else}
              <input
                type="number"
                class="field w-28 py-1.5 text-xs"
                min={field.min ?? undefined}
                max={field.max ?? undefined}
                step={field.step ?? 1}
                value={Number(clientDraft[field.key] ?? 0)}
                oninput={(event) =>
                  (clientDraft = { ...clientDraft, [field.key]: Number(event.currentTarget.value) })}
              />
            {/if}
          </SettingRow>
        {/each}
      </div>

      <div class="flex flex-wrap items-center gap-2 border-t border-ivory-200/8 py-3">
        <button type="button" class="btn-primary gap-1.5" disabled={clientBusy} onclick={() => void saveClientSettings()}>
          <Icon name={clientBusy ? 'spinner' : 'save'} size={14} />
          Save changes
        </button>

        <button type="button" class="btn-ghost gap-1.5" onclick={() => void loadClientSettings()}>
          Reload file
        </button>

        {#if clientSettings.readOnly}
          <span class="text-2xs text-caution/90">
            Close Roblox first — the client rewrites this file when it exits.
          </span>
        {/if}
      </div>
    {/if}
  </Section>
{:else if tab === 'tweaks'}
  <Section title="Live process" description="Applies to the running client, when there is one.">
    <SettingRow title="Status">
      <span class="text-xs text-ivory-300">
        {#if process?.running}
          running · pid {process.pid} · {process.cpuCount} cores
        {:else}
          not running
        {/if}
      </span>
    </SettingRow>

    <SettingRow
      title="Priority"
      description="Higher priority can help on a busy machine, but takes CPU away from everything else."
      warning={settings.value.processPriority === 'high' ? 'High priority is applied to the client on every launch.' : undefined}
    >
      <Select
        value={settings.value.processPriority}
        options={[
          { value: 'normal', label: 'Normal' },
          { value: 'abovenormal', label: 'Above normal' },
          { value: 'high', label: 'High' }
        ]}
        onchange={(value) => {
          void updateSettings({ processPriority: value as typeof settings.value.processPriority })
          void applyPriority(value as 'normal' | 'abovenormal' | 'high')
        }}
      />
    </SettingRow>
  </Section>

  <div class="h-5"></div>

  <Section title="Memory" description="Trimming hands unused pages back to Windows while the client runs.">
    <SettingRow
      title="Trim periodically"
      description={`Every ${settings.value.memoryTrimMinutes} minutes while a client is running. It never touches a client that is not responding.`}
    >
      <Switch
        checked={settings.value.memoryTrimEnabled}
        onchange={(value) => void updateSettings({ memoryTrimEnabled: value })}
      />
    </SettingRow>

    <SettingRow title="Interval" description="How often the working set is trimmed.">
      <Select
        value={String(settings.value.memoryTrimMinutes)}
        options={[5, 10, 15, 30, 60].map((minutes) => ({
          value: String(minutes),
          label: `${minutes} minutes`
        }))}
        onchange={(value) => void updateSettings({ memoryTrimMinutes: Number(value) })}
      />
    </SettingRow>

    <SettingRow title="Trim now" description="One immediate trim of whatever client is running.">
      <button type="button" class="btn-secondary gap-1.5" disabled={!process?.running} onclick={() => void trimNow()}>
        <Icon name="zap" size={14} />
        Trim
      </button>
    </SettingRow>

    <SettingRow
      title="Working set"
      description="Current resident size of the client process."
    >
      <span class="text-xs text-ivory-300">{formatBytes(process?.workingSetBytes ?? 0)}</span>
    </SettingRow>
  </Section>

  <div class="h-5"></div>

  <Section title="Power and graphics" description="Applied before each launch; nothing is changed permanently.">
    <SettingRow
      title="Power plan on launch"
      description="Some machines throttle the client on a balanced plan. Switching to a performance plan while playing can steady the frame rate."
    >
      <Select
        value={settings.value.powerPlanOnLaunch}
        options={[
          { value: '', label: 'Leave it alone' },
          ...plans.map((plan) => ({ value: plan.guid, label: `${plan.name}${plan.active ? ' (current)' : ''}` }))
        ]}
        onchange={(value) => void updateSettings({ powerPlanOnLaunch: value })}
      />
    </SettingRow>

    <SettingRow title="Switch power plan now">
      <div class="flex items-center gap-2">
        {#each plans as plan (plan.guid)}
          <button
            type="button"
            class="btn-ghost px-2.5 py-1 text-2xs {plan.active ? 'text-gold-200' : ''}"
            onclick={() => void setPlan(plan.guid)}
          >
            {plan.name}
          </button>
        {/each}

        {#if plans.length === 0}
          <span class="text-2xs text-ivory-500">Power plans are only readable on Windows.</span>
        {/if}
      </div>
    </SettingRow>

    <SettingRow
      title="GPU preference"
      description="A hint to Windows about which GPU should run the client. Only applied when it is changed here."
    >
      <Select
        value={settings.value.gpuPreference}
        options={[
          { value: 'auto', label: 'Let Windows decide' },
          { value: 'high-performance', label: 'High performance' },
          { value: 'power-saving', label: 'Power saving' }
        ]}
        onchange={(value) => void updateSettings({ gpuPreference: value as typeof settings.value.gpuPreference })}
      />
    </SettingRow>
  </Section>
{:else if tab === 'shortcuts'}
  <Section
    title="Game shortcuts"
    description="A shortcut launches Roblox through RemielleStrap with the account and region baked in, so it behaves exactly like pressing Play here."
  >
    <SettingRow title="Name" description="Shown under the icon; the place name is a good default.">
      <input class="field w-56 py-1.5 text-xs" placeholder="My game" bind:value={shortcutName} />
    </SettingRow>

    <SettingRow title="Place id" description="The number in the experience's URL.">
      <input class="field w-40 py-1.5 text-xs" placeholder="123456789" bind:value={shortcutPlace} />
    </SettingRow>

    <SettingRow title="Account" description="Which stored account the shortcut signs in as.">
      <Select
        value={shortcutAccount}
        options={[
          { value: 'active', label: accounts.active ? `${accounts.active.displayName} (active)` : 'None' },
          ...accounts.list.map((account) => ({ value: account.id, label: account.displayName }))
        ]}
        onchange={(value) => (shortcutAccount = value)}
      />
    </SettingRow>

    <SettingRow title="Region" description="Written into the shortcut's name so it is obvious which is which.">
      <Select
        value={shortcutRegion}
        options={[{ value: 'any', label: 'Any region' }, ...REGION_OPTIONS]}
        onchange={(value) => (shortcutRegion = value)}
      />
    </SettingRow>

    <div class="flex items-center justify-end gap-2 py-3">
      <button type="button" class="btn-primary gap-1.5" disabled={shortcutBusy} onclick={() => void createShortcut()}>
        <Icon name={shortcutBusy ? 'spinner' : 'save'} size={14} />
        Create on the desktop
      </button>
    </div>
  </Section>
{:else}
  <Section
    title="Export"
    description="One archive with everything RemielleStrap knows. Account cookies can only travel inside it when a passphrase is given."
  >
    <div class="py-1">
      <SettingRow title="Settings" description="Every preference on every page.">
        <Switch checked={includeSettings} onchange={(value) => (includeSettings = value)} />
      </SettingRow>
      <SettingRow title="FastFlag profiles" description="Profiles and the active selection.">
        <Switch checked={includeFlags} onchange={(value) => (includeFlags = value)} />
      </SettingRow>
      <SettingRow title="Playtime" description="Session history and per-game totals.">
        <Switch checked={includePlaytime} onchange={(value) => (includePlaytime = value)} />
      </SettingRow>
      <SettingRow title="Mod list" description="Which mods were installed. The files themselves stay out, to keep the archive small.">
        <Switch checked={includeMods} onchange={(value) => (includeMods = value)} />
      </SettingRow>
      <SettingRow
        title="Accounts"
        description="Cookies are sealed with AES-256-GCM under a passphrase you choose. Without eight characters this section is skipped."
      >
        <Switch checked={includeAccounts} onchange={(value) => (includeAccounts = value)} />
      </SettingRow>

      {#if includeAccounts}
        <SettingRow title="Passphrase" description="Needed again to import the accounts. It is not stored anywhere.">
          <input
            type="password"
            class="field w-56 py-1.5 text-xs"
            placeholder="at least 8 characters"
            bind:value={passphrase}
          />
        </SettingRow>
      {/if}
    </div>

    <div class="flex items-center justify-end gap-2 border-t border-ivory-200/8 py-3">
      <button type="button" class="btn-primary gap-1.5" disabled={backupBusy} onclick={() => void exportBackup()}>
        <Icon name={backupBusy ? 'spinner' : 'save'} size={14} />
        Write archive
      </button>
    </div>
  </Section>

  <div class="h-5"></div>

  <Section title="Import" description="Restore an archive written by RemielleStrap.">
    <SettingRow
      title="Archive passphrase"
      description="Leave empty for an archive without accounts."
    >
      <input type="password" class="field w-56 py-1.5 text-xs" bind:value={importPassword} />
    </SettingRow>

    <div class="flex items-center justify-end gap-2 py-3">
      <button type="button" class="btn-secondary gap-1.5" onclick={() => (confirmImport = true)}>
        <Icon name="download" size={14} />
        Choose an archive
      </button>
    </div>
  </Section>

  <div class="h-5"></div>

  <Section
    title="Import from another bootstrapper"
    description="Settings and flag profiles can be carried over from Bloxstrap, Fishstrap or Froststrap. Nothing is changed in the other app."
  >
    {#if detections.length === 0}
      <div class="py-4 text-xs text-ivory-500">Looking for other bootstrappers…</div>
    {:else}
      {#each detections as detection (detection.id)}
        <SettingRow
          title={detection.name}
          description={detection.detected ? (detection.detail ?? 'Found on this machine') : 'Not installed'}
        >
          <button
            type="button"
            class="btn-secondary gap-1.5"
            disabled={!detection.detected}
            onclick={() => void importFrom(detection.id)}
          >
            <Icon name="download" size={14} />
            Import
          </button>
        </SettingRow>
      {/each}
    {/if}
  </Section>
{/if}

{#if confirmClean}
  <Dialog
    title="Clean the selected folders?"
    description="Files are deleted, not moved. Roblox will re-download anything it still needs."
    onclose={() => (confirmClean = false)}
  >
    <ul class="space-y-1 text-xs text-ivory-300">
      {#each totalSelected as target (target.id)}
        <li class="flex items-center justify-between gap-3">
          <span>{target.label}</span>
          <span class="text-ivory-500">{formatBytes(target.bytes)}</span>
        </li>
      {/each}
    </ul>

    <div class="mt-4 flex justify-end gap-2">
      <button type="button" class="btn-ghost" onclick={() => (confirmClean = false)}>Cancel</button>
      <button type="button" class="btn-danger" disabled={cleaning} onclick={() => void runCleaner()}>
        Delete {formatBytes(selectedBytes)}
      </button>
    </div>
  </Dialog>
{/if}

{#if confirmImport}
  <Dialog
    title="Import this backup?"
    description="Settings in the archive replace the current ones. Mods are listed but not re-downloaded."
    onclose={() => (confirmImport = false)}
  >
    <div class="mt-4 flex justify-end gap-2">
      <button type="button" class="btn-ghost" onclick={() => (confirmImport = false)}>Cancel</button>
      <button type="button" class="btn-primary" onclick={() => void importBackup()}>Choose archive</button>
    </div>
  </Dialog>
{/if}
