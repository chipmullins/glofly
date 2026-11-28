import { AppState } from 'react-native'
import { mentionsMe, type ConversationSummary, type Message } from '@glofly/shared'
import * as api from '@/api/glofly'
import { useSession } from './session'
import { refreshAccount } from './account'
import {
  chatMessages,
  patchConversation,
  putMessage,
  rememberPeople,
  setCall,
  setChatMessages,
  setConversations,
  setPresence,
  useStore,
} from './store'

// Fetching and merging: what the app does when it opens, reconnects, or hears that
// something changed.

const me = () => useSession.getState().user?.id ?? ''

/**
 * Bumped on sign-out: an answer that arrives afterwards belongs to the previous account and is
 * thrown away (it used to land in the freshly emptied store, or in the next account's).
 */
let generation = 0
const stillCurrent = (gen: number) => gen === generation && useSession.getState().status === 'signedIn'

export async function refreshConversations(): Promise<boolean> {
  const gen = generation
  const r = await api.listConversations()
  if (!r.ok || !stillCurrent(gen)) return false
  setConversations(r.data)
  useStore.setState((s) => ({ synced: { ...s.synced, conversations: true } }))
  return true
}

export async function refreshFriends(): Promise<boolean> {
  const gen = generation
  const r = await api.listFriends()
  if (!r.ok || !stillCurrent(gen)) return false
  useStore.setState((s) => ({ friends: r.data, synced: { ...s.synced, friends: true } }))
  rememberPeople([...r.data.friends, ...r.data.incoming, ...r.data.outgoing])
  for (const f of r.data.friends) if (f.presence) setPresence(f.id, f.presence)
  return true
}

export async function refreshStatus(): Promise<boolean> {
  const gen = generation
  const r = await api.getMyStatus()
  if (!r.ok || !stillCurrent(gen)) return false
  useStore.setState({ myStatus: r.data })
  return true
}

export async function refreshCalls(): Promise<boolean> {
  const gen = generation
  const r = await api.activeCalls()
  if (!r.ok || !stillCurrent(gen)) return false
  const calls: Record<string, (typeof r.data)[number]['call']> = {}
  for (const { call } of r.data) calls[call.conversationId] = call
  useStore.setState({ calls })
  return true
}

export async function refreshNotices(): Promise<boolean> {
  const gen = generation
  const r = await api.getNotices()
  if (!r.ok || !stillCurrent(gen)) return false
  useStore.setState({ notices: r.data.notices, announcement: r.data.announcement })
  return true
}

// Opening the app used to wait for the live connection before loading anything, and a load that
// failed (the network still waking up right after launch) was never tried again: the Friends tab
// said "No friends yet" until something else happened to refresh it. Now everything loads straight
// away over plain requests, anything that fails is retried a few times, and two refreshes asked
// for at the same moment (opening the app + the live connection coming up) share one.
let inFlight: Promise<void> | null = null
let lastDone = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retries = 0
const RETRY_MS = [1500, 4000, 10_000, 20_000]

/** Everything at once (opening the app, coming back to it, reconnecting). */
export function refreshAll(opts: { ifStale?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight
  if (opts.ifStale && Date.now() - lastDone < 3000) return Promise.resolve()
  const gen = generation
  const run: Promise<void> = (async () => {
    const results = await Promise.all([refreshConversations(), refreshFriends(), refreshStatus(), refreshCalls(), refreshNotices(), refreshAccount().catch(() => false)])
    // Chats already open get their newest messages again (anything missed while away). One that
    // fails counts too, or a chat opened while offline kept its spinner until something else
    // happened to reload it.
    const open = Object.keys(useStore.getState().messages)
    results.push(...(await Promise.all(open.map((id) => loadLatest(id)))))
    if (gen !== generation) return // signed out meanwhile: stopRefreshing() reset everything
    lastDone = Date.now()
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    if (results.every(Boolean)) {
      retries = 0
    } else if (useSession.getState().status === 'signedIn') {
      // After the quick retries, keep trying every 30 seconds while Glofly is on screen, instead
      // of giving up and leaving the lists on "loading" until the app is reopened.
      const wait = RETRY_MS[retries] ?? 30_000
      retries++
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (useSession.getState().status !== 'signedIn') return
        if (AppState.currentState === 'active') void refreshAll()
        else retries = 0 // coming back to the app loads everything again anyway
      }, wait)
    }
  })().finally(() => {
    if (inFlight === run) inFlight = null
  })
  inFlight = run
  return run
}

/** Forget pending retries (signing out). */
export function stopRefreshing() {
  generation++
  // A refresh still on its way belongs to the old account: the next sign-in starts its own
  // instead of waiting on (and sharing) that one.
  inFlight = null
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  retries = 0
  lastDone = 0
}

/** The newest page of a chat (merged with what's already there). False if it couldn't load. */
/** 0.12.0: shows a chat as the server has it now (after Clear chat or its Undo). */
export async function startChatOver(id: string): Promise<void> {
  setChatMessages(id, { list: chatMessages(id).list.filter((m) => m.id.startsWith('local-')), hasMore: true, loaded: false })
  await loadLatest(id)
}

export async function loadLatest(id: string): Promise<boolean> {
  const current = chatMessages(id)
  if (current.loading) return true
  const gen = generation
  setChatMessages(id, { loading: true })
  const r = await api.loadMessages(id)
  if (gen !== generation) return false
  if (!r.ok) {
    setChatMessages(id, { loading: false })
    // Gone or no longer yours is an answer too (not worth retrying every 30 seconds).
    return r.error === 'not_found' || r.error === 'forbidden'
  }
  rememberPeople(r.data.people)
  const before = chatMessages(id).list
  // 0.7.3: after a long time away more than a page of messages may have come in. Then the newest
  // page doesn't reach back to what's already shown, and merging the two left a silent gap in
  // the middle. In that case the older messages go (scrolling up loads them again, in order) and
  // the chat starts again from the newest page. Messages still being sent stay.
  const saved = before.filter((m) => !m.id.startsWith('local-'))
  const page = r.data.messages
  const pageIds = new Set(page.map((m) => m.id))
  const oldestInPage = page.reduce<string | null>((o, m) => (!o || m.createdAt < o ? m.createdAt : o), null)
  const newestSaved = saved.reduce<string | null>((n, m) => (!n || m.createdAt > n ? m.createdAt : n), null)
  const gap = r.data.hasMore && saved.length > 0 && !!oldestInPage && !!newestSaved && newestSaved < oldestInPage && !saved.some((m) => pageIds.has(m.id))
  const known = new Map((gap ? before.filter((m) => m.id.startsWith('local-')) : before).map((m) => [m.id, m]))
  for (const m of page) known.set(m.id, m)
  const list = [...known.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  setChatMessages(id, { list, loading: false, loaded: true, hasMore: gap || !current.loaded ? r.data.hasMore : current.hasMore })
  return true
}

/** The page before the oldest one shown (scrolling up). */
export async function loadOlder(id: string): Promise<void> {
  const current = chatMessages(id)
  if (current.loading || !current.hasMore || !current.list.length) return
  const gen = generation
  setChatMessages(id, { loading: true })
  const r = await api.loadMessages(id, current.list[0].id)
  if (gen !== generation) return
  if (!r.ok) {
    setChatMessages(id, { loading: false })
    return
  }
  rememberPeople(r.data.people)
  const seen = new Set(current.list.map((m) => m.id))
  setChatMessages(id, { list: [...r.data.messages.filter((m) => !seen.has(m.id)), ...chatMessages(id).list], hasMore: r.data.hasMore, loading: false })
}

/**
 * Loads older messages until this one is in the chat (for search results and replies further
 * back). True once it's there. Gives up after ~2,000 messages.
 */
export async function loadUntil(id: string, messageId: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    const current = chatMessages(id)
    if (current.list.some((m) => m.id === messageId)) return true
    // Waits for a load already going (an empty chat used to spin through all 40 rounds at once).
    if (current.loading) {
      await new Promise((r) => setTimeout(r, 150))
      continue
    }
    if (!current.list.length) {
      await loadLatest(id)
      if (!chatMessages(id).list.length) return false
      continue
    }
    if (!current.hasMore) return false
    const before = current.list.length
    await loadOlder(id)
    if (chatMessages(id).list.length === before && !chatMessages(id).loading) return chatMessages(id).list.some((m) => m.id === messageId)
  }
  return chatMessages(id).list.some((m) => m.id === messageId)
}

/** 0.7.0: tells nebula chats apart (set by state/constellations; they're never in the chats list). */
let isNebula: (conversationId: string) => boolean = () => false
export function setNebulaCheck(fn: (conversationId: string) => boolean) {
  isNebula = fn
}

/** A new message (live, or one this phone just sent): into its chat and the chats list. */
/** 0.7.5: called for every message that arrives (the outbox settles its own copies). */
const receiveHooks: ((m: Message) => void)[] = []
export function onReceive(hook: (m: Message) => void): void {
  receiveHooks.push(hook)
}

export function receiveMessage(m: Message, opts: { appActive: boolean }): { counts: boolean } {
  for (const hook of receiveHooks) hook(m)
  putMessage(m)
  const c = useStore.getState().conversations[m.conversationId]
  if (!c && isNebula(m.conversationId)) return { counts: false }
  if (!c) {
    void refreshConversations()
    return { counts: m.senderId !== me() }
  }
  const mine = m.senderId === me()
  const isEvent = !!m.event
  const viewing = useStore.getState().viewing === m.conversationId && opts.appActive
  // A missed call counts as unread for the person who missed it (like the desktop app).
  const counts = !mine && !viewing && (!isEvent || (m.event?.type === 'call' && m.event.status === 'missed'))
  const newer = !c.lastMessage || m.createdAt >= c.lastMessage.createdAt
  patchConversation(m.conversationId, {
    ...(newer ? { lastMessage: m, activityAt: m.createdAt } : {}),
    ...(counts ? { unreadCount: c.unreadCount + 1 } : {}),
    ...(counts && mentionsMe(m, me()) ? { mentionCount: (c.mentionCount ?? 0) + 1 } : {}),
    ...(mine ? { unreadCount: 0, mentionCount: 0 } : {}),
  } as Partial<ConversationSummary>)
  // Their "typing…" ends when the message arrives.
  const typing = useStore.getState().typing[m.conversationId]
  if (typing?.[m.senderId]) {
    const { [m.senderId]: _gone, ...rest } = typing
    useStore.setState({ typing: { ...useStore.getState().typing, [m.conversationId]: rest } })
  }
  return { counts }
}

/** An edit, delete, reaction or call line change. */
export function updateMessage(m: Message) {
  putMessage(m)
  const c = useStore.getState().conversations[m.conversationId]
  if (c?.lastMessage?.id === m.id) patchConversation(m.conversationId, { lastMessage: m })
}

// 0.7.3 Mark unread: the chat that was just marked unread is still on screen for a moment while
// it closes; it mustn't read itself again in that time.
const heldUnread = new Map<string, number>()
export function holdUnread(id: string): void {
  heldUnread.set(id, Date.now())
}
export const readHeld = (id: string): boolean => Date.now() - (heldUnread.get(id) ?? 0) < 4000

/** Marks a chat read here and on the server (which clears it on other devices too). */
export async function markChatRead(id: string): Promise<void> {
  if (readHeld(id)) return
  const c = useStore.getState().conversations[id]
  if (c && (c.unreadCount > 0 || (c.mentionCount ?? 0) > 0)) patchConversation(id, { unreadCount: 0, mentionCount: 0 })
  await api.markRead(id)
}

export { setCall }
