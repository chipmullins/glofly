import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, BackHandler, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { router } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { chatTitle, type PublicUser } from '@glofly/shared'
import type { VideoTrack } from 'livekit-client'
import { useCall, hangUp, setMic, setCamera, flipCamera, ringPeople, callDiagnostics, type Tile } from '@/calls/controller'
import { featured } from '@/calls/CallPip'
import { CallVideo, audioRoutes, currentAudioRoute, selectAudioRoute, type AudioRoute } from '@/calls/media'
import { useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { timer } from '@/lib/format'
import { allowRotation, lockPortrait } from '@/lib/orientation'
import { useNow } from '@/lib/hooks'
import { Avatar } from '@/ui/Avatar'
import { BottomSheet, chooseFrom } from '@/ui/dialogs'
import { FriendPicker } from '@/ui/FriendPicker'
import { Icon, type IconName } from '@/ui/icons'
import { Button, Text } from '@/ui/kit'
import { call as callColors } from '@/ui/theme'
import { canControlWatch } from '@glofly/shared'
import { useWatchStore } from '@/calls/watch'
import { StartWatchSheet, WatchLandscape, WatchPortrait } from '@/calls/WatchMode'

// The call screen, from the design: 1-on-1 video fills the screen with your camera on top (drag
// it to any corner), voice calls show their photo with firefly glow rings, groups are a grid
// (tap someone to pin them), and a shared screen shows big with everyone below it.
// This is the one screen that turns sideways: landscape gets tiles in a row and a floating control
// bar, and turning the phone also makes your camera send a wide picture.

const ROUTE_LABEL: Record<AudioRoute, string> = { speaker: 'Speaker', earpiece: 'Phone', headset: 'Headphones', bluetooth: 'Bluetooth' }
const ROUTE_ICON: Record<AudioRoute, IconName> = { speaker: 'speaker', earpiece: 'earpiece', headset: 'speaker', bluetooth: 'bluetooth' }

export default function CallScreen() {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const s = useCall()
  const meId = useSession((x) => x.user?.id ?? '')
  const people = useStore((x) => x.people)
  const me = useSession((x) => x.user)
  const chat = useStore((x) => (s.call ? x.conversations[s.call.conversationId] : undefined))
  const now = useNow(1000)
  const [pinned, setPinned] = useState<string | null>(null)
  const [route, setRoute] = useState<AudioRoute | null>(null)
  const [adding, setAdding] = useState(false)
  const [diagOpen, setDiagOpen] = useState(false)
  /** Watch Together: the Start / Change video sheet, and full screen when sideways */
  const [watchSheet, setWatchSheet] = useState<'start' | 'change' | null>(null)
  const [watchFull, setWatchFull] = useState(true)
  const watchState = useWatchStore((x) => (s.call && x.callId === s.call.id ? x.watch : null))
  const landscape = width > height

  // iPhone: show where the call is really playing (it starts on the speaker; plugging in
  // headphones or Bluetooth moves it there).
  useEffect(() => {
    const read = () => {
      const r = currentAudioRoute()
      if (r) setRoute(r)
    }
    read()
    const t = setInterval(read, 1500)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    allowRotation()
    return () => lockPortrait()
  }, [])

  const leaveScreen = () => (router.canGoBack() ? router.back() : router.replace('/chats'))

  useEffect(() => {
    if (!s.call && !s.connecting) leaveScreen()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.call, s.connecting])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      leaveScreen() // the call keeps going (the strip brings you back)
      return true
    })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const call = s.call
  const isGroup = chat?.kind === 'group'
  const personOf = (id: string): PublicUser => (id === meId && me ? me : (people[id] ?? { id, username: '', displayName: 'Someone', avatarVersion: null }))
  const others = s.tiles.filter((t) => !t.local)
  const self = s.tiles.find((t) => t.local)
  const ringing = call ? call.members.filter((m) => m.state === 'ringing' && m.userId !== meId).map((m) => m.userId) : []
  const joinedCount = call ? call.members.filter((m) => m.state === 'joined').length : 0
  const screenTile = s.tiles.find((t) => t.screen)
  const answered = !!call?.answeredAt || others.length > 0
  const status = !call
    ? 'Connecting…'
    : !answered
      ? isGroup
        ? `Ringing ${ringing.length} ${ringing.length === 1 ? 'person' : 'people'}…`
        : 'Ringing…'
      : isGroup
        ? `${joinedCount} of ${call.members.length} joined · ${timer(call.answeredAt ?? call.createdAt, now)}`
        : timer(call.answeredAt ?? call.createdAt, now)
  const title = chat ? chatTitle(chat) : 'Call'
  const meJoined = !!call?.members.some((m) => m.userId === meId && m.state === 'joined')
  const watch = meJoined ? watchState : null
  const canWatchControl = !!watch && canControlWatch(watch, meId)
  const watchingFull = !!watch && landscape && watchFull

  async function pickRoute() {
    const routes = await audioRoutes()
    if (!routes.length) return
    const pick = await chooseFrom(
      routes.map((r) => ({ key: r, label: ROUTE_LABEL[r] ?? r, icon: ROUTE_ICON[r] ?? 'speaker', checked: r === route })),
      'Play the call on',
    )
    if (!pick) return
    await selectAudioRoute(pick as AudioRoute)
    setRoute(pick as AudioRoute)
  }

  // Room taken by the title bar and controls (landscape: slimmer bar, floating controls).
  const barH = landscape ? 48 : 60
  const topSpace = insets.top + (landscape ? barH + 4 : 64)
  const bottomSpace = landscape ? 84 + insets.bottom : 140 + insets.bottom
  const sidePad = { paddingLeft: insets.left, paddingRight: insets.right }

  const oneOnOneVideo = !isGroup && !screenTile && others[0]?.camera
  const voiceOnly = !isGroup && !screenTile && !others[0]?.camera

  return (
    <View style={{ flex: 1, backgroundColor: callColors.bg }}>
      {/* Main area */}
      <View style={{ flex: 1 }}>
        {watch && !landscape && call ? (
          <WatchPortrait watch={watch} meId={meId} people={personOf} tiles={s.tiles} conversationId={call.conversationId} top={insets.top + 64} bottom={bottomSpace + 6} />
        ) : screenTile ? (
          <View style={{ flex: 1, paddingTop: landscape ? topSpace : insets.top + 60, paddingBottom: landscape ? bottomSpace - 8 : 0, ...sidePad }}>
            <View style={{ flex: 1, backgroundColor: '#000' }} accessibilityLabel={`${personOf(screenTile.userId).displayName}'s shared screen`}>
              <CallVideo track={screenTile.screen!} contain style={{ flex: 1 }} pip={!screenTile.local} shape={[16, 9]} />
              <View style={{ position: 'absolute', left: 12, bottom: 12, paddingHorizontal: 12, height: 30, borderRadius: 15, backgroundColor: 'rgba(28,18,16,0.6)', justifyContent: 'center' }}>
                <Text size={13} weight="bold" style={{ color: '#FFF' }}>
                  {screenTile.local ? 'You are sharing your screen' : `${personOf(screenTile.userId).displayName.split(' ')[0]} is sharing their screen`}
                </Text>
              </View>
            </View>
            {landscape ? null : (
              <>
                <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ padding: 10, gap: 8 }}>
                  {s.tiles.map((t) => (
                    <TileView key={t.userId} tile={t} person={personOf(t.userId)} w={120} h={90} fill />
                  ))}
                </ScrollView>
                <Text size={12} style={{ color: callColors.faint, textAlign: 'center', paddingBottom: 6 }}>
                  Turn your phone sideways to see it bigger
                </Text>
              </>
            )}
          </View>
        ) : oneOnOneVideo ? (
          <View style={{ flex: 1 }}>
            {/* Whole picture, never cropped: a computer's wide camera on an upright phone would otherwise be
                a zoomed-in slice of the middle (faces cut off when someone sits off to the side). */}
            <CallVideo track={others[0].camera!} contain style={{ position: 'absolute', top: 0, left: 0, width, height }} zOrder={0} pip />
            <View style={{ position: 'absolute', left: 16 + insets.left, bottom: bottomSpace }}>{others[0].speaking ? <TalkingTag name={personOf(others[0].userId).displayName} /> : null}</View>
          </View>
        ) : !answered && s.cameraOn && self?.camera ? (
          <View style={{ flex: 1 }}>
            <CallVideo track={self.camera} mirror={s.frontCamera} style={{ position: 'absolute', top: 0, left: 0, width, height }} />
            <View style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(18,13,11,0.35)' }} />
            <VoiceStage person={chat?.kind === 'dm' ? chat.partner : personOf(meId)} speaking={false} ringing compact={landscape} />
          </View>
        ) : voiceOnly ? (
          <VoiceStage person={others[0] ? personOf(others[0].userId) : chat?.kind === 'dm' ? chat.partner : personOf(meId)} speaking={!!others[0]?.speaking} ringing={!answered} compact={landscape} />
        ) : (
          <Grid
            tiles={s.tiles}
            ringing={ringing}
            personOf={personOf}
            pinned={pinned}
            onPin={(id) => setPinned((p) => (p === id ? null : id))}
            top={topSpace}
            bottom={bottomSpace}
            left={insets.left}
            right={insets.right}
            pipId={pinned && s.tiles.some((t) => t.userId === pinned && !t.local && t.camera) ? pinned : featured(s.tiles).video === 'camera' ? featured(s.tiles).tile?.userId : null}
          />
        )}
      </View>

      {/* Your camera on top in 1-on-1 video */}
      {oneOnOneVideo && !watch && self?.camera ? <SelfPip track={self.camera} mirror={s.frontCamera} top={topSpace + 6} bottom={bottomSpace + 10} landscape={landscape} /> : null}

      {/* Title bar */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top, ...sidePad, backgroundColor: oneOnOneVideo || (landscape && screenTile) ? 'rgba(18,13,11,0.45)' : 'transparent' }}>
        <View style={{ height: barH, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, gap: 4 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to chat, call keeps going" onPress={leaveScreen} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="chevronDown" size={26} color="#FFFFFF" />
          </Pressable>
          {/* Long-press the title: call diagnostics (for tracking down audio/camera problems). */}
          <Pressable onLongPress={() => setDiagOpen(true)} delayLongPress={600} style={{ flex: 1, alignItems: 'center' }}>
            <Text size={17} weight="bold" numberOfLines={1} style={{ color: '#FFF' }}>
              {title}
            </Text>
            <Text size={13} weight={watch ? 'bold' : 'regular'} style={{ color: watch ? '#FFB36A' : callColors.muted }}>
              {watch ? `Watching together · ${joinedCount}` : status}
            </Text>
          </Pressable>
          {canWatchControl ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Change video" onPress={() => setWatchSheet('change')} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="swapVideo" size={22} color="#FFFFFF" />
            </Pressable>
          ) : isGroup ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Add people to call" onPress={() => setAdding(true)} style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="addPerson" size={22} color="#FFFFFF" />
            </Pressable>
          ) : (
            <View style={{ width: 48 }} />
          )}
        </View>
      </View>

      {/* Controls */}
      <View
        style={
          landscape
            ? // Sideways: a floating bar in the middle, so the video gets the height
              { position: 'absolute', bottom: insets.bottom + 10, alignSelf: 'center', padding: 8, borderRadius: 28, backgroundColor: 'rgba(42,28,23,0.92)' }
            : { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, paddingHorizontal: 16, paddingBottom: insets.bottom + 18, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#2A1C17' }
        }
      >
        {landscape ? null : <View style={{ alignSelf: 'center', width: 32, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', marginBottom: 14 }} />}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: landscape ? 14 : 0 }}>
          <CtrlButton icon={s.cameraOn ? 'video' : 'videoOff'} label={s.cameraOn ? 'Turn camera off' : 'Turn camera on'} on={s.cameraOn} onPress={() => void setCamera(!s.cameraOn)} />
          <CtrlButton icon={s.micOn ? 'mic' : 'micOff'} label={s.micOn ? 'Mute microphone' : 'Unmute microphone'} on={!s.micOn} onPress={() => void setMic(!s.micOn)} />
          {s.cameraOn ? <CtrlButton icon="flip" label="Switch camera" onPress={() => void flipCamera()} /> : <CtrlButton icon={route ? ROUTE_ICON[route] : 'speaker'} label={`Audio: ${route ? ROUTE_LABEL[route] : 'choose where it plays'}`} onPress={() => void pickRoute()} />}
          {s.cameraOn ? <CtrlButton icon={route ? ROUTE_ICON[route] : 'speaker'} label={`Audio: ${route ? ROUTE_LABEL[route] : 'choose where it plays'}`} onPress={() => void pickRoute()} /> : null}
          {/* Watch Together: a YouTube video for everyone in the call (lit while watching). */}
          {meJoined && answered ? (
            <CtrlButton
              icon="watch"
              label={watch ? (landscape ? 'Watching together: full screen' : canWatchControl ? 'Watching together: change the video' : 'Watching together') : 'Watch a video together'}
              lit={!!watch}
              onPress={() => {
                if (watch && landscape) setWatchFull(true)
                else if (watch) {
                  if (canWatchControl) setWatchSheet('change')
                } else setWatchSheet('start')
              }}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isGroup ? 'Leave call' : 'Hang up'}
            onPress={() => void hangUp()}
            style={{ width: 84, height: 56, borderRadius: 28, backgroundColor: '#D33A2C', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(211,58,44,0.45)' }}
          >
            <Icon name="hangup" size={26} color="#FFFFFF" fill="#FFFFFF" />
          </Pressable>
        </View>
      </View>

      {/* Watch Together sideways: the video fills the screen (over everything else). */}
      {watchingFull && watch ? <WatchLandscape watch={watch} meId={meId} people={personOf} tiles={s.tiles} onExit={() => setWatchFull(false)} /> : null}

      {watchSheet ? <StartWatchSheet changing={watchSheet === 'change'} onClose={() => setWatchSheet(null)} /> : null}

      {diagOpen ? <CallDiagnostics onClose={() => setDiagOpen(false)} /> : null}

      {adding && call ? (
        <AddToCall
          exclude={call.members.filter((m) => m.state !== 'out').map((m) => m.userId)}
          inChat={chat?.members.map((m) => m.id) ?? []}
          onDone={(ids) => {
            setAdding(false)
            void ringPeople(ids)
          }}
        />
      ) : null}
    </View>
  )
}

function CtrlButton({ icon, label, on, lit, onPress }: { icon: IconName; label: string; on?: boolean; lit?: boolean; onPress: () => void }) {
  // on: switched off (muted, camera off) · lit: Watch Together is on (orange, like the design)
  const bg = lit ? '#F47A1F' : on ? '#F3E6DC' : '#3A2A22'
  const fg = lit ? '#2A1406' : on ? '#1C1210' : '#FFFFFF'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!on || !!lit }}
      onPress={onPress}
      style={{ width: 52, height: 56, borderRadius: 18, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={24} color={fg} />
    </Pressable>
  )
}

function TalkingTag({ name }: { name: string }) {
  return (
    <View style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, backgroundColor: 'rgba(28,18,16,0.6)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFA54A', boxShadow: '0 0 8px 2px rgba(255,165,74,0.8)' }} />
      <Text size={13} weight="bold" style={{ color: '#FFF' }}>
        {name.split(' ')[0]} is talking
      </Text>
    </View>
  )
}

function VoiceStage({ person, speaking, ringing, compact }: { person: PublicUser; speaking: boolean; ringing: boolean; compact?: boolean }) {
  // Sideways there's little height: a smaller photo and rings.
  const k = compact ? 0.62 : 1
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, useNativeDriver: true }))
    loop.start()
    return () => loop.stop()
  }, [pulse])
  const ring = (delay: number, size: number) => (
    <Animated.View
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: callColors.glow,
        opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [ringing || speaking ? 0.55 - delay : 0.18, 0] }),
        transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
      }}
    />
  )
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: compact ? 8 : 24, paddingBottom: compact ? 70 : 120, paddingTop: compact ? 30 : 0 }}>
      <View style={{ alignItems: 'center', justifyContent: 'center', width: 260 * k, height: 260 * k }}>
        {ring(0, 200 * k)}
        {ring(0.15, 240 * k)}
        <View style={{ borderRadius: 90, boxShadow: speaking ? '0 0 0 4px #FFA54A, 0 0 32px rgba(255,165,74,0.6)' : '0 0 40px rgba(255,179,71,0.25)' }}>
          <Avatar user={person} size={160 * k} />
        </View>
      </View>
      <Text display size={compact ? 22 : 28} style={{ color: '#FFF' }}>
        {person.displayName}
      </Text>
    </View>
  )
}

function TileView({ tile, person, w, h, ringing, onPress, fill, pip }: { tile: Tile | null; person: PublicUser; w: number; h: number; ringing?: boolean; onPress?: () => void; fill?: boolean; pip?: boolean }) {
  const talking = tile?.speaking
  // Only your front camera's picture is mirrored (like a mirror); the back camera shows the world as it is.
  const frontCamera = useCall((s) => s.frontCamera)
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${person.displayName}${ringing ? ', ringing' : ''}${tile?.micMuted ? ', muted' : ''}${onPress ? '. Tap to pin' : ''}`}
      onPress={onPress}
      style={{ width: w, height: h, borderRadius: 16, overflow: 'hidden', backgroundColor: callColors.tile, alignItems: 'center', justifyContent: 'center', borderWidth: talking ? 3 : 0, borderColor: '#FFA54A' }}
    >
      {tile?.camera ? (
        // fill: the video covers the tile (edges trimmed) like FaceTime, instead of a narrow strip with
        // bars beside it. A pinned (big) tile shows the whole picture.
        <CallVideo track={tile.camera} mirror={tile.local && frontCamera} contain={!fill} style={{ position: 'absolute', top: 0, left: 0, width: w, height: h }} pip={pip && !tile.local} />
      ) : (
        <View style={{ opacity: ringing ? 0.85 : 1, borderRadius: 60, boxShadow: ringing ? '0 0 24px rgba(255,179,71,0.6)' : undefined }}>
          <Avatar user={person} size={Math.min(w, h) * 0.42} />
        </View>
      )}
      <View style={{ position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, height: 24, borderRadius: 12, backgroundColor: 'rgba(18,13,11,0.6)' }}>
        {tile?.micMuted ? <Icon name="micOff" size={12} color="#FFF" /> : null}
        <Text size={12} weight="bold" style={{ color: '#FFF' }} numberOfLines={1}>
          {tile?.local ? 'You' : person.displayName.split(' ')[0]}
          {ringing ? ' · Ringing…' : ''}
        </Text>
      </View>
    </Pressable>
  )
}

function Grid({ tiles, ringing, personOf, pinned, onPin, top, bottom, left = 0, right = 0, pipId }: { tiles: Tile[]; ringing: string[]; personOf: (id: string) => PublicUser; pinned: string | null; onPin: (id: string) => void; top: number; bottom: number; left?: number; right?: number; pipId?: string | null }) {
  const { width: screenW, height } = useWindowDimensions()
  const width = screenW - left - right
  const landscape = screenW > height
  const all = useMemo(() => [...tiles.map((t) => ({ id: t.userId, tile: t as Tile | null, ringing: false })), ...ringing.filter((id) => !tiles.some((t) => t.userId === id)).map((id) => ({ id, tile: null, ringing: true }))], [tiles, ringing])
  const available = height - top - bottom
  const pin = pinned ? all.find((x) => x.id === pinned) : null
  if (pin) {
    const rest = all.filter((x) => x.id !== pin.id)
    // Pinned: the whole picture big, everyone else small beside it (sideways) or below it (upright).
    const stripW = landscape ? 150 : width - 20
    return (
      <View style={{ position: 'absolute', top, left, right, bottom, padding: 10, gap: 10, flexDirection: landscape ? 'row' : 'column' }}>
        <TileView tile={pin.tile} person={personOf(pin.id)} w={landscape ? width - 20 - 10 - stripW : width - 20} h={landscape ? available - 20 : available - 130} ringing={pin.ringing} onPress={() => onPin(pin.id)} pip={pin.id === pipId} />
        <ScrollView horizontal={!landscape} contentContainerStyle={{ gap: 8 }}>
          {rest.map((x) => (
            <TileView key={x.id} tile={x.tile} person={personOf(x.id)} w={landscape ? stripW : 130} h={100} ringing={x.ringing} onPress={() => onPin(x.id)} fill pip={x.id === pipId} />
          ))}
        </ScrollView>
      </View>
    )
  }
  // Pick the number of columns that makes the tiles biggest for this screen shape: upright, 3
  // people are 2 + 1; sideways they're 3 in a row. Past ~9 people the tiles scroll.
  const n = Math.max(all.length, 1)
  const gap = 8
  const innerW = width - 20
  const innerH = available - 20
  let best = { cols: 1, w: innerW, h: innerH, score: -1 }
  for (let cols = 1; cols <= Math.min(n, 4); cols++) {
    const rows = Math.ceil(n / cols)
    const w = (innerW - (cols - 1) * gap) / cols
    const h = (innerH - (rows - 1) * gap) / rows
    const score = Math.min(w, h) // the tile's short side: how big a face can be
    if (score > best.score) best = { cols, w, h, score }
  }
  let { w, h } = best
  if (best.score < 110) {
    // Too many people for one screen: fixed-size tiles that scroll.
    const cols = landscape ? 4 : 3
    w = (innerW - (cols - 1) * gap) / cols
    h = landscape ? w * 0.75 : w * 1.3
  }
  return (
    <ScrollView style={{ position: 'absolute', top, left, right, bottom }} contentContainerStyle={{ padding: 10, flexDirection: 'row', flexWrap: 'wrap', gap, justifyContent: 'center', minHeight: available, alignContent: 'center' }}>
      {all.map((x) => (
        <TileView key={x.id} tile={x.tile} person={personOf(x.id)} w={w} h={h} ringing={x.ringing} onPress={() => onPin(x.id)} fill pip={x.id === pipId} />
      ))}
    </ScrollView>
  )
}

/** Your camera on top: drag it, and it snaps to the nearest corner. */
function SelfPip({ track, mirror, top, bottom, landscape }: { track: VideoTrack; mirror: boolean; top: number; bottom: number; landscape: boolean }) {
  const { width, height } = useWindowDimensions()
  // A phone camera's own shape (9:16, or 16:9 with the phone sideways), shown whole, so nothing
  // of your face is cut off.
  // An iPad's screen is much bigger: a bigger self view, same shape.
  const k = Math.min(width, height) >= 700 ? 1.6 : 1
  const W = (landscape ? 192 : 108) * k
  const H = (landscape ? 108 : 192) * k
  const pos = useRef(new Animated.ValueXY({ x: width - W - 14, y: top })).current
  useEffect(() => {
    // Turned the phone: back to the top-right corner of the new screen.
    pos.setValue({ x: width - W - 14, y: top })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height])
  const start = useRef({ x: 0, y: 0 })
  const gesture = Gesture.Pan()
    .runOnJS(true)
    .onBegin(() => {
      // @ts-expect-error Animated values hold their current number
      start.current = { x: pos.x._value, y: pos.y._value }
    })
    .onUpdate((e) => pos.setValue({ x: start.current.x + e.translationX, y: start.current.y + e.translationY }))
    .onEnd((e) => {
      const x = start.current.x + e.translationX
      const y = start.current.y + e.translationY
      const toX = x + W / 2 < width / 2 ? 14 : width - W - 14
      const toY = y + H / 2 < height / 2 ? top : height - bottom - H
      Animated.spring(pos, { toValue: { x: toX, y: toY }, useNativeDriver: false }).start()
    })
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View accessibilityLabel="Your camera (drag to move)" style={{ position: 'absolute', left: pos.x, top: pos.y, width: W, height: H, borderRadius: 16, overflow: 'hidden', backgroundColor: '#2E3A44', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}>
        <CallVideo track={track} mirror={mirror} contain style={{ width: W, height: H }} zOrder={1} />
      </Animated.View>
    </GestureDetector>
  )
}

function AddToCall({ exclude, inChat, onDone }: { exclude: string[]; inChat: string[]; onDone: (ids: string[]) => void }) {
  const [picked, setPicked] = useState<string[]>([])
  const notIn = (useStore.getState().friends.friends.map((f) => f.id) as string[]).filter((id) => !inChat.includes(id))
  return (
    <BottomSheet onClose={() => onDone([])}>
      <View style={{ height: 480 }}>
        <Text display size={20} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
          Add people to call
        </Text>
        <View style={{ flex: 1 }}>
          <FriendPicker selected={picked} onToggle={(f) => setPicked((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p, f.id]))} exclude={[...exclude, ...notIn]} />
        </View>
        <View style={{ padding: 16 }}>
          <Button label={picked.length ? `Ring ${picked.length}` : 'Pick people in the group'} disabled={!picked.length} onPress={() => onDone(picked)} />
        </View>
      </View>
    </BottomSheet>
  )
}

/** Call diagnostics: live call/audio state and a log of the call, refreshed every second. */
function CallDiagnostics({ onClose }: { onClose: () => void }) {
  useNow(1000)
  const { rows, log } = callDiagnostics()
  const text = [...rows.map(([k, v]) => `${k}: ${v}`), '', ...log].join('\n')
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ height: 520 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 8 }}>
          <Text display size={20} style={{ flex: 1 }}>
            Call diagnostics
          </Text>
          <Button label="Copy" onPress={() => void Clipboard.setStringAsync(text)} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
          {rows.map(([k, v], i) => (
            <View key={`${k}-${i}`} style={{ flexDirection: 'row', gap: 10, paddingVertical: 3 }}>
              <Text size={12} weight="bold" style={{ width: 130 }}>
                {k}
              </Text>
              <Text size={12} style={{ flex: 1 }}>
                {v}
              </Text>
            </View>
          ))}
          <Text size={12} weight="bold" style={{ marginTop: 14, marginBottom: 4 }}>
            Log
          </Text>
          {log.map((l, i) => (
            <Text key={i} size={12}>
              {l}
            </Text>
          ))}
        </ScrollView>
      </View>
    </BottomSheet>
  )
}
