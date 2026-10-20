import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { Image } from 'expo-image'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { photoSubtitle, viewerPhotos, type Attachment, type Message, type ViewerPhoto } from '@glofly/shared'
import { Icon } from '@/ui/icons'
import { Text } from '@/ui/kit'
import { Avatar } from '@/ui/Avatar'
import { useStore } from '@/state/store'
import { useSession } from '@/state/session'
import { imageSource, savePhoto, shareFile } from './media'

// The photo viewer (0.7.5, PhotoViewer.dc.html, approved, adapted for phones): who sent it and
// when, "3 of 12" through every photo in the loaded part of the chat, Show in chat, Save, Share,
// a strip of thumbnails. Swipe left/right for more, pinch or double-tap to zoom, drag to move,
// swipe down to close. Opens with the approved spring (240 ms), closes in 160 ms; Reduce Motion
// fades only.

export type ViewerState = { message: Message; index: number }

const OPEN = { duration: 240, easing: Easing.bezier(0.2, 0.9, 0.3, 1.15) }
const CLOSE = { duration: 160, easing: Easing.bezier(0.4, 0, 1, 1) }
const MAX_ZOOM = 5

type Item = ViewerPhoto | { photo: Attachment; message: null }

export function PhotoViewer({
  state,
  onClose,
  messages,
  chatName = null,
  onShowInChat,
}: {
  state: ViewerState
  onClose: () => void
  /** The chat's loaded messages: the viewer steps through all their photos (0.7.5) */
  messages?: Message[]
  /** Groups and nebulas: "· in <name>" */
  chatName?: string | null
  /** Scroll the chat to that message and highlight it (the viewer has closed by then) */
  onShowInChat?: (messageId: string) => void
}) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const reduce = useReducedMotion()
  const people = useStore((s) => s.people)
  const me = useSession((s) => s.user)

  const startPhoto = state.message.attachments[state.index]
  const items = useMemo<Item[]>(() => {
    const all = messages ? viewerPhotos(messages) : []
    if (startPhoto && all.some((p) => p.photo.id === startPhoto.id)) return all
    const own = state.message.attachments.filter((a) => a.kind === 'image' && !a.sticker)
    return own.map((photo) => ({
      photo,
      message: { id: state.message.id, senderId: state.message.senderId, createdAt: state.message.createdAt },
    }))
    // The list is fixed while the viewer is open (new messages don't shift the pages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const first = Math.max(0, startPhoto ? items.findIndex((p) => p.photo.id === startPhoto.id) : 0)
  const [index, setIndex] = useState(first)
  const item = items[index] ?? items[0]
  const count = items.length
  const conversationId = state.message.conversationId

  // ---- open / close ----
  const shown = useSharedValue(0)
  const drop = useSharedValue(0)
  useEffect(() => {
    shown.value = reduce ? withTiming(1, { duration: 150 }) : withTiming(1, OPEN)
  }, [reduce, shown])
  const closing = useRef(false)
  const close = useCallback(
    (after?: () => void) => {
      if (closing.current) return
      closing.current = true
      const done = () => {
        onClose()
        after?.()
      }
      shown.value = withTiming(0, reduce ? { duration: 120 } : CLOSE, (ok) => {
        if (ok) runOnJS(done)()
      })
    },
    [onClose, reduce, shown]
  )
  const backdrop = useAnimatedStyle(() => ({
    opacity: shown.value * Math.max(0.2, 1 - Math.abs(drop.value) / 500),
  }))
  const content = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: drop.value }, { scale: reduce ? 1 : 0.94 + 0.06 * shown.value }],
  }))
  const chrome = useAnimatedStyle(() => ({ opacity: shown.value * (1 - Math.min(1, Math.abs(drop.value) / 150)) }))

  // ---- pages ----
  const list = useRef<FlatList<Item>>(null)
  const [zoomed, setZoomed] = useState(false)
  const go = (i: number) => {
    if (i < 0 || i >= count) return
    list.current?.scrollToIndex({ index: i, animated: !reduce })
    setIndex(i)
  }
  const strip = useRef<ScrollView>(null)
  useEffect(() => {
    strip.current?.scrollTo({ x: Math.max(0, index * 64 - width / 2 + 28), animated: !reduce })
  }, [index, width, reduce])

  const sender = item?.message
    ? item.message.senderId === me?.id
      ? me
      : (people[item.message.senderId] ?? null)
    : null
  const senderName = item?.message ? (sender?.displayName ?? 'Someone') : (item?.photo.name ?? '')
  const subtitle = item?.message ? photoSubtitle(item.message.createdAt, chatName) : ''
  const photoH = height - insets.top - insets.bottom - 200

  if (!item) return null
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={() => close()}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Animated.View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14,9,8,0.97)' }, backdrop]} />
        <Animated.View style={[{ flex: 1 }, content]}>
          <FlatList
            ref={list}
            data={items}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            initialScrollIndex={first}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(p) => p.photo.id}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item: p, index: i }) => (
              <ZoomPage
                conversationId={conversationId}
                photo={p.photo}
                width={width}
                height={height}
                photoH={photoH}
                active={i === index}
                drop={drop}
                onZoomed={setZoomed}
                onDismiss={() => close()}
              />
            )}
          />
        </Animated.View>

        {/* Top: close, who and when, save, share */}
        <Animated.View
          style={[
            { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 6, paddingBottom: 14, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.45)' },
            chrome,
          ]}
        >
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => close()} style={iconButton}>
            <Icon name="close" size={22} color="#FFFFFF" />
          </Pressable>
          {item.message ? <Avatar user={sender ?? { id: item.message.senderId, displayName: senderName, avatarVersion: null }} size={36} /> : null}
          <View style={{ flex: 1, minWidth: 0, marginLeft: 4 }}>
            <Text size={15} weight="bold" numberOfLines={1} style={{ color: '#FFFFFF' }}>
              {senderName}
            </Text>
            {subtitle ? (
              <Text size={12} numberOfLines={1} style={{ color: '#D9C2B1' }}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Save photo" onPress={() => void savePhoto(conversationId, item.photo)} style={iconButton}>
            <Icon name="download" size={20} color="#FFFFFF" />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Share" onPress={() => void shareFile(conversationId, item.photo)} style={iconButton}>
            <Icon name="share" size={20} color="#FFFFFF" />
          </Pressable>
        </Animated.View>

        {/* Bottom: "3 of 12", Show in chat, thumbnails */}
        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + 12, gap: 12 }, chrome]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 }}>
            <Text size={14} style={{ flex: 1, color: '#D9C2B1' }} accessibilityLiveRegion="polite">
              {count > 1 ? `${index + 1} of ${count}` : ''}
            </Text>
            {item.message && onShowInChat ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const id = item.message?.id
                  if (id) close(() => onShowInChat(id))
                }}
                style={{ height: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.14)', justifyContent: 'center' }}
              >
                <Text size={14} weight="bold" style={{ color: '#FFFFFF' }}>
                  Show in chat
                </Text>
              </Pressable>
            ) : null}
          </View>
          {count > 1 ? (
            <ScrollView ref={strip} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }} accessibilityLabel="All photos">
              {items.map((p, i) => (
                <Pressable
                  key={p.photo.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Photo ${i + 1} of ${count}`}
                  accessibilityState={{ selected: i === index }}
                  onPress={() => go(i)}
                  style={{
                    width: 56,
                    height: 42,
                    borderRadius: 8,
                    overflow: 'hidden',
                    opacity: i === index ? 1 : 0.6,
                    borderWidth: i === index ? 3 : 0,
                    borderColor: '#FFA54A',
                  }}
                >
                  <Image source={imageSource(conversationId, p.photo, 'preview')} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  )
}

const iconButton = { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' } as const

/** One photo: pinch or double-tap to zoom, drag to move when zoomed, swipe down to close when not. */
function ZoomPage({
  conversationId,
  photo,
  width,
  height,
  photoH,
  active,
  drop,
  onZoomed,
  onDismiss,
}: {
  conversationId: string
  photo: Attachment
  width: number
  height: number
  photoH: number
  active: boolean
  drop: { value: number }
  onZoomed: (zoomed: boolean) => void
  onDismiss: () => void
}) {
  const scale = useSharedValue(1)
  const base = useSharedValue(1)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)

  const [zoomedHere, setZoomedHere] = useState(false)
  // Leaving the page zooms it back out
  useEffect(() => {
    if (!active) {
      setZoomedHere(false)
      scale.value = 1
      base.value = 1
      x.value = 0
      y.value = 0
    }
  }, [active, scale, base, x, y])

  const report = useCallback(
    (z: boolean) => {
      setZoomedHere(z)
      onZoomed(z)
    },
    [onZoomed]
  )

  const gesture = useMemo(() => {
    const limit = (s: number) => {
      'worklet'
      return { mx: Math.max(0, (width * s - width) / 2), my: Math.max(0, (photoH * s - photoH) / 2) }
    }
    const pinch = Gesture.Pinch()
      .onUpdate((e) => {
        scale.value = Math.min(MAX_ZOOM, Math.max(0.8, base.value * e.scale))
      })
      .onEnd(() => {
        const s = Math.max(1, scale.value)
        scale.value = withTiming(s, { duration: 160 })
        base.value = s
        const { mx, my } = limit(s)
        x.value = withTiming(Math.max(-mx, Math.min(mx, x.value)), { duration: 160 })
        y.value = withTiming(Math.max(-my, Math.min(my, y.value)), { duration: 160 })
        runOnJS(report)(s > 1.01)
      })
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd((e) => {
        if (base.value > 1.01) {
          base.value = 1
          scale.value = withTiming(1, OPEN)
          x.value = withTiming(0, OPEN)
          y.value = withTiming(0, OPEN)
          runOnJS(report)(false)
        } else {
          const s = 2.5
          base.value = s
          scale.value = withTiming(s, OPEN)
          // Zoom toward the tapped point
          const { mx, my } = limit(s)
          const tx = (width / 2 - e.x) * (s - 1)
          const ty = (height / 2 - e.y) * (s - 1)
          x.value = withTiming(Math.max(-mx, Math.min(mx, tx)), OPEN)
          y.value = withTiming(Math.max(-my, Math.min(my, ty)), OPEN)
          runOnJS(report)(true)
        }
      })
    // Zoomed: drag moves the photo (paging is off). Not zoomed: only a downward swipe is ours
    // (sideways goes to the pages), and it closes the viewer.
    const pan = zoomedHere
      ? Gesture.Pan()
          .minDistance(4)
          .onStart(() => {
            startX.value = x.value
            startY.value = y.value
          })
          .onUpdate((e) => {
            const { mx, my } = limit(base.value)
            x.value = Math.max(-mx, Math.min(mx, startX.value + e.translationX))
            y.value = Math.max(-my, Math.min(my, startY.value + e.translationY))
          })
      : Gesture.Pan()
          .activeOffsetY([-12, 12])
          .failOffsetX([-14, 14])
          .onUpdate((e) => {
            drop.value = Math.max(0, e.translationY)
          })
          .onEnd((e) => {
            if (drop.value > 120 || e.velocityY > 900) {
              runOnJS(onDismiss)()
            } else {
              drop.value = withSpring(0, { damping: 20, stiffness: 220 })
            }
          })
    return Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan))
  }, [width, height, photoH, scale, base, x, y, startX, startY, drop, report, onDismiss, zoomedHere])

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }))

  return (
    <GestureDetector gesture={gesture}>
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View style={style}>
          <Image
            source={imageSource(conversationId, photo, 'full')}
            placeholder={imageSource(conversationId, photo, 'preview')}
            style={{ width, height: photoH }}
            contentFit="contain"
            accessibilityLabel={photo.name}
          />
        </Animated.View>
      </View>
    </GestureDetector>
  )
}
