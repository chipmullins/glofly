import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import type { ConnectionProvider, ConnectionSettings, ConnectionsView, FriendEntry, FriendLists, LinkedAccount, ServerEvent } from '@glofly/shared'
import { request } from '@/api/http'
import { onLive } from '@/api/realtime'
import { confirm, inform } from '@/ui/dialogs'
import { Button, Notice, Text } from '@/ui/kit'
import { Screen } from '@/ui/Screen'
import { SettingsRow } from '@/ui/SettingsRow'
import { Avatar } from '@/ui/Avatar'
import { Icon } from '@/ui/icons'
import { useTheme } from '@/ui/theme'

// 0.9.3 Settings → Connections (approved canvas "Glofly: forwarding, formatting, live alerts,
// Steam", boards 6 and 8, drawn for phones). Linking opens Steam's, Twitch's or Kick's own
// sign-in page in the browser; the server tells this screen when it's done.

const LOOK: Record<ConnectionProvider, { name: string; color: string; badge: string }> = {
  twitch: { name: 'Twitch', color: '#6f3fd1', badge: 'TWITCH' },
  kick: { name: 'Kick', color: '#1f7a3a', badge: 'KICK' },
  steam: { name: 'Steam', color: '#1b2838', badge: 'STEAM' },
}
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const synced = (iso: string | null | undefined) => {
  if (!iso) return 'not synced yet'
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 90) return 'synced just now'
  if (s < 3600) return `synced ${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `synced ${Math.floor(s / 3600)} h ago`
  return `synced ${day(iso)}`
}

function Badge({ site }: { site: ConnectionProvider }) {
  return (
    <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: LOOK[site].color, alignItems: 'center', justifyContent: 'center' }}>
      <Text size={9} weight="bold" style={{ color: '#ffffff', letterSpacing: 0.3 }}>
        {LOOK[site].badge}
      </Text>
    </View>
  )
}

function Label({ children }: { children: string }) {
  return (
    <Text size={13} weight="bold" tone="muted" style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4, letterSpacing: 0.6 }}>
      {children}
    </Text>
  )
}

function ChooseFriends({ chosen, onChange }: { chosen: string[]; onChange: (ids: string[]) => void }) {
  const { c } = useTheme()
  const [friends, setFriends] = useState<FriendEntry[] | null>(null)
  useEffect(() => {
    void request<FriendLists>('GET', '/friends').then((r) => r.ok && setFriends(r.data.friends))
  }, [])
  if (!friends) return null
  if (!friends.length)
    return (
      <Text size={14} tone="muted" style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
        Add friends first, then pick who hears about your streams.
      </Text>
    )
  return (
    <View>
      {friends.map((f) => {
        const on = chosen.includes(f.id)
        return (
          <Pressable
            key={f.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={f.displayName}
            onPress={() => onChange(on ? chosen.filter((x) => x !== f.id) : [...chosen, f.id])}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, minHeight: 52 }}
          >
            <Avatar user={f} size={32} />
            <Text size={15} numberOfLines={1} style={{ flex: 1 }}>
              {f.displayName}
            </Text>
            <View style={{ width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: on ? c.accent : c.line, backgroundColor: on ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              {on ? <Icon name="check" size={16} color={c.accentInk} /> : null}
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

export default function Connections() {
  const { c } = useTheme()
  const [view, setView] = useState<ConnectionsView | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [waiting, setWaiting] = useState<ConnectionProvider | null>(null)
  const [syncing, setSyncing] = useState(false)
  const waitingRef = useRef<ConnectionProvider | null>(null)
  useEffect(() => {
    waitingRef.current = waiting
  })

  const load = useCallback(() => {
    void request<ConnectionsView>('GET', '/connections').then((r) => {
      if (!r.ok) return void inform("Couldn't load your connections", r.message)
      setView(r.data)
      const w = waitingRef.current
      if (w && r.data.accounts.some((a) => a.provider === w)) {
        setNotice(`${LOOK[w].name} is linked.`)
        setWaiting(null)
      }
    })
  }, [])
  useEffect(() => {
    load()
    return onLive((event, payload) => {
      if (event === 'cx' && (payload as ServerEvent).type === 'connections:changed') load()
    })
  }, [load])

  const account = (p: ConnectionProvider): LinkedAccount | undefined => view?.accounts.find((a) => a.provider === p)
  async function link(p: ConnectionProvider) {
    setNotice(null)
    const r = await request<{ url: string }>('POST', `/connections/${p}/start`)
    if (!r.ok) return void inform(`Couldn't link ${LOOK[p].name}`, r.message)
    setWaiting(p)
    void Linking.openURL(r.data.url)
  }
  async function change(p: ConnectionProvider, settings: Partial<ConnectionSettings>) {
    setView((v) => (v ? { ...v, accounts: v.accounts.map((a) => (a.provider === p ? { ...a, settings: { ...a.settings, ...settings } } : a)) } : v))
    const r = await request<{ account: LinkedAccount }>('PATCH', `/connections/${p}`, { settings })
    if (r.ok) setView((v) => (v ? { ...v, accounts: v.accounts.map((a) => (a.provider === p ? r.data.account : a)) } : v))
    else {
      void inform("Couldn't change that", r.message)
      load()
    }
  }
  async function unlink(a: LinkedAccount) {
    const ok = await confirm({
      title: `Unlink ${LOOK[a.provider].name}?`,
      message:
        a.provider === 'steam'
          ? "Steam's games and playtime leave My games (time Glofly counted itself stays). You can link it again any time."
          : "Friends won't hear when you go live there any more. You can link it again any time.",
      confirmLabel: 'Unlink',
      danger: true,
    })
    if (!ok) return
    const r = await request('DELETE', `/connections/${a.provider}`)
    if (!r.ok) return void inform("Couldn't unlink it", r.message)
    load()
  }

  const streams = (['twitch', 'kick'] as const).map(account).filter((a): a is LinkedAccount => !!a)
  const steam = account('steam')
  const live = streams[0]?.settings
  const changeLive = (settings: Partial<ConnectionSettings>) => {
    for (const a of streams) void change(a.provider, settings)
  }
  const notLinked = (['twitch', 'kick', 'steam'] as const).filter((p) => !account(p))

  return (
    <Screen title="Connections">
      <Text size={14} tone="muted" style={{ paddingHorizontal: 20, paddingTop: 16, lineHeight: 20 }}>
        Link where you stream and play. Glofly tells your friends when you go live and fills in My games. It never posts anything.
      </Text>
      {notice ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
          <Notice tone="good">{notice}</Notice>
        </View>
      ) : null}

      {streams.map((a) => (
        <View key={a.provider} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 }}>
          <Badge site={a.provider} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={16} weight="bold" numberOfLines={1}>
              {LOOK[a.provider].name} · {a.displayName}
            </Text>
            <Text size={13} tone="muted" numberOfLines={2}>
              Linked {day(a.linkedAt)} · {a.live ? `live now${a.live.title ? ` · ${a.live.title}` : ''}` : 'not live'}
            </Text>
          </View>
          <Button kind="secondary" label="Unlink" onPress={() => void unlink(a)} />
        </View>
      ))}

      {live ? (
        <>
          <Label>WHEN I GO LIVE ON TWITCH OR KICK</Label>
          <SettingsRow label="Tell my friends" detail="A notification with Open on Twitch or Kick" toggle={{ value: live.tellFriends !== 'off', onChange: (v) => changeLive({ tellFriends: v ? 'all' : 'off' }) }} />
          {live.tellFriends !== 'off' ? (
            <>
              <SettingsRow label="All friends" selected={live.tellFriends === 'all'} onPress={() => changeLive({ tellFriends: 'all' })} />
              <SettingsRow label="Only friends I choose" selected={live.tellFriends === 'chosen'} onPress={() => changeLive({ tellFriends: 'chosen' })} />
              {live.tellFriends === 'chosen' ? <ChooseFriends chosen={live.chosen} onChange={(ids) => changeLive({ chosen: ids })} /> : null}
            </>
          ) : null}
          <SettingsRow label="Show LIVE on my profile and in friends lists" detail="With the stream title and game" toggle={{ value: live.showLive, onChange: (v) => changeLive({ showLive: v }) }} />
          <SettingsRow label="Also post in my constellations" detail="Only where the owner allows members' streams" toggle={{ value: live.postInConstellations, onChange: (v) => changeLive({ postInConstellations: v }) }} />
        </>
      ) : null}

      {steam ? (
        <>
          <Label>STEAM</Label>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 }}>
            <Badge site="steam" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text size={16} weight="bold" numberOfLines={1}>
                Steam · {steam.displayName}
              </Text>
              <Text size={13} tone="muted" numberOfLines={2}>
                {typeof steam.gameCount === 'number' ? `${steam.gameCount.toLocaleString()} games · ` : ''}
                {synced(steam.syncedAt)}
              </Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingBottom: 6 }}>
            <Button
              kind="secondary"
              label={syncing ? 'Syncing…' : 'Sync now'}
              disabled={syncing}
              onPress={async () => {
                setSyncing(true)
                const r = await request<{ count: number; publicGames: boolean }>('POST', '/connections/steam/sync')
                setSyncing(false)
                if (!r.ok) return void inform("Couldn't sync", r.message)
                setNotice(r.data.count ? `Synced ${r.data.count === 1 ? '1 game' : `${r.data.count} games`} from Steam.` : "Steam didn't share any games. Check that your Game details are Public on Steam.")
                load()
              }}
            />
            <Button kind="secondary" label="Unlink" onPress={() => void unlink(steam)} />
          </View>
          <SettingsRow label="Add my Steam games to My games" detail="Real playtime from Steam, including other computers" toggle={{ value: steam.settings.myGames, onChange: (v) => void change('steam', { myGames: v }) }} />
          <SettingsRow label={'Show "Playing" from Steam'} detail="When you play on another PC or a Steam Deck" toggle={{ value: steam.settings.playing, onChange: (v) => void change('steam', { playing: v }) }} />
          <SettingsRow label="Show my Steam profile link on my profile" detail="Who sees it follows My games" toggle={{ value: steam.settings.showLink, onChange: (v) => void change('steam', { showLink: v }) }} />
          <View style={{ marginHorizontal: 20, marginTop: 8, padding: 14, borderRadius: 14, backgroundColor: c.surface, flexDirection: 'row', gap: 10 }}>
            <Icon name="info" size={20} color={c.accentText} />
            <Text size={14} style={{ flex: 1, lineHeight: 20 }}>
              Steam only shares playtime when your Steam profile&apos;s Game details are set to Public.
            </Text>
          </View>
        </>
      ) : null}

      {notLinked.length ? (
        <>
          <Label>{streams.length || steam ? 'NOT LINKED YET' : 'LINK AN ACCOUNT'}</Label>
          {notLinked.map((p) => (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 12 }}>
              <Badge site={p} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text size={16} weight="bold">
                  {LOOK[p].name}
                </Text>
                <Text size={13} tone="muted">
                  {!view?.available[p]
                    ? "Not set up on this server yet."
                    : waiting === p
                      ? `Finish signing in on ${LOOK[p].name}, then come back.`
                      : p === 'steam'
                        ? 'Fill in My games with your Steam playtime.'
                        : `Tell friends when you go live on ${LOOK[p].name}.`}
                </Text>
              </View>
              <Button kind="primary" label={waiting === p ? 'Open again' : 'Link'} disabled={!view?.available[p]} onPress={() => void link(p)} />
            </View>
          ))}
        </>
      ) : null}
      <Text size={12} tone="muted" style={{ paddingHorizontal: 20, paddingVertical: 16, lineHeight: 18 }}>
        You sign in on each site&apos;s own page; Glofly never sees those passwords. It only reads your channel name, whether you&apos;re live, and (Steam) your games and playtime.
      </Text>
    </Screen>
  )
}
