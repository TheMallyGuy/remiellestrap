import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'crypto'
import { basename } from 'path'
import type {
  AccountAddRequest,
  AccountBrowserLoginRequest,
  AccountFriend,
  AccountPresence,
  AccountProfile,
  AccountState,
  GameListRequest,
  GameSearchRequest,
  GameSummary,
  JoinAsRequest,
  OperationResult,
  RobloxAccount
} from '@shared/models'
import { DEFAULT_ACCOUNTS, type AccountRecord, type AccountsFile } from '@shared/state'
import { createLogger } from '../utils/logger'
import { paths } from '../utils/paths'
import { ensureDir, readJson, writeJson } from '../utils/fs'
import { shortId } from '../utils/hash'
import { buildTicketUri, parseLaunchUri } from '../utils/uri'
import { emit } from './events'
import { getSettings, saveSettings } from './settingsStore'
import {
  deleteSecret,
  hasSecret,
  loadSecret,
  pruneSecrets,
  saveSecret,
  secureStorageStatus
} from './credentials'
import * as api from './robloxApi'

/**
 * Account manager.
 *
 * A stored account is two things: metadata in Accounts.json, and its cookie in
 * the encrypted credential store (see credentials.ts — the cookie is never
 * written in the clear). Cookies are held in memory only for as long as the
 * process runs, so switching accounts does not repeatedly hit the keychain.
 *
 * Presence is not persisted: it is runtime information that goes stale within
 * seconds, so it lives in `presenceCache` and is merged into the records the
 * UI sees.
 */

const logger = createLogger('Accounts')

const LOGIN_PARTITION = 'persist:remielle-account-login'
const PROFILE_TTL_MS = 5 * 60_000

let file: AccountsFile | null = null
const cookies = new Map<string, string>()
const presenceCache = new Map<number, api.PresenceEntry>()
const profileCache = new Map<
  string,
  { at: number; profile: AccountProfile; friends: AccountFriend[] | null }
>()

let backgroundTimer: NodeJS.Timeout | null = null
let backgroundRefreshing = false

/* ------------------------------------------------------------- Persistence */

async function load(): Promise<AccountsFile> {
  if (file) return file
  await ensureDir(paths.root)

  const raw = await readJson<Partial<AccountsFile>>(paths.accountsFile, {})
  const accounts = Array.isArray(raw.accounts)
    ? raw.accounts
        .filter((entry): entry is AccountRecord => Boolean(entry) && typeof entry.id === 'string')
        .slice(0, 40)
    : []

  const activeAccountId =
    typeof raw.activeAccountId === 'string' && accounts.some((a) => a.id === raw.activeAccountId)
      ? raw.activeAccountId
      : (accounts[0]?.id ?? null)

  file = {
    accounts,
    activeAccountId,
    encrypted: raw.encrypted !== false
  }

  // Drop credential files for accounts that no longer exist.
  await pruneSecrets(accounts.map((account) => account.id)).catch(() => 0)
  return file
}

async function persist(patch: Partial<AccountsFile>): Promise<AccountsFile> {
  const current = await load()
  file = { ...current, ...patch }
  await yieldWrite(file)
  emit('accounts:changed', await state())
  return file
}

/**
 * Accounts.json is written through the same temp-file-then-rename helper as the
 * rest of the app; this wrapper only exists so failures are logged once.
 */
async function yieldWrite(value: AccountsFile): Promise<void> {
  try {
    await writeJson(paths.accountsFile, value)
  } catch (error) {
    logger.error(`Could not write Accounts.json: ${String(error)}`)
  }
}

/* ------------------------------------------------------------------ Cookie */

/** Pulls the cookie value out of whatever the user pasted. */
export function normalizeCookie(input: string): string | null {
  const trimmed = input.trim().replace(/^["']|["']$/g, '')
  if (trimmed.length === 0) return null

  // A pasted "document.cookie" line, e.g. ".ROBLOSECURITY=WARNING:-DO-NOT-...;"
  const assignment = trimmed.match(/\.?ROBLOSECURITY=([^;]+)/i)
  const value = (assignment ? assignment[1] : trimmed).trim()

  // Roblox cookies always start with a warning banner and are long.
  if (value.length < 100) return null
  if (!/^(_\|)?WARNING/i.test(value) && value.length < 200) return null
  if (/[\s;]/.test(value)) return null

  return value
}

async function cookieFor(accountId: string): Promise<string | null> {
  const cached = cookies.get(accountId)
  if (cached) return cached

  const stored = await loadSecret(accountId)
  if (stored) cookies.set(accountId, stored)
  return stored
}

/** The cookie for the currently selected account, if there is one. */
export async function activeCookie(): Promise<string | null> {
  const store = await load()
  if (!store.activeAccountId) return null
  return cookieFor(store.activeAccountId)
}

export async function activeAccountId(): Promise<string | null> {
  return (await load()).activeAccountId
}

export async function activeAccount(): Promise<RobloxAccount | null> {
  const store = await load()
  const record = store.accounts.find((account) => account.id === store.activeAccountId)
  return record ? decorate(record) : null
}

/* ------------------------------------------------------------------- State */

function decorate(record: AccountRecord): RobloxAccount {
  const presence = presenceCache.get(record.userId)
  const store = file
  return {
    id: record.id,
    userId: record.userId,
    username: record.username,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    description: record.description,
    created: record.created,
    isPremium: record.isPremium,
    presence: presence?.presence ?? ('unknown' as AccountPresence),
    lastLocation: presence?.lastLocation ?? null,
    friendsCount: record.friendsCount,
    followersCount: record.followersCount,
    followingCount: record.followingCount,
    lastUsed: record.lastUsed,
    addedAt: record.addedAt,
    notes: record.notes,
    isActive: store?.activeAccountId === record.id,
    valid: record.valid,
    statusMessage: record.statusMessage
  }
}

export async function state(): Promise<AccountState> {
  const store = await load()
  const status = secureStorageStatus()
  return {
    secureStorage: status.available,
    secureStorageReason: status.reason,
    accounts: store.accounts.map(decorate),
    activeAccountId: store.activeAccountId,
    backgroundRefreshing
  }
}

export async function listAccounts(): Promise<RobloxAccount[]> {
  return (await state()).accounts
}

/* ------------------------------------------------------------------- Add */

async function recordFromUser(
  user: api.AuthenticatedUser,
  extras: Partial<AccountRecord> = {}
): Promise<AccountRecord> {
  const [profile, avatar, friends, followers, following] = await Promise.all([
    api.userProfile(user.id, null),
    api.avatarHeadshots([user.id]),
    api.friendCount(user.id, null, 'friends'),
    api.friendCount(user.id, null, 'followers'),
    api.friendCount(user.id, null, 'followings')
  ])

  return {
    id: extras.id ?? shortId(`${user.id}:${randomUUID()}`, 12),
    userId: user.id,
    username: user.name,
    displayName: profile?.displayName ?? user.displayName,
    avatarUrl: avatar[user.id] ?? null,
    description: profile?.description ?? null,
    created: profile?.created ?? null,
    isPremium: false,
    friendsCount: friends,
    followersCount: followers,
    followingCount: following,
    addedAt: Date.now(),
    lastUsed: Date.now(),
    lastVerifiedAt: Date.now(),
    valid: true,
    statusMessage: null,
    notes: '',
    ...extras
  }
}

/**
 * Adds (or refreshes) an account from a pasted cookie. The account is
 * validated against Roblox before anything is written, so a typo never leaves
 * a broken entry behind.
 */
export async function addFromCookie(
  request: AccountAddRequest
): Promise<OperationResult<AccountState>> {
  const cookie = normalizeCookie(request.cookie)
  if (!cookie) {
    return {
      ok: false,
      error:
        'That does not look like a .ROBLOSECURITY cookie. Copy the whole value, including the WARNING prefix.'
    }
  }

  try {
    const user = await api.authenticatedUser(cookie)
    const store = await load()
    const existing = store.accounts.find((account) => account.userId === user.id)

    if (!existing && store.accounts.length >= 40) {
      return { ok: false, error: 'Account limit reached (40). Remove one first.' }
    }

    const record = await recordFromUser(user, {
      id: existing?.id,
      addedAt: existing?.addedAt ?? Date.now(),
      notes: request.notes ?? existing?.notes ?? ''
    })

    const status = secureStorageStatus()
    if (status.available) {
      await saveSecret(record.id, cookie)
    } else {
      record.valid = false
      record.statusMessage = status.reason
      logger.warn('Storing the account for this session only: no OS credential store')
    }

    cookies.set(record.id, cookie)

    const accounts = existing
      ? store.accounts.map((account) => (account.id === record.id ? record : account))
      : [...store.accounts, record]

    await persist({ accounts, activeAccountId: store.activeAccountId ?? record.id })
    logger.info(`Added account ${record.username} (${record.userId})`)

    void refresh({ id: record.id, profile: true }).catch(() => undefined)
    return { ok: true, data: await state() }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(`Adding an account failed: ${message}`)
    return { ok: false, error: message }
  }
}

/**
 * Opens a real Roblox sign-in window in an isolated session and waits for the
 * `.ROBLOSECURITY` cookie to appear. Nothing is scraped from the page: the
 * cookie is read straight out of the session jar, which is why this works for
 * every login method Roblox offers (password, passkey, QR, parental controls).
 */
export async function browserLogin(
  request: AccountBrowserLoginRequest = {}
): Promise<OperationResult<AccountState>> {
  const timeoutMs = Math.min(Math.max((request.timeoutSeconds ?? 300) * 1000, 30_000), 900_000)

  return new Promise((resolve) => {
    let settled = false
    const target = session.fromPartition(LOGIN_PARTITION)

    const window = new BrowserWindow({
      width: 520,
      height: 720,
      minWidth: 420,
      minHeight: 560,
      title: 'Sign in to Roblox — RemielleStrap',
      autoHideMenuBar: true,
      backgroundColor: '#0a0a0b',
      webPreferences: {
        partition: LOGIN_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        spellcheck: false
      }
    })

    const cleanup = (): void => {
      target.cookies.removeListener('changed', onCookieChanged)
      clearTimeout(timer)
      if (!window.isDestroyed()) window.destroy()
    }

    const finish = async (result: OperationResult<AccountState>): Promise<void> => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    const onCookieChanged = (
      _event: Electron.Event,
      cookie: Electron.Cookie,
      cause: string
    ): void => {
      if (cookie.name !== '.ROBLOSECURITY') return
      if (cause === 'removed' || cookie.value.length < 100) return
      if (!/roblox\.com$/i.test((cookie.domain ?? '').replace(/^\./, ''))) return

      void (async () => {
        const result = await addFromCookie({ cookie: cookie.value })
        if (result.ok) {
          logger.info('Browser sign-in completed')
          await finish(result)
        } else {
          await finish(result)
        }
      })()
    }

    const timer = setTimeout(() => {
      void finish({ ok: false, error: 'Sign-in timed out. Nothing was saved.' })
    }, timeoutMs)

    target.cookies.on('changed', onCookieChanged)
    window.on('closed', () => {
      void finish({ ok: false, error: 'Sign-in cancelled' })
    })

    // `login` lands on the sign-in form; `quick` opens the page where a code
    // from a phone or another browser can be typed in. Both end the same way:
    // the cookie appears in this session's jar and is picked up above.
    const url =
      request.mode === 'quick'
        ? 'https://www.roblox.com/login/quick-login'
        : 'https://www.roblox.com/login'

    void window.loadURL(url)
  })
}

/** Replaces the cookie of an existing account (used when one expires). */
export async function reauthenticate(id: string): Promise<OperationResult<AccountState>> {
  const store = await load()
  const existing = store.accounts.find((account) => account.id === id)
  if (!existing) return { ok: false, error: 'That account is no longer stored' }

  const result = await browserLogin({})
  if (!result.ok) return result

  const next = result.data
  const replacement = next?.accounts.find((account) => account.userId === existing.userId)
  if (replacement && replacement.id !== existing.id) {
    // Logging in again mints a new id; keep one entry, preferring the old one's
    // metadata so custom notes and add-time are preserved.
    const merged: AccountRecord = {
      ...(await toRecord(replacement)),
      id: existing.id,
      notes: existing.notes,
      addedAt: existing.addedAt
    }

    const cookie = (await cookieFor(replacement.id)) ?? null
    if (cookie) {
      await saveSecret(existing.id, cookie)
      cookies.set(existing.id, cookie)
    }
    await deleteSecret(replacement.id)
    cookies.delete(replacement.id)

    const accounts = store.accounts
      .filter((account) => account.id !== replacement.id)
      .map((account) => (account.id === existing.id ? merged : account))

    await persist({ accounts })
  }

  return { ok: true, data: await state() }
}

async function toRecord(account: RobloxAccount): Promise<AccountRecord> {
  return {
    id: account.id,
    userId: account.userId,
    username: account.username,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    description: account.description,
    created: account.created,
    isPremium: account.isPremium,
    friendsCount: account.friendsCount,
    followersCount: account.followersCount,
    followingCount: account.followingCount,
    addedAt: account.addedAt,
    lastUsed: account.lastUsed,
    lastVerifiedAt: Date.now(),
    valid: account.valid,
    statusMessage: account.statusMessage,
    notes: account.notes
  }
}

/* ------------------------------------------------------- Remove / activate */

export async function remove(id: string): Promise<OperationResult<AccountState>> {
  const store = await load()
  if (!store.accounts.some((account) => account.id === id)) {
    return { ok: false, error: 'That account is no longer stored' }
  }

  await deleteSecret(id)
  cookies.delete(id)
  profileCache.delete(id)

  const accounts = store.accounts.filter((account) => account.id !== id)
  const activeAccountId =
    store.activeAccountId === id ? (accounts[0]?.id ?? null) : store.activeAccountId

  await persist({ accounts, activeAccountId })

  if (!activeAccountId) await saveSettings({ activeAccountId: null })
  logger.info(`Removed account ${id}`)
  return { ok: true, data: await state() }
}

export async function setActive(id: string | null): Promise<AccountState> {
  const store = await load()

  if (id !== null && !store.accounts.some((account) => account.id === id)) {
    throw new Error('That account is no longer stored')
  }

  const accounts = store.accounts.map((account) => ({
    ...account,
    lastUsed: account.id === id ? Date.now() : account.lastUsed
  }))

  await persist({ accounts, activeAccountId: id })
  await saveSettings({ activeAccountId: id })
  logger.info(id ? `Active account is now ${id}` : 'Active account cleared')

  if (id) void refresh({ id, profile: true }).catch(() => undefined)
  return state()
}

export async function updateNotes(id: string, notes: string): Promise<AccountState> {
  const store = await load()
  // eslint-disable-next-line no-control-regex -- control characters are what we strip
  const trimmed = notes.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500)
  const accounts = store.accounts.map((account) =>
    account.id === id ? { ...account, notes: trimmed } : account
  )
  await persist({ accounts })
  return state()
}

/* -------------------------------------------------------------- Refreshing */

/**
 * Revalidates stored cookies and refreshes presence.
 *
 * A cookie that Roblox rejects is marked invalid rather than deleted, so the
 * user can re-authenticate it without losing their notes and history; the
 * account is only auto-removed when the *user* asks for the cleanup action.
 */
export async function refresh(
  options: { id?: string; profile?: boolean } = {}
): Promise<AccountState> {
  const store = await load()
  const targets = options.id
    ? store.accounts.filter((account) => account.id === options.id)
    : store.accounts

  if (targets.length === 0) return state()

  const updates = new Map<string, Partial<AccountRecord>>()

  await Promise.all(
    targets.map(async (account) => {
      const cookie = await cookieFor(account.id)

      if (!cookie) {
        updates.set(account.id, {
          valid: false,
          statusMessage: secureStorageStatus().available
            ? 'The stored cookie is missing. Sign in again to fix this.'
            : (secureStorageStatus().reason ?? 'No credential store available.')
        })
        return
      }

      try {
        await api.authenticatedUser(cookie)
        updates.set(account.id, { valid: true, statusMessage: null, lastVerifiedAt: Date.now() })

        const [presence, avatar] = await Promise.all([
          api.userPresence([account.userId], cookie),
          account.avatarUrl ? Promise.resolve({}) : api.avatarHeadshots([account.userId])
        ])

        const state = presence[account.userId]
        if (state) presenceCache.set(account.userId, state)

        const avatarUrl = account.avatarUrl ?? avatar[account.userId] ?? null
        if (avatarUrl !== account.avatarUrl)
          updates.set(account.id, { ...updates.get(account.id), avatarUrl })

        if (options.profile) {
          const [profile, friends, followers, following] = await Promise.all([
            api.userProfile(account.userId, cookie),
            api.friendCount(account.userId, cookie, 'friends'),
            api.friendCount(account.userId, cookie, 'followers'),
            api.friendCount(account.userId, cookie, 'followings')
          ])

          updates.set(account.id, {
            ...updates.get(account.id),
            displayName: profile?.displayName ?? account.displayName,
            description: profile?.description ?? account.description,
            created: profile?.created ?? account.created,
            friendsCount: friends,
            followersCount: followers,
            followingCount: following
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const expired = /401|403|not recognise/i.test(message)
        updates.set(account.id, {
          valid: false,
          statusMessage: expired ? 'This session expired. Sign in again to restore it.' : message
        })
      }
    })
  )

  if (updates.size > 0) {
    const accounts = store.accounts.map((account) => {
      const patch = updates.get(account.id)
      return patch ? { ...account, ...patch } : account
    })
    await persist({ accounts })
  } else {
    emit('accounts:changed', await state())
  }

  return state()
}

/** Clears out accounts whose cookies Roblox has definitively rejected. */
export async function removeInvalid(): Promise<number> {
  const store = await load()
  const invalid = store.accounts.filter((account) => !account.valid)
  for (const account of invalid) {
    await deleteSecret(account.id)
    cookies.delete(account.id)
  }

  if (invalid.length > 0) {
    const accounts = store.accounts.filter((account) => account.valid)
    const activeAccountId =
      store.activeAccountId && accounts.some((a) => a.id === store.activeAccountId)
        ? store.activeAccountId
        : (accounts[0]?.id ?? null)
    await persist({ accounts, activeAccountId })
    logger.info(`Removed ${invalid.length} invalid account(s)`)
  }

  return invalid.length
}

/* ---------------------------------------------------- Background refreshes */

/** Starts the periodic presence/profile refresh, honouring the settings. */
export function startBackgroundRefresh(): void {
  stopBackgroundRefresh()

  const settings = getSettings()
  if (!settings.accountBackgroundRefresh) return

  const interval = Math.min(Math.max(settings.accountRefreshMinutes, 1), 60) * 60_000
  backgroundTimer = setInterval(() => {
    void (async () => {
      if (backgroundRefreshing) return
      const store = await load()
      if (store.accounts.length === 0) return

      backgroundRefreshing = true
      try {
        await refresh({ profile: false })
      } catch (error) {
        logger.warn(`Background account refresh failed: ${String(error)}`)
      } finally {
        backgroundRefreshing = false
      }
    })()
  }, interval)

  logger.info(`Account background refresh every ${interval / 60_000} minute(s)`)
}

export function stopBackgroundRefresh(): void {
  if (backgroundTimer) clearInterval(backgroundTimer)
  backgroundTimer = null
}

/** Applies the settings toggle at runtime. */
export function syncBackgroundRefresh(): void {
  if (backgroundTimer) stopBackgroundRefresh()
  startBackgroundRefresh()
}

/* ----------------------------------------------------------------- Profiles */

export async function profile(
  accountId: string,
  refreshProfile = false
): Promise<OperationResult<AccountProfile>> {
  const store = await load()
  const record = store.accounts.find((account) => account.id === accountId)
  if (!record) return { ok: false, error: 'That account is no longer stored' }

  const cached = profileCache.get(accountId)
  if (!refreshProfile && cached && Date.now() - cached.at < PROFILE_TTL_MS) {
    return { ok: true, data: cached.profile }
  }

  const cookie = await cookieFor(accountId)
  const [details, avatar, presence, friends, followers, following] = await Promise.all([
    api.userProfile(record.userId, cookie),
    record.avatarUrl ? Promise.resolve({}) : api.avatarHeadshots([record.userId]),
    api.userPresence([record.userId], cookie),
    api.friendCount(record.userId, cookie, 'friends'),
    api.friendCount(record.userId, cookie, 'followers'),
    api.friendCount(record.userId, cookie, 'followings')
  ])

  const state = presence[record.userId]
  if (state) presenceCache.set(record.userId, state)

  const result: AccountProfile = {
    accountId,
    userId: record.userId,
    username: details?.name ?? record.username,
    displayName: details?.displayName ?? record.displayName,
    description: details?.description ?? record.description,
    avatarUrl: avatar[record.userId] ?? record.avatarUrl,
    created: details?.created ?? record.created,
    isPremium: record.isPremium,
    presence: state?.presence ?? 'unknown',
    lastOnline: state?.lastOnline ?? null,
    friendsCount: friends ?? record.friendsCount,
    followersCount: followers ?? record.followersCount,
    followingCount: following ?? record.followingCount,
    fetchedAt: Date.now()
  }

  profileCache.set(accountId, { at: Date.now(), profile: result, friends: cached?.friends ?? null })

  // Keep the stored record in step with what we just learned.
  const accounts = store.accounts.map((account) =>
    account.id === accountId
      ? {
          ...account,
          displayName: result.displayName,
          description: result.description,
          avatarUrl: result.avatarUrl,
          created: result.created,
          friendsCount: result.friendsCount,
          followersCount: result.followersCount,
          followingCount: result.followingCount
        }
      : account
  )
  await persist({ accounts })

  return { ok: true, data: result }
}

export async function friends(
  accountId: string,
  refreshFriends = false
): Promise<OperationResult<AccountFriend[]>> {
  const store = await load()
  const record = store.accounts.find((account) => account.id === accountId)
  if (!record) return { ok: false, error: 'That account is no longer stored' }

  const cached = profileCache.get(accountId)
  if (!refreshFriends && cached?.friends) return { ok: true, data: cached.friends }

  const cookie = await cookieFor(accountId)
  const list = await api.friendsList(record.userId, cookie)
  if (list.length === 0) {
    return {
      ok: false,
      error:
        'No friends came back. The account may have its friends list hidden, or Roblox may be rate limiting.'
    }
  }

  profileCache.set(accountId, {
    at: cached?.at ?? Date.now(),
    profile:
      cached?.profile ??
      ({
        accountId,
        userId: record.userId,
        username: record.username,
        displayName: record.displayName,
        description: record.description,
        avatarUrl: record.avatarUrl,
        created: record.created,
        isPremium: record.isPremium,
        presence: presenceCache.get(record.userId)?.presence ?? 'unknown',
        lastOnline: null,
        friendsCount: record.friendsCount,
        followersCount: record.followersCount,
        followingCount: record.followingCount,
        fetchedAt: Date.now()
      } satisfies AccountProfile),
    friends: list
  })

  return { ok: true, data: list }
}

/* ------------------------------------------------------------------- Games */

export async function searchGames(
  request: GameSearchRequest
): Promise<OperationResult<GameSummary[]>> {
  const limit = Math.min(Math.max(request.limit ?? 20, 1), 50)
  const games = await api.searchGames(request.query, limit)
  if (games.length === 0) {
    return {
      ok: false,
      error: `Nothing matched “${request.query}”. Roblox search can also rate limit — try again in a moment.`
    }
  }
  return { ok: true, data: games }
}

export async function gameDetailsByRef(request: {
  universeId?: number
  placeId?: number
}): Promise<OperationResult<GameSummary>> {
  let universeId = request.universeId ?? null

  if (!universeId && request.placeId) {
    universeId = await api.universeIdForPlace(request.placeId)
  }

  if (!universeId) return { ok: false, error: 'That experience could not be found' }

  const details = await api.gameDetails([universeId])
  if (details.length === 0) return { ok: false, error: 'That experience could not be found' }
  return { ok: true, data: details[0] }
}

export async function gameList(request: GameListRequest): Promise<OperationResult<GameSummary[]>> {
  const store = await load()
  const record = store.accounts.find((account) => account.id === request.accountId)
  if (!record) return { ok: false, error: 'Select an account first' }

  const cookie = await cookieFor(request.accountId)
  if (!cookie) {
    return { ok: false, error: 'That account has no usable credential. Sign in again.' }
  }

  const limit = Math.min(Math.max(request.limit ?? 24, 1), 50)

  if (request.kind === 'continue-playing') {
    const games = await api.recentlyPlayed(record.userId, cookie, limit)
    return games.length > 0
      ? { ok: true, data: games }
      : { ok: false, error: 'Roblox did not return a continue-playing list for this account' }
  }

  if (request.kind === 'favorites') {
    const games = await api.favoriteGames(record.userId, cookie, limit)
    return games.length > 0
      ? { ok: true, data: games }
      : { ok: false, error: 'No favourites came back for this account' }
  }

  // Recommendations: base them on the most recent game, then fall back to the
  // account's own play history so the section is never simply empty.
  const recent = await api.recentlyPlayed(record.userId, cookie, 5)
  for (const seed of recent) {
    const games = await api.recommendations(seed.universeId, cookie, limit)
    if (games.length > 0) return { ok: true, data: games }
  }

  if (recent.length > 0) {
    return { ok: true, data: recent.slice(0, limit) }
  }

  return { ok: false, error: 'Not enough history yet to recommend anything' }
}

/* -------------------------------------------------------------------- Join */

export interface ResolvedJoin {
  uri: string
  accountId: string | null
  accountName: string | null
}

/**
 * Builds a launch URI for a place, optionally authenticated as a stored
 * account.
 *
 * With an account we ask Roblox's place launcher for a join script — the same
 * call the website makes when you press Play — and hand the ticket it returns
 * to the client in the URI's `gameinfo` field. Without one, the URI is the
 * plain public form the client handles on its own.
 */
export async function resolveJoinUri(request: JoinAsRequest): Promise<ResolvedJoin> {
  const placeId =
    request.placeId ?? (request.universeId ? await placeIdForUniverse(request.universeId) : null)
  if (!placeId) throw new Error('A place id is required to join')

  const settings = getSettings()
  const accountId = request.accountId ?? settings.activeAccountId ?? null

  if (!accountId || settings.accountLaunchStrategy === 'plain') {
    return {
      uri: buildTicketUri(null, placeId, request.serverId ?? null),
      accountId: null,
      accountName: null
    }
  }

  const store = await load()
  const record = store.accounts.find((account) => account.id === accountId)
  if (!record) throw new Error('The selected account is no longer stored')

  const cookie = await cookieFor(accountId)
  if (!cookie) throw new Error('That account has no usable credential. Sign in again.')

  const ticket = await api.joinTicket(cookie, placeId, request.serverId ?? null)

  return {
    uri: buildTicketUri(
      ticket.ticket,
      ticket.placeId ?? placeId,
      ticket.jobId,
      request.accessCode ?? null
    ),
    accountId,
    accountName: record.username
  }
}

async function placeIdForUniverse(universeId: number): Promise<string | null> {
  const details = await api.gameDetails([universeId])
  const placeId = details[0]?.placeId
  return placeId ? String(placeId) : null
}

/**
 * Resolves a launch request into a URI that authenticates as an account.
 *
 * Two shapes are handled:
 *
 *  * no URI at all — the client is asked to open its own app UI, signed in;
 *  * a `roblox:`/`roblox-player:` URI carrying a place id — the join ticket for
 *    that place is requested for the account, and a fresh URI is built around
 *    it so the client lands in the right server as the right user.
 *
 * Returns null when the URI cannot be rewritten, in which case the caller falls
 * back to launching it untouched rather than failing the launch.
 */
export async function resolveLaunchUri(request: {
  uri: string | null
  accountId: string
}): Promise<string | null> {
  const store = await load()
  const record = store.accounts.find((account) => account.id === request.accountId)
  if (!record) return null

  const cookie = await cookieFor(request.accountId)
  if (!cookie) return null

  if (!request.uri) {
    const ticket = await api.authenticationTicket(cookie)
    return buildTicketUri(ticket, null)
  }

  const info = parseLaunchUri(request.uri)
  if (!info?.placeId) {
    const ticket = await api.authenticationTicket(cookie)
    return buildTicketUri(ticket, null)
  }

  const ticket = await api.joinTicket(cookie, info.placeId, info.gameInstanceId ?? null)

  return buildTicketUri(
    ticket.ticket,
    info.placeId,
    ticket.jobId ?? info.gameInstanceId ?? null,
    info.linkCode ?? null
  )
}

/** Records that an account was used, so the UI can order by recency. */
export async function markUsed(accountId: string): Promise<void> {
  const store = await load()
  const accounts = store.accounts.map((account) =>
    account.id === accountId ? { ...account, lastUsed: Date.now() } : account
  )
  await persist({ accounts })
}

/** True when the account exists and has a readable credential. */
export async function isUsable(accountId: string): Promise<boolean> {
  return hasSecret(accountId)
}

/** Diagnostics for the About page: how many credential files we hold. */
export async function credentialSummary(): Promise<{ files: number; directory: string }> {
  const store = await load()
  return { files: store.accounts.length, directory: paths.credentials }
}

/* ------------------------------------------------------------------ Login */

/**
 * Convenience for the CLI-ish flows (deep links, tray quick-join): returns the
 * account a launch should use, if the caller did not name one.
 */
export async function effectiveAccountId(explicit?: string | null): Promise<string | null> {
  if (explicit && (await hasSecret(explicit))) return explicit
  return activeAccountId()
}

/** Filename-safe label for a shortcut or backup entry. */
export function accountLabel(account: RobloxAccount): string {
  return basename(account.displayName || account.username).slice(0, 40)
}

/** Exposed for tests: forget everything held in memory. */
export function resetForTests(): void {
  file = null
  cookies.clear()
  presenceCache.clear()
  profileCache.clear()
}

export { DEFAULT_ACCOUNTS }

/* ------------------------------------------------------------- Backup hooks */

/** The raw cookie for an account, for the encrypted backup section only. */
export async function cookieForBackup(accountId: string): Promise<string | null> {
  return cookieFor(accountId)
}

/**
 * Restores accounts from a backup.
 *
 * Entries are matched to existing accounts by user id so importing a backup on
 * a machine that already has the account updates it instead of duplicating it.
 * Cookies are validated before anything is written, and an entry that Roblox
 * rejects is skipped rather than stored broken.
 */
export async function importEntries(
  entries: { userId: number; username?: string; notes?: string; cookie: string | null }[]
): Promise<number> {
  const store = await load()
  let imported = 0

  for (const entry of entries) {
    if (typeof entry.userId !== 'number' || !Number.isFinite(entry.userId)) continue
    if (!entry.cookie) continue

    const cookie = normalizeCookie(entry.cookie)
    if (!cookie) continue

    try {
      const user = await api.authenticatedUser(cookie)
      const existing = store.accounts.find((account) => account.userId === user.id)
      const record = await recordFromUser(user, {
        id: existing?.id,
        addedAt: existing?.addedAt ?? Date.now(),
        notes: entry.notes ?? existing?.notes ?? ''
      })

      const status = secureStorageStatus()
      if (status.available) await saveSecret(record.id, cookie)
      else record.statusMessage = status.reason

      cookies.set(record.id, cookie)

      const accounts = existing
        ? store.accounts.map((account) => (account.id === record.id ? record : account))
        : [...store.accounts, record]

      await persist({ accounts, activeAccountId: store.activeAccountId ?? record.id })
      imported += 1
    } catch (error) {
      logger.warn(`Skipping account ${entry.username ?? entry.userId}: ${String(error)}`)
    }
  }

  if (imported > 0) emit('accounts:changed', await state())
  logger.info(`Imported ${imported} account(s) from a backup`)
  return imported
}
