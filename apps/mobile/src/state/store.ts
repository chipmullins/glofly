import { create } from 'zustand'
import type {
  Announcement,
  Call,
  ConversationSummary,
  FriendLists,
  Message,
  MyStatus,
  Presence,
  PublicUser,
  TeamNotice,
} from '@glofly/shared'

// Everything the app knows about the signed-in account, kept up to date by the live connection.

export type ChatMessages = {
  list: Message[]
  hasMore: boolean
  loading: boolean
  /** Fetched at least once (so an empty list means an empty chat). */
  loaded: boolean
}

type State = {
  connected: boolean
  /** Loaded from the server at least once since signing in (so an empty list really means empty). */
  synced: { conversations: boolean; friends: boolean }
  conversations: Record<string, ConversationSummary>
  /** Everyone we've seen (chat members, friends, message senders), by id. */
  people: Record<string, PublicUser>
  messages: Record<string, ChatMessages>
  /** conversationId → userId → when the "typing…" hint stops (ms). */
  typing: Record<string, Record<string, number>>
  presence: Record<string, Presence>
  friends: FriendLists
  myStatus: MyStatus | null
  /** Ringing or ongoing calls, by conversation. */
  calls: Record<string, Call>
  callers: Record<string, PublicUser>
  notices: TeamNotice[]
  announcement: Announcement | null
  /** The chat on screen right now (no sounds or notifications for it). */
  viewing: string | null
}

const empty = (): State => ({
  connected: false,
  synced: { conversations: false, friends: false },
  conversations: {},
  people: {},
  messages: {},
  typing: {},
  presence: {},
  friends: { friends: [], incoming: [], outgoing: [], blocked: [] },
  myStatus: null,
  calls: {},
  callers: {},
  notices: [],
  announcement: null,
  viewing: null,
})

export const useStore = create<State>(() => empty())

export const resetStore = () => useStore.setState(empty(), true)

const set = useStore.setState
const get = useStore.getState

export function rememberPeople(list: (PublicUser | null | undefined)[]) {
  const people = { ...get().people }
  let changed = false
  for (const p of list) {
    if (!p?.id) continue
    const old = people[p.id]
    if (!old || old.displayName !== p.displayName || old.avatarVersion !== p.avatarVersion || old.username !== p.username) {
      people[p.id] = { id: p.id, username: p.username, displayName: p.displayName, avatarVersion: p.avatarVersion }
      changed = true
    }
  }
  if (changed) set({ people })
}

export function setConversations(list: ConversationSummary[]) {
  const conversations: Record<string, ConversationSummary> = {}
  for (const c of list) conversations[c.id] = c
  set({ conversations })
  rememberPeople(list.flatMap((c) => c.members))
}

export function patchConversation(id: string, patch: Partial<ConversationSummary>) {
  const c = get().conversations[id]
  if (!c) return
  set({ conversations: { ...get().conversations, [id]: { ...c, ...patch } as ConversationSummary } })
}

export function upsertConversation(c: ConversationSummary) {
  set({ conversations: { ...get().conversations, [c.id]: c } })
  rememberPeople(c.members)
}

export function removeConversation(id: string) {
  const { [id]: _gone, ...rest } = get().conversations
  const { [id]: _m, ...msgs } = get().messages
  set({ conversations: rest, messages: msgs })
}

export function chatMessages(id: string): ChatMessages {
  return get().messages[id] ?? { list: [], hasMore: true, loading: false, loaded: false }
}

export function setChatMessages(id: string, patch: Partial<ChatMessages>) {
  set({ messages: { ...get().messages, [id]: { ...chatMessages(id), ...patch } } })
}

/** Adds or replaces a message in its chat (kept in time order). */
export function putMessage(m: Message) {
  const chat = get().messages[m.conversationId]
  if (!chat) return
  const list = chat.list.slice()
  const i = list.findIndex((x) => x.id === m.id)
  if (i >= 0) list[i] = m
  else {
    let at = list.length
    while (at > 0 && list[at - 1].createdAt > m.createdAt) at--
    list.splice(at, 0, m)
  }
  setChatMessages(m.conversationId, { list })
}

export function setTyping(conversationId: string, userId: string, until: number | null) {
  const forChat = { ...(get().typing[conversationId] ?? {}) }
  if (until === null) delete forChat[userId]
  else forChat[userId] = until
  set({ typing: { ...get().typing, [conversationId]: forChat } })
}

export function setPresence(userId: string, p: Presence) {
  set({ presence: { ...get().presence, [userId]: p } })
}

export function setCall(call: Call, caller: PublicUser | null) {
  const calls = { ...get().calls }
  if (call.status === 'ringing' || call.status === 'ongoing') calls[call.conversationId] = call
  else if (calls[call.conversationId]?.id === call.id) delete calls[call.conversationId]
  set({ calls, ...(caller ? { callers: { ...get().callers, [call.id]: caller } } : {}) })
  if (caller) rememberPeople([caller])
}

/** Sorted for the Chats list: pinned first (newest pin first), then latest activity. */
export function sortedChats(conversations: Record<string, ConversationSummary>): ConversationSummary[] {
  return Object.values(conversations).sort((a, b) => b.activityAt.localeCompare(a.activityAt))
}
