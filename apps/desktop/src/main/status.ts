import { powerMonitor } from 'electron'
import type { ApiResult, MyStatus, MyStatusChanges, PrivacySettings } from '../preload/api-types'
import { request } from './api'
import { reconnectRealtime, setIdle } from './realtime'

export const getMyStatus = (): Promise<ApiResult<MyStatus>> => request('GET', '/users/me/status')

export const setMyStatus = (changes: MyStatusChanges): Promise<ApiResult<MyStatus>> =>
  request('PATCH', '/users/me/status', changes)

/** 0.11.4: ask your open Glofly computer(s) to share your game or not, or to stop showing one game. */
export const setActivitySharing = (change: { share?: boolean; hide?: string }): Promise<ApiResult<{ ok: true }>> =>
  request('PUT', '/users/me/activity-sharing', change)

export const getSettings = (): Promise<ApiResult<PrivacySettings>> =>
  request('GET', '/users/me/settings')

export const setSettings = (
  changes: Partial<PrivacySettings>
): Promise<ApiResult<PrivacySettings>> => request('PATCH', '/users/me/settings', changes)

// Away after this long without touching the keyboard or mouse.
const IDLE_AFTER_SECONDS = 10 * 60

/** Watches for the computer going idle (or locking), so friends see you as Away. */
export function startIdleWatch(): void {
  const check = (): void => setIdle(powerMonitor.getSystemIdleTime() >= IDLE_AFTER_SECONDS)
  setInterval(check, 30_000)
  powerMonitor.on('lock-screen', () => setIdle(true))
  powerMonitor.on('suspend', () => setIdle(true))
  powerMonitor.on('unlock-screen', check)
  powerMonitor.on('resume', () => {
    check()
    reconnectRealtime()
  })
}
