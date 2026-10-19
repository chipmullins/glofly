import { create } from 'zustand'
import { inQuietHours, type QuietHours } from '@glofly/shared'
import { request } from '@/api/http'
import { onLive } from '@/api/realtime'

// 0.7.3 Quiet hours (Settings → Notifications): no notification sounds or banners between two
// times. Kept on the server (every device follows it; the server also holds back phone
// notifications); the app only needs to stay quiet while it's open.

export const useQuietHours = create<{
  quiet: QuietHours | null
  loaded: boolean
}>(() => ({ quiet: null, loaded: false }))

export async function refreshQuietHours(): Promise<void> {
  const r = await request<{ quietHours: QuietHours | null }>('GET', '/account/quiet-hours')
  if (r.ok) useQuietHours.setState({ quiet: r.data.quietHours, loaded: true })
}

export async function saveQuietHours(quiet: QuietHours | null): Promise<string | null> {
  const before = useQuietHours.getState().quiet
  useQuietHours.setState({ quiet })
  const r = await request<{ quietHours: QuietHours | null }>('PUT', '/account/quiet-hours', { quietHours: quiet })
  if (!r.ok) {
    useQuietHours.setState({ quiet: before })
    return r.message
  }
  useQuietHours.setState({ quiet: r.data.quietHours })
  return null
}

/** Is it quiet hours right now? For a call: only if calls don't ring through. */
export function isQuietNow(forCall = false): boolean {
  const q = useQuietHours.getState().quiet
  if (!q || (forCall && q.calls)) return false
  return inQuietHours(q)
}

/** The phone's own time zone (for new quiet hours). */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

let started = false
export function startQuietHours(): void {
  if (started) return
  started = true
  void refreshQuietHours()
  onLive((event) => {
    if (event === 'account:changed') void refreshQuietHours()
  })
}
