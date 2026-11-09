import { useCallback, useEffect, useState } from 'react'
import { Linking, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams } from 'expo-router'
import { alertSiteName, type LiveAlert } from '@glofly/shared'
import { request } from '@/api/http'
import { cxSay } from '@/state/constellations'
import { confirm } from '@/ui/dialogs'
import { Text } from '@/ui/kit'
import { haptic } from '@/constellations/motion'
import { can } from '@/constellations/roles'
import { SettingsScreen, useSettingsDetail } from '@/constellations/settingsKit'
import { Caps, Card, N, Row } from '@/constellations/ui'

// 0.9.3 Live alerts on phones: the channels this constellation follows (tap one to stop
// following it). Adding a channel is on a computer (the desktop app or chat.glofly.app), like
// webhooks.

const COLOR: Record<LiveAlert['site'], string> = { twitch: '#6f3fd1', kick: '#1f7a3a', youtube: '#c4302b' }
const SHORT: Record<LiveAlert['site'], string> = { twitch: 'TW', kick: 'KI', youtube: 'YT' }

type View_ = { alerts: LiveAlert[]; members: { nebulaId: string; ping: string | null; message: string } | null }

export default function LiveAlertsScreen() {
  const { cid } = useLocalSearchParams<{ cid: string }>()
  const c = useSettingsDetail(cid)
  const [view, setView] = useState<View_ | null>(null)
  const load = useCallback(() => {
    void request<View_>('GET', `/constellations/${cid}/live-alerts`).then((r) => {
      if (r.ok) setView(r.data)
      else cxSay(r.message)
    })
  }, [cid])
  useFocusEffect(load)
  useEffect(load, [load])
  if (!c) return <SettingsScreen title="Live alerts" c={null}>{null}</SettingsScreen>
  if (!can(c, 'manageConstellation')) {
    return (
      <SettingsScreen title="Live alerts" c={c}>
        <Text size={14} style={{ color: N.muted }}>Only people who can edit {c.name}&apos;s settings can set up Live alerts.</Text>
      </SettingsScreen>
    )
  }
  const nebula = (id: string) => c.nebulas.find((n) => n.id === id)?.name ?? 'a nebula'
  async function remove(a: LiveAlert) {
    const ok = await confirm({ title: `Stop following ${a.channelName}?`, message: `No more ${alertSiteName(a.site)} alerts for this channel. Alerts already posted stay.`, confirmLabel: 'Remove', danger: true })
    if (!ok) return
    const r = await request('DELETE', `/constellations/${cid}/live-alerts/${a.id}`)
    if (!r.ok) return cxSay(r.message)
    haptic.success()
    load()
  }
  return (
    <SettingsScreen title="Live alerts" c={c}>
      <Text size={14} style={{ color: N.ink2, lineHeight: 20 }}>
        Glofly posts in a nebula when a streamer goes live on Twitch or Kick, or a channel posts on YouTube. No bot needed. YouTube alerts use YouTube API Services (
        <Text size={14} style={{ color: N.ink, textDecorationLine: 'underline' }} accessibilityRole="link" onPress={() => void Linking.openURL('https://www.youtube.com/t/terms')}>
          YouTube Terms
        </Text>
        ).
      </Text>
      <Caps>Channels</Caps>
      {view?.alerts.length ? (
        <Card>
          {view.alerts.map((a, i) => (
            <Row
              key={a.id}
              icon={
                <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: COLOR[a.site], alignItems: 'center', justifyContent: 'center' }}>
                  <Text size={11} weight="bold" style={{ color: '#fff' }}>
                    {SHORT[a.site]}
                  </Text>
                </View>
              }
              label={`${a.channelName} on ${alertSiteName(a.site)}`}
              sub={`#${nebula(a.nebulaId)} · ${a.site === 'youtube' ? 'new videos' : 'goes live'}`}
              chevron
              last={i === view.alerts.length - 1}
              accessibilityLabel={`${a.channelName} on ${alertSiteName(a.site)}, posts in ${nebula(a.nebulaId)}. Tap to stop following.`}
              onPress={() => void remove(a)}
            />
          ))}
        </Card>
      ) : view ? (
        <Text size={14} style={{ color: N.muted }}>No channels yet.</Text>
      ) : null}
      <Caps>Members&apos; streams</Caps>
      <Text size={14} style={{ color: N.muted, lineHeight: 20 }}>
        {view?.members ? `On: members who link Twitch or Kick post in #${nebula(view.members.nebulaId)} when they go live.` : 'Off.'}
      </Text>
      <Text size={13} style={{ color: N.muted, lineHeight: 19 }}>
        Add channels and change where alerts post in Glofly on a computer or chat.glofly.app (Settings → Live alerts).
      </Text>
    </SettingsScreen>
  )
}
