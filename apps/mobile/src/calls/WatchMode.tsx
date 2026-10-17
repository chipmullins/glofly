import { useCallback, useEffect, useRef, useState } from 'react'
import { Animated, Easing, Image, Pressable, ScrollView, TextInput, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { canControlWatch, eventText, videoTime, watchActionText, watchPositionAt, WATCH_REACTIONS, youTubeIdFrom, type PublicUser, type WatchControl, type WatchPreview, type WatchReaction, type WatchState } from '@glofly/shared'
import Svg, { Ellipse, Path } from 'react-native-svg'
import * as api from '@/api/glofly'
import { useStore, chatMessages } from '@/state/store'
import { loadLatest } from '@/state/sync'
import { sendText } from '@/chat/send'
import { firstName } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { Avatar } from '@/ui/Avatar'
import { BottomSheet, confirm } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Button, Field, Text } from '@/ui/kit'
import { controlWatch, reactWatch, setWatchControl, startWatching, stopWatching, useWatchStore, watchClock } from './watch'
import { WatchView } from './WatchView'
import type { PlayerState } from './watchSync'
import type { Tile } from './controller'

// Watch Together on phones (the "Glofly Watch Together" mockup, phone artboard): the video at
// the top, controls for everyone, who's here, the call's chat with firefly reactions. Sideways,
// the video fills the screen and its controls show for a few seconds after a tap.

const ORANGE = '#F47A1F'
const firstOf = (p: PublicUser) => firstName(p.displayName, p.username)

/** Stop watching (for everyone in the call), after a quick check: like the desktop app's button. */
async function askStop() {
  if (await confirm({ title: 'Stop watching?', message: 'The video stops for everyone in the call.', confirmLabel: 'Stop watching', danger: true })) stopWatching()
}

// ---------------------------------------------------------------------------------------------

export function StartWatchSheet({ changing, onClose }: { changing: boolean; onClose: () => void }) {
  const [link, setLink] = useState('')
  const [control, setControl] = useState<WatchControl>('everyone')
  const [found, setFound] = useState<{ id: string; preview: WatchPreview | null; problem: string | null } | null>(null)
  const [startProblem, setStartProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const id = youTubeIdFrom(link)
  const answer = found && found.id === id ? found : null

  useEffect(() => {
    if (!id) return
    let gone = false
    const t = setTimeout(() => {
      void api.watchPreview(link).then((r) => {
        if (!gone) setFound(r.ok ? { id, preview: r.data, problem: null } : { id, preview: null, problem: r.message })
      })
    }, 350)
    return () => {
      gone = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function start() {
    if (!id || busy) return
    setBusy(true)
    const r = await startWatching(link.trim(), control)
    setBusy(false)
    if (r.ok) onClose()
    else setStartProblem(r.message)
  }

  const picture = answer?.preview?.thumbnailUrl && /^https:\/\/i\.ytimg\.com\//.test(answer.preview.thumbnailUrl) ? answer.preview.thumbnailUrl : null
  return (
    <BottomSheet onClose={onClose}>
      <View style={{ paddingHorizontal: 20, paddingBottom: 28, gap: 16 }}>
        <View style={{ gap: 4 }}>
          <Text display size={24}>
            {changing ? 'Change the video' : 'Watch together'}
          </Text>
          <Text tone="muted" size={15}>
            Everyone in this call sees the same video at the same moment. Works with YouTube.
          </Text>
        </View>
        <Field
          label="YouTube link"
          value={link}
          onChangeText={(t) => {
            setLink(t)
            setStartProblem(null)
          }}
          placeholder="https://youtu.be/…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          maxLength={500}
          error={startProblem ?? answer?.problem ?? (link.trim() && !id ? 'Paste a link from YouTube (youtube.com or youtu.be).' : null)}
        />
        {id ? (
          <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: 'rgba(244,122,31,0.08)' }}>
            <View style={{ width: 112, height: 63, borderRadius: 10, overflow: 'hidden', backgroundColor: '#3A2030' }}>
              {picture ? <Image source={{ uri: picture }} style={{ width: 112, height: 63 }} accessibilityIgnoresInvertColors /> : null}
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="bold" size={15} numberOfLines={2}>
                {answer?.preview?.title ?? (answer ? 'YouTube video' : 'Looking it up…')}
              </Text>
              <Text tone="muted" size={13} numberOfLines={1}>
                {answer?.preview?.channel ?? 'YouTube'}
              </Text>
            </View>
          </View>
        ) : null}
        {!changing ? (
          <View style={{ gap: 8 }}>
            <Text size={14} weight="medium">
              Who can pause and skip
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['everyone', 'starter'] as const).map((c) => (
                <Pressable
                  key={c}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: control === c }}
                  onPress={() => setControl(c)}
                  style={{ flex: 1, minHeight: 50, borderRadius: 12, borderWidth: control === c ? 2 : 1, borderColor: control === c ? ORANGE : 'rgba(128,100,80,0.35)', backgroundColor: control === c ? 'rgba(244,122,31,0.12)' : 'transparent', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text weight={control === c ? 'bold' : 'regular'}>{c === 'everyone' ? 'Everyone' : 'Only me'}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <Button label={busy ? 'Starting…' : changing ? 'Watch this instead' : 'Start watching'} disabled={!id} busy={busy} onPress={() => void start()} />
      </View>
    </BottomSheet>
  )
}

// ---------------------------------------------------------------------------------------------
// Firefly reactions

function Glyph({ reaction, size = 12 }: { reaction: WatchReaction; size?: number }) {
  const color = '#C4410C'
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {reaction === 'heart' ? <Path d="M12 21s-7-4.4-9.3-9C1 8.4 3.2 5 6.6 5c2 0 3.6 1.2 5.4 3 1.8-1.8 3.4-3 5.4-3C20.8 5 23 8.4 21.3 12 19 16.6 12 21 12 21z" fill={color} /> : null}
      {reaction === 'laugh' ? <Path d="M7 13.5s1.8 3 5 3 5-3 5-3zM8 8.5l2 1.2M16 8.5l-2 1.2" fill={color} stroke={color} strokeWidth={2.4} strokeLinecap="round" /> : null}
      {reaction === 'wow' ? (
        <>
          <Path d="M9 8.5h.01M15 8.5h.01" stroke={color} strokeWidth={3} strokeLinecap="round" />
          <Ellipse cx="12" cy="15" rx="2.6" ry="3" fill={color} />
        </>
      ) : null}
      {reaction === 'fire' ? <Path d="M12 2.5c.6 3.2 4.6 5.2 4.6 10A4.6 4.6 0 0 1 12 17.1a4.6 4.6 0 0 1-4.6-4.6c0-2 1-3.5 2.2-4.6.1 1.4.7 2.4 1.7 2.9-.4-3.1.1-5.8.7-8.3zM12 21.5c-3.9 0-7-2.9-7-6.6 0-.5.1-1 .2-1.5.8 3.2 3.6 5.3 6.8 5.3s6-2.1 6.8-5.3c.1.5.2 1 .2 1.5 0 3.7-3.1 6.6-7 6.6z" fill="#D1340C" /> : null}
    </Svg>
  )
}

export function Firefly({ reaction, size = 22 }: { reaction: WatchReaction; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#FFD27A', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 14px 5px rgba(255,166,60,0.6)' }}>
      <Glyph reaction={reaction} size={size * 0.55} />
    </View>
  )
}

function FlyingFirefly({ reaction, name, x, w, h }: { reaction: WatchReaction; name: string; x: number; w: number; h: number }) {
  const t = useRef(new Animated.Value(0)).current
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 3100, easing: Easing.out(Easing.quad), useNativeDriver: true }).start()
  }, [t])
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x * w - 40,
        top: h * 0.72,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingLeft: 3,
        paddingRight: 9,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: 'rgba(28,18,16,0.6)',
        opacity: t.interpolate({ inputRange: [0, 0.1, 0.75, 1], outputRange: [0, 1, 1, 0] }),
        transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -h * 0.6] }) }, { scale: t.interpolate({ inputRange: [0, 0.12, 1], outputRange: [0.6, 1, 0.85] }) }],
      }}
    >
      <Firefly reaction={reaction} size={20} />
      <Text size={11} weight="bold" style={{ color: '#FFF' }}>
        {name}
      </Text>
    </Animated.View>
  )
}

function Fireflies({ w, h, nameOf }: { w: number; h: number; nameOf: (id: string) => string }) {
  const flying = useWatchStore((s) => s.flying)
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, width: w, height: h, overflow: 'hidden' }}>
      {flying.map((f) => (
        <FlyingFirefly key={f.id} reaction={f.reaction} name={nameOf(f.userId)} x={f.x} w={w} h={h} />
      ))}
    </View>
  )
}

// ---------------------------------------------------------------------------------------------
// The video, the time line, the buttons

function SeekBar({ position, duration, enabled, onSeek }: { position: number; duration: number; enabled: boolean; onSeek: (to: number) => void }) {
  const [w, setW] = useState(1)
  const [drag, setDrag] = useState<number | null>(null)
  const frac = duration ? Math.min(1, Math.max(0, (drag ?? position) / duration)) : 0
  const at = (x: number) => Math.min(1, Math.max(0, x / w)) * duration
  const pan = Gesture.Pan()
    .runOnJS(true)
    .enabled(enabled && duration > 0)
    .onBegin((e) => setDrag(at(e.x)))
    .onUpdate((e) => setDrag(at(e.x)))
    .onEnd((e) => onSeek(at(e.x)))
    .onFinalize(() => setDrag(null))
  return (
    <GestureDetector gesture={pan}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Where in the video, for everyone"
        accessibilityValue={{ text: `${videoTime(position)} of ${duration ? videoTime(duration) : 'unknown'}` }}
        accessibilityActions={enabled ? [{ name: 'increment' }, { name: 'decrement' }] : []}
        onAccessibilityAction={(e) => controlWatch(e.nativeEvent.actionName === 'increment' ? 'forward' : 'back')}
        onLayout={(e) => setW(e.nativeEvent.layout.width || 1)}
        style={{ height: 28, justifyContent: 'center' }}
      >
        <View style={{ height: 4, borderRadius: 2, backgroundColor: '#4A372B' }}>
          <View style={{ width: `${frac * 100}%`, height: 4, borderRadius: 2, backgroundColor: ORANGE }} />
        </View>
        {enabled && duration ? <View style={{ position: 'absolute', left: frac * w - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: '#FFF' }} /> : null}
      </View>
    </GestureDetector>
  )
}

function SyncPill({ state }: { state: PlayerState }) {
  if (state.error) return null
  const [label, bg, fg] =
    state.status === 'sync' ? ['In sync', '#1F3A2A', '#6FD39A'] : state.status === 'paused' ? ['Paused', '#3A2A22', '#D9C2B1'] : state.status === 'ended' ? ['Ended', '#3A2A22', '#D9C2B1'] : ['Catching up…', '#3A2C14', '#FFC86A']
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: bg }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: fg }} />
      <Text size={12} weight="bold" style={{ color: fg }}>
        {label}
      </Text>
    </View>
  )
}

function RoundButton({ icon, label, onPress, disabled, big, text }: { icon: string; label: string; onPress: () => void; disabled?: boolean; big?: boolean; text?: string }) {
  const size = big ? 56 : 44
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: big ? ORANGE : '#2A1C17', alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.45 : pressed ? 0.8 : 1 })}
    >
      <Icon name={icon} size={big ? 22 : 20} color={big ? '#2A1406' : '#F5EDE6'} fill={big ? '#2A1406' : '#F5EDE6'} />
      {text ? (
        <Text size={8} weight="bold" style={{ position: 'absolute', color: '#F5EDE6', top: size / 2 - 4 }}>
          {text}
        </Text>
      ) : null}
    </Pressable>
  )
}

function useWatchInfo(watch: WatchState) {
  useNow(watch.playing ? 500 : 60_000)
  return { position: watchPositionAt(watch, watchClock.now()), duration: watch.durationSec ?? 0 }
}

/** The controls: time line, −10 s, play / pause, +10 s, and whether you're in step. */
function Controls({ watch, meId, state, compact }: { watch: WatchState; meId: string; state: PlayerState; compact?: boolean }) {
  const { position, duration } = useWatchInfo(watch)
  const can = canControlWatch(watch, meId)
  return (
    <View style={{ gap: compact ? 4 : 8 }}>
      <SeekBar position={position} duration={duration} enabled={can} onSeek={(to) => controlWatch('seek', to)} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text size={12} style={{ color: '#D9C2B1', fontVariant: ['tabular-nums'] }}>
          {videoTime(position)} / {duration ? videoTime(duration) : '–:––'}
        </Text>
        <View style={{ flex: 1 }} />
        <SyncPill state={state} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
        <RoundButton icon="back10" text="10" label="Back 10 seconds for everyone" disabled={!can} onPress={() => controlWatch('back')} />
        <RoundButton big icon={watch.playing ? 'pause' : 'play'} label={watch.playing ? 'Pause for everyone' : 'Play for everyone'} disabled={!can} onPress={() => controlWatch(watch.playing ? 'pause' : 'play')} />
        <RoundButton icon="forward10" text="10" label="Forward 10 seconds for everyone" disabled={!can} onPress={() => controlWatch('forward')} />
      </View>
    </View>
  )
}

/** The video with its overlays (reactions, problems, "tap to start", what just happened). */
function Video({ watch, w, h, nameOf, onState, state, onPress }: { watch: WatchState; w: number; h: number; nameOf: (id: string) => string; onState: (s: PlayerState) => void; state: PlayerState; onPress?: () => void }) {
  const [unmute, setUnmute] = useState(0)
  const [firstSeq] = useState(watch.seq)
  const [doneSeq, setDoneSeq] = useState<number | null>(null)
  const fresh = !!watch.last && watch.seq > firstSeq && doneSeq !== watch.seq && watch.last.action !== 'change'
  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => setDoneSeq(watch.seq), 3500)
    return () => clearTimeout(t)
  }, [fresh, watch.seq])
  const said = fresh && watch.last ? watchActionText(watch, nameOf(watch.last.userId)) : null
  return (
    <View style={{ width: w, height: h, backgroundColor: '#000' }}>
      <WatchView watch={watch} unmute={unmute} onState={onState} style={{ width: w, height: h }} />
      {/* A tap on the video turns a muted video's sound on (and, sideways, shows the controls).
          Not while it's "blocked": then the tap has to reach the player itself. */}
      {state.status !== 'blocked' ? (
        <Pressable
          accessible={false}
          onPress={() => {
            if (state.muted) setUnmute((n) => n + 1)
            onPress?.()
          }}
          style={{ position: 'absolute', top: 0, left: 0, width: w, height: h }}
        />
      ) : null}
      <Fireflies w={w} h={h} nameOf={nameOf} />
      {said ? (
        <View pointerEvents="none" style={{ position: 'absolute', bottom: 10, alignSelf: 'center', paddingHorizontal: 12, height: 28, borderRadius: 14, backgroundColor: 'rgba(28,18,16,0.8)', justifyContent: 'center' }}>
          <Text size={12} weight="medium" style={{ color: '#FFF' }}>
            {said}
          </Text>
        </View>
      ) : null}
      {state.error ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#2B1D4F' }}>
          <Text weight="bold" style={{ color: '#FFF', textAlign: 'center' }}>
            {state.error}
          </Text>
        </View>
      ) : state.status === 'blocked' ? (
        <View pointerEvents="none" style={{ position: 'absolute', alignSelf: 'center', top: h / 2 - 18, paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: 'rgba(28,18,16,0.86)', justifyContent: 'center' }}>
          <Text size={13} weight="bold" style={{ color: '#FFF' }}>
            Tap the video to start it
          </Text>
        </View>
      ) : state.muted ? (
        <Pressable accessibilityRole="button" onPress={() => setUnmute((n) => n + 1)} style={{ position: 'absolute', alignSelf: 'center', bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: 'rgba(28,18,16,0.86)' }}>
          <Icon name="speakerOff" size={16} color="#FFF" />
          <Text size={13} weight="bold" style={{ color: '#FFF' }}>
            Video is muted · Turn on sound
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/** Recent messages of the call's chat, a message box and the firefly button. */
function CallChat({ conversationId, meId, nameOf }: { conversationId: string; meId: string; nameOf: (id: string) => string }) {
  const list = useStore((s) => s.messages[conversationId]?.list ?? null)
  const [text, setText] = useState('')
  const [picking, setPicking] = useState(false)
  const scroll = useRef<ScrollView>(null)
  useEffect(() => {
    if (!chatMessages(conversationId).loaded) void loadLatest(conversationId)
  }, [conversationId])
  const recent = (list ?? []).filter((m) => !m.deleted).slice(-30)
  const send = () => {
    const body = text.trim()
    if (!body) return
    sendText(conversationId, body, null)
    setText('')
  }
  return (
    <View style={{ flex: 1, minHeight: 120, marginHorizontal: 12, padding: 12, borderRadius: 16, backgroundColor: '#2A1C17', gap: 8 }}>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={{ gap: 6, justifyContent: 'flex-end', flexGrow: 1 }} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
        {recent.map((m) =>
          m.event ? (
            <Text key={m.id} size={12} style={{ color: '#9A897C' }}>
              {eventText(m.event, m.senderId, meId, nameOf)}
            </Text>
          ) : (
            <Text key={m.id} size={14} style={{ color: '#F5EDE6' }}>
              <Text size={14} weight="bold" style={{ color: '#FFB36A' }}>
                {m.senderId === meId ? 'You' : nameOf(m.senderId)}{' '}
              </Text>
              {m.body || (m.attachments.length ? 'sent an attachment' : '')}
            </Text>
          ),
        )}
      </ScrollView>
      {picking ? (
        <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 4 }}>
          {WATCH_REACTIONS.map((r) => (
            <Pressable
              key={r}
              accessibilityRole="button"
              accessibilityLabel={`Send a firefly: ${r}`}
              onPress={() => {
                reactWatch(r)
                setPicking(false)
              }}
              style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#3A2618', alignItems: 'center', justifyContent: 'center' }}
            >
              <Firefly reaction={r} size={24} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <View style={{ flex: 1, height: 44, borderRadius: 22, backgroundColor: '#3A2A22', paddingHorizontal: 14, justifyContent: 'center' }}>
          <TextInput value={text} onChangeText={setText} placeholder="Message" placeholderTextColor="#9A897C" accessibilityLabel="Message the call's chat" style={{ color: '#F5EDE6', fontSize: 15 }} onSubmitEditing={send} returnKeyType="send" maxLength={4000} />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={picking ? 'Close firefly reactions' : 'Send a firefly reaction'} onPress={() => setPicking((p) => !p)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#3A2618', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFD27A', boxShadow: '0 0 10px 4px rgba(255,166,60,0.6)' }} />
        </Pressable>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------------------------

/** Upright: video, controls, people, chat (the call's own controls are drawn by the call screen). */
export function WatchPortrait({ watch, meId, people, tiles, conversationId, top, bottom }: { watch: WatchState; meId: string; people: (id: string) => PublicUser; tiles: Tile[]; conversationId: string; top: number; bottom: number }) {
  const { width } = useWindowDimensions()
  const [state, setState] = useState<PlayerState>({ status: 'catching', error: null, muted: false })
  const nameOf = useCallback((id: string) => (id === meId ? 'You' : firstOf(people(id))), [meId, people])
  const starter = watch.startedBy === meId ? 'you' : nameOf(watch.startedBy)
  return (
    <View style={{ position: 'absolute', top, left: 0, right: 0, bottom, gap: 10 }}>
      <Video watch={watch} w={width} h={(width * 9) / 16} nameOf={nameOf} onState={setState} state={state} />
      <View style={{ paddingHorizontal: 16 }}>
        <Controls watch={watch} meId={meId} state={state} />
        <Text size={12} style={{ color: '#B8A699', textAlign: 'center', marginTop: 4 }} accessibilityLiveRegion="polite">
          {watch.control === 'everyone' ? 'Anyone in the call can pause or skip.' : `Only ${starter} can pause or skip.`}
          {watch.startedBy === meId ? (
            <Text size={12} weight="bold" style={{ color: '#FFA96A' }} onPress={() => setWatchControl(watch.control === 'everyone' ? 'starter' : 'everyone')}>
              {'  '}
              {watch.control === 'everyone' ? 'Only me' : 'Let everyone'}
            </Text>
          ) : null}
        </Text>
        {canControlWatch(watch, meId) ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Stop watching, for everyone" onPress={() => void askStop()} style={({ pressed }) => ({ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: '#2A1C17', opacity: pressed ? 0.8 : 1 })}>
            <Icon name="close" size={14} color="#F5EDE6" />
            <Text size={13} weight="bold" style={{ color: '#F5EDE6' }}>
              Stop watching
            </Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView horizontal style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 14, paddingHorizontal: 16, justifyContent: 'center', flexGrow: 1 }}>
        {tiles.map((t) => {
          const p = people(t.userId)
          return (
            <View key={t.userId} style={{ alignItems: 'center', gap: 4 }} accessibilityLabel={`${t.local ? 'You' : p.displayName}${t.speaking ? ', talking' : ''}${t.micMuted ? ', muted' : ''}`}>
              <View style={{ borderRadius: 30, boxShadow: t.speaking ? '0 0 0 3px #FF9F43' : undefined }}>
                <Avatar user={p} size={52} />
              </View>
              <Text size={12} style={{ color: '#F5EDE6' }}>
                {t.local ? 'You' : firstOf(p)}
              </Text>
            </View>
          )
        })}
      </ScrollView>
      <CallChat conversationId={conversationId} meId={meId} nameOf={nameOf} />
    </View>
  )
}

/** Sideways: the video fills the screen; a tap shows the controls for a few seconds. */
export function WatchLandscape({ watch, meId, people, tiles, onExit }: { watch: WatchState; meId: string; people: (id: string) => PublicUser; tiles: Tile[]; onExit: () => void }) {
  const { width, height } = useWindowDimensions()
  const [state, setState] = useState<PlayerState>({ status: 'catching', error: null, muted: false })
  const [shown, setShown] = useState(true)
  const [picking, setPicking] = useState(false)
  const [changing, setChanging] = useState(false)
  const can = canControlWatch(watch, meId)
  const nameOf = useCallback((id: string) => (id === meId ? 'You' : firstOf(people(id))), [meId, people])
  useEffect(() => {
    if (!shown || picking || changing) return
    const t = setTimeout(() => setShown(false), 3500)
    return () => clearTimeout(t)
  }, [shown, picking, changing, watch.seq])
  // The video's box: 16:9 inside the screen.
  const vw = Math.min(width, (height * 16) / 9)
  const vh = (vw * 9) / 16
  const talking = tiles.filter((t) => t.speaking && !t.micMuted)
  return (
    <View style={{ position: 'absolute', inset: 0, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}>
      {/* Tapping anywhere shows (or hides) the controls. Under the video, so the video's own taps
          ("Turn on sound", "Tap the video to start it") still reach it. */}
      <Pressable accessibilityLabel={shown ? 'Hide video controls' : 'Show video controls'} onPress={() => setShown((s) => !s)} style={{ position: 'absolute', inset: 0 }} />
      <Video watch={watch} w={vw} h={vh} nameOf={nameOf} onState={setState} state={state} onPress={() => setShown((s) => !s)} />
      {talking.length ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: 16, right: 16, gap: 6, alignItems: 'flex-end' }}>
          {talking.slice(0, 3).map((t) => (
            <View key={t.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 3, paddingRight: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(28,18,16,0.7)', borderWidth: 2, borderColor: '#FFA54A' }}>
              <Avatar user={people(t.userId)} size={24} />
              <Text size={12} weight="bold" style={{ color: '#FFF' }}>
                {t.local ? 'You' : firstOf(people(t.userId))}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {shown ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 28, paddingTop: 30, paddingBottom: 16, backgroundColor: 'rgba(0,0,0,0.55)', gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text size={15} weight="bold" numberOfLines={1} style={{ color: '#FFF', flex: 1 }}>
              {watch.title}
            </Text>
            {picking ? (
              WATCH_REACTIONS.map((r) => (
                <Pressable
                  key={r}
                  accessibilityRole="button"
                  accessibilityLabel={`Send a firefly: ${r}`}
                  onPress={() => {
                    reactWatch(r)
                    setPicking(false)
                  }}
                  style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#3A2618', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Firefly reaction={r} size={22} />
                </Pressable>
              ))
            ) : (
              <Pressable accessibilityRole="button" accessibilityLabel="Send a firefly reaction" onPress={() => setPicking(true)} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#3A2618', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: '#FFD27A', boxShadow: '0 0 10px 4px rgba(255,166,60,0.6)' }} />
              </Pressable>
            )}
            {can && !picking ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel="Change video" onPress={() => setChanging(true)} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="swapVideo" size={22} color="#FFF" />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Stop watching, for everyone" onPress={() => void askStop()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 36, borderRadius: 18, backgroundColor: '#3A2618' }}>
                  <Icon name="close" size={14} color="#F5EDE6" />
                  <Text size={13} weight="bold" style={{ color: '#F5EDE6' }}>
                    Stop watching
                  </Text>
                </Pressable>
              </>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Leave full screen" onPress={onExit} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="minimize" size={22} color="#FFF" />
            </Pressable>
          </View>
          <Controls watch={watch} meId={meId} state={state} compact />
        </View>
      ) : null}
      {changing ? <StartWatchSheet changing onClose={() => setChanging(false)} /> : null}
    </View>
  )
}
