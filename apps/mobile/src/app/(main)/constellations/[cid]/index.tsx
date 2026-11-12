import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { router, useIsFocused, useLocalSearchParams } from 'expo-router'
import Animated, { FadeIn, SlideInLeft, SlideInRight } from 'react-native-reanimated'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ConstellationDetail, Nebula } from '@glofly/shared'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { loadDetail, onRemovedFrom, useCx } from '@/state/constellations'
import { unreadTotal } from '@/lib/chats'
import { useWide } from '@/lib/layout'
import { setMic, useCall } from '@/calls/controller'
import { Icon } from '@/ui/icons'
import { Spinner, Text } from '@/ui/kit'
import { EmptyScene } from '@/ui/EmptyScene'
import { NightSky } from '@/constellations/sky'
import { NightTabBar } from '@/constellations/NightTabBar'
import { CreateJoinSheet } from '@/constellations/CreateJoin'
import { ConstellationBanner, IconStrip, NebulaList, SideBanner, SideStrip, useStripList } from '@/constellations/Inside'
import { NebulaChat } from '@/constellations/NebulaChat'
import { WelcomeSheet } from '@/constellations/community'
import { OnboardingSheet } from '@/constellations/Onboarding'
import { MemberList, openMemberSheet } from '@/constellations/Members'
import { StageLobby } from '@/constellations/Stage'
import { VoiceLobby, VoiceStage } from '@/constellations/Voice'
import { openDmDock } from '@/constellations/dock'
import { flyHome } from '@/constellations/transition'
import { rememberCxPlace } from '@/constellations/nav'
import { haptic, useReduceMotion } from '@/constellations/motion'
import { can, stepNebula, topRole, roleColor, STATUS_WORD } from '@/constellations/roles'
import { useKeyCommand } from '@/lib/keys'
import { Face, N, NightButton, NightCenter, SearchBox } from '@/constellations/ui'

// Inside a constellation. Phones (canvas board 4): the icon strip (swipe sideways to switch),
// the banner, categories → nebulas, and the night tab bar. iPad (the iPad board): the strip down
// the left, the nebula sidebar, the open nebula, and the members.

/** The nebula to open first on iPad: one with news, else the first text nebula. */
function firstNebula(c: ConstellationDetail): Nebula | null {
  const text = [...c.nebulas].filter((n) => n.kind === 'text').sort((a, b) => a.position - b.position)
  return text.find((n) => n.mentionCount) ?? text[0] ?? c.nebulas[0] ?? null
}

/** iPad: the nebula you had open in each constellation (while Glofly is open). */
const lastOpen = new Map<string, string>()

export default function ConstellationHome() {
  const { cid, nebula: nebulaParam } = useLocalSearchParams<{ cid: string; nebula?: string }>()
  const c = useCx((s) => s.details[cid]) ?? null
  const problem = useCx((s) => s.problems[cid])
  const wide = useWide()
  const [sheet, setSheet] = useState(false)

  useEffect(() => {
    void loadDetail(cid)
  }, [cid])
  // 0.7.1: the Constellations tab brings you back here
  useEffect(() => {
    rememberCxPlace(cid, nebulaParam ?? null)
  }, [cid, nebulaParam])
  useEffect(
    () =>
      onRemovedFrom((id) => {
        if (id === cid) router.replace('/constellations')
      }),
    [cid],
  )

  if (!c) {
    return (
      <View style={{ flex: 1, backgroundColor: N.bg }}>
        <NightSky flies={1} />
        <NightCenter>
          {problem ? (
            <>
              <Text size={15} style={{ color: N.ink2, textAlign: 'center' }}>
                {problem}
              </Text>
              <NightButton kind="outline" label="Back to Constellations" onPress={() => router.replace('/constellations')} />
            </>
          ) : (
            <Spinner />
          )}
        </NightCenter>
        {wide ? null : <NightTabBar active="constellations" />}
      </View>
    )
  }

  return (
    <>
      {wide ? (
        <WideLayout c={c} nebulaParam={nebulaParam ?? null} onAdd={() => setSheet(true)} sheet={sheet} closeSheet={() => setSheet(false)} />
      ) : (
        <PhoneLayout c={c} onAdd={() => setSheet(true)} sheet={sheet} closeSheet={() => setSheet(false)} />
      )}
      {/* 0.7.5: the welcome, once, right after you join (about, rules, pick your roles) */}
      <WelcomeSheet c={c} />
      {/* 4.3: the questions, right after the welcome (board 28) */}
      <OnboardingSheet c={c} />
    </>
  )
}

function switchTo(id: string) {
  haptic.select()
  router.setParams({ cid: id, nebula: undefined })
}

function PhoneLayout({ c, onAdd, sheet, closeSheet }: { c: ConstellationDetail; onAdd: () => void; sheet: boolean; closeSheet: () => void }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const reduce = useReduceMotion((s) => s.on)
  const list = useStripList(c)
  const dir = useRef<'left' | 'right' | null>(null)

  const go = (step: 1 | -1) => {
    const i = list.findIndex((x) => x.id === c.id)
    const next = list[i + step]
    if (!next) return
    dir.current = step === 1 ? 'right' : 'left'
    switchTo(next.id)
  }
  const swipe = Gesture.Pan()
    .runOnJS(true)
    .activeOffsetX([-30, 30])
    .failOffsetY([-14, 14])
    .onEnd((e) => {
      if (e.translationX < -70 || e.velocityX < -900) go(1)
      else if (e.translationX > 70 || e.velocityX > 900) go(-1)
    })
  const entering = reduce ? undefined : dir.current === 'right' ? SlideInRight.duration(240) : dir.current === 'left' ? SlideInLeft.duration(240) : FadeIn.duration(160)
  const openNebula = (n: Nebula) => {
    haptic.select()
    router.push({ pathname: '/constellations/[cid]/nebula/[nid]', params: { cid: c.id, nid: n.id } })
  }

  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightSky flies={1} />
      <View style={{ paddingTop: insets.top + 4 }}>
        <IconStrip
          current={c.id}
          onPick={(id) => {
            const i = list.findIndex((x) => x.id === c.id)
            const j = list.findIndex((x) => x.id === id)
            dir.current = j > i ? 'right' : 'left'
            switchTo(id)
          }}
          onAdd={onAdd}
        />
      </View>
      <GestureDetector gesture={swipe}>
        <Animated.View key={c.id} entering={entering} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ paddingBottom: 140 }} accessibilityHint="Swipe left or right for your other constellations">
            <ConstellationBanner
              c={c}
              width={width}
              onInvite={can(c, 'invite') ? () => router.push({ pathname: '/constellations/[cid]/settings/invites', params: { cid: c.id } }) : null}
              onSettings={() => router.push({ pathname: '/constellations/[cid]/settings', params: { cid: c.id } })}
            />
            <View style={{ paddingTop: 14, paddingHorizontal: 12 }}>
              <NebulaList c={c} onOpen={openNebula} />
            </View>
            {/* 0.7.5: a constellation with just you in it says what to do next */}
            {c.members.length === 1 && (can(c, 'invite') || can(c, 'manageNebulas')) ? (
              <EmptyScene kind="constellation" small night title="Your constellation is ready" text="It’s quiet with just you. Invite a few friends, then add a voice nebula to hang out in.">
                {can(c, 'invite') ? <NightButton label="Invite friends" onPress={() => router.push({ pathname: '/constellations/[cid]/settings/invites', params: { cid: c.id } })} /> : null}
                {can(c, 'manageNebulas') ? <NightButton kind="outline" label="Add a nebula" onPress={() => router.push({ pathname: '/constellations/[cid]/settings/nebulas', params: { cid: c.id } })} /> : null}
              </EmptyScene>
            ) : null}
          </ScrollView>
        </Animated.View>
      </GestureDetector>
      <NightTabBar active="constellations" />
      {sheet ? <CreateJoinSheet initialTab="create" onClose={closeSheet} onDone={(id) => { closeSheet(); switchTo(id) }} /> : null}
    </View>
  )
}

function WideLayout({ c, nebulaParam, onAdd, sheet, closeSheet }: { c: ConstellationDetail; nebulaParam: string | null; onAdd: () => void; sheet: boolean; closeSheet: () => void }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const me = useSession((s) => s.user)
  const homeCount = useStore((s) => unreadTotal(Object.values(s.conversations)))
  const myVoice = useCall((s) => (s.call ? s.voice : null))
  const micOn = useCall((s) => s.micOn)
  const [picked, setPicked] = useState<string | null>(nebulaParam ?? lastOpen.get(c.id) ?? null)
  const [membersShown, setMembersShown] = useState(width >= 1100)
  const [q, setQ] = useState('')
  useEffect(() => {
    if (nebulaParam) setPicked(nebulaParam)
  }, [nebulaParam])
  useEffect(() => {
    setPicked(lastOpen.get(c.id) ?? null)
  }, [c.id])
  const n = c.nebulas.find((x) => x.id === picked) ?? firstNebula(c)
  const open = (x: Nebula) => {
    haptic.select()
    lastOpen.set(c.id, x.id)
    rememberCxPlace(c.id, x.id)
    setPicked(x.id)
  }
  // 0.8.0 keyboard: ⌥↑ / ⌥↓ (Alt on Android tablets) to the previous / next nebula.
  const focused = useIsFocused()
  const step = (dir: -1 | 1) => {
    const next = stepNebula(c, n?.id, dir)
    if (next) open(next)
  }
  useKeyCommand('prevNebula', () => step(-1), focused)
  useKeyCommand('nextNebula', () => step(1), focused)
  const role = me ? topRole(c, me.id) : null
  const myStatus = useStore((s) => s.myStatus?.status ?? 'online')
  const inThisVoice = !!myVoice && !!n && myVoice.nebulaId === n.id

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: N.deep, paddingTop: insets.top }}>
      <SideStrip current={c.id} homeCount={homeCount} onHome={() => flyHome()} onHomeHold={() => openDmDock(false)} onAll={() => router.navigate('/constellations')} onPick={(id) => switchTo(id)} onAdd={onAdd} />
      <View style={{ width: 300, backgroundColor: N.side, borderRightWidth: 1, borderRightColor: N.card2, opacity: inThisVoice ? 0.5 : 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 12 }}>
          {me ? <Face user={me} size={40} me /> : null}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text size={15} weight="bold" numberOfLines={1}>
              {me?.displayName}
            </Text>
            <Text size={12} weight="bold" numberOfLines={1} style={{ color: role ? roleColor(role) : N.muted }}>
              {role?.name ?? 'Member'} · {STATUS_WORD[myStatus === 'invisible' ? 'offline' : (myStatus as keyof typeof STATUS_WORD)] ?? 'Online'}
            </Text>
          </View>
          {myVoice ? (
            <Pressable accessibilityRole="button" accessibilityLabel={micOn ? 'Mute microphone' : 'Unmute microphone'} onPress={() => void setMic(!micOn)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.card2, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={micOn ? 'mic' : 'micOff'} size={18} color={N.ink2} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`${c.name} settings`} onPress={() => router.push({ pathname: '/constellations/[cid]/settings', params: { cid: c.id } })} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.card2, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="gear" size={18} color={N.ink2} />
          </Pressable>
        </View>
        <SideBanner c={c} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 10, paddingBottom: 40 }}>
          <NebulaList c={c} onOpen={open} selected={n?.id} dense />
        </ScrollView>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        {n ? (
          n.kind === 'voice' ? (
            inThisVoice ? (
              <VoiceStage wide />
            ) : (
              <VoiceLobby key={n.id} c={c} n={n} />
            )
          ) : n.kind === 'stage' ? (
            <StageLobby key={n.id} c={c} n={n} />
          ) : (
            <NebulaChat key={n.id} c={c} n={n} wide={{ membersShown, toggleMembers: () => setMembersShown((v) => !v) }} />
          )
        ) : (
          <NightCenter>
            <Text size={15} style={{ color: N.muted }}>
              No nebulas here yet.
            </Text>
          </NightCenter>
        )}
      </View>
      {membersShown && n?.kind === 'text' ? (
        <View style={{ width: 250, backgroundColor: N.side, borderLeftWidth: 1, borderLeftColor: N.card2 }}>
          <View style={{ padding: 12, paddingTop: 14 }}>
            <SearchBox value={q} onChange={setQ} placeholder="Search members" />
          </View>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 40 }}>
            <MemberList c={c} query={q} compact onPick={(m) => openMemberSheet(c.id, m.user.id)} />
          </ScrollView>
        </View>
      ) : null}
      {sheet ? <CreateJoinSheet initialTab="create" onClose={closeSheet} onDone={(id) => { closeSheet(); switchTo(id) }} /> : null}
    </View>
  )
}
