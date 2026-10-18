import { useEffect, useState } from 'react'
import type { IconName } from '@/ui/icons'
import { chooseFrom } from '@/ui/dialogs'
import { audioRoutes, currentAudioRoute, selectAudioRoute, type AudioRoute } from './media'

// Where the call plays (speaker, the phone's earpiece, headphones, Bluetooth): the call screen's
// Audio button, and (0.7.1) the voice nebula stage's, so both work the same way.

export const ROUTE_LABEL: Record<AudioRoute, string> = { speaker: 'Speaker', earpiece: 'Phone', headset: 'Headphones', bluetooth: 'Bluetooth' }
export const ROUTE_ICON: Record<AudioRoute, IconName> = { speaker: 'speaker', earpiece: 'earpiece', headset: 'speaker', bluetooth: 'bluetooth' }

export function useAudioRoute(): { route: AudioRoute | null; pick: () => Promise<void> } {
  const [route, setRoute] = useState<AudioRoute | null>(null)
  // iPhone: show where it's really playing (plugging in headphones or Bluetooth moves it there).
  useEffect(() => {
    const read = () => {
      const r = currentAudioRoute()
      if (r) setRoute(r)
    }
    read()
    const t = setInterval(read, 1500)
    return () => clearInterval(t)
  }, [])
  async function pick() {
    const routes = await audioRoutes()
    if (!routes.length) return
    const chosen = await chooseFrom(
      routes.map((r) => ({ key: r, label: ROUTE_LABEL[r] ?? r, icon: ROUTE_ICON[r] ?? 'speaker', checked: r === route })),
      'Play the call on',
    )
    if (!chosen) return
    await selectAudioRoute(chosen as AudioRoute)
    setRoute(chosen as AudioRoute)
  }
  return { route, pick }
}
