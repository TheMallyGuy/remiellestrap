<script lang="ts">
  import type {
    AccountFriend,
    AccountPresence,
    AccountProfile,
    GameSummary,
    RobloxAccount
  } from '@shared/models'
  import { api, errorMessage, listen } from '../ipc'
  import {
    accounts,
    addFromCookie,
    browserLogin,
    initials,
    loadAccounts,
    reauthenticate,
    refreshAccounts,
    removeAccount,
    setActiveAccount,
    updateNotes
  } from '../stores/accounts.svelte'
  import { pushToast } from '../stores/toasts.svelte'
  import { updateSettings } from '../stores/settings.svelte'

  import Dialog from '../components/Dialog.svelte'
  import EmptyState from '../components/EmptyState.svelte'
  import Icon from '../components/Icon.svelte'
  import PageHeader from '../components/PageHeader.svelte'
  import Section from '../components/Section.svelte'
  import SettingRow from '../components/SettingRow.svelte'
  import Tabs from '../components/Tabs.svelte'
  import { formatRelative } from '../utils/format'

  /**
   * The account manager.
   *
   * One list of stored accounts, one detail panel for whichever is selected,
   * and three ways in: a real Roblox sign-in window, Roblox's Quick Log In page
   * for a code from a phone, and a pasted cookie for people who already have
   * one. Cookies never leave the main process, so nothing here ever sees one.
   */

  let selectedId = $state<string | null>(null)
  let tab = $state<'overview' | 'friends' | 'games'>('overview')

  let profile = $state<AccountProfile | null>(null)
  let friends = $state<AccountFriend[]>([])
  let games = $state<GameSummary[]>([])
  let gameList = $state<'continue-playing' | 'favorites' | 'recommendations'>('continue-playing')
  let searchQuery = $state('')
  let searchResults = $state<GameSummary[]>([])
  let busyPanel = $state(false)

  let cookieDialog = $state(false)
  let cookieInput = $state('')
  let cookieNotes = $state('')
  let confirmRemove = $state<RobloxAccount | null>(null)

  const selected = $derived(accounts.list.find((account) => account.id === selectedId) ?? null)

  $effect(() => {
    void loadAccounts()
    return listen('accounts:changed', (payload) => {
      // The main process may add or drop accounts while the page is open (tray
      // switch, background refresh); mirror whatever it settled on.
      profile = null
      void payload
      void loadAccounts()
    })
  })

  // Keep the selection pointing at something real as the list changes.
  $effect(() => {
    const list = accounts.list
    if (list.length === 0) {
      if (selectedId !== null) selectedId = null
      return
    }

    if (!selectedId || !list.some((account) => account.id === selectedId)) {
      selectedId = accounts.active?.id ?? list[0].id
    }
  })

  // Reload the detail panel whenever the selection or tab changes.
  $effect(() => {
    const id = selectedId
    const current = tab

    if (!id) {
      profile = null
      friends = []
      games = []
      return
    }

    void loadPanel(id, current)
  })

  async function loadPanel(id: string, which: 'overview' | 'friends' | 'games'): Promise<void> {
    busyPanel = true

    try {
      if (which === 'overview') {
        const result = await api.accounts.getProfile({ accountId: id })
        profile = result.ok ? (result.data ?? null) : null
      }

      if (which === 'friends') {
        const result = await api.accounts.getFriends(id)
        friends = result.ok ? (result.data ?? []) : []
      }

      if (which === 'games') {
        const result = await api.accounts.getGameList({ accountId: id, kind: gameList, limit: 24 })
        games = result.ok ? (result.data ?? []) : []
      }
    } catch (error) {
      pushToast({
        kind: 'warning',
        title: 'That list is unavailable',
        message: errorMessage(error)
      })
    } finally {
      busyPanel = false
    }
  }

  async function runSearch(): Promise<void> {
    const query = searchQuery.trim()
    if (query.length < 2) {
      searchResults = []
      return
    }

    busyPanel = true
    try {
      const result = await api.accounts.searchGames({ query, limit: 20 })
      searchResults = result.ok ? (result.data ?? []) : []
      if (!result.ok && result.error) {
        pushToast({ kind: 'warning', title: 'Search failed', message: result.error })
      }
    } finally {
      busyPanel = false
    }
  }

  async function join(placeId: number): Promise<void> {
    const accountId = selectedId

    try {
      const result = await api.accounts.joinAs({ placeId: String(placeId), accountId })
      if (!result.ok) {
        pushToast({ kind: 'error', title: 'Could not launch', message: result.message })
        return
      }

      if (accountId) void updateSettings({ activeAccountId: accountId })
    } catch (error) {
      pushToast({ kind: 'error', title: 'Could not launch', message: errorMessage(error) })
    }
  }

  async function submitCookie(): Promise<void> {
    const ok = await addFromCookie(cookieInput.trim(), cookieNotes.trim() || undefined)
    if (ok) {
      cookieDialog = false
      cookieInput = ''
      cookieNotes = ''
    }
  }

  const presenceLabel: Record<AccountPresence, string> = {
    ingame: 'In game',
    online: 'Online',
    website: 'On the site',
    offline: 'Offline',
    unknown: 'Presence unknown'
  }

  const presenceTone: Record<AccountPresence, string> = {
    ingame: 'bg-positive',
    online: 'bg-gold-400',
    website: 'bg-prism-cyan',
    offline: 'bg-ivory-500/50',
    unknown: 'bg-ivory-500/30'
  }
</script>

<PageHeader
  title="Accounts"
  lede="Sign in once per account and RemielleStrap handles the rest: launches use the selected account, and its games are one click away."
/>

{#if !accounts.secureStorage && accounts.value}
  <div
    class="mb-5 flex items-start gap-2.5 rounded-card border border-caution/25 bg-caution/8 px-3.5 py-3"
  >
    <span class="mt-0.5 text-caution"><Icon name="alert" size={15} /></span>
    <div class="min-w-0 text-xs leading-relaxed text-caution/90">
      <p class="font-medium text-caution">Accounts cannot be saved on this machine</p>
      <p class="mt-0.5 text-caution/80">
        {accounts.secureStorageReason ?? 'No OS credential store is available.'}
        Accounts added now work for this session only.
      </p>
    </div>
  </div>
{/if}

<div class="mb-5 flex flex-wrap items-center gap-2">
  <button
    type="button"
    class="btn-primary gap-1.5"
    disabled={accounts.busy === 'new'}
    onclick={() => void browserLogin('login')}
  >
    <Icon name={accounts.busy === 'new' ? 'spinner' : 'user'} size={14} />
    Sign in with a browser
  </button>

  <button
    type="button"
    class="btn-secondary gap-1.5"
    disabled={accounts.busy === 'new'}
    onclick={() => void browserLogin('quick')}
    title="Sign in with a code generated on your phone or another device"
  >
    <Icon name="key" size={14} />
    Quick sign-in code
  </button>

  <button type="button" class="btn-ghost gap-1.5" onclick={() => (cookieDialog = true)}>
    <Icon name="link" size={14} />
    Paste a cookie
  </button>

  <button
    type="button"
    class="btn-ghost ml-auto gap-1.5"
    disabled={accounts.loading}
    onclick={() => void refreshAccounts()}
  >
    <Icon name="refresh" size={14} />
    Refresh all
  </button>
</div>

{#if accounts.loading}
  <div class="space-y-2">
    {#each [0, 1] as row (row)}
      <div class="skeleton h-16 rounded-card"></div>
    {/each}
  </div>
{:else if accounts.list.length === 0}
  <EmptyState
    icon="user"
    title="No accounts yet"
    message="Sign in with a browser window, use a Quick Log In code, or paste a .ROBLOSECURITY cookie. Cookies are encrypted with your OS credential store and never written in the clear."
  />
{:else}
  <div class="grid gap-5 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
    <!-- The roster: compact rows, one per account. -->
    <ul class="space-y-1.5">
      {#each accounts.list as account (account.id)}
        {@const isSelected = account.id === selectedId}
        <li>
          <button
            type="button"
            class="w-full rounded-card border px-2.5 py-2 text-left transition-colors duration-150
              {isSelected
              ? 'border-gold-500/35 bg-ivory-100/6'
              : 'border-transparent hover:border-ivory-200/10 hover:bg-ivory-100/4'}"
            onclick={() => (selectedId = account.id)}
          >
            <div class="flex items-center gap-2.5">
              <span class="relative shrink-0">
                {#if account.avatarUrl}
                  <img
                    src={account.avatarUrl}
                    alt=""
                    class="h-8 w-8 rounded-full object-cover"
                    loading="lazy"
                  />
                {:else}
                  <span
                    class="grid h-8 w-8 place-items-center rounded-full bg-ink-700 text-xs text-ivory-300"
                  >
                    {initials(account)}
                  </span>
                {/if}

                <span
                  class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-ink-900 {presenceTone[
                    account.presence
                  ]}"
                  title={presenceLabel[account.presence]}
                ></span>
              </span>

              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5">
                  <span class="truncate text-[0.8125rem] text-ivory-100">{account.displayName}</span
                  >
                  {#if account.isActive}
                    <span class="chip border-gold-500/40 text-gold-200">launch</span>
                  {/if}
                </span>
                <span class="block truncate text-2xs text-ivory-500">
                  @{account.username}{#if !account.valid}
                    · signed out{/if}
                </span>
              </span>
            </div>
          </button>
        </li>
      {/each}
    </ul>

    <!-- The detail panel. -->
    {#if selected}
      <div class="min-w-0">
        <div class="surface mb-4 flex items-center gap-3.5 px-4 py-3.5">
          {#if selected.avatarUrl}
            <img
              src={selected.avatarUrl}
              alt=""
              class="h-12 w-12 rounded-full object-cover"
              loading="lazy"
            />
          {:else}
            <span class="grid h-12 w-12 place-items-center rounded-full bg-ink-700 text-sm"
              >{initials(selected)}</span
            >
          {/if}

          <div class="min-w-0 flex-1">
            <p class="truncate text-sm text-ivory-50">{selected.displayName}</p>
            <p class="text-xs text-ivory-500">
              @{selected.username} · {presenceLabel[selected.presence]}
              {#if selected.lastLocation}· {selected.lastLocation}{/if}
            </p>
            {#if selected.statusMessage}
              <p class="mt-0.5 text-2xs text-caution/90">{selected.statusMessage}</p>
            {/if}
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            {#if selected.isActive}
              <button
                type="button"
                class="btn-ghost gap-1.5"
                onclick={() => void setActiveAccount(null)}
                title="Launch without a stored account"
              >
                Clear
              </button>
            {:else}
              <button
                type="button"
                class="btn-secondary gap-1.5"
                disabled={accounts.busy === selected.id}
                onclick={() => void setActiveAccount(selected.id)}
              >
                <Icon name="check" size={14} />
                Use for launches
              </button>
            {/if}
          </div>
        </div>

        <Tabs
          value={tab}
          onchange={(next) => (tab = next as typeof tab)}
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'friends', label: 'Friends' },
            { id: 'games', label: 'Games' }
          ]}
        />

        {#if busyPanel}
          <div class="skeleton h-40 rounded-card"></div>
        {:else if tab === 'overview'}
          <Section
            title="Profile"
            description="Fetched from Roblox with this account's own cookie."
          >
            {#if profile}
              <SettingRow
                title="Display name"
                description={`Last checked ${formatRelative(profile.fetchedAt)}`}
              >
                <span class="text-xs text-ivory-300">{profile.displayName}</span>
              </SettingRow>
              <SettingRow title="Account created">
                <span class="text-xs text-ivory-300">{profile.created ?? 'private'}</span>
              </SettingRow>
              <SettingRow title="Friends">
                <span class="text-xs text-ivory-300">{profile.friendsCount ?? '—'}</span>
              </SettingRow>
              <SettingRow title="Followers / following">
                <span class="text-xs text-ivory-300">
                  {profile.followersCount ?? '—'} / {profile.followingCount ?? '—'}
                </span>
              </SettingRow>
              {#if profile.description}
                <SettingRow title="About" stacked>
                  <p class="text-xs leading-relaxed text-ivory-400">{profile.description}</p>
                </SettingRow>
              {/if}
            {:else}
              <div class="px-0 py-6 text-center text-xs text-ivory-500">
                No profile came back — the session may have expired.
              </div>
            {/if}
          </Section>

          <div class="h-5"></div>

          <Section
            title="Actions"
            description="Tag the account, refresh it, or take it out of the list."
          >
            <SettingRow title="Note" description="Shown on the roster, kept only on this machine.">
              <input
                class="field w-56 py-1.5 text-xs"
                placeholder="e.g. main, alt for testing"
                value={selected.notes}
                onblur={(event) => void updateNotes(selected.id, event.currentTarget.value)}
              />
            </SettingRow>

            <SettingRow
              title="Refresh session"
              description="Validates the stored cookie and updates presence."
            >
              <button
                type="button"
                class="btn-secondary gap-1.5"
                disabled={accounts.busy === selected.id}
                onclick={() => void refreshAccounts(selected.id)}
              >
                <Icon name="refresh" size={14} />
                Refresh
              </button>
            </SettingRow>

            <SettingRow
              title="Sign in again"
              description="Opens the sign-in window; the note and add date are kept."
            >
              <button
                type="button"
                class="btn-secondary gap-1.5"
                disabled={accounts.busy === selected.id}
                onclick={() => void reauthenticate(selected.id)}
              >
                Re-authenticate
              </button>
            </SettingRow>

            <SettingRow
              title="Remove"
              description="Deletes the encrypted cookie and the account record."
              warning={selected.isActive
                ? 'This is the account launches currently use.'
                : undefined}
            >
              <button
                type="button"
                class="btn-danger gap-1.5"
                disabled={accounts.busy === selected.id}
                onclick={() => (confirmRemove = selected)}
              >
                <Icon name="trash" size={14} />
                Remove
              </button>
            </SettingRow>
          </Section>
        {:else if tab === 'friends'}
          <Section
            title="Friends"
            description="Presence for your friends list, newest cache first."
          >
            {#if friends.length === 0}
              <div class="py-6 text-center text-xs text-ivory-500">
                No friends came back. Refresh the account, or the friends list may be private.
              </div>
            {:else}
              <ul class="divide-y divide-ivory-200/6">
                {#each friends as friend (friend.userId)}
                  <li class="flex items-center gap-2.5 py-2.5">
                    {#if friend.avatarUrl}
                      <img
                        src={friend.avatarUrl}
                        alt=""
                        class="h-7 w-7 rounded-full object-cover"
                        loading="lazy"
                      />
                    {:else}
                      <span
                        class="grid h-7 w-7 place-items-center rounded-full bg-ink-700 text-2xs"
                      >
                        {friend.displayName.slice(0, 1).toUpperCase()}
                      </span>
                    {/if}

                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-xs text-ivory-200">{friend.displayName}</span
                      >
                      <span class="block truncate text-2xs text-ivory-500">@{friend.username}</span>
                    </span>

                    {#if friend.isPlaying}
                      <span class="chip border-positive/30 text-positive">in game</span>
                    {:else if friend.isOnline}
                      <span class="chip border-gold-500/30 text-gold-200">online</span>
                    {/if}

                    <button
                      type="button"
                      class="btn-ghost px-2 py-1 text-2xs"
                      title="Open their profile on roblox.com"
                      onclick={() =>
                        void api.system.openExternal(
                          `https://www.roblox.com/users/${friend.userId}/profile`
                        )}
                    >
                      <Icon name="external" size={13} />
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </Section>
        {:else}
          <Section title="Games" description="Your own lists, read straight from Roblox.">
            {#if games.length === 0}
              <div class="py-6 text-center text-xs text-ivory-500">Nothing in this list yet.</div>
            {:else}
              <ul class="grid gap-2 py-1 sm:grid-cols-2">
                {#each games as game (game.universeId)}
                  <li class="surface-inset flex items-center gap-2.5 p-2">
                    {#if game.thumbnailUrl}
                      <img
                        src={game.thumbnailUrl}
                        alt=""
                        class="h-10 w-14 rounded object-cover"
                        loading="lazy"
                      />
                    {:else}
                      <span
                        class="grid h-10 w-14 place-items-center rounded bg-ink-700 text-ivory-500"
                      >
                        <Icon name="gamepad" size={14} />
                      </span>
                    {/if}

                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-xs text-ivory-200">{game.name}</span>
                      <span class="block truncate text-2xs text-ivory-500">
                        {game.creatorName ?? 'Unknown creator'}
                        {#if game.playerCount !== null}· {game.playerCount.toLocaleString()} playing{/if}
                      </span>
                    </span>

                    <button
                      type="button"
                      class="btn-secondary px-2 py-1 text-2xs"
                      onclick={() => void join(game.placeId)}
                    >
                      Play
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </Section>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Join anything by name; results launch as the selected account. -->
  <div class="h-5"></div>

  <Section
    title="Find a game"
    description="Search Roblox and launch straight into the result as the selected account."
  >
    <div class="flex items-center gap-2 py-3">
      <input
        class="field flex-1 py-1.5 text-xs"
        placeholder="Game name or place id"
        bind:value={searchQuery}
        onkeydown={(event) => {
          if (event.key === 'Enter') void runSearch()
        }}
      />
      <button
        type="button"
        class="btn-secondary gap-1.5"
        disabled={busyPanel}
        onclick={() => void runSearch()}
      >
        <Icon name="search" size={14} />
        Search
      </button>
      {#if /^\d{5,}$/.test(searchQuery.trim())}
        <button
          type="button"
          class="btn-primary gap-1.5"
          onclick={() => void join(Number.parseInt(searchQuery.trim(), 10))}
        >
          <Icon name="play" size={14} />
          Join place
        </button>
      {/if}
    </div>

    {#if searchResults.length > 0}
      <ul class="grid gap-2 border-t border-ivory-200/8 py-3 sm:grid-cols-2">
        {#each searchResults as game (game.universeId)}
          <li class="surface-inset flex items-center gap-2.5 p-2">
            {#if game.thumbnailUrl}
              <img
                src={game.thumbnailUrl}
                alt=""
                class="h-10 w-14 rounded object-cover"
                loading="lazy"
              />
            {:else}
              <span class="grid h-10 w-14 place-items-center rounded bg-ink-700 text-ivory-500">
                <Icon name="gamepad" size={14} />
              </span>
            {/if}

            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs text-ivory-200">{game.name}</span>
              <span class="block truncate text-2xs text-ivory-500">
                {game.creatorName ?? 'Unknown creator'}
              </span>
            </span>

            <button
              type="button"
              class="btn-secondary px-2 py-1 text-2xs"
              onclick={() => void join(game.placeId)}
            >
              Play
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </Section>
{/if}

<!-- ------------------------------------------------------------- Dialogs -->

{#if cookieDialog}
  <Dialog
    title="Add an account from a cookie"
    description="Paste the .ROBLOSECURITY value, or the whole cookie header copied from your browser."
    onclose={() => (cookieDialog = false)}
  >
    <textarea
      class="field h-24 w-full resize-none py-2 font-mono text-2xs"
      placeholder="_|WARNING:-DO-NOT-SHARE-THIS..."
      bind:value={cookieInput}
      spellcheck="false"
    ></textarea>

    <input
      class="field mt-2 w-full py-1.5 text-xs"
      placeholder="Note (optional) — e.g. which account this is"
      bind:value={cookieNotes}
    />

    <p class="mt-2 text-2xs leading-relaxed text-ivory-500">
      The cookie is validated against Roblox, then sealed with your OS credential store. It is never
      written to disk in plain text and never shown again.
    </p>

    <div class="mt-4 flex justify-end gap-2">
      <button type="button" class="btn-ghost" onclick={() => (cookieDialog = false)}>Cancel</button>
      <button
        type="button"
        class="btn-primary"
        disabled={cookieInput.trim().length < 20 || accounts.busy === 'new'}
        onclick={() => void submitCookie()}
      >
        Add account
      </button>
    </div>
  </Dialog>
{/if}

{#if confirmRemove}
  <Dialog
    title={`Remove ${confirmRemove.displayName}?`}
    description="The encrypted cookie and every setting tied to this account are deleted."
    onclose={() => (confirmRemove = null)}
  >
    <p class="text-xs leading-relaxed text-ivory-400">
      You can add it again at any time by signing in. Anything already written to disk — notes,
      playtime, favourites — is not touched.
    </p>

    <div class="mt-4 flex justify-end gap-2">
      <button type="button" class="btn-ghost" onclick={() => (confirmRemove = null)}>Keep it</button
      >
      <button
        type="button"
        class="btn-danger"
        onclick={() => {
          const target = confirmRemove
          confirmRemove = null
          if (target) void removeAccount(target.id)
        }}
      >
        Remove account
      </button>
    </div>
  </Dialog>
{/if}
