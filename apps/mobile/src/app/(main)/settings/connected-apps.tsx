import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams } from 'expo-router'
import type { ConnectedApp, LinkedGameServer } from '@glofly/shared'
import { request } from '@/api/http'
import { confirm, inform } from '@/ui/dialogs'
import { Button, Notice, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { SettingsRow } from '@/ui/SettingsRow'

// Communities round (Nov 2026): Settings → Apps & game servers (approved canvas board 12).
// Sites and apps you signed in to with Glofly; Disconnect signs them out at once. Linked game
// servers (board 13): Enter a code (settings/link-code), tap one to unlink.

const what = (a: ConnectedApp): string => {
  const parts = ['name, photo']
  if (a.scopes.includes('email')) parts.push('email')
  if (a.scopes.includes('roles') && a.constellations.length) parts.push(`roles in ${a.constellations.join(', ')}`)
  return parts.join(', ')
}

const joined = (iso: string | null) => {
  if (!iso) return 'no joins yet'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 3600) return `last join ${Math.max(1, Math.floor(s / 60))} min ago`
  if (s < 86_400) return `last join ${Math.floor(s / 3600)} h ago`
  return `last join ${new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

export default function ConnectedApps() {
  const { linked } = useLocalSearchParams<{ linked?: string }>()
  const [apps, setApps] = useState<ConnectedApp[] | null>(null)
  const [servers, setServers] = useState<LinkedGameServer[] | null>(null)
  const load = useCallback(() => {
    void request<{ apps: ConnectedApp[] }>('GET', '/account/connected-apps').then((r) => {
      if (r.ok) setApps(r.data.apps)
      else void inform("Couldn't load your apps", r.message)
    })
    void request<{ servers: LinkedGameServer[] }>('GET', '/account/game-links').then((r) => {
      if (r.ok) setServers(r.data.servers)
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
  async function unlink(s: LinkedGameServer) {
    const ok = await confirm({
      title: `Unlink ${s.serverName}?`,
      message: "The server can't look you up any more; you'll be asked for a new code next time you join. Your characters and progress stay on the game server.",
      confirmLabel: 'Unlink',
      danger: true,
    })
    if (!ok) return
    const r = await request<{ ok: true }>('DELETE', `/account/game-links/${s.id}`)
    if (!r.ok) return void inform("Couldn't unlink it", r.message)
    load()
  }
  return (
    <Screen title="Apps & game servers">
      <Text size={13} weight="bold" tone="muted" style={{ paddingHorizontal: 20, paddingTop: 16, letterSpacing: 0.6 }}>
        GAME SERVERS
      </Text>
      <Text size={14} tone="muted" style={{ paddingHorizontal: 20, paddingVertical: 8, lineHeight: 20 }}>
        Servers that let you in with Glofly. Each only sees your Glofly name and your roles in its constellation.
      </Text>
      {linked ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          <Notice tone="good">Linked to {linked}. Go back to the game: you'll join in a moment.</Notice>
        </View>
      ) : null}
      {servers?.map((g) => (
        <SettingsRow
          key={g.id}
          icon="gamepad"
          label={g.serverName}
          detail={`${g.playerName} · ${g.roles.length ? g.roles.join(', ') : 'no roles'} · ${joined(g.lastUsedAt)}`}
          onPress={() => void unlink(g)}
        />
      ))}
      <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
        <Button kind="secondary" label="Enter a code" onPress={() => router.push('/settings/link-code')} />
      </View>
      <Text size={13} weight="bold" tone="muted" style={{ paddingHorizontal: 20, paddingTop: 12, letterSpacing: 0.6 }}>
        APPS
      </Text>
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
        Tap an app to disconnect it, or a game server to unlink it.
      </Text>
    </Screen>
  )
}
