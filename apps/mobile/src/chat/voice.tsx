import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, PermissionsAndroid, Platform, Pressable, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import * as Haptics from 'expo-haptics'
import { VOICE_MAX_MS, toPeaks, voiceTime } from '@glofly/shared'
import { cancelVoice, startVoice, stopVoice, voiceLevel } from 'glofly-native'
import * as api from '@/api/glofly'
import { inform } from '@/ui/dialogs'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { sendText } from './send'

// Voice messages: hold the mic and let go to send (slide left to cancel), or tap it to record
// hands-free and press Send. Up to 5 minutes; under half a second isn't sent.

export type Voice = {
  recording: boolean
  locked: boolean
  elapsed: number
  levels: number[]
  cancelling: boolean
  start: () => Promise<boolean>
  finish: (send: boolean) => Promise<void>
  lock: () => void
  setCancelling: (v: boolean) => void
}

const MIN_MS = 500

export function useVoice(conversationId: string): Voice {
  const [recording, setRecording] = useState(false)
  const [locked, setLocked] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>([])
  const [cancelling, setCancelling] = useState(false)
  const all = useRef<number[]>([])
  const startedAt = useRef(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const active = useRef(false)

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
  }

  async function start(): Promise<boolean> {
    if (active.current) return false
    // Reset before anything async: a quick tap locks hands-free mode while the mic is starting.
    setLocked(false)
    setCancelling(false)
    if (Platform.OS === 'android') {
      const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        void inform('Microphone not allowed', 'Allow Glofly to use the microphone in Android Settings → Apps → Glofly → Permissions.')
        return false
      }
    }
    try {
      await startVoice()
    } catch {
      void inform("Couldn't start recording", 'Another app may be using the microphone.')
      return false
    }
    active.current = true
    all.current = []
    startedAt.current = Date.now()
    setElapsed(0)
    setLevels([])
    setRecording(true)
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    timer.current = setInterval(() => {
      const level = voiceLevel()
      all.current.push(level)
      const ms = Date.now() - startedAt.current
      setElapsed(ms)
      setLevels((l) => [...l.slice(-39), level])
      if (ms >= VOICE_MAX_MS) void finish(true)
    }, 100)
    return true
  }

  async function finish(send: boolean) {
    if (!active.current) return
    active.current = false
    stopTimer()
    setRecording(false)
    setLocked(false)
    setCancelling(false)
    if (!send) {
      cancelVoice()
      return
    }
    const rec = await stopVoice()
    if (!rec) return
    const durationMs = Math.min(rec.durationMs, VOICE_MAX_MS)
    if (durationMs < MIN_MS) return
    const peaks = toPeaks(all.current)
    const ext = rec.mime.includes('ogg') ? 'ogg' : 'webm'
    const r = await api.uploadAttachment(conversationId, { uri: rec.uri, type: rec.mime, name: `Voice message.${ext}` }, { durationMs, peaks })
    if (!r.ok) return void inform("Couldn't send the voice message", r.message)
    sendText(conversationId, '', null, [r.data])
  }

  useEffect(
    () => () => {
      stopTimer()
      if (active.current) cancelVoice()
    },
    [],
  )

  return { recording, locked, elapsed, levels, cancelling, start, finish, lock: () => setLocked(true), setCancelling }
}

/** The strip that replaces the message box while recording. */
export function VoiceRecorderBar({ voice }: { voice: Voice }) {
  const { c } = useTheme()
  const blink = useRef(new Animated.Value(1)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([Animated.timing(blink, { toValue: 0.2, duration: 500, useNativeDriver: true }), Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true })]))
    loop.start()
    return () => loop.stop()
  }, [blink])
  const bars = voice.levels.length ? voice.levels : [0]
  return (
    <View
      accessibilityLabel={`Recording a voice message, ${voiceTime(voice.elapsed)}`}
      accessibilityLiveRegion="polite"
      style={{ height: 44, borderRadius: 22, backgroundColor: voice.cancelling ? c.dangerSoft : c.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 }}
    >
      {voice.locked ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Delete recording" onPress={() => void voice.finish(false)} hitSlop={8}>
          <Icon name="trash" size={20} color={c.danger} />
        </Pressable>
      ) : null}
      <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.dnd, opacity: blink }} />
      <Text size={14} weight="bold">
        {voiceTime(voice.elapsed)}
        <Text size={14} tone="muted">
          {' '}
          / 5:00
        </Text>
      </Text>
      {voice.locked ? (
        <View style={{ flex: 1, height: 28, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          {bars.map((l, i) => (
            <View key={i} style={{ flex: 1, maxWidth: 4, height: Math.max(3, l * 26), borderRadius: 2, backgroundColor: c.accent }} />
          ))}
        </View>
      ) : (
        <Text size={14} tone={voice.cancelling ? 'danger' : 'muted'} weight={voice.cancelling ? 'bold' : 'regular'} style={{ flex: 1, textAlign: 'right' }}>
          {voice.cancelling ? 'Let go to cancel' : '‹ Slide to cancel'}
        </Text>
      )}
    </View>
  )
}

/** The mic button: hold to record, let go to send, slide left to cancel, tap to record hands-free. */
export function RecordButton({ voice }: { voice: Voice }) {
  const { c } = useTheme()
  const pressedAt = useRef(0)
  const v = useRef(voice)
  v.current = voice

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .minDistance(0)
        .onBegin(() => {
          if (v.current.locked) return
          pressedAt.current = Date.now()
          void v.current.start()
        })
        .onUpdate((e) => {
          if (v.current.recording && !v.current.locked) v.current.setCancelling(e.translationX < -90)
        })
        .onFinalize((e) => {
          if (v.current.locked || !pressedAt.current) return
          const held = Date.now() - pressedAt.current
          pressedAt.current = 0
          if (e.translationX < -90) return void v.current.finish(false)
          // A quick tap: keep recording hands-free (Send / trash on the strip).
          if (held < 350) return v.current.lock()
          void v.current.finish(true)
        }),
    [],
  )

  if (voice.recording && voice.locked) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send voice message"
        onPress={() => void voice.finish(true)}
        style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 16px ${c.glow}` }}
      >
        <Icon name="send" size={20} color={c.accentInk} strokeWidth={2.2} />
      </Pressable>
    )
  }
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={voice.recording ? 'Recording: let go to send' : 'Record a voice message (hold, or tap to start)'}
        style={{
          width: voice.recording ? 56 : 44,
          height: voice.recording ? 56 : 44,
          borderRadius: 28,
          backgroundColor: voice.recording ? (voice.cancelling ? c.danger : c.accent) : c.surface,
          alignItems: 'center',
          justifyContent: 'center',
          marginLeft: voice.recording ? -6 : 0,
        }}
      >
        <Icon name="mic" size={voice.recording ? 24 : 22} color={voice.recording ? c.accentInk : c.ink2} />
      </View>
    </GestureDetector>
  )
}
