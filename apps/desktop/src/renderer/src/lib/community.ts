import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ApiResult,
  AutoModSettings,
  ConstellationEvent,
  InboxPage,
  InboxTab,
  Message,
  PublicUser,
  RsvpAnswer,
  SearchHas
} from '@glofly/shared'

// Constellations community tools (0.8.0, approved Oct 20 boards 9, 13, 14, 15): search across a
// constellation, events with RSVP, AutoMod lite and the Inbox. Requests go through the same
// gateway as the rest of Constellations (window.glofly.constellations.request: only /constellations/…).

const call = <T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResult<T>> => window.glofly.constellations.request<T>(method, path, body)

export type CxSearchResult = {
  message: Message
  nebula: { id: string; name: string; kind: 'text' | 'voice'; conversationId: string }
  sender: PublicUser | null
}
export type CxSearchFilters = {
  q: string
  from?: PublicUser | null
  in?: { id: string; name: string } | null
  has?: SearchHas | null
  before?: { label: string; at: string } | null
}

export type AutoModLogItem = {
  id: string
  action: 'automod_hidden' | 'automod_links' | 'automod_wait'
  target: PublicUser | null
  details: {
    nebulaName: string | null
    word: string | null
    rule: string | null
    until: string | null
    preview: string | null
    heldId: string | null
  }
  createdAt: string
  undone: { by: PublicUser | null; at: string } | null
  canUndo: boolean
}
export type AutoModPageData = {
  settings: AutoModSettings
  nebulas: { id: string; name: string }[]
  log: AutoModLogItem[]
  canEdit: boolean
}

export type EventValues = {
  nebulaId: string
  title: string
  description: string | null
  startsAt: string
  endsAt: string | null
  voiceNebulaId: string | null
  timeZone: string | null
}

const base = (id: string): string => `/constellations/${id}`

export const community = {
  search: (constellationId: string, f: CxSearchFilters, cursor?: string) => {
    const p = new URLSearchParams()
    if (f.q.trim()) p.set('q', f.q.trim())
    if (f.from) p.set('from', f.from.id)
    if (f.in) p.set('in', f.in.id)
    if (f.has) p.set('has', f.has)
    if (f.before) p.set('before', f.before.at)
    if (cursor) p.set('cursor', cursor)
    return call<{ results: CxSearchResult[]; hasMore: boolean }>(
      'GET',
      `${base(constellationId)}/search?${p.toString()}`
    )
  },
  events: (constellationId: string) =>
    call<{ events: ConstellationEvent[] }>('GET', `${base(constellationId)}/events`),
  createEvent: (constellationId: string, values: EventValues) =>
    call<{ event: ConstellationEvent }>('POST', `${base(constellationId)}/events`, values),
  updateEvent: (constellationId: string, eventId: string, values: Partial<Omit<EventValues, 'nebulaId'>>) =>
    call<{ event: ConstellationEvent }>('PATCH', `${base(constellationId)}/events/${eventId}`, values),
  cancelEvent: (constellationId: string, eventId: string) =>
    call<null>('DELETE', `${base(constellationId)}/events/${eventId}`),
  rsvp: (constellationId: string, eventId: string, answer: RsvpAnswer | null) =>
    call<{ event: ConstellationEvent }>('PUT', `${base(constellationId)}/events/${eventId}/rsvp`, {
      answer
    }),
  automod: (constellationId: string) => call<AutoModPageData>('GET', `${base(constellationId)}/automod`),
  setAutomod: (constellationId: string, changes: Partial<AutoModSettings>) =>
    call<AutoModPageData>('PUT', `${base(constellationId)}/automod`, changes),
  releaseHeld: (constellationId: string, heldId: string) =>
    call<AutoModPageData>('POST', `${base(constellationId)}/automod/held/${heldId}/release`),
  waiveWait: (constellationId: string, userId: string) =>
    call<AutoModPageData>('POST', `${base(constellationId)}/automod/wait/${userId}/waive`),
  inbox: (tab: InboxTab, before?: string) =>
    call<InboxPage>(
      'GET',
      `/constellations/inbox?tab=${tab}${before ? `&before=${encodeURIComponent(before)}` : ''}`
    ),
  inboxRead: (keys: string[]) => call<null>('POST', '/constellations/inbox/read', { keys }),
  inboxReadAll: () => call<null>('POST', '/constellations/inbox/read-all'),
  answerRequest: (constellationId: string, userId: string, decision: 'approve' | 'deny') =>
    call<unknown>('POST', `${base(constellationId)}/requests/${userId}/${decision}`)
}

/** A constellation's events, kept fresh by live events (and every minute, for "Starts in"). */
export function useConstellationEvents(constellationId: string | null): {
  events: ConstellationEvent[]
  /** The time the events were last looked at (ticks every 15 s while there are some) */
  now: number
  reload: () => void
  setEvent: (e: ConstellationEvent) => void
} {
  const [state, setState] = useState<{ id: string | null; events: ConstellationEvent[] }>({
    id: null,
    events: []
  })
  const [now, setNow] = useState(() => Date.now())
  const load = useCallback(() => {
    if (!constellationId) return
    void community.events(constellationId).then((r) => {
      if (r.ok) {
        setState({ id: constellationId, events: r.data.events })
        setNow(Date.now())
      }
    })
  }, [constellationId])
  const any = state.events.length > 0
  useEffect(() => {
    if (!any) return
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [any])
  useEffect(() => {
    load()
    if (!constellationId) return
    const stop = window.glofly.onEvent((event) => {
      if (event.type === 'constellation:event' && event.constellationId === constellationId) load()
      if (event.type === 'connection' && event.connected) load()
    })
    return stop
  }, [constellationId, load])
  const setEvent = useCallback((e: ConstellationEvent) => {
    setState((s) => ({ ...s, events: s.events.map((x) => (x.id === e.id ? e : x)) }))
  }, [])
  return { events: state.id === constellationId ? state.events : [], now, reload: load, setEvent }
}

/** The Inbox's unread counts (the badge), kept fresh: its own news, and constellation activity. */
export function useInboxCounts(enabled: boolean): {
  counts: InboxPage['counts'] | null
  reload: () => void
} {
  const [counts, setCounts] = useState<InboxPage['counts'] | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = useCallback(() => {
    void community.inbox('all').then((r) => {
      if (r.ok) setCounts(r.data.counts)
    })
  }, [])
  const later = useCallback(() => {
    if (timer.current) return
    timer.current = setTimeout(() => {
      timer.current = null
      load()
    }, 1200)
  }, [load])
  useEffect(() => {
    if (!enabled) return
    load()
    const stop = window.glofly.onEvent((event) => {
      if (event.type === 'inbox:changed' || event.type === 'constellation:event') later()
      // Someone mentioned or replied to me, or asked to join somewhere I let people in.
      else if (event.type === 'constellation:activity' || event.type === 'constellation:updated') later()
      else if (event.type === 'connection' && event.connected) later()
    })
    return () => {
      stop()
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }
  }, [enabled, load, later])
  return { counts, reload: load }
}

// ───────────── Jumping to a message in another constellation ─────────────
// The Inbox and search can open a nebula somewhere else; the nebula's chat picks up the message to
// show once it's on screen.

let pendingJump: { nebulaId: string; messageId: string } | null = null

export function requestJump(nebulaId: string, messageId: string): void {
  pendingJump = { nebulaId, messageId }
}

/** The message to show in this nebula, if one was asked for (once). */
export function takeJump(nebulaId: string | null | undefined): string | null {
  if (!nebulaId || !pendingJump || pendingJump.nebulaId !== nebulaId) return null
  const id = pendingJump.messageId
  pendingJump = null
  return id
}

/** Downloads an .ics file ("Add to calendar"). */
export function downloadIcs(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
