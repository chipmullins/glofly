import { useEffect, type ReactNode } from 'react'
import { View } from 'react-native'
import { Image } from 'expo-image'
import Animated, {
  Easing,
  FadeOut,
  LinearTransition,
  ZoomIn,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { colorsFor, type PublicUser } from '@glofly/shared'
import { avatarSource } from '@/ui/Avatar'

// Cameras off, still full of life (0.7.5, CallScreen.dc.html, approved): each tile fills with a
// soft, blurred glow of the person's photo (or their colors when they have none) under a dark
// vignette; the round photo gets a soft white ring; talking pulses gently. Tiles grow in and
// slide when people join or leave. JS only (expo-image's blur, Reanimated), so it ships as an
// over-the-air update.

const OPEN_EASE = Easing.bezier(0.2, 0.9, 0.3, 1.15)
/** Tiles moving when someone joins or leaves */
export const tileLayout = LinearTransition.duration(240).easing(OPEN_EASE)
export const tileEntering = ZoomIn.duration(240).easing(OPEN_EASE)
export const tileExiting = FadeOut.duration(160)

type Person = Pick<PublicUser, 'id' | 'avatarVersion'>

/** The blurred glow + vignette behind a camera-off tile (absolutely fills the tile). */
export function TileGlow({ person, mine }: { person: Person; mine?: boolean }) {
  const [light, deep] = mine ? ['#FFCF8A', '#F47A1F'] : colorsFor(person.id)
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden', backgroundColor: '#1C1210' }}>
      {person.avatarVersion ? (
        <Image
          source={avatarSource(person.id, person.avatarVersion)}
          blurRadius={36}
          cachePolicy="disk"
          contentFit="cover"
          style={{ position: 'absolute', top: '-30%', left: '-30%', width: '160%', height: '160%', opacity: 0.85 }}
        />
      ) : (
        <View
          style={
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: deep,
              opacity: 0.85,
              experimental_backgroundImage: `radial-gradient(circle at 42% 40%, ${light}, ${deep} 48%, #1C1210)`,
            } as object
          }
        />
      )}
      <View
        style={
          {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            experimental_backgroundImage: 'radial-gradient(circle at 50% 45%, rgba(28,18,16,0) 0%, rgba(28,18,16,0.55) 100%)',
          } as object
        }
      />
    </View>
  )
}

/** The round photo on a glow tile: a soft white ring and a shadow. */
export function GlowFace({ size, children }: { size: number; children: ReactNode }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, boxShadow: '0 0 0 3px rgba(255,255,255,0.25), 0 10px 30px rgba(0,0,0,0.35)' }}>{children}</View>
}

/** Talking: an accent ring with an inner glow that breathes (still with Reduce Motion). */
export function TalkingRing({ radius }: { radius: number }) {
  const reduce = useReducedMotion()
  const pulse = useSharedValue(0.75)
  useEffect(() => {
    if (reduce) {
      pulse.value = 0.85
      return
    }
    pulse.value = withRepeat(withTiming(1, { duration: 800, easing: Easing.inOut(Easing.sin) }), -1, true)
    return () => cancelAnimation(pulse)
  }, [reduce, pulse])
  const glow = useAnimatedStyle(() => ({ opacity: pulse.value }))
  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, boxShadow: 'inset 0 0 28px 6px rgba(255,165,74,0.5)' }, glow]}
      />
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius, borderWidth: 3, borderColor: '#FFA54A' }} />
    </>
  )
}
