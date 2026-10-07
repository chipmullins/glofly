import type { AccountDetails, ApiResult } from '../preload/api-types'
import { request } from './api'
import { endSessionLocally } from './auth'
import { disconnectRealtime } from './realtime'

// Settings → Account

export const getAccount = (): Promise<ApiResult<AccountDetails>> => request('GET', '/account')

export const changePassword = (
  currentPassword: string,
  newPassword: string,
  signOutOthers: boolean
): Promise<ApiResult<{ signedOut: number }>> =>
  request('POST', '/account/password', { currentPassword, newPassword, signOutOthers })

/** Deleting signs out every device, this one included, so forget the session here too. */
export async function deleteAccount(password: string): Promise<ApiResult<{ deleteAfter: string }>> {
  const result = await request<{ deleteAfter: string }>('POST', '/account/delete', { password })
  if (result.ok) {
    disconnectRealtime()
    await endSessionLocally()
  }
  return result
}
