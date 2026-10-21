import { useEffect } from 'react'
import { router, usePathname } from 'expo-router'
import { useSession } from '@/state/session'
import { useShareInbox } from './inbox'

// 0.8.0: a share is waiting and you're signed in: "Send to…" opens. Signed out, it waits (the
// sign-in screen says so) and opens right after you sign in. Nothing renders here.

export function ShareGate() {
  const signedIn = useSession((s) => s.status === 'signedIn')
  const seq = useShareInbox((s) => s.seq)
  const waiting = useShareInbox((s) => !!s.item)
  const path = usePathname()
  useEffect(() => {
    if (!signedIn || !waiting || path === '/share') return
    // Let the signed-in screens mount first (straight after signing in, or a cold start).
    const t = setTimeout(() => router.push('/share'), 350)
    return () => clearTimeout(t)
    // Only for a new share or when you've just signed in: not every time you move around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, seq])
  return null
}
