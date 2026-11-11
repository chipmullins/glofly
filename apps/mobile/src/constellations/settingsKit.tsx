import { useEffect, useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { router } from 'expo-router'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ApiResult, ConstellationDetail, ModerationEntry, PublicUser } from '@glofly/shared'
import { cxSay, loadDetail, onRemovedFrom, putDetail, useCx } from '@/state/constellations'
import { Spinner } from '@/ui/kit'
import { haptic } from './motion'
import { N, NightCenter, NightHeader } from './ui'

// Shared pieces of a constellation's settings pages (canvas boards 7 / 7b).

/** The constellation a settings page is about (loads it if needed; leaves if you're removed). */
export function useSettingsDetail(cid: string): ConstellationDetail | null {
  const c = useCx((s) => s.details[cid]) ?? null
  useEffect(() => {
    if (!c) void loadDetail(cid)
  }, [cid, c])
  useEffect(
    () =>
      onRemovedFrom((id) => {
        if (id === cid) router.replace('/constellations')
      }),
    [cid],
  )
  return c
}

/** Runs a change that answers with the constellation's newer copy. */
export async function runDetail(task: () => Promise<ApiResult<{ constellation: ConstellationDetail }>>): Promise<boolean> {
  const r = await task()
  if (!r.ok) {
    cxSay(r.message)
    return false
  }
  putDetail(r.data.constellation)
  return true
}

export function SettingsScreen({ title, right, children, c, close, scroll = true }: { title: string; right?: ReactNode; children: ReactNode; c: ConstellationDetail | null; close?: boolean; scroll?: boolean }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      <NightHeader title={title} right={right} close={close} />
      {!c ? (
        <NightCenter>
          <Spinner />
        </NightCenter>
      ) : scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: insets.bottom + 40, gap: 14, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, width: '100%', maxWidth: 640, alignSelf: 'center' }}>{children}</View>
      )}
    </View>
  )
}

// ───────────── Moderation log lines (the same words as the desktop app) ─────────────

const ACTION_WORDS: Record<string, string> = {
  joined: 'joined',
  left: 'left',
  kicked: 'kicked',
  banned: 'banned',
  unbanned: 'unbanned',
  timed_out: 'timed out',
  timeout_removed: 'ended the time-out of',
  message_deleted: 'deleted a message by',
  roles_changed: 'changed the roles of',
  role_created: 'created a role',
  role_changed: 'changed a role',
  onboarding_changed: 'changed onboarding',
  role_deleted: 'deleted a role',
  nebula_deleted: 'deleted a nebula',
  category_deleted: 'deleted a category',
  voice_muted: 'muted in voice',
  voice_unmuted: 'unmuted in voice',
  voice_disconnected: 'disconnected from voice',
  visibility_changed: 'changed who can join',
  request_approved: 'let in',
  request_denied: 'turned down',
  ownership_transferred: 'gave ownership to',
  // Communities round 2 (Night watch)
  messages_deleted: 'deleted recent messages by',
  automod_hidden: 'held a message by',
  automod_links: 'held links by',
  automod_mentions: 'held a message with too many mentions by',
  automod_raid: 'held a message by a raid joiner,',
  automod_wait: 'asked a new member to wait:',
  automod_undo: 'let a held message through from',
  automod_kept: 'kept a held message hidden from',
  automod_changed: 'changed AutoMod',
  safety_changed: 'changed Safety',
  joins_locked: 'paused joins',
  joins_unlocked: 'reopened joins',
  raid_cleared: 'let raid joiners talk',
  raid_kicked: 'kicked raid joiners',
  report_dismissed: 'dismissed a report about',
  report_actioned: 'acted on a report about',
  appeal_accepted: 'accepted the appeal of',
  appeal_denied: 'turned down the appeal of',
  settings_changed: 'changed settings',
}

const LENGTH_WORDS: Record<string, string> = { '5m': '5 minutes', '1h': '1 hour', '1d': '1 day', '1w': '1 week' }

/** What kind of entry it is, for the filter chips. */
export function moderationKind(e: ModerationEntry): 'messages' | 'members' | 'roles' | 'other' {
  if (e.action === 'message_deleted') return 'messages'
  if (e.action.startsWith('role')) return 'roles'
  if (['joined', 'left', 'kicked', 'banned', 'unbanned', 'timed_out', 'timeout_removed', 'request_approved', 'request_denied', 'ownership_transferred', 'voice_muted', 'voice_unmuted', 'voice_disconnected'].includes(e.action)) return 'members'
  return 'other'
}

export function moderationParts(e: ModerationEntry, meId: string): { actor: string; verb: string; target: string | null; extra: string; detail: string | null } {
  const name = (u: PublicUser | null) => (u ? (u.id === meId ? 'you' : u.displayName.trim().split(/\s+/)[0] || u.username) : 'someone')
  const d0 = (e.details ?? {}) as Record<string, unknown>
  const actor = e.actor
    ? e.actor.id === meId
      ? 'You'
      : e.actor.displayName.trim().split(/\s+/)[0] || e.actor.username
    : d0.by === 'safety' || e.action === 'joins_locked'
      ? 'Safety'
      : d0.by === 'automod' || e.action.startsWith('automod_')
        ? 'AutoMod'
        : 'Glofly'
  const verb = ACTION_WORDS[e.action] ?? e.action.replace(/_/g, ' ')
  const d = e.details ?? {}
  const extra =
    e.action === 'timed_out' && typeof d.length === 'string'
      ? ` for ${LENGTH_WORDS[d.length] ?? d.length}`
      : (e.action.startsWith('role_') || (e.action === 'nebula_deleted' || e.action === 'category_deleted')) && typeof d.name === 'string'
        ? ` “${d.name}”`
        : e.action.startsWith('voice_') && typeof d.nebula === 'string'
          ? ` in ${d.nebula}`
          : e.action === 'message_deleted' && typeof d.nebula === 'string'
            ? ` in #${d.nebula}`
            : ''
  const target = e.action === 'joined' || e.action === 'left' || !e.target ? null : name(e.target)
  const bits: string[] = []
  if (e.action === 'message_deleted' && typeof d.excerpt === 'string' && d.excerpt) bits.push(`“${d.excerpt}”`)
  if (typeof d.reason === 'string' && d.reason && d.reason !== 'account_removed') bits.push(`reason: ${d.reason}`)
  return { actor, verb, target, extra, detail: bits.length ? bits.join(' · ') : null }
}

// ───────────── Drag to reorder ─────────────

export type ReorderItem = { id: string; movable: boolean; render: (dragging: boolean) => ReactNode }

/**
 * A list you reorder by holding a row's grip and dragging it (rows are all `rowHeight` tall).
 * Fixed rows (Owner, Member) don't move; by default nothing moves past the first or last movable row.
 */
export function ReorderList({ items, rowHeight, onReorder, gap = 0, bounds }: { items: ReorderItem[]; rowHeight: number; onReorder: (ids: string[]) => void; gap?: number; /** How far rows may move (default: between the first and last movable row) */ bounds?: [number, number] }) {
  const from = useSharedValue(-1)
  const to = useSharedValue(-1)
  const dy = useSharedValue(0)
  const [, setDragging] = useState(-1)
  const step = rowHeight + gap
  const movableIdx = items.map((it, i) => (it.movable ? i : -1)).filter((i) => i >= 0)
  const lo = bounds ? bounds[0] : movableIdx.length ? Math.min(...movableIdx) : 0
  const hi = bounds ? bounds[1] : movableIdx.length ? Math.max(...movableIdx) : 0

  const drop = (a: number, b: number) => {
    setDragging(-1)
    if (a < 0 || b < 0 || a === b) return
    const ids = items.map((x) => x.id)
    const [moved] = ids.splice(a, 1)
    ids.splice(b, 0, moved)
    haptic.success()
    onReorder(ids)
  }

  return (
    <View style={{ gap }}>
      {items.map((it, i) => (
        <ReorderRow key={it.id} index={i} item={it} step={step} height={rowHeight} from={from} to={to} dy={dy} lo={lo} hi={hi} onStart={() => { haptic.medium(); setDragging(i) }} onDrop={drop} />
      ))}
    </View>
  )
}

function ReorderRow({ index, item, step, height, from, to, dy, lo, hi, onStart, onDrop }: { index: number; item: ReorderItem; step: number; height: number; from: SharedValue<number>; to: SharedValue<number>; dy: SharedValue<number>; lo: number; hi: number; onStart: () => void; onDrop: (a: number, b: number) => void }) {
  const pan = Gesture.Pan()
    .enabled(item.movable)
    .activateAfterLongPress(220)
    .onStart(() => {
      from.value = index
      to.value = index
      dy.value = 0
      runOnJS(onStart)()
    })
    .onUpdate((e) => {
      dy.value = e.translationY
      to.value = Math.max(lo, Math.min(hi, Math.round(index + e.translationY / step)))
    })
    .onEnd(() => {
      const a = from.value
      const b = to.value
      dy.value = withTiming((b - a) * step, { duration: 120 }, () => {
        from.value = -1
        to.value = -1
        dy.value = 0
        runOnJS(onDrop)(a, b)
      })
    })
  const style = useAnimatedStyle(() => {
    if (from.value < 0) return { transform: [{ translateY: 0 }, { scale: 1 }], zIndex: 0 }
    if (from.value === index) return { transform: [{ translateY: dy.value }, { scale: 1.02 }], zIndex: 10 }
    let shift = 0
    if (from.value < index && to.value >= index) shift = -step
    if (from.value > index && to.value <= index) shift = step
    return { transform: [{ translateY: withTiming(shift, { duration: 140 }) }, { scale: 1 }], zIndex: 0 }
  })
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ height }, style]}>{item.render(false)}</Animated.View>
    </GestureDetector>
  )
}
