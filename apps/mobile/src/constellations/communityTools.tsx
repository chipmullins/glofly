import { useEffect, useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { create } from 'zustand'
import {
  RSVP_ANSWERS,
  eventDateTile,
  eventPhase,
  eventTimeLabel,
  eventWhenLabel,
  type ConstellationDetail,
  type ConstellationEvent,
  type InboxPage,
  type InboxTab,
  type Message,
  type PublicUser,
  type RsvpAnswer,
  type SearchHas,
  type ServerEvent,
} from '@glofly/shared'
import { request } from '@/api/http'
import { onLive } from '@/api/realtime'
import { onSignOut } from '@/state/session'
import { Text } from '@/ui/kit'
import { haptic } from './motion'
import { Face, N, SpeakerGlyph } from './ui'

// Constellations community tools on phones (0.8.0, approved Oct 20 boards 9, 13, 15): event cards
// with RSVP in nebulas, the Inbox (in place of Mentions) and search across a constellation. The
// same routes as the desktop app's lib/community.ts. AutoMod is managed on a computer.

const base = (id: string) => `/constellations/${id}`

export type CxSearchResult = {
  message: Message
  nebula: { id: string; name: string; kind: 'text' | 'voice'; conversationId: string }
  sender: PublicUser | null
}

export const community = {
  search: (cid: string, f: { q: string; from?: string | null; in?: string | null; has?: SearchHas | null; before?: string | null }, cursor?: string) => {
    const p: string[] = []
    if (f.q.trim()) p.push(`q=${encodeURIComponent(f.q.trim())}`)
    if (f.from) p.push(`from=${f.from}`)
    if (f.in) p.push(`in=${f.in}`)
    if (f.has) p.push(`has=${f.has}`)
    if (f.before) p.push(`before=${encodeURIComponent(f.before)}`)
    if (cursor) p.push(`cursor=${cursor}`)
    return request<{ results: CxSearchResult[]; hasMore: boolean }>('GET', `${base(cid)}/search?${p.join('&')}`)
  },
  events: (cid: string) => request<{ events: ConstellationEvent[] }>('GET', `${base(cid)}/events`),
  rsvp: (cid: string, eventId: string, answer: RsvpAnswer | null) =>
    request<{ event: ConstellationEvent }>('PUT', `${base(cid)}/events/${eventId}/rsvp`, { answer }),
  inbox: (tab: InboxTab, before?: string) =>
    request<InboxPage>('GET', `/constellations/inbox?tab=${tab}${before ? `&before=${encodeURIComponent(before)}` : ''}`),
  inboxRead: (keys: string[]) => request<null>('POST', '/constellations/inbox/read', { keys }),
  inboxReadAll: () => request<null>('POST', '/constellations/inbox/read-all'),
  answerRequest: (cid: string, userId: string, decision: 'approve' | 'deny') =>
    request<unknown>('POST', `${base(cid)}/requests/${userId}/${decision}`),
}

// ───────────── Live: events per constellation, and the Inbox count ─────────────

type State = {
  events: Record<string, ConstellationEvent[]>
  inbox: InboxPage['counts'] | null
  /** Bumped by every live change to the Inbox (open screens reload) */
  inboxTick: number
}
export const useCommunity = create<State>(() => ({ events: {}, inbox: null, inboxTick: 0 }))

export function loadEvents(cid: string) {
  void community.events(cid).then((r) => {
    if (r.ok) useCommunity.setState((s) => ({ events: { ...s.events, [cid]: r.data.events } }))
  })
}
export function putEvent(e: ConstellationEvent) {
  useCommunity.setState((s) => ({ events: { ...s.events, [e.constellationId]: (s.events[e.constellationId] ?? []).map((x) => (x.id === e.id ? e : x)) } }))
}

let inboxTimer: ReturnType<typeof setTimeout> | null = null
export function refreshInbox(soon = false) {
  if (inboxTimer) return
  inboxTimer = setTimeout(
    () => {
      inboxTimer = null
      void community.inbox('all').then((r) => {
        if (r.ok) useCommunity.setState((s) => ({ inbox: r.data.counts, inboxTick: s.inboxTick + 1 }))
      })
    },
    soon ? 1200 : 0,
  )
}

let started = false
/** Follows live events (once; started by the screens that need it). */
export function startCommunity() {
  if (started) return
  started = true
  refreshInbox()
  onLive((event, payload) => {
    if (event === 'connected') refreshInbox(true)
    if (event !== 'cx') return
    const e = payload as ServerEvent
    if (e.type === 'constellation:event') {
      if (useCommunity.getState().events[e.constellationId]) loadEvents(e.constellationId)
      refreshInbox(true)
    } else if (e.type === 'inbox:changed' || e.type === 'constellation:activity' || e.type === 'constellation:updated') refreshInbox(true)
  })
  onSignOut(() => useCommunity.setState({ events: {}, inbox: null, inboxTick: 0 }))
}

/** A constellation's events (loaded once it's on screen, then kept fresh). */
export function useEvents(cid: string): ConstellationEvent[] {
  const list = useCommunity((s) => s.events[cid])
  useEffect(() => {
    startCommunity()
    loadEvents(cid)
  }, [cid])
  return list ?? []
}

// ───────────── Opening a nebula at a message (the Inbox and search) ─────────────

let pendingJump: { nebulaId: string; messageId: string } | null = null
export function requestJump(nebulaId: string, messageId: string) {
  pendingJump = { nebulaId, messageId }
}
export function takeJump(nebulaId: string): string | null {
  if (!pendingJump || pendingJump.nebulaId !== nebulaId) return null
  const id = pendingJump.messageId
  pendingJump = null
  return id
}

// ───────────── The event card ─────────────

const first = (name: string) => name.trim().split(/\s+/)[0] || name

/** An event's card under its "made an event 📅" message (approved board 13, phone size). */
export function EventCard({ event: e, c, onJoinVoice }: { event: ConstellationEvent; c: ConstellationDetail; onJoinVoice: (voiceNebulaId: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  const tile = eventDateTile(e.startsAt)
  const voice = e.voiceNebulaId ? c.nebulas.find((n) => n.id === e.voiceNebulaId) : null
  const phase = eventPhase(e, Math.max(now, Date.now()))
  const closed = phase === 'cancelled' || phase === 'ended'
  const inVoice = voice ? (c.voice.find((v) => v.nebulaId === voice.id)?.userIds.length ?? 0) : 0
  const when = phase === 'live' && voice && inVoice ? `Happening now · ${inVoice} in ${voice.name}` : eventWhenLabel(e, now)
  async function answer(a: RsvpAnswer) {
    if (busy || closed) return
    haptic.light()
    setBusy(true)
    const next = e.mine === a ? null : a
    putEvent({
      ...e,
      mine: next,
      going: e.going - (e.mine === 'going' ? 1 : 0) + (next === 'going' ? 1 : 0),
      maybe: e.maybe - (e.mine === 'maybe' ? 1 : 0) + (next === 'maybe' ? 1 : 0),
    })
    const r = await community.rsvp(c.id, e.id, next)
    setBusy(false)
    putEvent(r.ok ? r.data.event : e)
  }
  return (
    <View accessible={false} style={{ marginTop: 8, marginLeft: 46, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: N.line2, backgroundColor: N.card, opacity: phase === 'cancelled' ? 0.7 : 1 }}>
      <View style={{ flexDirection: 'row', gap: 12, padding: 14, experimental_backgroundImage: 'linear-gradient(120deg, #1c1210, #2b1a3a)', backgroundColor: '#22162a' }}>
        <View style={{ width: 54, borderRadius: 12, backgroundColor: N.amber, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }}>
          <Text size={11} weight="bold" style={{ color: N.amberInk, letterSpacing: 1 }}>
            {tile.weekday}
          </Text>
          <Text display size={24} style={{ color: N.amberInk, lineHeight: 26 }}>
            {tile.day}
          </Text>
          <Text size={10} weight="bold" style={{ color: N.amberInk }}>
            {tile.month}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text display size={17} style={{ textDecorationLine: phase === 'cancelled' ? 'line-through' : 'none' }}>
            {e.title}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
            <Text size={12} style={{ color: N.ink2 }}>
              {eventTimeLabel(e.startsAt)}
            </Text>
            {voice ? (
              <>
                <Text size={12} style={{ color: N.ink2 }}>
                  ·
                </Text>
                <SpeakerGlyph size={12} color={N.amber} />
                <Text size={12} style={{ color: N.ink2 }}>
                  {voice.name}
                </Text>
              </>
            ) : null}
            {e.host ? (
              <Text size={12} style={{ color: N.ink2 }}>
                · hosted by {first(e.host.displayName)}
              </Text>
            ) : null}
          </View>
          <Text size={12} weight="bold" style={{ color: '#ffd27a', marginTop: 4 }}>
            {when}
          </Text>
        </View>
      </View>
      <View style={{ padding: 12, gap: 10 }}>
        {e.description ? (
          <Text size={13} style={{ color: N.ink2, lineHeight: 19 }}>
            {e.description}
          </Text>
        ) : null}
        {!closed ? (
          <View accessibilityRole="radiogroup" accessibilityLabel="Your answer" style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {RSVP_ANSWERS.map((a) => {
              const on = e.mine === a.id
              const label = a.id === 'going' ? `${a.name} · ${e.going}` : a.id === 'maybe' ? `${a.name} · ${e.maybe}` : a.name
              return (
                <Pressable
                  key={a.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on, disabled: busy }}
                  accessibilityLabel={label}
                  onPress={() => void answer(a.id)}
                  style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1.5, borderColor: on ? N.ink : N.edge, backgroundColor: on ? (a.id === 'no' ? N.raised : N.ink) : 'transparent', justifyContent: 'center' }}
                >
                  <Text size={13} weight="bold" style={{ color: on && a.id !== 'no' ? N.amberInk : N.ink }}>
                    {on ? '✓ ' : ''}
                    {label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        ) : null}
        {phase === 'live' && voice ? (
          <Pressable accessibilityRole="button" onPress={() => onJoinVoice(voice.id)} style={{ minHeight: 44, borderRadius: 22, backgroundColor: N.amber, alignItems: 'center', justifyContent: 'center' }}>
            <Text size={14} weight="bold" style={{ color: N.amberInk }}>
              Join {voice.name}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flexDirection: 'row', paddingLeft: 6 }}>
            {e.faces.map((f) => (
              <Face key={f.id} user={f} size={24} style={{ marginLeft: -6, borderWidth: 2, borderColor: N.card }} />
            ))}
          </View>
          <Text size={12} style={{ color: N.muted }}>
            {phase === 'cancelled' ? 'This event was cancelled.' : `${e.going} going${e.maybe ? ` · ${e.maybe} maybe` : ''}`}
          </Text>
        </View>
      </View>
    </View>
  )
}

/** "made an event 📅" in place of the card's plain text, for the messages that are event cards. */
export function useEventMessages(cid: string) {
  const events = useEvents(cid)
  return useMemo(() => new Map(events.filter((e) => e.messageId).map((e) => [e.messageId!, e])), [events])
}
