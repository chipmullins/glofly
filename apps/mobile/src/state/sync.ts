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

export async function refreshConversations(): Promise<boolean> {
  const r = await api.listConversations()
  if (!r.ok) return false
  setConversations(r.data)
  useStore.setState((s) => ({ synced: { ...s.synced, conversations: true } }))
  return true
}

export async function refreshFriends(): Promise<boolean> {
  const r = await api.listFriends()
  if (!r.ok) return false
  useStore.setState((s) => ({ friends: r.data, synced: { ...s.synced, friends: true } }))
  rememberPeople([...r.data.friends, ...r.data.incoming, ...r.data.outgoing])
  for (const f of r.data.friends) if (f.presence) setPresence(f.id, f.presence)
  return true
}

export async function refreshStatus(): Promise<boolean> {
  const r = await api.getMyStatus()
  if (r.ok) useStore.setState({ myStatus: r.data })
  return r.ok
}

export async function refreshCalls(): Promise<boolean> {
  const r = await api.activeCalls()
  if (!r.ok) return false
  const calls: Record<string, (typeof r.data)[number]['call']> = {}
  for (const { call } of r.data) calls[call.conversationId] = call
  useStore.setState({ calls })
  return true
}

export async function refreshNotices(): Promise<boolean> {
  const r = await api.getNotices()
  if (r.ok) useStore.setState({ notices: r.data.notices, announcement: r.data.announcement })
  return r.ok
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
  inFlight = (async () => {
    const results = await Promise.all([refreshConversations(), refreshFriends(), refreshStatus(), refreshCalls(), refreshNotices(), refreshAccount().then(() => true, () => false)])
    // Chats already open get their newest messages again (anything missed while away).
    const open = Object.keys(useStore.getState().messages)
    await Promise.all(open.map((id) => loadLatest(id)))
    lastDone = Date.now()
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    if (results.every(Boolean)) {
      retries = 0
    } else if (retries < RETRY_MS.length && useSession.getState().status === 'signedIn') {
      retryTimer = setTimeout(() => {
        retryTimer = null
        if (useSession.getState().status === 'signedIn') void refreshAll()
      }, RETRY_MS[retries++])
    }
  })().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** Forget pending retries (signing out). */
export function stopRefreshing() {
  if (retryTimer) clearTimeout(retryTimer)
  retryTimer = null
  retries = 0
  lastDone = 0
}

/** The newest page of a chat (merged with what's already there). */
export async function loadLatest(id: string): Promise<void> {
  const current = chatMessages(id)
  if (current.loading) return
  setChatMessages(id, { loading: true })
  const r = await api.loadMessages(id)
  if (!r.ok) {
    setChatMessages(id, { loading: false })
    return
  }
  rememberPeople(r.data.people)
  const known = new Map(chatMessages(id).list.map((m) => [m.id, m]))
  for (const m of r.data.messages) known.set(m.id, m)
  const list = [...known.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  setChatMessages(id, { list, loading: false, loaded: true, hasMore: current.loaded ? current.hasMore : r.data.hasMore })
}

/** The page before the oldest one shown (scrolling up). */
export async function loadOlder(id: string): Promise<void> {
  const current = chatMessages(id)
  if (current.loading || !current.hasMore || !current.list.length) return
  setChatMessages(id, { loading: true })
  const r = await api.loadMessages(id, current.list[0].id)
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
    if (!current.list.length) {
      await loadLatest(id)
      continue
    }
    if (!current.hasMore) return false
    if (current.loading) {
      await new Promise((r) => setTimeout(r, 150))
      continue
    }
    const before = current.list.length
    await loadOlder(id)
    if (chatMessages(id).list.length === before && !chatMessages(id).loading) return chatMessages(id).list.some((m) => m.id === messageId)
  }
  return chatMessages(id).list.some((m) => m.id === messageId)
}

/** A new message (live, or one this phone just sent): into its chat and the chats list. */
export function receiveMessage(m: Message, opts: { appActive: boolean }): { counts: boolean } {
  putMessage(m)
  const c = useStore.getState().conversations[m.conversationId]
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

/** Marks a chat read here and on the server (which clears it on other devices too). */
export async function markChatRead(id: string): Promise<void> {
  const c = useStore.getState().conversations[id]
  if (c && (c.unreadCount > 0 || (c.mentionCount ?? 0) > 0)) patchConversation(id, { unreadCount: 0, mentionCount: 0 })
  await api.markRead(id)
}

export { setCall }
