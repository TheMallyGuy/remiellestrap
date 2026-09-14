import type { AccountState, RobloxAccount } from '@shared/models'
import { api, errorMessage } from '../ipc'
import { pushToast } from './toasts.svelte'

/**
 * The account mirror.
 *
 * The main process owns the accounts file and the encrypted cookies; this store
 * only holds the view of it that the UI needs, plus the one flag the UI must
 * never guess at — whether the OS credential store is available, because
 * without it nothing can be saved between runs.
 */

let snapshot = $state<AccountState | null>(null)
let loading = $state(true)
/** Id of the account an action is currently running against. */
let busy = $state<string | null>(null)

export const accounts = {
  get value(): AccountState | null {
    return snapshot
  },
  get list(): RobloxAccount[] {
    return snapshot?.accounts ?? []
  },
  get active(): RobloxAccount | null {
    return snapshot?.accounts.find((account) => account.isActive) ?? null
  },
  get loading(): boolean {
    return loading
  },
  get busy(): string | null {
    return busy
  },
  get secureStorage(): boolean {
    return snapshot?.secureStorage ?? true
  },
  get secureStorageReason(): string | null {
    return snapshot?.secureStorageReason ?? null
  }
}

/** Folds in a state object from either a call or an `accounts:changed` event. */
export function applyAccounts(next: AccountState | null): void {
  if (next) snapshot = next
}

export async function loadAccounts(): Promise<void> {
  try {
    snapshot = await api.accounts.get()
  } catch (error) {
    pushToast({ kind: 'error', title: 'Accounts could not be loaded', message: errorMessage(error) })
  } finally {
    loading = false
  }
}

/** Shared wrapper so every action reports the same way. */
async function run<T>(
  id: string | null,
  action: () => Promise<T>,
  onDone: (result: T) => void,
  failure: string
): Promise<void> {
  busy = id
  try {
    onDone(await action())
  } catch (error) {
    pushToast({ kind: 'error', title: failure, message: errorMessage(error) })
  } finally {
    busy = null
  }
}

export async function setActiveAccount(id: string | null): Promise<void> {
  await run(id, () => api.accounts.setActive(id), applyAccounts, 'Could not switch accounts')
}

export async function addFromCookie(cookie: string, notes?: string): Promise<boolean> {
  let ok = false

  await run(
    'new',
    () => api.accounts.addFromCookie({ cookie, notes }),
    (result) => {
      if (result.ok) {
        applyAccounts(result.data ?? null)
        pushToast({ kind: 'success', title: 'Account added' })
        ok = true
      } else {
        pushToast({ kind: 'warning', title: 'That cookie was rejected', message: result.error })
      }
    },
    'Could not add the account'
  )

  return ok
}

export async function browserLogin(mode: 'login' | 'quick' = 'login'): Promise<void> {
  await run(
    'new',
    () => api.accounts.browserLogin({ mode }),
    (result) => {
      if (result.ok) {
        applyAccounts(result.data ?? null)
        pushToast({ kind: 'success', title: 'Signed in' })
      } else if (result.error && !/cancel/i.test(result.error)) {
        pushToast({ kind: 'warning', title: 'Sign-in did not finish', message: result.error })
      }
    },
    'Sign-in failed'
  )
}

export async function reauthenticate(id: string): Promise<void> {
  await run(
    id,
    () => api.accounts.reauthenticate(id),
    (result) => {
      if (result.ok) {
        applyAccounts(result.data ?? null)
        pushToast({ kind: 'success', title: 'Account refreshed' })
      } else if (result.error) {
        pushToast({ kind: 'warning', title: 'Not signed in', message: result.error })
      }
    },
    'Re-authentication failed'
  )
}

export async function removeAccount(id: string): Promise<void> {
  await run(
    id,
    () => api.accounts.remove(id),
    (result) => {
      if (result.ok) {
        applyAccounts(result.data ?? null)
        pushToast({ kind: 'success', title: 'Account removed' })
      } else if (result.error) {
        pushToast({ kind: 'warning', title: 'Could not remove it', message: result.error })
      }
    },
    'Removing the account failed'
  )
}

export async function updateNotes(id: string, notes: string): Promise<void> {
  if (!notes.trim()) return
  await run(id, () => api.accounts.updateNotes(id, notes), applyAccounts, 'Could not save the note')
}

export async function refreshAccounts(id?: string): Promise<void> {
  await run(
    id ?? null,
    () => api.accounts.refresh({ id, profile: true }),
    applyAccounts,
    'Refresh failed'
  )
}

/** Avatars are remote URLs; the first letter of the name is the fallback. */
export function initials(account: Pick<RobloxAccount, 'username' | 'displayName'>): string {
  const source = account.displayName || account.username
  return source.slice(0, 1).toUpperCase()
}
