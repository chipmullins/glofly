import type { AccountDetails, ApiResult, SignedInDevice } from '../preload/api-types'
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

export const resendVerification = (): Promise<ApiResult<{ ok: true }>> =>
  request('POST', '/account/email/verify', {})

export const changeEmail = (
  newEmail: string,
  password: string
): Promise<ApiResult<{ pendingEmail: string }>> =>
  request('POST', '/account/email', { newEmail, password })

export const cancelEmailChange = (): Promise<ApiResult<{ ok: true }>> =>
  request('DELETE', '/account/email/pending')

export const listSessions = (): Promise<ApiResult<{ sessions: SignedInDevice[] }>> =>
  request('GET', '/account/sessions')

export const signOutDevice = (sessionId: string): Promise<ApiResult<{ ok: true }>> =>
  request('DELETE', `/account/sessions/${sessionId}`)

export const signOutOtherDevices = (): Promise<ApiResult<{ signedOut: number }>> =>
  request('DELETE', '/account/sessions')

/** Deleting signs out every device, this one included, so forget the session here too. */
export async function deleteAccount(password: string): Promise<ApiResult<{ deleteAfter: string }>> {
  const result = await request<{ deleteAfter: string }>('POST', '/account/delete', { password })
  if (result.ok) {
    disconnectRealtime()
    await endSessionLocally()
  }
  return result
}
