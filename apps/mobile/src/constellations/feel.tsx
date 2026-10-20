import { useEffect, useRef } from 'react'
import { Animated, Pressable, View } from 'react-native'
import type { Message, PublicUser } from '@glofly/shared'
import { useCall } from '@/calls/controller'
import { useSession } from '@/state/session'
import { loadDetail, useCx } from '@/state/constellations'
import { loadLatest } from '@/state/sync'
import { Text } from '@/ui/kit'
import { useReduceMotion } from './motion'
import { lastCxPlace, loadCxPlace } from './nav'
import { Face, N } from './ui'

// 0.7.5 Constellations polish, "feel" (approved canvas boards 5, 7, 8 and 11), the phone pieces:
// the "New since you left" line and pill, the 📌 pins chip, voice counts / stacked faces /
// talking glow, and loading your last constellation ahead of time.

// ───────────── 7 · New since you left ─────────────

export type NewSince = { since: string; count: number }

const clock = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/** "6:12 PM" today, "Mon 6:12 PM" this week, "Oct 3, 6:12 PM" before that. */
export function sinceLabel(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  if (d.toDateString() === new Date(now).toDateString()) return clock(iso)
  if (now - d.getTime() < 6 * 24 * 60 * 60_000) return `${d.toLocaleDateString([], { weekday: 'short' })} ${clock(iso)}`
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock(iso)}`
}

/** The first message (oldest first) after `since` that someone else wrote: the line goes before it. */
export function firstNewId(oldestFirst: Message[], since: string, meId: string): string | null {
  const t = new Date(since).getTime()
  for (const m of oldestFirst) {
    if (m.senderId === meId || m.event || new Date(m.createdAt).getTime() <= t) continue
    return m.id
  }
  return null
}

export function NewSinceLine({ since }: { since: string }) {
  const label = sinceLabel(since)
  return (
    <View accessibilityRole="text" accessibilityLabel={`New messages since you left at ${label}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 2 }}>
      <View style={{ flex: 1, height: 2, borderRadius: 1, backgroundColor: N.amber, opacity: 0.8, boxShadow: '0 0 8px 1px rgba(255,165,74,0.55)' }} />
      <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,179,71,0.16)', boxShadow: '0 0 12px rgba(255,165,74,0.45)' }}>
        <Text size={11} weight="bold" style={{ color: N.tag, letterSpacing: 0.6 }}>
          NEW · SINCE {label.toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1, height: 2, borderRadius: 1, backgroundColor: N.amber, opacity: 0.8, boxShadow: '0 0 8px 1px rgba(255,165,74,0.55)' }} />
    </View>
  )
}

export function NewSincePill({ info, onJump, onMarkRead }: { info: NewSince; onJump: () => void; onMarkRead: () => void }) {
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{ position: 'absolute', top: 10, alignSelf: 'center', zIndex: 5, flexDirection: 'row', alignItems: 'center', gap: 2, padding: 4, borderRadius: 999, backgroundColor: N.card, borderWidth: 1, borderColor: N.edge, boxShadow: '0 0 20px rgba(255,165,74,0.3), 0 10px 26px rgba(0,0,0,0.35)' }}
    >
      <Pressable accessibilityRole="button" accessibilityLabel={`Jump to first unread, ${info.count} new since ${sinceLabel(info.since)}`} onPress={onJump} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, backgroundColor: N.amber, flexDirection: 'row', alignItems: 'center' }}>
        <Text size={14} weight="bold" style={{ color: N.amberInk }}>
          ↑ {info.count > 99 ? '99+' : info.count} new
        </Text>
      </Pressable>
      <Text size={12} style={{ color: N.ink2, paddingHorizontal: 6 }}>
        since {sinceLabel(info.since)}
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Mark as read" onPress={onMarkRead} style={{ minHeight: 40, paddingHorizontal: 12, borderRadius: 999, justifyContent: 'center' }}>
        <Text size={13} weight="bold">
          Mark as read
        </Text>
      </Pressable>
    </View>
  )
}

// ───────────── 8 · pins chip ─────────────

export function PinsChip({ count, onPress }: { count: number; onPress: () => void }) {
  if (!count) return null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} pinned ${count === 1 ? 'message' : 'messages'}`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => ({ minHeight: 30, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: pressed ? N.amber : N.edge2, backgroundColor: pressed ? 'rgba(255,179,71,0.16)' : N.raised, flexDirection: 'row', alignItems: 'center', gap: 4 })}
    >
      <Text size={12}>📌</Text>
      <Text size={12} weight="bold">
        {count}
      </Text>
    </Pressable>
  )
}

// ───────────── 11 · who's in voice ─────────────

/** "4 in voice" next to a voice nebula's name. */
export function InVoiceCount({ count, small }: { count: number; small?: boolean }) {
  return (
    <Text size={small ? 11 : 12} weight="bold" style={{ color: N.greenText }}>
      {count} in voice
    </Text>
  )
}

/** Who's talking right now in your own voice room (only knowable from inside it). */
export function useTalking(nebulaId: string): Set<string> {
  const mine = useCall((s) => s.voice?.nebulaId === nebulaId)
  const tiles = useCall((s) => s.tiles)
  if (!mine) return new Set()
  return new Set(tiles.filter((t) => t.speaking && !t.micMuted).map((t) => t.userId))
}

/** A face with a soft glow that pulses while they talk (still with Reduce Motion). */
export function TalkingFace({ user, size, talking }: { user: PublicUser; size: number; talking: boolean }) {
  const reduce = useReduceMotion((s) => s.on)
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (!talking || reduce) {
      pulse.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [talking, reduce, pulse])
  return (
    <View style={{ width: size, height: size }}>
      {talking ? (
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', left: -3, top: -3, right: -3, bottom: -3, borderRadius: size, borderWidth: 2, borderColor: N.amber, boxShadow: '0 0 10px 3px rgba(255,165,74,0.55)', opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }}
        />
      ) : null}
      <Face user={user} size={size} />
    </View>
  )
}

/** Busy voice nebula: three faces overlapped and "+N". */
export function StackedFaces({ people, size }: { people: PublicUser[]; size: number }) {
  const shown = people.slice(0, 3)
  const more = people.length - shown.length
  return (
    <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {shown.map((p, i) => (
        <View key={p.id} style={{ marginLeft: i ? -7 : 0, borderRadius: size, boxShadow: `0 0 0 2px ${N.side}` }}>
          <Face user={p} size={size} />
        </View>
      ))}
      {more > 0 ? (
        <View style={{ marginLeft: -7, width: size, height: size, borderRadius: size / 2, backgroundColor: N.line2, boxShadow: `0 0 0 2px ${N.side}`, alignItems: 'center', justifyContent: 'center' }}>
          <Text size={10} weight="bold" style={{ color: N.ink2 }}>
            +{more}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

/** More people than this (and you're not in it): stacked faces */
export const VOICE_LIST_MAX = 4

// ───────────── 5 · instant fly-in ─────────────

/**
 * While Glofly is open on home: once things are idle, your last constellation and the newest
 * messages of the nebula you'll land in load quietly, so the hop in lands on a finished screen.
 * Light on purpose: one constellation and one page of messages, a few seconds after opening.
 */
export function usePreloadCx() {
  const userId = useSession((s) => s.user?.id ?? null)
  const cardIds = useCx((s) => s.cards.map((c) => c.id).join(','))
  useEffect(() => {
    if (!userId || !cardIds) return
    let cancelled = false
    const timer = setTimeout(async () => {
      await loadCxPlace()
      const place = lastCxPlace()
      if (!place || cancelled) return
      const detail = useCx.getState().details?.[place.constellationId] ?? (await loadDetail(place.constellationId))
      if (!detail || cancelled) return
      const land = detail.nebulas.find((n) => n.id === place.nebulaId) ?? detail.nebulas.find((n) => n.kind === 'text')
      if (land?.kind === 'text') void loadLatest(land.conversationId)
    }, 3000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [userId, cardIds])
}
