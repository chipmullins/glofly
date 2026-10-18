import { useState } from 'react'
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native'
import { router, usePathname } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { canControlWatch, voiceLine, type ConstellationDetail, type Nebula, type PublicUser } from '@glofly/shared'
import { useSession } from '@/state/session'
import { useStore } from '@/state/store'
import { useCx } from '@/state/constellations'
import { firstName, timer } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { hangUp, joinVoiceNebula, setCamera, setMic, useCall, type Tile } from '@/calls/controller'
import { CallVideo } from '@/calls/media'
import { ROUTE_ICON, ROUTE_LABEL, useAudioRoute } from '@/calls/audioRoute'
import { featured } from '@/calls/CallPip'
import { useWatchStore } from '@/calls/watch'
import { StartWatchSheet, WatchPortrait } from '@/calls/WatchMode'
import { Avatar } from '@/ui/Avatar'
import { Icon, type IconName } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { haptic } from './motion'
import { openMemberSheet } from './Members'
import { NightModal } from './sheet'
import { NightSky } from './sky'
import { Face, Glyph, Live, N, NightButton, SpeakerGlyph } from './ui'

// Voice nebulas on phones (canvas board 5): the lobby (drop in, nobody is rung), the stage
// (a shared screen big, cameras in 16:9 tiles; phones watch shares, sharing from a phone comes
// later), and the green in-voice bar on the night side when the stage is minimized.

function useVoicePeople(c: ConstellationDetail, n: Nebula): PublicUser[] {
  const people = useStore((s) => s.people)
  const state = c.voice.find((v) => v.nebulaId === n.id)
  return (state?.userIds ?? []).map((id) => people[id] ?? c.members.find((m) => m.user.id === id)?.user).filter((p): p is PublicUser => !!p)
}

const RING_SPOTS = [
  { left: 76, top: 20, size: 58 },
  { left: 26, top: 116, size: 54 },
  { left: 130, top: 116, size: 54 },
  { left: 20, top: 40, size: 44 },
  { left: 146, top: 40, size: 44 },
]

/** The lobby: who's there, your mic / camera to start with, and Join voice. */
export function VoiceLobby({ c, n }: { c: ConstellationDetail; n: Nebula }) {
  const insets = useSafeAreaInsets()
  const inIt = useVoicePeople(c, n)
  const state = c.voice.find((v) => v.nebulaId === n.id)
  const mine = useCall((s) => s.voice?.nebulaId === n.id && !!s.call)
  const connecting = useCall((s) => s.connecting)
  const [mic, setMicPick] = useState(true)
  const [cam, setCamPick] = useState(false)
  const sharer = state?.sharing[0] ? inIt.find((p) => p.id === state.sharing[0]) : null

  async function join() {
    haptic.light()
    await joinVoiceNebula({ constellationId: c.id, nebulaId: n.id, nebulaName: n.name, constellationName: c.name }, cam)
    if (!mic && useCall.getState().voice?.nebulaId === n.id) void setMic(false)
  }

  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightSky flies={2} />
      <View style={{ paddingTop: insets.top + 6, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${c.name}`} onPress={() => (router.canGoBack() ? router.back() : router.replace({ pathname: '/constellations/[cid]', params: { cid: c.id } }))} style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chevronLeft" size={24} color={N.ink} strokeWidth={2.2} />
        </Pressable>
        <Text size={13} style={{ flex: 1, color: N.muted }}>
          {c.name} · Voice
        </Text>
      </View>
      <ScrollView contentContainerStyle={{ alignItems: 'center', gap: 14, paddingTop: 22, paddingHorizontal: 24, paddingBottom: 200 }}>
        <View accessibilityLabel={inIt.length ? `${inIt.length} in voice` : 'Nobody here yet'} style={{ width: 210, height: 210, borderRadius: 105, backgroundColor: 'rgba(28,18,16,0.7)', alignItems: 'center', justifyContent: 'center' }}>
          {inIt.slice(0, RING_SPOTS.length).map((p, i) => {
            const spot = RING_SPOTS[i]
            return <Face key={p.id} user={p} size={spot.size} style={{ position: 'absolute', left: spot.left, top: spot.top }} ring={i === 0 && state?.live ? `0 0 0 3px ${N.amber}` : undefined} />
          })}
          <View style={inIt.length ? { position: 'absolute', left: 93, top: 92 } : undefined}>
            <SpeakerGlyph size={inIt.length ? 24 : 54} color={N.greenText} waves={2} />
          </View>
        </View>
        <Text display size={30} style={{ marginTop: 6, textAlign: 'center' }} accessibilityRole="header">
          {n.name}
        </Text>
        <Text size={15} style={{ color: N.ink2 }}>
          Drop in any time · no ringing
        </Text>
        {inIt.length ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: N.card2 }}>
            <Text size={13}>{voiceLine(inIt.slice(0, 3), n.name, inIt.length).replace(` in ${n.name}`, inIt.length === 1 ? ' is here' : ' are here')}</Text>
            {state?.live ? <Live /> : null}
          </View>
        ) : (
          <Text size={13} style={{ color: N.muted }}>
            Nobody's here yet. Join and others can drop in.
          </Text>
        )}
        {sharer ? (
          <Text size={13} style={{ color: N.muted }}>
            {firstName(sharer.displayName, sharer.username)} is sharing their screen
          </Text>
        ) : null}
      </ScrollView>
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: insets.bottom + 24, gap: 14 }}>
        {mine ? null : (
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16 }}>
            <RoundToggle icon={mic ? 'mic' : 'micOff'} label={mic ? 'Microphone on' : 'Microphone off'} on={mic} onPress={() => setMicPick(!mic)} />
            <RoundToggle icon={cam ? 'video' : 'videoOff'} label={cam ? 'Camera on' : 'Camera off'} on={cam} onPress={() => setCamPick(!cam)} />
          </View>
        )}
        {mine ? (
          <NightButton kind="green" height={54} label="You're in · Open voice" onPress={() => router.push('/constellations/voice')} />
        ) : (
          <NightButton kind="green" height={54} label={connecting ? 'Joining…' : 'Join voice'} busy={connecting} onPress={() => void join()} />
        )}
      </View>
    </View>
  )
}

function RoundToggle({ icon, label, on, onPress }: { icon: IconName; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={() => { haptic.select(); onPress() }} style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: N.raised, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={22} color={on ? N.ink : N.faint} />
    </Pressable>
  )
}

// ───────────── The stage ─────────────

function nameFor(t: Tile, meId: string, people: Record<string, PublicUser>) {
  if (t.userId === meId) return 'You'
  const p = people[t.userId]
  return p ? firstName(p.displayName, p.username) : 'Someone'
}

/** Joined: the shared screen big, everyone in 16:9 tiles, and the controls. */
export function VoiceStage({ wide }: { wide?: boolean }) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const s = useCall()
  const audio = useAudioRoute()
  const meId = useSession((x) => x.user?.id ?? '')
  const people = useStore((x) => x.people)
  const c = useCx((x) => (s.voice ? x.details[s.voice.constellationId] : undefined))
  const state = c?.voice.find((v) => v.nebulaId === s.voice?.nebulaId)
  const watchState = useWatchStore((x) => (s.call && x.callId === s.call.id ? x.watch : null))
  const [watchSheet, setWatchSheet] = useState<'start' | 'change' | null>(null)
  const [full, setFull] = useState(false)
  const [who, setWho] = useState(false)
  const now = useNow(1000)

  if (!s.call || !s.voice) {
    return (
      <View style={{ flex: 1, backgroundColor: N.deep, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 }}>
        <SpeakerGlyph size={40} color={N.faint} />
        <Text size={15} style={{ color: N.muted, textAlign: 'center' }}>
          You're not in a voice nebula right now.
        </Text>
        <NightButton kind="outline" label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/constellations'))} />
      </View>
    )
  }
  const voice = s.voice
  const modMuted = !!state?.muted.includes(meId)
  const screenTile = featured(s.tiles).video === 'screen' ? featured(s.tiles).tile : null
  const screen = screenTile?.screen ?? null
  const watch = watchState
  const canWatchControl = !!watch && canControlWatch(watch, meId)
  const started = s.call.answeredAt ?? s.call.createdAt
  const tiles = s.tiles
  const inner = (wide ? width - 80 - 260 : width) - (wide ? 40 : 24)
  const cols = wide ? 4 : 2
  const tileW = Math.floor((Math.min(inner, wide ? 900 : 600) - (cols - 1) * (wide ? 10 : 8)) / cols)
  const bigH = wide ? Math.min(450, Math.round(inner * 0.56)) : Math.round((inner * 9) / 16)
  const minimize = () => {
    haptic.light()
    if (router.canGoBack()) router.back()
    else router.replace({ pathname: '/constellations/[cid]', params: { cid: voice.constellationId } })
  }
  const leave = async () => {
    haptic.medium()
    await hangUp()
    if (router.canGoBack()) router.back()
  }
  const personOf = (id: string): PublicUser => people[id] ?? { id, username: 'someone', displayName: 'Someone', avatarVersion: null } as PublicUser

  return (
    <View style={{ flex: 1, backgroundColor: N.deep }}>
      <View style={{ paddingTop: (wide ? 14 : insets.top + 6), paddingHorizontal: wide ? 20 : 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {wide ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel="Minimize" accessibilityHint="Keeps you in voice" onPress={minimize} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.card, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevronDown" size={22} color={N.ink} strokeWidth={2.2} />
          </Pressable>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <SpeakerGlyph size={16} color={N.greenText} waves={2} />
            <Text size={wide ? 18 : 16} weight="bold" numberOfLines={1} accessibilityRole="header">
              {voice.nebulaName}
            </Text>
            {wide && state?.live ? <Live /> : null}
          </View>
          <Text size={12} numberOfLines={1} style={{ color: N.muted }}>
            {voice.constellationName} · {tiles.length} in voice · {s.connecting ? 'connecting…' : timer(started, now)}
          </Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="People in voice" onPress={() => setWho(true)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.card, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="friends" size={20} color={N.ink2} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: wide ? 20 : 12, paddingTop: 14, paddingBottom: 140 + insets.bottom, gap: 10 }}>
        {watch ? (
          <WatchPortrait watch={watch} meId={meId} people={personOf} tiles={tiles} conversationId={s.call.conversationId} />
        ) : screen && screenTile ? (
          <View style={{ height: bigH, borderRadius: 16, overflow: 'hidden', backgroundColor: '#000' }}>
            <CallVideo track={screen} contain style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
            <View style={{ position: 'absolute', left: 10, bottom: 10, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.6)' }}>
              <Live small />
              <Text size={12} weight="bold" style={{ color: '#fff' }}>
                {screenTile.local ? 'Your screen' : `${nameFor(screenTile, meId, people)}'s screen`}
              </Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Full screen" onPress={() => setFull(true)} style={{ position: 'absolute', right: 8, bottom: 8, width: 44, height: 44, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="fullscreen" size={18} color="#fff" />
            </Pressable>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: wide ? 10 : 8 }}>
          {tiles.map((t) => (
            <VoiceTile key={t.userId} t={t} w={tileW} name={nameFor(t, meId, people)} person={t.userId === meId ? (useSession.getState().user as PublicUser) : personOf(t.userId)} me={t.userId === meId} mirror={t.local && s.frontCamera} modMuted={!!state?.muted.includes(t.userId)} onPress={() => !t.local && c && openMemberSheet(c.id, t.userId)} />
          ))}
        </View>
        {modMuted ? (
          <Notice icon={<Glyph name="micSlash" size={16} color={N.amber} />} text="A moderator muted you. You can still listen." />
        ) : null}
        <Notice icon={<Glyph name="screen" size={16} color={N.muted} />} text={wide ? 'Sharing from an iPad comes later. You can watch.' : 'Sharing from a phone comes later. You can watch.'} />
      </ScrollView>

      <View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: wide ? 'center' : 'space-around', gap: wide ? 14 : 0, paddingTop: 14, paddingHorizontal: 10, paddingBottom: (wide ? 22 : Math.max(insets.bottom, 14) + 8) }, wide ? null : { backgroundColor: N.bg, borderTopWidth: 1, borderTopColor: N.line }]}>
        <StageButton icon={s.micOn && !modMuted ? 'mic' : 'micOff'} label="Mute" a11y={modMuted ? 'A moderator muted you' : s.micOn ? 'Mute microphone' : 'Unmute microphone'} disabled={modMuted} onPress={() => void setMic(!s.micOn)} wide={wide} />
        <StageButton icon={s.cameraOn ? 'video' : 'videoOff'} label="Camera" a11y={s.cameraOn ? 'Turn camera off' : 'Turn camera on'} onPress={() => void setCamera(!s.cameraOn)} wide={wide} />
        {/* 0.7.1: where the voice plays (speaker, phone, Bluetooth), like the call screen's Audio */}
        <StageButton icon={audio.route ? ROUTE_ICON[audio.route] : 'speaker'} label="Audio" a11y={`Audio: ${audio.route ? ROUTE_LABEL[audio.route] : 'choose where it plays'}`} onPress={() => void audio.pick()} wide={wide} />
        <StageButton icon="screen" label="Share" a11y="Share your screen (coming later on phones)" disabled dashed wide={wide} onPress={() => {}} />
        <StageButton icon="watch" label="Watch" a11y={watch ? (canWatchControl ? 'Watching together: change the video' : 'Watching together') : 'Watch a video together'} amber onPress={() => (watch ? canWatchControl && setWatchSheet('change') : setWatchSheet('start'))} wide={wide} />
        <StageButton icon="hangup" label="Leave" a11y={`Leave ${voice.nebulaName}`} red onPress={() => void leave()} wide={wide} />
      </View>

      {watchSheet ? <StartWatchSheet changing={watchSheet === 'change'} onClose={() => setWatchSheet(null)} /> : null}
      {full && screen ? (
        <Modal visible transparent={false} animationType="fade" supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setFull(false)}>
          <View style={{ flex: 1, backgroundColor: '#000' }}>
            <CallVideo track={screen} contain style={{ flex: 1 }} />
            <Pressable accessibilityRole="button" accessibilityLabel="Exit full screen" onPress={() => setFull(false)} style={{ position: 'absolute', right: 16, top: insets.top + 12, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="close" size={20} color="#fff" />
            </Pressable>
          </View>
        </Modal>
      ) : null}
      {who && c ? <WhoSheet c={c} userIds={tiles.map((t) => t.userId)} muted={state?.muted ?? []} sharing={state?.sharing ?? []} onClose={() => setWho(false)} /> : null}
    </View>
  )
}

function Notice({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: N.card, borderWidth: 1, borderColor: N.line2 }}>
      {icon}
      <Text size={13} style={{ flex: 1, color: N.ink2 }}>
        {text}
      </Text>
    </View>
  )
}

function VoiceTile({ t, w, name, person, me, mirror, modMuted, onPress }: { t: Tile; w: number; name: string; person: PublicUser; me: boolean; mirror: boolean; modMuted: boolean; onPress: () => void }) {
  const h = Math.round((w * 9) / 16)
  const talking = t.speaking && !t.micMuted
  return (
    <Pressable
      accessibilityRole={me ? undefined : 'button'}
      accessibilityLabel={`${name}${talking ? ', talking' : ''}${t.micMuted || modMuted ? ', muted' : ''}${t.camera ? ', camera on' : ''}`}
      onPress={me ? undefined : onPress}
      style={{ width: w, height: h, borderRadius: 14, overflow: 'hidden', backgroundColor: talking ? '#3a2418' : N.card2, alignItems: 'center', justifyContent: 'center', borderWidth: talking ? 2 : 0, borderColor: N.amber, boxShadow: talking ? '0 0 16px rgba(255,165,74,0.45)' : undefined }}
    >
      {t.camera ? <CallVideo track={t.camera} mirror={mirror} style={{ position: 'absolute', top: 0, left: 0, width: w, height: h }} /> : me ? <Face user={person} size={46} me /> : <Avatar user={person} size={46} />}
      <View style={{ position: 'absolute', left: 8, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.55)' }}>
        {t.micMuted || modMuted ? <Icon name="micOff" size={11} color={modMuted ? N.amber : '#fff'} /> : null}
        <Text size={11} weight="bold" style={{ color: '#fff' }}>
          {name}
        </Text>
      </View>
    </Pressable>
  )
}

function StageButton({ icon, label, a11y, onPress, disabled, dashed, amber, red, wide }: { icon: IconName; label: string; a11y: string; onPress: () => void; disabled?: boolean; dashed?: boolean; amber?: boolean; red?: boolean; wide?: boolean }) {
  const bg = red ? N.red : amber ? 'rgba(255,179,71,0.14)' : dashed ? N.card : N.raised
  const fg = red ? '#fff' : amber ? N.amber : dashed ? N.dim : N.ink
  const text = red ? N.redText : amber ? N.amber : dashed ? N.dim : N.ink2
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={() => { haptic.light(); onPress() }} style={{ alignItems: 'center', gap: 6, opacity: disabled && !dashed ? 0.5 : 1 }}>
      <View style={{ width: wide && red ? 72 : wide ? 56 : 54, height: wide ? 56 : 54, borderRadius: 28, backgroundColor: bg, borderWidth: dashed ? 1 : 0, borderStyle: 'dashed', borderColor: N.line2, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={fg} />
      </View>
      {wide ? null : (
        <Text size={11} weight="medium" style={{ color: text }}>
          {label}
        </Text>
      )}
    </Pressable>
  )
}

/** People in voice (tap someone for their actions; moderators can mute or disconnect from there). */
function WhoSheet({ c, userIds, muted, sharing, onClose }: { c: ConstellationDetail; userIds: string[]; muted: string[]; sharing: string[]; onClose: () => void }) {
  const people = useStore((x) => x.people)
  const meId = useSession((x) => x.user?.id ?? '')
  return (
    <NightModal onClose={onClose} fit accessibilityLabel="People in voice">
      <View style={{ gap: 8, paddingBottom: 8 }}>
        <Text display size={20}>
          In voice · {userIds.length}
        </Text>
        {userIds.map((id) => {
          const p = people[id] ?? c.members.find((m) => m.user.id === id)?.user
          if (!p) return null
          return (
            <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${p.displayName}${muted.includes(id) ? ', muted by a moderator' : ''}${sharing.includes(id) ? ', sharing their screen' : ''}`} onPress={() => { onClose(); if (id !== meId) openMemberSheet(c.id, id) }} style={{ height: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Face user={p} size={38} me={id === meId} />
              <Text size={15} weight="bold" style={{ flex: 1 }} numberOfLines={1}>
                {p.displayName}
                {id === meId ? <Text size={12} style={{ color: N.faint }}>{'  you'}</Text> : null}
              </Text>
              {sharing.includes(id) ? <Live small /> : null}
              {muted.includes(id) ? <Glyph name="micSlash" size={16} color={N.amber} /> : null}
            </Pressable>
          )
        })}
      </View>
    </NightModal>
  )
}

// ───────────── Minimized: the in-voice bar ─────────────

/** Above the night tab bar while you're in a voice nebula (and a small window if someone shares). */
export function VoiceBar() {
  const call = useCall((s) => s.call)
  const voice = useCall((s) => s.voice)
  const tiles = useCall((s) => s.tiles)
  const micOn = useCall((s) => s.micOn)
  const people = useStore((s) => s.people)
  const meId = useSession((s) => s.user?.id ?? '')
  const path = usePathname()
  const c = useCx((s) => (voice ? s.details[voice.constellationId] : undefined))
  if (!call || !voice || path === '/constellations/voice') return null
  const talking = tiles.find((t) => t.speaking && !t.micMuted && t.userId !== meId)
  const talker = talking ? people[talking.userId] : null
  const modMuted = !!c?.voice.find((v) => v.nebulaId === voice.nebulaId)?.muted.includes(meId)
  const pick = featured(tiles)
  const screen = pick.video === 'screen' ? pick.tile?.screen : null
  const open = () => router.push('/constellations/voice')
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 10, right: 10, bottom: '100%', marginBottom: 10 }}>
      {screen ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Shared screen. Open voice" onPress={open} style={{ alignSelf: 'flex-end', marginBottom: 10, marginRight: 4, width: 150, height: 84, borderRadius: 14, overflow: 'hidden', backgroundColor: '#000', boxShadow: `0 14px 34px rgba(0,0,0,0.6), 0 0 0 1px ${N.edge}` }}>
          <CallVideo track={screen} contain style={{ width: 150, height: 84 }} />
          <View style={{ position: 'absolute', left: 6, top: 6 }}>
            <Live small />
          </View>
        </Pressable>
      ) : null}
      <View style={{ height: 58, paddingLeft: 12, paddingRight: 8, borderRadius: 20, backgroundColor: N.greenDeep, borderWidth: 1, borderColor: N.greenEdge, boxShadow: '0 12px 30px rgba(0,0,0,0.5)', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`In voice: ${voice.nebulaName}, ${voice.constellationName}${talker ? `, ${talker.displayName} talking` : ''}. Open voice`}
          onPress={open}
          style={{ flex: 1, minWidth: 0, height: 56, flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
        {talker ? (
          <Face user={talker} size={34} ring={`0 0 0 2px ${N.amber}`} />
        ) : (
          <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(111,211,154,0.14)', alignItems: 'center', justifyContent: 'center' }}>
            <SpeakerGlyph size={18} color={N.greenText} waves={2} />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text size={14} weight="bold" numberOfLines={1}>
            {voice.nebulaName}
          </Text>
          <Text size={12} numberOfLines={1} style={{ color: '#a7e0bf' }}>
            {voice.constellationName} · {talker ? `${firstName(talker.displayName, talker.username)} talking` : `${tiles.length} in voice`}
          </Text>
        </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={modMuted ? 'A moderator muted you' : micOn ? 'Mute' : 'Unmute'} disabled={modMuted} onPress={() => { haptic.light(); void setMic(!micOn) }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center', opacity: modMuted ? 0.5 : 1 }}>
          <Icon name={micOn && !modMuted ? 'mic' : 'micOff'} size={20} color={N.ink} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Leave ${voice.nebulaName}`} onPress={() => { haptic.medium(); void hangUp() }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: N.red, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="hangup" size={20} color="#fff" />
        </Pressable>
      </View>
    </View>
  )
}
