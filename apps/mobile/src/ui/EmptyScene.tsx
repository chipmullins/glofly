import { useEffect, useId, type ReactNode } from 'react'
import { View } from 'react-native'
import Svg, { Circle, Defs, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg'
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { Text } from './kit'
import { useTheme } from './theme'

// 0.7.5 "Empty screens with personality" (EmptyStates.dc.html), the same scenes as the desktop
// app's components/EmptyScene.tsx: a small firefly picture, one friendly line, and a button that
// helps. The fireflies drift and blink (still with Reduce Motion). Buttons are the app's own, so
// they follow the accent color.

export type SceneKind = 'search' | 'friends' | 'constellation' | 'caughtUp' | 'hello' | 'group' | 'pins' | 'scheduled' | 'games'

type Fly = { x: number; y: number; r: number; beat: 0 | 1 | 2; faint?: boolean }

const W = 170
const H = 150

/** The still parts of each scene, and where its fireflies sit. */
function scene(kind: SceneKind, ink: { fill: string; stroke: string; dash: string; lid: string; line: string; star: string }): { art: ReactNode; flies: Fly[] } {
  switch (kind) {
    case 'search':
      return {
        art: (
          <>
            <Circle cx={72} cy={70} r={40} fill={ink.fill} stroke={ink.stroke} strokeWidth={8} />
            <Path d="M101 99l30 30" stroke={ink.stroke} strokeWidth={12} strokeLinecap="round" />
            <Path d="M48 76c10-14 30-14 44-4" stroke={ink.dash} strokeWidth={3} fill="none" strokeDasharray="3 6" strokeLinecap="round" />
          </>
        ),
        flies: [
          { x: 120, y: 34, r: 16, beat: 0 },
          { x: 30, y: 118, r: 11, beat: 1 },
        ],
      }
    case 'friends':
    case 'hello':
    case 'group':
      return {
        art: (
          <>
            <Path d="M10 128c30-10 60-10 75 0s45 10 75 0" stroke={ink.stroke} strokeWidth={3} fill="none" strokeLinecap="round" />
            <Path d="M44 110c18-40 62-40 82 0" stroke={ink.dash} strokeWidth={2.5} fill="none" strokeDasharray="2 7" strokeLinecap="round" />
            {kind === 'friends' ? <Circle cx={126} cy={108} r={4} fill="none" stroke="#f0c48a" strokeWidth={1.6} strokeDasharray="2 2" /> : null}
          </>
        ),
        flies: [
          { x: 44, y: 108, r: 20, beat: 0 },
          { x: 126, y: 108, r: 20, beat: 2, faint: kind === 'friends' },
          { x: 86, y: 40, r: 10, beat: 1 },
          ...(kind === 'group' ? [{ x: 146, y: 56, r: 9, beat: 2 as const }] : []),
        ],
      }
    case 'constellation':
      return {
        art: (
          <>
            <Path d="M30 110L64 52L110 70L140 30" stroke={ink.line} strokeWidth={1.6} fill="none" />
            <Path d="M110 70L128 116" stroke={ink.line} strokeWidth={1.6} fill="none" strokeDasharray="3 5" />
            <Circle cx={30} cy={110} r={3} fill={ink.star} />
            <Circle cx={64} cy={52} r={3} fill={ink.star} />
            <Circle cx={140} cy={30} r={3} fill={ink.star} />
            <Circle cx={16} cy={30} r={1.4} fill={ink.star} opacity={0.6} />
            <Circle cx={88} cy={18} r={1.2} fill={ink.star} opacity={0.6} />
            <Circle cx={156} cy={88} r={1.2} fill={ink.star} opacity={0.6} />
          </>
        ),
        flies: [
          { x: 110, y: 70, r: 20, beat: 0 },
          { x: 128, y: 116, r: 9, beat: 1, faint: true },
        ],
      }
    case 'caughtUp':
      return {
        art: (
          <>
            <Path d="M58 52h54v62a14 14 0 0 1-14 14H72a14 14 0 0 1-14-14z" fill={ink.fill} stroke={ink.stroke} strokeWidth={4} />
            <Rect x={54} y={40} width={62} height={12} rx={5} fill={ink.lid} />
          </>
        ),
        flies: [
          { x: 78, y: 96, r: 16, beat: 0 },
          { x: 96, y: 80, r: 12, beat: 1 },
          { x: 90, y: 110, r: 10, beat: 2 },
        ],
      }
    case 'pins':
      return {
        art: (
          <>
            <Rect x={40} y={46} width={90} height={70} rx={12} fill={ink.fill} stroke={ink.stroke} strokeWidth={4} />
            <Path d="M58 70h54M58 88h36" stroke={ink.stroke} strokeWidth={5} strokeLinecap="round" />
            <Path d="M118 30l14 14-8 4-10 10 2 10-4 4-22-22 4-4 10 2 10-10z" fill={ink.lid} />
          </>
        ),
        flies: [
          { x: 36, y: 36, r: 14, beat: 0 },
          { x: 140, y: 112, r: 10, beat: 1 },
        ],
      }
    case 'scheduled':
      return {
        art: (
          <>
            <Circle cx={85} cy={78} r={44} fill={ink.fill} stroke={ink.stroke} strokeWidth={6} />
            <Path d="M85 50v30l18 12" stroke={ink.stroke} strokeWidth={6} strokeLinecap="round" fill="none" />
          </>
        ),
        flies: [
          { x: 136, y: 36, r: 15, beat: 0 },
          { x: 30, y: 120, r: 10, beat: 1 },
        ],
      }
    case 'games':
      return {
        art: (
          <>
            <Path
              d="M50 62h70a26 26 0 0 1 26 26v2a20 20 0 0 1-36 12l-4-6H64l-4 6a20 20 0 0 1-36-12v-2a26 26 0 0 1 26-26z"
              fill={ink.fill}
              stroke={ink.stroke}
              strokeWidth={4}
            />
            <Path d="M54 82v14M47 89h14" stroke={ink.stroke} strokeWidth={5} strokeLinecap="round" />
            <Circle cx={112} cy={84} r={4} fill={ink.lid} />
            <Circle cx={124} cy={94} r={4} fill={ink.lid} />
          </>
        ),
        flies: [
          { x: 85, y: 30, r: 15, beat: 0 },
          { x: 150, y: 44, r: 9, beat: 1 },
        ],
      }
  }
}

const BEATS = [
  { float: 4000, blink: 2600, delay: 0 },
  { float: 5000, blink: 3100, delay: 800 },
  { float: 4600, blink: 2200, delay: 1600 },
]

/** One firefly: a warm glow that drifts a few points and blinks, on its own beat. */
function Firefly({ fly, scale, still }: { fly: Fly; scale: number; still: boolean }) {
  const id = `fly${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const t = useSharedValue(0)
  const b = useSharedValue(0)
  const beat = BEATS[fly.beat]
  useEffect(() => {
    if (still) return
    const half = { duration: beat.float / 2, easing: Easing.inOut(Easing.ease) }
    t.value = withDelay(beat.delay, withRepeat(withTiming(1, half), -1, true))
    b.value = withDelay(beat.delay / 2, withRepeat(withTiming(1, { duration: beat.blink / 2, easing: Easing.inOut(Easing.ease) }), -1, true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still])
  const style = useAnimatedStyle(() => ({
    opacity: (fly.faint ? 0.55 : 1) * (1 - b.value * 0.55),
    transform: [{ translateX: t.value * 3 * scale }, { translateY: -t.value * 6 * scale }],
  }))
  const size = fly.r * 2 * scale
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: (fly.x - fly.r) * scale, top: (fly.y - fly.r) * scale, width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox={`0 0 ${fly.r * 2} ${fly.r * 2}`}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#ffe9a8" />
            <Stop offset="0.35" stopColor="#ffb347" stopOpacity={0.8} />
            <Stop offset="1" stopColor="#ffb347" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={fly.r} cy={fly.r} r={fly.r} fill={`url(#${id})`} />
        <Circle cx={fly.r} cy={fly.r} r={Math.max(1.6, fly.r / 5)} fill="#fff4cf" />
      </Svg>
    </Animated.View>
  )
}

export function EmptyScene({
  kind,
  title,
  text,
  children,
  small,
  night,
}: {
  kind: SceneKind
  title: string
  text?: string
  /** Buttons (the app's own Button, so they follow the accent) */
  children?: ReactNode
  /** Tighter, for panels and sheets */
  small?: boolean
  /** On the always-dark night side */
  night?: boolean
}) {
  const { dark } = useTheme()
  const still = useReducedMotion()
  const isDark = dark || night
  const ink = isDark
    ? { fill: '#2a221e', stroke: '#4a3e36', dash: '#574a41', lid: '#4a3e36', line: '#5a4a40', star: '#c9b8ab' }
    : { fill: '#fdf1e6', stroke: '#e8d3c0', dash: '#f0dccb', lid: '#ecd8c6', line: '#d9c4b2', star: '#b8a08c' }
  const scale = small ? 0.68 : 1
  const { art, flies } = scene(kind, ink)
  return (
    <View accessibilityRole="summary" style={{ alignItems: 'center', paddingHorizontal: 28, paddingVertical: small ? 16 : 32, gap: small ? 8 : 12 }}>
      <View style={{ width: W * scale, height: H * scale }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Svg width={W * scale} height={H * scale} viewBox={`0 0 ${W} ${H}`}>
          <G>{art}</G>
        </Svg>
        {flies.map((f, i) => (
          <Firefly key={i} fly={f} scale={scale} still={still} />
        ))}
      </View>
      <Text display size={small ? 18 : 22} style={{ textAlign: 'center', color: night ? '#f5ede6' : undefined }}>
        {title}
      </Text>
      {text ? (
        <Text tone="muted" size={small ? 14 : 15} style={{ textAlign: 'center', lineHeight: small ? 20 : 22, maxWidth: 340, color: night ? '#c9b8ab' : undefined }}>
          {text}
        </Text>
      ) : null}
      {children ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 4 }}>{children}</View> : null}
    </View>
  )
}
