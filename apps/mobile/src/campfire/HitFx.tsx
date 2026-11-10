import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated'
import type { Token } from '@glofly/shared'
import { useCampfire, type Hit } from './store'
import { centerOf, useFire, useStill } from './lib'

// The Round board's hit animation, driven by `campfire:hit`:
//   melee  → the attacker bumps toward the target (170 ms there and back)
//   ranged → an arrow flies from the attacker to the target (330 ms)
//   spell  → a beam of light drops onto the target (330 ms)
// then the target shakes and flashes, a number floats up ("−10", "Hit!" when the campaign hides
// that monster's HP, "Miss" with a dodge), and its bar drops (the bar itself animates in Map.tsx
// when the token's new HP arrives). "Defeated" / "Bloodied" follow.
// Reduce Motion: nothing moves; the target glows and the number shows in place (those fades run
// with ReduceMotion.Never, or reanimated would skip them and nothing would show at all).

const TRAVEL_MS = 330
const KEEP = ReduceMotion.Never
const BUMP_MS = 170

/** The bump / shake / dodge / glow of one token for hits that involve it. */
export function useTokenFx(campaignId: string, tokenId: string, cell: number, still: boolean) {
  const hits = useCampfire((s) => s.hits[campaignId])
  const dx = useSharedValue(0)
  const dy = useSharedValue(0)
  const glow = useSharedValue(0)
  const flash = useSharedValue(1)
  const seen = useRef(new Set<number>())
  useEffect(() => {
    for (const h of hits ?? []) {
      if (seen.current.has(h.id)) continue
      seen.current.add(h.id)
      if (Date.now() - h.at > 2000) continue
      const travel = h.kind === 'melee' ? BUMP_MS : TRAVEL_MS
      if (h.attackerTokenId === tokenId && h.kind === 'melee' && !still) {
        const tokens = useCampfire.getState().tables[campaignId]?.tokens ?? []
        const a = tokens.find((t) => t.id === h.attackerTokenId)
        const b = tokens.find((t) => t.id === h.targetTokenId)
        if (a && b) {
          const [ax, ay] = centerOf(a, cell)
          const [bx, by] = centerOf(b, cell)
          const d = Math.max(1, Math.hypot(bx - ax, by - ay))
          const k = (cell * 0.37) / d // 26 px of a 70 px cell, like the board
          dx.value = withSequence(withTiming((bx - ax) * k, { duration: BUMP_MS / 2 }), withTiming(0, { duration: BUMP_MS / 2 }))
          dy.value = withSequence(withTiming((by - ay) * k, { duration: BUMP_MS / 2 }), withTiming(0, { duration: BUMP_MS / 2 }))
        }
      }
      if (h.targetTokenId === tokenId) {
        if (still) {
          glow.value = withSequence(withTiming(1, { duration: 0, reduceMotion: KEEP }), withDelay(1200, withTiming(0, { duration: 400, reduceMotion: KEEP }), KEEP))
        } else if (h.miss) {
          const s = cell / 70
          dx.value = withDelay(travel, withSequence(withTiming(10 * s, { duration: 160 }), withTiming(0, { duration: 240 })))
          dy.value = withDelay(travel, withSequence(withTiming(-6 * s, { duration: 160 }), withTiming(0, { duration: 240 })))
        } else {
          const s = (cell / 70) * 7
          dx.value = withDelay(
            travel,
            withSequence(withTiming(-s, { duration: 76 }), withTiming(s, { duration: 76 }), withTiming(-s * 0.7, { duration: 76 }), withTiming(s * 0.5, { duration: 76 }), withTiming(0, { duration: 76 })),
          )
          flash.value = withDelay(travel, withSequence(withTiming(0.35, { duration: 60 }), withTiming(1, { duration: 390 })))
          glow.value = withDelay(travel, withSequence(withTiming(0.9, { duration: 60 }), withTiming(0, { duration: 420 })))
        }
      }
    }
  }, [hits, tokenId, campaignId, cell, still, dx, dy, glow, flash])
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }, { translateY: dy.value }] }))
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }))
  return { style, glow: glowStyle, flash }
}

/** Arrows, beams and floating numbers, drawn in map pixels over the tokens. */
export function HitLayer({ hits, tokens, cell, zoom }: { hits: Hit[]; tokens: Token[]; cell: number; zoom: number }) {
  if (!hits.length) return null
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}>
      {hits.map((h) => (
        <OneHit key={h.id} hit={h} tokens={tokens} cell={cell} zoom={zoom} />
      ))}
    </View>
  )
}

/** What the floating number says. */
export function hitText(h: Pick<Hit, 'miss' | 'amount' | 'amountHidden' | 'crit'>): string {
  if (h.miss) return 'Miss'
  if (h.amountHidden || h.amount <= 0) return h.crit ? 'Critical hit!' : 'Hit!'
  return `−${h.amount}`
}

function OneHit({ hit, tokens, cell, zoom }: { hit: Hit; tokens: Token[]; cell: number; zoom: number }) {
  const fire = useFire()
  const still = useStill()
  // Where things were when the hit came in (the target's bar may change right after).
  const [frozen] = useState(() => ({
    a: tokens.find((t) => t.id === hit.attackerTokenId) ?? null,
    b: tokens.find((t) => t.id === hit.targetTokenId) ?? null,
  }))
  const travel = still || hit.kind === 'melee' ? (still ? 0 : BUMP_MS) : TRAVEL_MS
  const p = useSharedValue(0)
  const rise = useSharedValue(0)
  const after = useSharedValue(0)
  useEffect(() => {
    p.value = withTiming(1, { duration: travel, easing: Easing.in(Easing.quad) })
    const keep = still ? KEEP : ReduceMotion.System
    rise.value = withDelay(travel, withTiming(1, { duration: still ? 1600 : 1000, easing: Easing.out(Easing.cubic), reduceMotion: keep }), keep)
    after.value = withDelay(travel + (still ? 1600 : 1000), withTiming(1, { duration: 900, reduceMotion: keep }), keep)
  }, [p, rise, after, travel, still])

  const b = frozen.b
  const z = 1 / Math.max(0.05, zoom)
  const [bx, by] = b ? centerOf(b, cell) : [0, 0]
  const [ax, ay] = frozen.a ? centerOf(frozen.a, cell) : [bx, by - 140 * z]
  const top = b ? by - (b.h * cell) / 2 - 6 * z : 0
  const missOff = hit.miss ? cell * 0.8 : 0
  const angle = (Math.atan2(by - ay, bx + missOff - ax) * 180) / Math.PI

  const arrow = useAnimatedStyle(() => ({
    opacity: p.value < 1 ? 1 : 0,
    transform: [{ translateX: ax + (bx + missOff - ax) * p.value - 14 * z }, { translateY: ay + (by - ay) * p.value - 2 * z }, { rotate: `${angle}deg` }],
  }))
  const beam = useAnimatedStyle(() => ({
    opacity: p.value < 1 ? 1 : 0,
    transform: [{ translateX: bx - 14 * z }, { translateY: by - 140 * z * (1 - p.value) - 40 * z }],
  }))
  const pop = useAnimatedStyle(() => ({
    opacity: still ? (rise.value < 0.85 ? 1 : 1 - (rise.value - 0.85) / 0.15) * (rise.value > 0 ? 1 : 0) : rise.value === 0 ? 0 : rise.value < 0.15 ? rise.value / 0.15 : 1 - Math.max(0, rise.value - 0.6) / 0.4,
    transform: [{ translateY: still ? 0 : -10 * z - rise.value * 30 * z }, { scale: still ? 1 : rise.value < 0.15 ? 0.7 + rise.value * 3 : 1.15 - Math.min(0.15, (rise.value - 0.15) * 0.5) }],
  }))
  const second = useAnimatedStyle(() => ({ opacity: after.value === 0 ? 0 : after.value < 0.8 ? 1 : (1 - after.value) * 5, transform: [{ translateY: still ? 0 : -after.value * 20 * z }] }))
  if (!b) return null
  const color = hit.miss ? '#E5D6CA' : hit.kind === 'spell' ? fire.spell : fire.hurt
  const followUp = hit.miss ? null : hit.defeated ? 'Defeated' : hit.bloodied ? 'Bloodied' : null
  const textStyle = { fontFamily: 'Outfit_700Bold', fontSize: 26 * z, color, textShadowColor: 'rgba(0,0,0,0.9)', textShadowRadius: 6 * z, textShadowOffset: { width: 0, height: 2 * z } }
  return (
    <>
      {!still && hit.kind === 'ranged' && frozen.a ? (
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 28 * z, height: 4 * z, borderRadius: 2 * z, backgroundColor: '#F3E6DA', boxShadow: `0 0 ${8 * z}px rgba(255,179,71,0.8)` }, arrow]} />
      ) : null}
      {!still && hit.kind === 'spell' ? (
        <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: 28 * z, height: 56 * z, borderRadius: 14 * z, backgroundColor: '#FFE7A8', boxShadow: `0 0 ${24 * z}px ${8 * z}px rgba(255,208,138,0.7)` }, beam]} />
      ) : null}
      <Animated.View style={[{ position: 'absolute', left: bx - 150 * z, width: 300 * z, top: top - 30 * z, alignItems: 'center' }, pop]} accessibilityLiveRegion="polite">
        <Animated.Text style={textStyle}>{hitText(hit)}</Animated.Text>
      </Animated.View>
      {followUp ? (
        <Animated.View style={[{ position: 'absolute', left: bx - 150 * z, width: 300 * z, top: top - 30 * z, alignItems: 'center' }, second]}>
          <Animated.Text style={{ ...textStyle, color: hit.defeated ? fire.redText : '#FFB08A' }}>{followUp}</Animated.Text>
        </Animated.View>
      ) : null}
    </>
  )
}
