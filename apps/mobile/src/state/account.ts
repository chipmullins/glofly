import { create } from 'zustand'
import type { AccountDetails } from '@glofly/shared'
import * as api from '@/api/glofly'
import { inform } from '@/ui/dialogs'
import { onSignOut, useSession } from './session'

// Private account details (email, confirmed or not), for Settings → Account and the reminder bar.

export const useAccount = create<{ account: AccountDetails | null }>(() => ({ account: null }))

// The next account to sign in on this phone mustn't see this one's email (Settings, the banner).
onSignOut(() => useAccount.setState({ account: null }))

export async function refreshAccount(): Promise<boolean> {
  const token = useSession.getState().token
  const r = await api.getAccount()
  if (!r.ok || useSession.getState().token !== token) return false
  useAccount.setState({ account: r.data })
  return true
}

export async function resendConfirm(): Promise<void> {
  const r = await api.resendConfirmEmail()
  if (r.ok) void inform('Link sent', 'Check your email for the confirm link (it works for 7 days).')
  else void inform("Couldn't send it", r.message)
}
