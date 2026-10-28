import { useEffect, useRef, useState } from 'react'
import { Platform, Pressable, View, type LayoutChangeEvent } from 'react-native'
import { Image } from 'expo-image'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio'
import { fileTypeLabel, formatSize, voiceTime, type Attachment, type Message } from '@glofly/shared'
import { authHeaders } from '@/api/http'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { useTheme } from '@/ui/theme'
import { attachmentUrl, imageSource, posterSource, shareFile, voiceFileForIos } from './media'
import { VideoPlayer } from './VideoPlayer'
import { inform } from '@/ui/dialogs'

// Photos (a grid, or one photo in its own shape), file cards, and voice messages in a bubble.

type Props = { message: Message; mine: boolean; onOpenPhoto: (index: number) => void; onLongPress: () => void }

const MAX_W = 240

export function Attachments({ message, mine, onOpenPhoto, onLongPress }: Props) {
  const stickers = message.attachments.filter((a) => a.kind === 'image' && a.sticker)
  const photos = message.attachments.filter((a) => a.kind === 'image' && !a.sticker)
  const others = message.attachments.filter((a) => a.kind !== 'image')
  return (
    <View style={{ gap: 6 }}>
      {stickers.map((a) => {
        // A sticker (0.5.0): see-through, no frame.
        const scale = Math.min(1, 150 / Math.max(a.width ?? 150, a.height ?? 150))
        return (
          <Pressable key={a.id} accessibilityLabel="Sticker" onLongPress={onLongPress}>
            <Image source={imageSource(message.conversationId, a, 'full')} style={{ width: Math.round((a.width ?? 150) * scale), height: Math.round((a.height ?? 150) * scale) }} contentFit="contain" cachePolicy="disk" />
          </Pressable>
        )
      })}
      {photos.length ? <PhotoGrid message={message} photos={photos} onOpen={(a) => onOpenPhoto(message.attachments.indexOf(a))} onLongPress={onLongPress} /> : null}
      {others.map((a) =>
        a.voice ? (
          <VoiceBubble key={a.id} conversationId={message.conversationId} a={a} mine={mine} onLongPress={onLongPress} />
        ) : a.video ? (
          <VideoCard key={a.id} conversationId={message.conversationId} a={a} onLongPress={onLongPress} />
        ) : (
          <FileCard key={a.id} conversationId={message.conversationId} a={a} mine={mine} onLongPress={onLongPress} />
        ),
      )}
    </View>
  )
}

function PhotoGrid({ message, photos, onOpen, onLongPress }: { message: Message; photos: Attachment[]; onOpen: (a: Attachment) => void; onLongPress: () => void }) {
  const { c } = useTheme()
  if (photos.length === 1) {
    const a = photos[0]
    const ratio = a.width && a.height ? a.width / a.height : 4 / 3
    const w = Math.min(MAX_W, ratio >= 1 ? MAX_W : MAX_W * Math.max(ratio, 0.6))
    const h = Math.min(320, w / ratio)
    return (
      <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Photo: ${a.name}. Open`} onPress={() => onOpen(a)} onLongPress={onLongPress}>
        <Image source={imageSource(message.conversationId, a, 'preview')} style={{ width: w, height: h, borderRadius: 14, backgroundColor: c.surface2 }} contentFit="cover" transition={150} cachePolicy="disk" />
      </Pressable>
    )
  }
  const size = photos.length === 2 ? (MAX_W - 4) / 2 : (MAX_W - 4) / 2
  const shown = photos.slice(0, 4)
  const extra = photos.length - shown.length
  return (
    <View style={{ width: MAX_W, flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {shown.map((a, i) => (
        <Pressable key={a.id} accessibilityRole="imagebutton" accessibilityLabel={`Photo ${i + 1} of ${photos.length}. Open`} onPress={() => onOpen(a)} onLongPress={onLongPress}>
          <Image source={imageSource(message.conversationId, a, 'preview')} style={{ width: size, height: size, borderRadius: 10, backgroundColor: c.surface2 }} contentFit="cover" transition={150} cachePolicy="disk" />
          {i === shown.length - 1 && extra > 0 ? (
            <View style={{ position: 'absolute', inset: 0, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
              <Text display size={24} style={{ color: '#FFFFFF' }}>
                +{extra}
              </Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </View>
  )
}

/** A video (0.5.0): its picture, a play button and its length. Tap: full screen player. */
function VideoCard({ conversationId, a, onLongPress }: { conversationId: string; a: Attachment; onLongPress: () => void }) {
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  const v = a.video!
  const ratio = v.width && v.height ? v.width / v.height : 16 / 9
  const w = Math.min(MAX_W, ratio >= 1 ? MAX_W : MAX_W * Math.max(ratio, 0.56))
  const h = Math.min(320, w / ratio)
  const s = Math.round(v.durationMs / 1000)
  const length = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`Video, ${length}. Play`} onPress={() => setOpen(true)} onLongPress={onLongPress}>
        <Image source={posterSource(conversationId, a)} style={{ width: w, height: h, borderRadius: 14, backgroundColor: c.surface2 }} contentFit="cover" transition={150} cachePolicy="disk" />
        <View style={{ position: 'absolute', top: h / 2 - 26, left: w / 2 - 26, width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(28,18,16,0.62)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="play" size={20} color="#FFFFFF" />
        </View>
        <View style={{ position: 'absolute', right: 8, bottom: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.66)' }}>
          <Text size={12} weight="bold" style={{ color: '#FFF' }}>
            {length}
          </Text>
        </View>
      </Pressable>
      {open ? <VideoPlayer conversationId={conversationId} attachment={a} onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function FileCard({ conversationId, a, mine, onLongPress }: { conversationId: string; a: Attachment; mine: boolean; onLongPress: () => void }) {
  const { c } = useTheme()
  const [busy, setBusy] = useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`File ${a.name}, ${formatSize(a.size)}. Download`}
      onPress={async () => {
        setBusy(true)
        await shareFile(conversationId, a)
        setBusy(false)
      }}
      onLongPress={onLongPress}
      style={{ width: MAX_W, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12, backgroundColor: mine ? 'rgba(255,255,255,0.3)' : c.bg }}
    >
      <View style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: mine ? 'rgba(42,20,6,0.12)' : c.surface, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="file" size={20} color={mine ? c.meInk : c.ink2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={14} weight="bold" numberOfLines={1} style={{ color: mine ? c.meInk : c.ink }}>
          {a.name}
        </Text>
        <Text size={12} style={{ color: mine ? c.meInk : c.muted, opacity: mine ? 0.8 : 1 }}>
          {fileTypeLabel(a.name)} · {formatSize(a.size)}
        </Text>
      </View>
      <Icon name={busy ? 'clock' : 'download'} size={20} color={mine ? c.meInk : c.accentText} />
    </Pressable>
  )
}

// Only one voice message plays at a time.
let playing: AudioPlayer | null = null

/**
 * Pauses the voice message that was playing before this one. Its player is closed as soon as its
 * bubble leaves the screen (scrolled away, or the chat closed), and pausing a closed player throws:
 * that crashed iPhones (Oct 27, "Calling the 'pause' function has failed … native shared object").
 */
function pauseOther(next: AudioPlayer) {
  const p = playing
  if (!p || p === next) return
  playing = null
  try {
    p.pause()
  } catch {
    // Already closed: nothing is playing there.
  }
}
// 0.7.3: voice message speed (1× → 1.5× → 2×), the same for every voice message until changed.
const SPEEDS = [1, 1.5, 2] as const
let voiceSpeed: number = 1
const speedLabel = (r: number) => `${r}×`
function applySpeed(player: AudioPlayer, rate: number) {
  try {
    player.setPlaybackRate(rate, 'high')
  } catch {
    try {
      player.playbackRate = rate
    } catch {
      // this player can't change speed
    }
  }
}

function VoiceBubble({ conversationId, a, mine, onLongPress }: { conversationId: string; a: Attachment; mine: boolean; onLongPress: () => void }) {
  const { c } = useTheme()
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null)
  const player = useAudioPlayer(source)
  const status = useAudioPlayerStatus(player)
  const width = useRef(0)
  const wantPlay = useRef(false)
  const [speed, setSpeed] = useState(voiceSpeed)
  const peaks = a.voice?.peaks?.length ? a.voice.peaks : [20]
  const duration = (a.voice?.durationMs ?? 0) / 1000
  const progress = duration ? Math.min(1, status.currentTime / (status.duration || duration)) : 0
  const bars = 32
  const sampled = Array.from({ length: bars }, (_, i) => peaks[Math.floor((i / bars) * peaks.length)] ?? 0)

  useEffect(() => {
    if (wantPlay.current && status.isLoaded) {
      wantPlay.current = false
      pauseOther(player)
      playing = player
      // iPhone: voice messages play even with the ring/silent switch on silent (Glofly's other
      // sounds respect it again once it ends).
      if (Platform.OS === 'ios') void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' }).catch(() => {})
      player.play()
      applySpeed(player, voiceSpeed)
    }
  }, [status.isLoaded, player])
  // This bubble is leaving (or its player is being replaced): never point at its closed player.
  useEffect(() => {
    return () => {
      if (playing === player) playing = null
    }
  }, [player])
  // A speed picked on another voice message (or here) applies the next time this one plays.
  useEffect(() => {
    if (status.isLoaded) applySpeed(player, speed)
  }, [speed, status.isLoaded, player])

  useEffect(() => {
    if (!status.didJustFinish) return
    void player.seekTo(0)
    if (Platform.OS === 'ios') void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {})
  }, [status.didJustFinish, player])

  const toggle = () => {
    if (!source) {
      wantPlay.current = true
      const uri = attachmentUrl(conversationId, a, 'file')
      if (Platform.OS === 'ios') {
        void voiceFileForIos(conversationId, a)
          .then((file) => setSource({ uri: file, headers: {} }))
          .catch(() => {
            wantPlay.current = false
            void inform("Couldn't play the voice message", 'Check your connection and try again.')
          })
      } else if (Platform.OS === 'web') {
        // Browsers can't send the session header with <audio>, so the preview fetches it first.
        void fetch(uri, { headers: authHeaders() })
          .then((r) => r.blob())
          .then((b) => setSource({ uri: URL.createObjectURL(b), headers: {} }))
      } else setSource({ uri, headers: authHeaders() })
      return
    }
    if (status.playing) player.pause()
    else {
      pauseOther(player)
      playing = player
      // iPhone: voice messages play even with the ring/silent switch on silent (Glofly's other
      // sounds respect it again once it ends).
      if (Platform.OS === 'ios') void setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix' }).catch(() => {})
      setSpeed(voiceSpeed)
      player.play()
      applySpeed(player, voiceSpeed)
    }
  }

  const changeSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length]
    voiceSpeed = next
    setSpeed(next)
  }

  const seek = (x: number) => {
    if (!source || !width.current) return
    void player.seekTo(Math.max(0, Math.min(1, x / width.current)) * (status.duration || duration))
  }

  const ink = mine ? c.meInk : c.ink
  const dim = mine ? 'rgba(42,20,6,0.35)' : c.faint
  return (
    <Pressable onLongPress={onLongPress} style={{ width: MAX_W, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, paddingHorizontal: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause voice message' : `Play voice message, ${voiceTime(a.voice?.durationMs ?? 0)}`}
        onPress={toggle}
        style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: mine ? c.meInk : c.accent, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name={status.playing ? 'pause' : 'play'} size={18} color={mine ? c.me : c.accentInk} />
      </Pressable>
      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Voice message position"
        onLayout={(e: LayoutChangeEvent) => (width.current = e.nativeEvent.layout.width)}
        onPress={(e) => seek(e.nativeEvent.locationX)}
        style={{ flex: 1, height: 32, flexDirection: 'row', alignItems: 'center', gap: 2 }}
      >
        {sampled.map((p, i) => (
          <View key={i} style={{ flex: 1, height: Math.max(3, (p / 100) * 28), borderRadius: 2, backgroundColor: i / bars < progress ? ink : dim }} />
        ))}
      </Pressable>
      <Text size={12} weight="medium" style={{ color: ink, minWidth: 30 }}>
        {voiceTime(status.playing || status.currentTime > 0 ? status.currentTime * 1000 : (a.voice?.durationMs ?? 0))}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Playback speed ${speedLabel(speed)}. Change speed`}
        onPress={changeSpeed}
        hitSlop={8}
        style={{ minWidth: 34, height: 24, paddingHorizontal: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: mine ? 'rgba(42,20,6,0.14)' : c.surface }}
      >
        <Text size={11} weight="bold" style={{ color: ink }}>
          {speedLabel(speed)}
        </Text>
      </Pressable>
    </Pressable>
  )
}
