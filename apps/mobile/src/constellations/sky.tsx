import { memo, useEffect, useMemo } from 'react'
import { StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useFrameCallback,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg'
import { useReduceMotion } from './motion'

// The night sky from the "Glofly 2.0 Mobile" canvas (Sky.dc.html and the playable transition):
// seeded stars that twinkle (1 in 6 a glowing orange one), fireflies that wander with flapping
// wings, and the swarm that carries you home. The numbers are the canvas's; keep them.

/** The canvas's small seeded random, so the sky is the same every time. */
export function seeded(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 9301 + 49297) % 233280
    return s / 233280
  }
}

export type Star = { x: number; y: number; size: number; color: string; gold: boolean; delay: number }
export type SwarmFly = { top: number; w: number; h: number; delay: number; dur: number; dy: number; rot: number; flap: number; bobDelay: number }

const CREAM = ['#e9d5c4', '#f5ede6', '#f9b26b']

/** The playable transition's 112 stars and its 30-firefly swarm (one random sequence, seed 42). */
function makeTransitionSky(): { stars: Star[]; swarm: SwarmFly[] } {
  const rnd = seeded(42)
  const stars: Star[] = []
  for (let i = 0; i < 112; i++) {
    const gold = i % 6 === 0
    stars.push({
      x: Math.round((rnd() * 98 + 1) * 10) / 10,
      y: Math.round((rnd() * 98 + 1) * 10) / 10,
      size: gold ? (rnd() < 0.5 ? 3 : 4) : [1.5, 2, 2, 2.5][Math.floor(rnd() * 4)],
      color: gold ? '#ffb347' : CREAM[Math.floor(rnd() * 3)],
      gold,
      delay: Math.round(rnd() * 380),
    })
  }
  const lanes: number[] = []
  for (let i = 0; i < 30; i++) lanes.push(2 + (90 * i) / 29)
  for (let i = lanes.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    const t = lanes[i]
    lanes[i] = lanes[j]
    lanes[j] = t
  }
  const swarm = lanes.map((top) => {
    const w = Math.round(22 + Math.pow(rnd(), 2.2) * 110)
    const dir = Math.floor(rnd() * 3) - 1
    const dy = dir * Math.round(20 + rnd() * 60)
    const delay = Math.round(rnd() * 660)
    const dur = Math.round(1250 - 3 * w + rnd() * 150)
    const flap = Math.round(110 + rnd() * 120)
    const bobDelay = Math.round(rnd() * 420)
    return { top: Math.round(top * 10) / 10, w, h: Math.round((w * 190) / 256), delay, dur, dy, rot: dir === 0 ? 0 : dir * -6, flap, bobDelay }
  })
  return { stars, swarm }
}

export const TRANSITION = makeTransitionSky()

// ───────────── Firefly ─────────────

/** The firefly from the canvas (256 × 190), wings flapping (150 ms) and its light pulsing. */
export const Firefly = memo(function Firefly({ w, flap = 150, still, facingLeft }: { w: number; flap?: number; still?: boolean; facingLeft?: boolean }) {
  const h = Math.round((w * 190) / 256)
  const reduce = useReduceMotion((s) => s.on)
  const t = useSharedValue(0)
  const glow = useSharedValue(0)
  const moving = !still && !reduce
  useEffect(() => {
    if (!moving) return
    t.value = withRepeat(withTiming(1, { duration: flap, easing: Easing.inOut(Easing.ease) }), -1, true)
    glow.value = withRepeat(withTiming(1, { duration: 550, easing: Easing.inOut(Easing.ease) }), -1, true)
    return () => {
      cancelAnimation(t)
      cancelAnimation(glow)
    }
  }, [moving, flap, t, glow])
  const left = useAnimatedStyle(() => ({ transform: [{ rotate: `${-16 * t.value}deg` }, { scale: 1 - 0.16 * t.value }] }))
  const right = useAnimatedStyle(() => ({ transform: [{ rotate: `${16 * t.value}deg` }, { scale: 1 - 0.16 * t.value }] }))
  const light = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * glow.value }))
  const origin = { transformOrigin: `${(140 / 256) * 100}% ${(92 / 190) * 100}%` } as ViewStyle
  return (
    <View style={{ width: w, height: h, transform: facingLeft ? [{ scaleX: -1 }] : undefined }} pointerEvents="none">
      {/* The light's glow (a soft halo behind the tail) */}
      <Animated.View
        style={[
          { position: 'absolute', left: (34 / 256) * w, top: (112 / 190) * h, width: (80 / 256) * w, height: (54 / 190) * h, borderRadius: w, backgroundColor: 'rgba(255,179,71,0.35)', boxShadow: `0 0 ${Math.max(6, w * 0.12)}px ${Math.max(2, w * 0.05)}px rgba(255,200,90,0.8)` },
          light,
        ]}
      />
      <Animated.View style={[StyleSheet.absoluteFill, origin, left]}>
        <Svg width={w} height={h} viewBox="0 0 256 190">
          <G fill="none" stroke="#f7841f" strokeWidth={10}>
            <Ellipse cx={80} cy={62} rx={66} ry={24} transform="rotate(22 80 62)" />
            <Ellipse cx={118} cy={128} rx={19} ry={42} transform="rotate(-25 118 128)" />
          </G>
        </Svg>
      </Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, origin, right]}>
        <Svg width={w} height={h} viewBox="0 0 256 190">
          <G fill="none" stroke="#f7841f" strokeWidth={10}>
            <Ellipse cx={184} cy={120} rx={64} ry={22} transform="rotate(32 184 120)" />
            <Ellipse cx={160} cy={72} rx={16} ry={30} transform="rotate(40 160 72)" />
          </G>
        </Svg>
      </Animated.View>
      <Svg width={w} height={h} viewBox="0 0 256 190" style={StyleSheet.absoluteFill}>
        <Path d="M136 24 L128 6 M150 24 L162 9" stroke="#fbbf24" strokeWidth={7} strokeLinecap="round" fill="none" />
        <Circle cx={143} cy={38} r={17} fill="#fbbf24" />
        <Ellipse cx={151} cy={74} rx={29} ry={27} fill="#f9a825" />
        <Rect x={34} y={112} width={80} height={54} rx={23} fill="#ff9a2e" />
        <Path d="M46 158 L36 184 L70 164 Z" fill="#ff9a2e" />
      </Svg>
    </View>
  )
})

// ───────────── Stars ─────────────

/** One glowing orange star: breathes (3.2 s) bigger and brighter. */
function GoldStar({ s, clock }: { s: Star; clock: SharedValue<number> | null }) {
  const reduce = useReduceMotion((r) => r.on)
  const pulse = useSharedValue(0)
  useEffect(() => {
    if (reduce) return
    const dur = [3200, 4000, 2700, 4600][s.size === 4 ? 1 : Math.round(s.x) % 4]
    pulse.value = withDelay(Math.round(s.y * 30), withRepeat(withTiming(1, { duration: dur / 2, easing: Easing.inOut(Easing.ease) }), -1, true))
    return () => cancelAnimation(pulse)
  }, [reduce, pulse, s])
  const style = useAnimatedStyle(() => {
    const w = warpOf(clock?.value, s.delay)
    return {
      opacity: (0.42 + 0.5 * pulse.value) * w.opacity,
      transform: [{ translateX: w.tx }, { scaleX: w.sx }, { scale: 1 + 0.3 * pulse.value }],
    }
  })
  return (
    <Animated.View
      style={[
        { position: 'absolute', left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, borderRadius: s.size, backgroundColor: s.color, boxShadow: '0 0 8px 3px rgba(255,165,74,0.55)' },
        style,
      ]}
    />
  )
}

/**
 * The warp: each star starts 220 pt to the right, stretches ×10, then settles (1100 ms, its own
 * delay up to 380 ms). `t` = ms since the swipe started; undefined/large = settled.
 */
function warpOf(t: number | undefined, delay: number): { tx: number; sx: number; opacity: number } {
  'worklet'
  if (t === undefined || t >= 1500) return { tx: 0, sx: 1, opacity: 1 }
  const p = Math.min(1, Math.max(0, (t - delay) / 1100))
  if (p <= 0) return { tx: 220, sx: 1, opacity: 0 }
  if (p < 0.35) {
    const q = 1 - Math.pow(1 - p / 0.35, 2)
    return { tx: 220 - 150 * q, sx: 1 + 9 * q, opacity: q }
  }
  const q = 1 - Math.pow(1 - (p - 0.35) / 0.65, 2)
  return { tx: 70 - 70 * q, sx: 10 - 9 * q, opacity: 1 }
}

/** A group of small stars twinkling together (.3 ↔ 1, 2.8 s; the canvas's three offsets). */
function TwinkleGroup({ stars, delay, duration, clock }: { stars: Star[]; delay: number; duration: number; clock: SharedValue<number> | null }) {
  const reduce = useReduceMotion((r) => r.on)
  const tw = useSharedValue(1)
  useEffect(() => {
    if (reduce) {
      tw.value = 0.75
      return
    }
    tw.value = 0.3
    tw.value = withDelay(delay, withRepeat(withSequence(withTiming(1, { duration: duration / 2 }), withTiming(0.3, { duration: duration / 2 })), -1))
    return () => cancelAnimation(tw)
  }, [reduce, tw, delay, duration])
  const group = useAnimatedStyle(() => ({ opacity: tw.value }))
  return (
    <Animated.View style={[StyleSheet.absoluteFill, group]} pointerEvents="none">
      {stars.map((s, i) => (
        <SmallStar key={i} s={s} clock={clock} />
      ))}
    </Animated.View>
  )
}

function SmallStar({ s, clock }: { s: Star; clock: SharedValue<number> | null }) {
  const style = useAnimatedStyle(() => {
    const w = warpOf(clock?.value, s.delay)
    return { opacity: w.opacity, transform: [{ translateX: w.tx }, { scaleX: w.sx }] }
  })
  return <Animated.View style={[{ position: 'absolute', left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, borderRadius: s.size, backgroundColor: s.color }, style]} />
}

/** The star field. `clock` (ms since the swipe started) plays the warp; without it they're settled. */
export const StarField = memo(function StarField({ stars = TRANSITION.stars, clock = null }: { stars?: Star[]; clock?: SharedValue<number> | null }) {
  const groups = useMemo(() => {
    const small = stars.filter((s) => !s.gold)
    return {
      a: small.filter((_, i) => (i + 1) % 2 !== 0 && (i + 1) % 3 !== 0),
      b: small.filter((_, i) => (i + 1) % 2 === 0 && (i + 1) % 3 !== 0),
      c: small.filter((_, i) => (i + 1) % 3 === 0),
      gold: stars.filter((s) => s.gold),
    }
  }, [stars])
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <TwinkleGroup stars={groups.a} delay={0} duration={2800} clock={clock} />
      <TwinkleGroup stars={groups.b} delay={900} duration={2800} clock={clock} />
      <TwinkleGroup stars={groups.c} delay={1700} duration={3400} clock={clock} />
      {groups.gold.map((s, i) => (
        <GoldStar key={i} s={s} clock={clock} />
      ))}
    </View>
  )
})

// ───────────── Wandering fireflies ─────────────

const SPOTS = [
  { x: 74, y: 20, w: 16 },
  { x: 18, y: 64, w: 13 },
  { x: 82, y: 78, w: 15 },
  { x: 42, y: 14, w: 12 },
  { x: 58, y: 52, w: 18 },
]

type FlyPath = { wx: number[]; wy: number[]; fx: number[]; fy: number[]; px: number[]; py: number[] }

function Wanderer({ spot, path }: { spot: (typeof SPOTS)[number]; path: FlyPath }) {
  const reduce = useReduceMotion((r) => r.on)
  const x = useSharedValue(0)
  const y = useSharedValue(0)
  const rot = useSharedValue<number | null>(null)
  const frame = useFrameCallback((f) => {
    const t = f.timeSinceFirstFrame / 1000
    const dt = Math.min(0.05, (f.timeSincePreviousFrame ?? 16) / 1000)
    const nx = path.wx[0] * Math.sin(t * path.fx[0] + path.px[0]) + path.wx[1] * Math.sin(t * path.fx[1] + path.px[1])
    const ny = path.wy[0] * Math.sin(t * path.fy[0] + path.py[0]) + path.wy[1] * Math.sin(t * path.fy[1] + path.py[1])
    const vx = path.wx[0] * path.fx[0] * Math.cos(t * path.fx[0] + path.px[0]) + path.wx[1] * path.fx[1] * Math.cos(t * path.fx[1] + path.px[1])
    const vy = path.wy[0] * path.fy[0] * Math.cos(t * path.fy[0] + path.py[0]) + path.wy[1] * path.fy[1] * Math.cos(t * path.fy[1] + path.py[1])
    const heading = (Math.atan2(vy, vx) * 180) / Math.PI + 35
    if (rot.value === null) rot.value = heading
    const diff = ((heading - rot.value + 540) % 360) - 180
    rot.value = rot.value + diff * Math.min(1, dt * 2.5)
    x.value = nx
    y.value = ny * 0.6
  }, false)
  useEffect(() => {
    frame.setActive(!reduce)
    return () => frame.setActive(false)
  }, [reduce, frame])
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${rot.value ?? 0}deg` }] }))
  const h = Math.round((spot.w * 190) / 256)
  return (
    <View style={{ position: 'absolute', left: `${spot.x}%`, top: `${spot.y}%`, width: 0, height: 0 }} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute', left: -spot.w / 2, top: -h / 2 }, style]}>
        <Firefly w={spot.w} />
      </Animated.View>
    </View>
  )
}

/** Up to five fireflies drifting on their own slow loops (the canvas's spots). */
export const WanderingFireflies = memo(function WanderingFireflies({ count = 3, seed = 5 }: { count?: number; seed?: number }) {
  const paths = useMemo(() => {
    const rnd = seeded(seed * 97 + 13)
    return SPOTS.slice(0, count).map(() => ({
      wx: [70 + rnd() * 90, 20 + rnd() * 30],
      wy: [45 + rnd() * 55, 12 + rnd() * 25],
      fx: [0.16 + rnd() * 0.18, 0.3 + rnd() * 0.2],
      fy: [0.14 + rnd() * 0.18, 0.28 + rnd() * 0.2],
      px: [rnd() * 6.28, rnd() * 6.28],
      py: [rnd() * 6.28, rnd() * 6.28],
    }))
  }, [count, seed])
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {paths.map((p, i) => (
        <Wanderer key={i} spot={SPOTS[i]} path={p} />
      ))}
    </View>
  )
})

/** The whole night: dark sky, stars and (optionally) wandering fireflies. */
export function NightSky({ flies = 3, clock = null, still }: { flies?: number; clock?: SharedValue<number> | null; still?: boolean }) {
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#120c0a', overflow: 'hidden' }]} pointerEvents="none">
      <StarField clock={clock} />
      {flies > 0 && !still ? <WanderingFireflies count={flies} /> : null}
    </View>
  )
}

// ───────────── The swarm home ─────────────

function SwarmOne({ f, travel, start }: { f: SwarmFly; travel: number; start: SharedValue<number> }) {
  const bob = useSharedValue(0)
  useEffect(() => {
    bob.value = withDelay(f.bobDelay, withRepeat(withTiming(1, { duration: 420, easing: Easing.inOut(Easing.ease) }), -1, true))
    return () => cancelAnimation(bob)
  }, [bob, f.bobDelay])
  const style = useAnimatedStyle(() => {
    const p = Math.min(1, Math.max(0, (start.value - f.delay) / f.dur))
    // cubic-bezier(.45,.1,.75,.95) ≈ an ease-in-out leaning late
    const e = p < 0.5 ? 2 * p * p * (1.1 - 0.2 * p) : 1 - Math.pow(-2 * p + 2, 2) / 2
    const opacity = p <= 0 ? 0 : p < 0.08 ? p / 0.08 : p < 0.86 ? 1 : p >= 1 ? 0 : 1 - (p - 0.86) / 0.14
    return {
      opacity,
      transform: [{ translateX: -travel * e }, { translateY: f.dy * e + interpolate(bob.value, [0, 1], [-6, 6]) }, { rotate: `${f.rot * e}deg` }],
    }
  })
  return (
    <Animated.View style={[{ position: 'absolute', left: '100%', top: `${f.top}%` }, style]}>
      <Firefly w={f.w} flap={f.flap} facingLeft />
    </Animated.View>
  )
}

/** 30 fireflies crossing right to left, each in its own lane (the trip home). */
export function Swarm({ start }: { start: SharedValue<number> }) {
  const { width } = useWindowDimensions()
  const travel = width + 300
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {TRANSITION.swarm.map((f, i) => (
        <SwarmOne key={i} f={f} travel={travel} start={start} />
      ))}
    </View>
  )
}
