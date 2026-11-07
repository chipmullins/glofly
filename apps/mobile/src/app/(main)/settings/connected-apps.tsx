import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import type { ConnectedApp } from '@glofly/shared'
import { request } from '@/api/http'
import { confirm, inform } from '@/ui/dialogs'
import { Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { SettingsRow } from '@/ui/SettingsRow'

// Communities round (Nov 2026): Settings → Apps & game servers (approved canvas board 12).
// Sites and apps you signed in to with Glofly; Disconnect signs them out at once. (Linked game
// servers join this screen when game server linking ships.)

const what = (a: ConnectedApp): string => {
  const parts = ['name, photo']
  if (a.scopes.includes('email')) parts.push('email')
  if (a.scopes.includes('roles') && a.constellations.length) parts.push(`roles in ${a.constellations.join(', ')}`)
  return parts.join(', ')
}

export default function ConnectedApps() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null)
  const load = useCallback(() => {
    void request<{ apps: ConnectedApp[] }>('GET', '/account/connected-apps').then((r) => {
      if (r.ok) setApps(r.data.apps)
      else void inform("Couldn't load your apps", r.message)
    })
  }, [])
  useEffect(load, [load])
  async function disconnect(a: ConnectedApp) {
    const ok = await confirm({ title: `Disconnect ${a.name}?`, message: 'It’s signed out of your Glofly account straight away. Its own account on its site stays.', confirmLabel: 'Disconnect', danger: true })
    if (!ok) return
    const r = await request<{ ok: true }>('DELETE', `/account/connected-apps/${a.appId}`)
    if (!r.ok) return void inform("Couldn't disconnect it", r.message)
    load()
  }
  return (
    <Screen title="Apps & game servers">
      <Text size={14} tone="muted" style={{ paddingHorizontal: 20, paddingVertical: 12, lineHeight: 20 }}>
        Sites and apps you signed in to with Glofly. They never see your messages, friends or password.
      </Text>
      {apps?.length === 0 ? (
        <Text size={14} tone="muted" style={{ paddingHorizontal: 20 }}>
          No apps yet. When a site offers “Sign in with Glofly”, it shows up here.
        </Text>
      ) : null}
      {apps?.map((a) => (
        <SettingsRow
          key={a.appId}
          icon="link"
          label={a.firstParty ? `${a.name} · Made by Glofly` : a.name}
          detail={what(a)}
          onPress={() => void disconnect(a)}
        />
      ))}
      <View style={{ height: 12 }} />
      <Text size={12} tone="muted" style={{ paddingHorizontal: 20, lineHeight: 18 }}>
        Tap an app to disconnect it. Developers register apps in Glofly on a computer (Settings → Developer).
      </Text>
    </Screen>
  )
}
