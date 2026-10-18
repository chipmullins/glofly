import { useEffect } from 'react'
import { StyleSheet, View, useWindowDimensions } from 'react-native'
import { router, type Href } from 'expo-router'
import Animated, { Easing, makeMutable, useAnimatedStyle, withDelay, withTiming } from 'react-native-reanimated'
import { create } from 'zustand'
import { StarField, Swarm } from './sky'
import { haptic, reduceMotion } from './motion'
import { quickHop } from './nav'

// The starry swipe into Constellations and the firefly swarm home, at the approved desktop timings
// sized for a phone (board 1 / 1b of the "Glofly 2.0 Mobile" canvas):
//
//   In:   a circle of night grows from the tab (950 ms) while Chats slides left and fades (800 ms);
//         112 stars warp in (each from 220 pt right, stretched ×10, settling in 1100 ms, delays
//         0–380 ms); the content rises 18 pt and fades in from 1050 ms (650 ms).
//   Home: 30 fireflies cross right to left in their own lanes; the night slides right and fades
//         from 250 ms (900 ms); Chats comes back from the left at 350 ms (950 ms); done at 2100 ms.
//   Haptics: a light tap on press, a soft thud as the dashboard lands. Reduce Motion: instant.

export type NightPhase = 'home' | 'in' | 'night' | 'out'

type NightState = {
  phase: NightPhase
  /** 0.7.1: this trip is a quick hop (no warp, no swarm) */
  quick?: boolean
  /** Where the circle grows from (the tab), in window points */
  origin: { x: number; y: number }
}

export const useNight = create<NightState>(() => ({ phase: 'home', origin: { x: 0, y: 0 } }))

// The animation's values (shared with the UI thread).
/** 0 = Glofly home as normal, 1 = slid away to the left */
export const homeAway = makeMutable(0)
/** The circle of night: 0 → 1 */
const circle = makeMutable(0)
/** ms since the stars started warping (≥ 1500 = settled) */
export const warpClock = makeMutable(1500)
/** The night side's content: 0 = 18 pt low and clear, 1 = in place */
export const contentIn = makeMutable(1)
/** 0 = the night in place, 1 = slid away right (on the way home) */
export const nightAway = makeMutable(0)
/** ms since the swarm set off */
const swarmClock = makeMutable(0)
/** The night side has drawn its first frame (the circle can go) */
const nightReady = makeMutable(1)
/** The window's width (the slides are 30% of it) */
const screenW = makeMutable(390)

const EASE_AWAY = Easing.bezier(0.5, 0, 0.75, 0)
const EASE_BACK = Easing.bezier(0.2, 0.7, 0.2, 1)
const EASE_CIRCLE = Easing.bezier(0.22, 0.7, 0.2, 1)

let timers: ReturnType<typeof setTimeout>[] = []
const later = (fn: () => void, ms: number) => timers.push(setTimeout(fn, ms))
const clearTimers = () => {
  timers.forEach(clearTimeout)
  timers = []
}

/** Pops the whole night side off (set by its layout: the main stack's "back"). */
let exitNight: (() => void) | null = null
export function registerNightExit(fn: (() => void) | null) {
  exitNight = fn
}

const go = (target: Href | Href[]) => {
  const list = Array.isArray(target) ? target : [target]
  list.forEach((h, i) => (i === 0 ? router.push(h) : setTimeout(() => router.push(h), 40 * i)))
}

/**
 * Fly into Constellations from `origin` (the tab's middle), landing on the dashboard, or on
 * `target` (a constellation, then a nebula). Already up there: just go to the target.
 */
export function flyIn(origin: { x: number; y: number } | null, target?: Href | Href[], opts: { quick?: boolean } = {}) {
  // 0.7.1: quick whenever you're in a constellation already; the full swipe until you are.
  opts = { quick: opts.quick ?? quickHop() }
  const { phase } = useNight.getState()
  if (phase === 'night' || phase === 'in') {
    if (target) go(target)
    return
  }
  if (phase === 'out') return
  clearTimers()
  haptic.light()
  const landing: Href[] = target ? (Array.isArray(target) ? target : [target]) : ['/constellations']
  if (reduceMotion()) {
    homeAway.value = 1
    contentIn.value = 1
    warpClock.value = 1500
    nightAway.value = 0
    useNight.setState({ phase: 'night' })
    go(landing)
    return
  }
  useNight.setState({ phase: 'in', origin: origin ?? useNight.getState().origin, quick: !!opts.quick })
  nightReady.value = 0
  nightAway.value = 0
  circle.value = 0
  homeAway.value = 0
  warpClock.value = 0
  contentIn.value = 0
  if (opts.quick) {
    // 0.7.1: the quick hop (you're in a constellation already): the same circle and slide in
    // about a third of the time, the stars already settled.
    warpClock.value = 1500
    homeAway.value = withTiming(1, { duration: 320, easing: EASE_AWAY })
    circle.value = withTiming(1, { duration: 380, easing: EASE_CIRCLE })
    contentIn.value = withDelay(380, withTiming(1, { duration: 240, easing: Easing.out(Easing.ease) }))
    later(() => {
      useNight.setState({ phase: 'night' })
      go(landing)
    }, 380)
    later(() => haptic.soft(), 420)
    return
  }
  homeAway.value = withTiming(1, { duration: 800, easing: EASE_AWAY })
  circle.value = withTiming(1, { duration: 950, easing: EASE_CIRCLE })
  warpClock.value = withTiming(1500, { duration: 1500, easing: Easing.linear })
  contentIn.value = withDelay(1050, withTiming(1, { duration: 650, easing: Easing.out(Easing.ease) }))
  // The night side opens under the full circle, so nothing pops in at the edges.
  later(() => {
    useNight.setState({ phase: 'night' })
    go(landing)
  }, 950)
  later(() => haptic.soft(), 1050)
}

/** The night side drew its first frame: the circle (with the same stars) can go. */
export function nightMounted() {
  nightReady.value = 1
}

/** Back to Glofly home with the swarm; `then` runs once home is showing (open a chat, say). */
export function flyHome(then?: () => void, opts: { quick?: boolean } = {}) {
  opts = { quick: opts.quick ?? quickHop() }
  const { phase } = useNight.getState()
  if (phase !== 'night') return
  clearTimers()
  haptic.light()
  if (reduceMotion()) {
    exitNight?.()
    homeAway.value = 0
    nightAway.value = 0
    useNight.setState({ phase: 'home' })
    if (then) setTimeout(then, 60)
    return
  }
  if (opts.quick) {
    // 0.7.1: the quick hop home: no swarm, the slides about a third of the time.
    useNight.setState({ phase: 'out', quick: true })
    nightAway.value = withTiming(1, { duration: 340, easing: EASE_AWAY })
    homeAway.value = withDelay(60, withTiming(0, { duration: 380, easing: EASE_BACK }))
    later(() => {
      exitNight?.()
      if (then) setTimeout(then, 40)
    }, 420)
    later(() => {
      nightAway.value = 0
      useNight.setState({ phase: 'home', quick: false })
    }, 520)
    return
  }
  useNight.setState({ phase: 'out', quick: false })
  swarmClock.value = 0
  swarmClock.value = withTiming(2100, { duration: 2100, easing: Easing.linear })
  nightAway.value = withDelay(250, withTiming(1, { duration: 900, easing: EASE_AWAY }))
  homeAway.value = withDelay(350, withTiming(0, { duration: 950, easing: EASE_BACK }))
  later(() => {
    exitNight?.()
    if (then) setTimeout(then, 60)
  }, 1200)
  later(() => {
    nightAway.value = 0
    useNight.setState({ phase: 'home' })
  }, 2100)
}

/** Left without the swarm (signed out, or the night side closed some other way). */
export function nightGone() {
  clearTimers()
  homeAway.value = 0
  nightAway.value = 0
  contentIn.value = 1
  warpClock.value = 1500
  nightReady.value = 1
  useNight.setState({ phase: 'home' })
}

// ---- Styles the screens use ----

/** Glofly home: slides left and fades while the night is up. */
export function useHomeAwayStyle() {
  return useAnimatedStyle(() => {
    const a = homeAway.value
    if (a <= 0) return { opacity: 1, transform: [] }
    return { opacity: 1 - a, transform: [{ translateX: -0.3 * screenW.value * a }, { scale: 1 - 0.06 * a }] }
  })
}

/** The night side: slides right and fades on the way home. */
export function useNightAwayStyle() {
  return useAnimatedStyle(() => {
    const a = nightAway.value
    if (a <= 0) return { opacity: 1, transform: [] }
    return { opacity: 1 - a, transform: [{ translateX: 0.3 * screenW.value * a }, { scale: 1 - 0.06 * a }] }
  })
}

/** Content on the first night screen: rises 18 pt and fades in. */
export function useContentInStyle() {
  return useAnimatedStyle(() => ({ opacity: contentIn.value, transform: [{ translateY: 18 * (1 - contentIn.value) }] }))
}

// ---- The overlay (over everything, in the main layout) ----

function Circle() {
  const { width, height } = useWindowDimensions()
  const origin = useNight((s) => s.origin)
  const ox = origin.x || width * 0.72
  const oy = origin.y || height - 50
  // Big enough to cover the farthest corner.
  const full = Math.hypot(Math.max(ox, width - ox), Math.max(oy, height - oy)) + 20
  const outer = useAnimatedStyle(() => {
    const r = Math.max(0.5, full * circle.value)
    return { left: ox - r, top: oy - r, width: r * 2, height: r * 2, borderRadius: r, opacity: nightReady.value >= 1 ? 0 : 1 }
  })
  const inner = useAnimatedStyle(() => {
    const r = Math.max(0.5, full * circle.value)
    return { left: -(ox - r), top: -(oy - r) }
  })
  return (
    <Animated.View style={[{ position: 'absolute', overflow: 'hidden', backgroundColor: '#120c0a' }, outer]} pointerEvents="none">
      <Animated.View style={[{ position: 'absolute', width, height }, inner]}>
        <StarField clock={warpClock} />
      </Animated.View>
    </Animated.View>
  )
}

/** The circle of night on the way in, the swarm on the way home. */
export function NightOverlay() {
  const phase = useNight((s) => s.phase)
  const quick = useNight((s) => !!s.quick)
  const { width } = useWindowDimensions()
  useEffect(() => {
    screenW.value = width
  }, [width])
  // Safety: never leave the circle up if the night side didn't report in.
  useEffect(() => {
    if (phase !== 'night') return
    const t = setTimeout(nightMounted, 900)
    return () => clearTimeout(t)
  }, [phase])
  if (phase === 'in' || phase === 'night') {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Circle />
      </View>
    )
  }
  if (phase === 'out' && quick) return null
  if (phase === 'out') {
    return (
      <View style={[StyleSheet.absoluteFill, { zIndex: 40 }]} pointerEvents="none">
        <Swarm start={swarmClock} />
      </View>
    )
  }
  return null
}
