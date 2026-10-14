import { create } from 'zustand'
import type { Paused, SignedInUser, UpdateRequired } from '@glofly/shared'
import { secure } from '@/lib/storage'

// Who's signed in on this phone. The token lives in the Keystore when "Keep me signed in" is on,
// otherwise only in memory (gone when Android closes the app).

type Status = 'starting' | 'signedOut' | 'signedIn'

type SessionState = {
  status: Status
  token: string | null
  user: SignedInUser | null
  /** The server needs a newer Glofly: the update screen covers everything. */
  updateRequired: UpdateRequired | null
  /** 0.4.0: Glofly is paused (Glofly Control → Server): "Glofly is paused" covers everything. */
  paused: Paused | null
  /** Shown once on the login screen after being signed out by the server (e.g. password changed). */
  signedOutNote: string | null
  setUser: (user: SignedInUser) => void
  setUpdateRequired: (u: UpdateRequired | null) => void
  setPaused: (p: Paused | null) => void
}

const TOKEN_KEY = 'session.token'
const USER_KEY = 'session.user'

export const useSession = create<SessionState>((set) => ({
  status: 'starting',
  token: null,
  user: null,
  updateRequired: null,
  paused: null,
  signedOutNote: null,
  setUser: (user) => {
    set({ user })
    void secure.get(TOKEN_KEY).then((saved) => {
      if (saved) void secure.set(USER_KEY, JSON.stringify(user))
    })
  },
  setUpdateRequired: (updateRequired) => set({ updateRequired }),
  setPaused: (paused) => set({ paused }),
}))

/** At start: a saved sign-in, if there is one. Checked against the server later (401 → signed out). */
export async function restoreSession(): Promise<void> {
  const [token, rawUser] = await Promise.all([secure.get(TOKEN_KEY), secure.get(USER_KEY)])
  let user: SignedInUser | null = null
  try {
    user = rawUser ? (JSON.parse(rawUser) as SignedInUser) : null
  } catch {
    user = null
  }
  if (token && user) useSession.setState({ status: 'signedIn', token, user })
  else useSession.setState({ status: 'signedOut' })
}

export async function startSession(token: string, user: SignedInUser, keep: boolean): Promise<void> {
  if (keep) {
    await secure.set(TOKEN_KEY, token)
    await secure.set(USER_KEY, JSON.stringify(user))
  } else {
    await clearSaved()
  }
  useSession.setState({ status: 'signedIn', token, user, signedOutNote: null })
}

async function clearSaved() {
  await secure.set(TOKEN_KEY, null)
  await secure.set(USER_KEY, null)
}

const signOutListeners = new Set<() => void>()
/** Things that must forget the account when signing out (live connection, caches, notifications). */
export function onSignOut(fn: () => void): () => void {
  signOutListeners.add(fn)
  return () => signOutListeners.delete(fn)
}

/** Forget the session on this phone (the server side is handled by the caller, if needed). */
export async function endSessionLocally(note: string | null = null): Promise<void> {
  if (useSession.getState().status !== 'signedIn') {
    // Already signed out (the server closed the connection first): keep the more useful note.
    if (note) useSession.setState({ signedOutNote: note })
    return
  }
  await clearSaved()
  useSession.setState({ status: 'signedOut', token: null, user: null, signedOutNote: note })
  for (const fn of signOutListeners) {
    try {
      fn()
    } catch {
      /* keep going */
    }
  }
}
