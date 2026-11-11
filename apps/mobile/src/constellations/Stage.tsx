import { useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import { STAGE_TOPIC_MAX, stageLine, type ConstellationDetail, type MyStage, type Nebula, type PublicUser } from '@glofly/shared'
import { useSession } from '@/state/session'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { inform } from '@/ui/dialogs'
import { can } from './roles'
import { haptic } from './motion'
import { Face, N, NightButton, NightField } from './ui'
import { NightModal } from './sheet'
import { joinStage, leaveStage, setStageMic, stageApi, startStage, useStage } from './stage'

// Communities round 2, board 3c (approved): a stage on a phone. Speakers in a grid of three, the
// listening faces, Raise hand + a leave button; moderators get the raised hands as a sheet over the
// stage; a listener asked up gets "Riley invited you to speak". Following news is set up on a
// computer or chat.glofly.app.

export function Megaphone({ size = 16, color = N.amber }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 10v4h4l7 4V6L7 10z" />
      <Path d="M17 9a4 4 0 0 1 0 6" />
    </Svg>
  )
}
function HandGlyph({ size = 20, color = N.amberInk }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M8 11V5a1.5 1.5 0 0 1 3 0v5M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14a1.5 1.5 0 0 1 2.5-1.6L8 15" />
    </Svg>
  )
}

const minutes = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  return m < 1 ? 'just now' : `${m} min`
}

export function StageLobby({ c, n }: { c: ConstellationDetail; n: Nebula }) {
  const insets = useSafeAreaInsets()
  const me = useSession((s) => s.user)
  const stage = c.stages?.find((s) => s.nebulaId === n.id) ?? null
  const on = useStage((s) => s.on)
  const invitedBy = useStage((s) => s.invites[n.id] ?? null)
  const here = on?.nebulaId === n.id ? on : null
  const manage = can(c, 'manageStages')
  const [mine, setMine] = useState<MyStage | null>(null)
  const [busy, setBusy] = useState(false)
  const [topic, setTopic] = useState('')
  const [handsOpen, setHandsOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let gone = false
    void stageApi.get(c.id, n.id).then((r) => {
      if (!gone && r.ok) setMine(r.data.me)
    })
    return () => {
      gone = true
    }
  }, [c.id, n.id, stage?.id, stage?.handCount, stage?.speakers.length, here?.role, invitedBy])

  const people = new Map<string, PublicUser>(c.members.map((m) => [m.user.id, m.user]))
  const person = (id: string): Pick<PublicUser, 'id' | 'displayName' | 'avatarVersion'> => people.get(id) ?? { id, displayName: '?', avatarVersion: null }
  const name = (id: string) => (id === me?.id ? 'You' : (people.get(id)?.displayName.split(/\s+/)[0] ?? 'Someone'))
  const run = async (fn: () => Promise<string | null>) => {
    setBusy(true)
    const problem = await fn()
    setBusy(false)
    if (problem) void inform("That didn't work", problem)
  }
  const back = () => (router.canGoBack() ? router.back() : router.replace({ pathname: '/constellations/[cid]', params: { cid: c.id } }))

  const header = (
    <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 12, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: '#2c201a' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${c.name}`} onPress={back} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chevronLeft" size={24} color={N.ink} strokeWidth={2.2} />
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={17} weight="bold" numberOfLines={1} accessibilityRole="header">
          {stage ? stage.topic : `#${n.name}`}
        </Text>
        <Text size={12} style={{ color: '#c9b8ab' }} numberOfLines={1}>
          {stage ? `#${n.name} · ${stageLine(stage)}` : `${c.name} · Stage`}
        </Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Open the chat" onPress={() => router.push({ pathname: '/constellations/[cid]/nebula/[nid]', params: { cid: c.id, nid: n.id, chat: '1' } })} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="chats" size={22} color={N.ink} />
      </Pressable>
    </View>
  )

  if (!stage) {
    return (
      <View style={{ flex: 1, backgroundColor: N.bg }}>
        {header}
        <ScrollView contentContainerStyle={{ alignItems: 'center', gap: 14, padding: 24, paddingTop: 60 }}>
          <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: N.raised, alignItems: 'center', justifyContent: 'center' }}>
            <Megaphone size={32} />
          </View>
          <Text display size={26} style={{ textAlign: 'center' }}>
            #{n.name}
          </Text>
          <Text size={14} style={{ color: N.ink2, textAlign: 'center' }}>
            {n.topic || 'A stage for town halls, Q&As and events. Nobody’s on it right now.'}
          </Text>
          {manage ? (
            <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 10 }}>
              <NightField label="Topic" value={topic} onChangeText={setTopic} maxLength={STAGE_TOPIC_MAX} placeholder="Season 3 town hall" />
              <NightButton label="Start the stage" height={52} busy={busy} disabled={!topic.trim()} onPress={() => void run(() => startStage(c.id, n.id, topic))} />
            </View>
          ) : (
            <Text size={13} style={{ color: N.muted, textAlign: 'center' }}>
              You’ll see it go LIVE when a stage starts.
            </Text>
          )}
        </ScrollView>
      </View>
    )
  }

  const speaking = new Set(here?.speaking ?? [])
  const muted = new Set(here?.muted ?? [])
  const imSpeaker = here?.role === 'speaker'
  const asked = (mine?.role === 'invited' || !!invitedBy) && !imSpeaker && !dismissed
  const listeners = stage.listeners.filter((id) => !stage.speakers.some((s) => s.userId === id))
  const more = Math.max(0, stage.listenerCount - listeners.length)

  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      {header}
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 140 + insets.bottom }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 18, paddingHorizontal: 8, borderRadius: 22, backgroundColor: '#170f0c', borderWidth: 1, borderColor: '#2c201a', rowGap: 14 }}>
          {stage.speakers.length === 0 && (
            <Text size={13} style={{ color: N.muted, width: '100%', textAlign: 'center' }}>
              Nobody’s speaking right now.
            </Text>
          )}
          {stage.speakers.map((s) => (
            <View key={s.userId} accessibilityLabel={`${name(s.userId)}${s.host ? ', host' : ''}${muted.has(s.userId) ? ', muted' : ''}`} style={{ width: '33.33%', alignItems: 'center', gap: 4 }}>
              <View>
                <Face user={person(s.userId)} size={64} me={s.userId === me?.id} ring={speaking.has(s.userId) && !muted.has(s.userId) ? `0 0 0 3px ${N.amber}` : undefined} />
                {muted.has(s.userId) && (
                  <View style={{ position: 'absolute', right: -2, bottom: -2, width: 24, height: 24, borderRadius: 12, backgroundColor: '#3a1512', borderWidth: 2, borderColor: N.bg, alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="micOff" size={12} color="#ff9b8f" />
                  </View>
                )}
              </View>
              <Text size={13} weight="bold" numberOfLines={1}>
                {name(s.userId)}
              </Text>
              {s.host && (
                <Text size={11} weight="bold" style={{ color: N.amber }}>
                  Host
                </Text>
              )}
            </View>
          ))}
        </View>
        <Text size={12} weight="bold" style={{ color: '#c9b8ab', letterSpacing: 0.8 }}>
          LISTENING · {stage.listenerCount.toLocaleString('en-US')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {listeners.map((id) => (
            <Face key={id} user={person(id)} size={34} me={id === me?.id} />
          ))}
          {more > 0 && (
            <View style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: N.raised, justifyContent: 'center' }}>
              <Text size={13}>+{more.toLocaleString('en-US')}</Text>
            </View>
          )}
        </View>
        {manage && (
          <NightButton kind="outline" label={`Raised hands · ${stage.handCount}`} onPress={() => setHandsOpen(true)} />
        )}
        <Text size={12} style={{ color: '#c9b8ab', textAlign: 'center' }}>
          {imSpeaker ? 'You’re on stage. Everyone listening hears you when you’re unmuted.' : here ? 'You’re listening. Your mic and camera aren’t used.' : 'Listeners only receive: your mic and camera aren’t used.'}
        </Text>
      </ScrollView>

      {asked && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 96, padding: 14, borderRadius: 16, backgroundColor: N.raised, borderWidth: 1, borderColor: '#5b4434', gap: 10 }} accessibilityLiveRegion="polite">
          <Text size={15} weight="bold">
            {invitedBy ?? 'A moderator'} invited you to speak
          </Text>
          <Text size={13} style={{ color: '#c9b8ab' }}>
            You’ll join muted.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <NightButton style={{ flex: 1 }} label="Join as a speaker" busy={busy} onPress={() => void run(() => joinStage(c.id, n.id, 'speaker'))} />
            <NightButton style={{ flex: 1 }} kind="outline" label="Stay listening" onPress={() => setDismissed(true)} />
          </View>
        </View>
      )}

      <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 24, flexDirection: 'row', gap: 10 }}>
        {!here ? (
          <>
            <NightButton style={{ flex: 1 }} height={52} label="Listen in" icon="speaker" busy={busy} onPress={() => void run(() => joinStage(c.id, n.id, 'listener'))} />
            {manage && <NightButton kind="outline" height={52} label="Speak" busy={busy} onPress={() => void run(() => joinStage(c.id, n.id, 'speaker'))} />}
          </>
        ) : imSpeaker ? (
          <NightButton style={{ flex: 1 }} height={52} kind={here.micOn ? 'outline' : 'amber'} icon={here.micOn ? 'mic' : 'micOff'} label={here.micOn ? 'Mute' : 'Unmute'} onPress={() => void run(() => setStageMic(!here.micOn))} />
        ) : stage.handsOn ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mine?.handUp ? 'Lower hand' : 'Raise hand'}
            onPress={() => {
              haptic.select()
              void run(async () => {
                const r = await stageApi.hand(c.id, n.id, !mine?.handUp)
                if (r.ok) setMine(r.data.me)
                return r.ok ? null : r.message
              })
            }}
            style={{ flex: 1, height: 52, borderRadius: 26, backgroundColor: mine?.handUp ? N.raised : N.amber, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <HandGlyph color={mine?.handUp ? N.ink : N.amberInk} />
            <Text size={15} weight="bold" style={{ color: mine?.handUp ? N.ink : N.amberInk }}>
              {mine?.handUp ? 'Lower hand' : 'Raise hand'}
            </Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {here && (
          <Pressable accessibilityRole="button" accessibilityLabel="Leave quietly" onPress={() => void leaveStage()} style={{ width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: N.edge, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="door" size={20} color={N.ink} />
          </Pressable>
        )}
      </View>

      <NightModal visible={handsOpen} onClose={() => setHandsOpen(false)} accessibilityLabel="Raised hands">
        <View style={{ gap: 12 }}>
          <Text size={17} weight="bold">
            Raised hands · {stage.handCount}
          </Text>
          <Text size={12} style={{ color: '#c9b8ab' }}>
            {stage.topic}
          </Text>
          {(stage.hands ?? []).length === 0 && (
            <Text size={13} style={{ color: N.muted }}>
              No hands up.
            </Text>
          )}
          {(stage.hands ?? []).map((h) => (
            <View key={h.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Face user={person(h.userId)} size={40} />
              <View style={{ flex: 1 }}>
                <Text size={15} weight="bold">
                  {people.get(h.userId)?.displayName ?? 'Someone'}
                </Text>
                <Text size={12} style={{ color: '#c9b8ab' }}>
                  hand up {minutes(h.at)}
                </Text>
              </View>
              <NightButton height={36} label="Invite" onPress={() => void run(async () => { const r = await stageApi.invite(c.id, n.id, h.userId); return r.ok ? null : r.message })} />
            </View>
          ))}
          <NightButton kind="danger" label="End the stage for everyone" onPress={() => void run(async () => { const r = await stageApi.end(c.id, n.id); if (r.ok) { setHandsOpen(false); if (here) await leaveStage(false) } return r.ok ? null : r.message })} />
        </View>
      </NightModal>
    </View>
  )
}
