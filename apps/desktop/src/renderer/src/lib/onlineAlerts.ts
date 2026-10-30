import { useSyncExternalStore } from 'react'
import type { OnlineAlertsMode, PrivacySettings } from '@glofly/shared'

// Oct 30, 2026: "Friends coming online" is All friends / Selected friends / None. Settings and the
// bell on a profile both need it: the bell hides with All (every friend is covered) and turns the
// setting to Selected friends when rung while it's None (the server does the same).

let mode: OnlineAlertsMode | null = null
const listeners = new Set<() => void>()

function set(next: OnlineAlertsMode | null): void {
  if (next === mode) return
  mode = next
  for (const l of listeners) l()
}

/** The mode from privacy settings (older servers only have the on/off switch). */
export function modeFrom(
  settings: Pick<PrivacySettings, 'onlineAlerts' | 'onlineAlertsMode'>
): OnlineAlertsMode {
  return settings.onlineAlertsMode ?? (settings.onlineAlerts === false ? 'none' : 'selected')
}

export function setOnlineAlertsMode(next: OnlineAlertsMode): void {
  set(next)
}

/** Loads it once (at sign-in); later changes come from Settings and the bell. */
export function loadOnlineAlertsMode(): void {
  void window.glofly.settings.get().then((r) => {
    if (r.ok) set(modeFrom(r.data))
  })
}

export function useOnlineAlertsMode(): OnlineAlertsMode | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => mode
  )
}
