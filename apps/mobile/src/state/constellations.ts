import { create } from 'zustand'
import type { ConstellationCard, ConstellationDetail, ConstellationInvite, InvitePopup, Nebula, NebulaNews, PinnedNebula, ServerEvent } from '@glofly/shared'
import { cx } from '@/api/constellations'
import { onLive } from '@/api/realtime'
import { onSignOut, useSession } from './session'
import { rememberPeople } from './store'
import { setNebulaCheck } from './sync'

// Glofly 2.0 on phones: what the app knows about your constellations, kept fresh by the live
// events only apps that send the "constellations" feature get (constellations:changed,
// constellation:updated / activity / voice / removed). Every rule is the server's; this only
// mirrors what it says.

type State = {
  cards: ConstellationCard[]
  invites: ConstellationInvite[]
  /** The dashboard loaded at least once since signing in */
  loaded: boolean
  details: Record<string, ConstellationDetail>
  /** Couldn't load (and why), by constellation */
  problems: Record<string, string>
  /** Nebulas pinned to the dock on Glofly home */
  pins: PinnedNebula[]
  /** Unread @mentions of you across your nebulas */
  mentionsUnread: number
  /** A nebula chat's place: conversationId → constellation and nebula */
  chats: Record<string, { constellationId: string; nebulaId: string }>
  /** The night side is on screen (dialogs and sheets draw in its colors) */
  front: boolean
  /** The nebula chat on screen (no sound for it) */
  viewing: string | null
  /** A short message at the bottom of the night side ("You left Night Owls.") */
  toast: string | null
  /** 0.7.1: nebulas with news for you, for the Chats list */
  news: NebulaNews[]
  /** 0.7.1: invites that just arrived (the pop-up), oldest first */
  invitePopups: InvitePopup[]
  /** Communities round 2: bumped when Night watch changes (constellation id → count) */
  watchTick: Record<string, number>
  /** Communities round 2: bumped when my bans or appeals change */
  bansTick: number
}

const empty = (): State => ({
  cards: [],
  invites: [],
  loaded: false,
  details: {},
  problems: {},
  pins: [],
  mentionsUnread: 0,
  chats: {},
  front: false,
  viewing: null,
  toast: null,
  news: [],
  invitePopups: [],
  watchTick: {},
  bansTick: 0,
})

export const useCx = create<State>(() => empty())
const set = useCx.setState
const get = useCx.getState

/** Constellations are there for this account (restricted family accounts never see them). */
export const cxAvailable = (): boolean => {
  const u = useSession.getState().user
  return !!u && !u.restricted
}

/** The same, as a hook (the 5th tab hides for restricted accounts). */
export function useCxAvailable(): boolean {
  return useSession((s) => !!s.user && !s.user.restricted)
}

let toastTimer: ReturnType<typeof setTimeout> | null = null
export function cxSay(text: string) {
  set({ toast: text })
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => set({ toast: null }), 4200)
}

function rememberChats(d: ConstellationDetail) {
  const chats = { ...get().chats }
  for (const n of d.nebulas) chats[n.conversationId] = { constellationId: d.id, nebulaId: n.id }
  set({ chats })
}

/** Is this conversation a nebula's chat (known so far)? */
export const isNebulaChat = (conversationId: string): boolean => !!get().chats[conversationId]

// ---- Loading ----

let gen = 0
let cardsTimer: ReturnType<typeof setTimeout> | null = null

export async function refreshCards(): Promise<boolean> {
  if (!cxAvailable()) return false
  const g = gen
  const r = await cx.dashboard()
  if (g !== gen || !r.ok) return false
  set({ cards: r.data.constellations, invites: r.data.invites, loaded: true })
  rememberPeople(r.data.invites.map((i) => i.by))
  return true
}

/** Bursts of activity reload the dashboard once, a moment later. */
export function refreshCardsSoon() {
  if (cardsTimer) return
  cardsTimer = setTimeout(() => {
    cardsTimer = null
    void refreshCards()
  }, 400)
}

export async function refreshPins(): Promise<void> {
  if (!cxAvailable()) return
  const g = gen
  const r = await cx.pins()
  if (g === gen && r.ok) setPins(r.data.pins)
}

export function setPins(pins: PinnedNebula[]) {
  const chats = { ...get().chats }
  for (const p of pins) chats[p.nebula.conversationId] = { constellationId: p.constellationId, nebulaId: p.nebula.id }
  set({ pins, chats })
}

let newsTimer: ReturnType<typeof setTimeout> | null = null
/** 0.7.1: the Chats list's nebulas with news (soon: bursts of activity ask once). */
export function refreshNews(soon = false) {
  if (!cxAvailable()) return
  if (newsTimer) return
  newsTimer = setTimeout(
    async () => {
      newsTimer = null
      const g = gen
      const r = await cx.news()
      if (g !== gen || !r.ok) return
      const chats = { ...get().chats }
      for (const n of r.data.news) chats[n.nebula.conversationId] = { constellationId: n.constellation.id, nebulaId: n.nebula.id }
      rememberPeople(r.data.news.flatMap((n) => (n.last?.sender ? [n.last.sender] : [])))
      set({ news: r.data.news, chats })
    },
    soon ? 600 : 0,
  )
}

/** The invite pop-up was answered or closed. */
export function dropInvitePopup(id: string) {
  set({ invitePopups: get().invitePopups.filter((i) => i.id !== id) })
}

export async function refreshMentionCount(): Promise<void> {
  if (!cxAvailable()) return
  const g = gen
  const r = await cx.mentions()
  if (g === gen && r.ok) set({ mentionsUnread: r.data.unread })
}

const loadingDetail = new Map<string, Promise<ConstellationDetail | null>>()

/** One constellation, everything about it. Null if it's not yours (any more). */
export function loadDetail(id: string): Promise<ConstellationDetail | null> {
  const going = loadingDetail.get(id)
  if (going) return going
  const g = gen
  const run = (async () => {
    const r = await cx.get(id)
    if (g !== gen) return null
    if (r.ok) {
      putDetail(r.data.constellation)
      return r.data.constellation
    }
    if (r.error === 'not_found' || r.error === 'forbidden') {
      forget(id)
      set({ problems: { ...get().problems, [id]: r.message || "That constellation isn't available." } })
      return null
    }
    set({ problems: { ...get().problems, [id]: r.message } })
    return null
  })().finally(() => loadingDetail.delete(id))
  loadingDetail.set(id, run)
  return run
}

const detailTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** A busy nebula reloads its constellation once, half a second later (like the desktop app). */
export function loadDetailSoon(id: string) {
  if (detailTimers.has(id)) return
  detailTimers.set(
    id,
    setTimeout(() => {
      detailTimers.delete(id)
      if (get().details[id]) void loadDetail(id)
    }, 500),
  )
}

/** The server's newer copy (after any change that answers with it). */
export function putDetail(d: ConstellationDetail) {
  const { [d.id]: _gone, ...problems } = get().problems
  set({ details: { ...get().details, [d.id]: d }, problems })
  rememberPeople(d.members.map((m) => m.user))
  rememberChats(d)
}

/** Changes one nebula in place (a mute, a notify setting) until the next reload. */
export function patchNebula(constellationId: string, nebulaId: string, patch: Partial<Nebula>) {
  const d = get().details[constellationId]
  if (!d) return
  putDetail({ ...d, nebulas: d.nebulas.map((n) => (n.id === nebulaId ? { ...n, ...patch } : n)) })
}

function forget(id: string) {
  const { [id]: _d, ...details } = get().details
  set({ details, cards: get().cards.filter((c) => c.id !== id), pins: get().pins.filter((p) => p.constellationId !== id) })
}

/** Where a nebula chat is (asks the server if this phone hasn't seen it yet). */
export async function placeOfChat(conversationId: string): Promise<{ constellationId: string; nebulaId: string } | null> {
  const known = get().chats[conversationId]
  if (known) return known
  if (!cxAvailable()) return null
  const r = await cx.chatOf(conversationId)
  if (!r.ok) return null
  set({ chats: { ...get().chats, [conversationId]: { constellationId: r.data.constellationId, nebulaId: r.data.nebulaId } } })
  return { constellationId: r.data.constellationId, nebulaId: r.data.nebulaId }
}

// ---- Live ----

const REMOVED_TEXT = {
  kicked: 'You were removed from that constellation.',
  banned: 'You were banned from that constellation.',
  taken_down: 'That constellation was taken down by the Glofly team.',
  deleted: 'That constellation was deleted.',
} as const

/** Listeners for "you were removed from it" (open screens close themselves). */
const removedListeners = new Set<(id: string) => void>()
export function onRemovedFrom(fn: (id: string) => void): () => void {
  removedListeners.add(fn)
  return () => removedListeners.delete(fn)
}

function onEvent(e: ServerEvent) {
  switch (e.type) {
    case 'constellations:changed':
      refreshCardsSoon()
      void refreshPins()
      void refreshMentionCount()
      refreshNews(true)
      return
    case 'constellation:invited':
      set({ invitePopups: [...get().invitePopups.filter((i) => i.constellationId !== e.invite.constellationId), e.invite].slice(-4) })
      rememberPeople([e.invite.by])
      return
    case 'constellation:updated':
      if (get().details[e.constellationId]) void loadDetail(e.constellationId)
      void refreshPins()
      return
    case 'constellation:activity':
      refreshCardsSoon()
      loadDetailSoon(e.constellationId)
      if (e.mentions.includes(useSession.getState().user?.id ?? '')) void refreshMentionCount()
      if (get().pins.some((p) => p.constellationId === e.constellationId)) void refreshPins()
      refreshNews(true)
      return
    case 'constellation:voice': {
      const d = get().details[e.constellationId]
      if (d) {
        const others = d.voice.filter((v) => v.nebulaId !== e.voice.nebulaId)
        set({ details: { ...get().details, [d.id]: { ...d, voice: e.voice.userIds.length ? [...others, e.voice] : others } } })
      }
      refreshCardsSoon()
      return
    }
    case 'constellation:removed': {
      const had = !!get().details[e.constellationId] || get().cards.some((c) => c.id === e.constellationId)
      forget(e.constellationId)
      refreshCardsSoon()
      for (const fn of removedListeners) fn(e.constellationId)
      if (had) cxSay((REMOVED_TEXT[e.reason] ?? 'That constellation is gone.') + (e.reason === 'banned' && e.banReason ? ` Reason: “${e.banReason}”` : ''))
      if (e.reason === 'banned') set({ bansTick: get().bansTick + 1 })
      return
    }
    // Communities round 2: a stage started, changed or ended.
    case 'stage:updated': {
      const d = get().details[e.constellationId]
      if (d) {
        const others = (d.stages ?? []).filter((s) => s.nebulaId !== e.nebulaId)
        set({ details: { ...get().details, [d.id]: { ...d, stages: e.stage ? [...others, e.stage] : others } } })
      }
      return
    }
    // Communities round 2: Night watch
    case 'nightwatch:changed':
    case 'constellation:raid':
      set({ watchTick: { ...get().watchTick, [e.constellationId]: (get().watchTick[e.constellationId] ?? 0) + 1 } })
      loadDetailSoon(e.constellationId)
      return
    case 'constellation:appeal':
      set({ bansTick: get().bansTick + 1 })
      refreshCardsSoon()
      return
    // Communities round 2: a constellation's emoji or stickers changed (the picker reloads).
    case 'emoji:changed':
      void import('@/chat/customEmoji').then((m) => m.loadEmojiSets())
      return
    default:
      return
  }
}

let started = false
/** Starts following live events (once, after signing in). */
export function startConstellations() {
  if (started) return
  started = true
  setNebulaCheck(isNebulaChat)
  onLive((event, payload) => {
    if (event === 'cx') onEvent(payload as ServerEvent)
    else if (event === 'connected' && cxAvailable()) {
      refreshCardsSoon()
      void refreshPins()
      void refreshMentionCount()
      refreshNews()
      for (const id of Object.keys(get().details)) void loadDetail(id)
    }
  })
  onSignOut(() => {
    gen++
    set(empty())
  })
}
