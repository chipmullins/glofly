import { AppState } from 'react-native'
import { create } from 'zustand'
import { EMPTY_SOCIAL, type SocialToday } from '@glofly/shared'
import * as api from '@/api/glofly'
import { onLive } from '@/api/realtime'
import { onSignOut } from './session'

// 0.5.0: glows, who's free to hang, birthdays today and who's live (GET /social), kept fresh:
// on start, when the server says it changed, when the app comes back, and every few minutes.

export const useSocial = create<SocialToday>(() => EMPTY_SOCIAL)

let asking: Promise<void> | null = null
export function refreshSocial(): Promise<void> {
  asking ??= api
    .social()
    .then((r) => {
      if (r.ok) useSocial.setState(r.data, true)
    })
    .catch(() => undefined)
    .finally(() => {
      asking = null
    })
  return asking
}

onLive((event) => {
  if (event === 'social:changed' || event === 'connected') void refreshSocial()
})
AppState.addEventListener('change', (s) => {
  if (s === 'active') void refreshSocial()
})
setInterval(() => {
  if (AppState.currentState === 'active') void refreshSocial()
}, 4 * 60 * 1000)
onSignOut(() => useSocial.setState(EMPTY_SOCIAL, true))
