import { useState } from 'react'
import { Modal, Pressable, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { Text } from './kit'

// Glofly's own square cropper for profile and group photos (iPhone). Asking iOS's picker to crop
// makes it use Apple's old photo picker, which takes seconds to open with a big library; the fast
// picker can't crop, so the cropping happens here instead. Drag to move, pinch to zoom.

export type CropRect = { originX: number; originY: number; width: number; height: number }

type Job = { uri: string; width: number; height: number; resolve: (rect: CropRect | null) => void }

const useCrop = create<{ job: Job | null }>(() => ({ job: null }))

/** Shows the cropper for this photo; resolves to the square to keep (in the photo's pixels), or null. */
export function cropSquare(uri: string, width: number, height: number): Promise<CropRect | null> {
  return new Promise((resolve) => useCrop.setState({ job: { uri, width, height, resolve } }))
}

export function PhotoCropperHost() {
  const job = useCrop((s) => s.job)
  if (!job) return null
  return <Cropper key={job.uri} job={job} />
}

const MAX_ZOOM = 5

function Cropper({ job }: { job: Job }) {
  const { width: screenW } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [visible, setVisible] = useState(true)
  const S = Math.min(screenW - 32, 420) // the square, on screen
  // At zoom 1 the photo just covers the square (its short side = the square).
  const base = S / Math.min(job.width, job.height)
  const w = job.width * base
  const h = job.height * base

  const zoom = useSharedValue(1)
  const tx = useSharedValue(0)
  const ty = useSharedValue(0)
  const startZoom = useSharedValue(1)
  const startX = useSharedValue(0)
  const startY = useSharedValue(0)

  // Keeps the photo covering the whole square.
  const clamp = (v: number, z: number, size: number) => {
    'worklet'
    const room = Math.max(0, (size * z - S) / 2)
    return Math.min(room, Math.max(-room, v))
  }

  const pan = Gesture.Pan()
    .onBegin(() => {
      startX.value = tx.value
      startY.value = ty.value
    })
    .onUpdate((e) => {
      tx.value = clamp(startX.value + e.translationX, zoom.value, w)
      ty.value = clamp(startY.value + e.translationY, zoom.value, h)
    })
  const pinch = Gesture.Pinch()
    .onBegin(() => {
      startZoom.value = zoom.value
    })
    .onUpdate((e) => {
      zoom.value = Math.min(MAX_ZOOM, Math.max(1, startZoom.value * e.scale))
      tx.value = clamp(tx.value, zoom.value, w)
      ty.value = clamp(ty.value, zoom.value, h)
    })
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = zoom.value > 1.05 ? 1 : 2
      zoom.value = withTiming(next)
      tx.value = withTiming(clamp(tx.value, next, w))
      ty.value = withTiming(clamp(ty.value, next, h))
    })
  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap)

  const photoStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: zoom.value }],
  }))

  const finish = (rect: CropRect | null) => {
    setVisible(false)
    useCrop.setState({ job: null })
    job.resolve(rect)
  }

  const use = () => {
    const scale = base * zoom.value // screen points per photo pixel
    const shown = S / scale // the square's side, in photo pixels
    const centerX = job.width / 2 - tx.value / scale
    const centerY = job.height / 2 - ty.value / scale
    const side = Math.min(shown, job.width, job.height)
    const originX = Math.round(Math.min(job.width - side, Math.max(0, centerX - side / 2)))
    const originY = Math.round(Math.min(job.height - side, Math.max(0, centerY - side / 2)))
    finish({ originX, originY, width: Math.round(side), height: Math.round(side) })
  }

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent onRequestClose={() => finish(null)}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#000', paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8 }}>
          <Pressable accessibilityRole="button" onPress={() => finish(null)} style={{ padding: 12 }}>
            <Text size={17} style={{ color: '#FFFFFF' }}>
              Cancel
            </Text>
          </Pressable>
          <Text size={17} weight="bold" style={{ color: '#FFFFFF' }}>
            Move and scale
          </Text>
          <Pressable accessibilityRole="button" onPress={use} style={{ padding: 12 }}>
            <Text size={17} weight="bold" style={{ color: '#FFB347' }}>
              Choose
            </Text>
          </Pressable>
        </View>
        <GestureDetector gesture={gesture}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <Animated.View style={[{ width: w, height: h }, photoStyle]}>
              <Image source={{ uri: job.uri }} style={{ width: w, height: h }} contentFit="fill" />
            </Animated.View>
            {/* Dim everything outside the square, and a round guide for how the photo will show. */}
            <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
              <View
                style={{
                  width: S,
                  height: S,
                  borderRadius: S / 2,
                  borderWidth: 2,
                  borderColor: 'rgba(255,255,255,0.9)',
                  boxShadow: '0 0 0 2000px rgba(0,0,0,0.55)',
                }}
              />
            </View>
          </View>
        </GestureDetector>
        <Text size={13} style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', paddingVertical: 14 }}>
          Drag to move · pinch or double-tap to zoom
        </Text>
      </GestureHandlerRootView>
    </Modal>
  )
}
