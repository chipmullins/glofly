import { create } from 'zustand'
import type { AccountDetails } from '@glofly/shared'
import * as api from '@/api/glofly'
import { inform } from '@/ui/dialogs'

// Private account details (email, confirmed or not), for Settings → Account and the reminder bar.

export const useAccount = create<{ account: AccountDetails | null }>(() => ({ account: null }))

export async function refreshAccount(): Promise<void> {
  const r = await api.getAccount()
  if (r.ok) useAccount.setState({ account: r.data })
}

export async function resendConfirm(): Promise<void> {
  const r = await api.resendConfirmEmail()
  if (r.ok) void inform('Link sent', 'Check your email for the confirm link (it works for 7 days).')
  else void inform("Couldn't send it", r.message)
}
