import { create } from 'zustand'
import type { Attachment, Message, ReplyPreview } from '@glofly/shared'
import * as api from '@/api/glofly'
import { onSignOut, useSession } from '@/state/session'
import { chatMessages, putMessage, setChatMessages, useStore } from '@/state/store'
import { onReceive, receiveMessage } from '@/state/sync'
import { tap } from '@/lib/haptics'

// Sending: the message shows straight away, and is swapped for the server's copy when it lands.
// 0.7.5: it only dims, with a quiet "Sending…", if the server takes more than 1.5 s. If it fails
// it stays, with "Not sent · Retry · Delete". Every message carries a clientId that its retries
// reuse, so the server hands back the first copy instead of making a second one. Failures from
// the connection being down are retried once by themselves when Glofly reconnects.

type Outgoing = {
  conversationId: string
  body: string
  replyToId?: string
  attachmentIds?: string[]
  /** 0.5.0: a lantern message */
  lantern?: boolean
  status: 'sending' | 'failed'
  error?: string
  /** 0.7.5: the same on every retry (the server's duplicate guard) */
  clientId: string
  /** Still waiting after 1.5 s: "Sending…" */
  slow?: boolean
  /** Failed because the connection was down: retried once on reconnect */
  offline?: boolean
}

/** How long before a message still on its way says "Sending…". */
export const SLOW_AFTER_MS = 1500

function newClientId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // fall through
  }
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

export const useOutbox = create<{ items: Record<string, Outgoing> }>(() => ({ items: {} }))
onSignOut(() => useOutbox.setState({ items: {} }))

const setItem = (id: string, item: Outgoing | null) => {
  const items = { ...useOutbox.getState().items }
  if (item) items[id] = item
  else delete items[id]
  useOutbox.setState({ items })
}

let counter = 0

export function sendText(conversationId: string, body: string, reply: Message | null, attachments: Attachment[] = [], lantern = false): void {
  const me = useSession.getState().user
  if (!me) return
  const localId = `local-${Date.now()}-${counter++}`
  const replyTo: ReplyPreview | null = reply
    ? {
        id: reply.id,
        senderId: reply.senderId,
        body: reply.body,
        deleted: reply.deleted,
        attachment: reply.attachments[0] ? { kind: reply.attachments[0].kind, name: reply.attachments[0].name, count: reply.attachments.length, voice: !!reply.attachments[0].voice } : null,
      }
    : null
  const local: Message = {
    id: localId,
    conversationId,
    senderId: me.id,
    body,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deleted: false,
    replyTo,
    reactions: [],
    attachments,
    event: null,
    mentions: [],
    lantern,
  }
  if (!chatMessages(conversationId).loaded) setChatMessages(conversationId, { loaded: true })
  // 0.7.5: a light tap as it goes (follows the phone's own vibration setting).
  tap.light()
  putMessage(local)
  const item: Outgoing = { conversationId, body, replyToId: reply?.id, attachmentIds: attachments.map((a) => a.id), lantern, status: 'sending', clientId: newClientId() }
  setItem(localId, item)
  void deliver(localId, item)
}

async function deliver(localId: string, item: Outgoing, attempt = 0) {
  const slow = setTimeout(() => {
    const now = useOutbox.getState().items[localId]
    if (now && now.status === 'sending') setItem(localId, { ...now, slow: true })
  }, SLOW_AFTER_MS)
  const r = await api.sendMessage(item.conversationId, item.body, item.replyToId, item.attachmentIds, item.lantern, item.clientId)
  clearTimeout(slow)
  const current = useOutbox.getState().items[localId]
  if (!current) return // deleted meanwhile
  if (r.ok) {
    dropLocal(item.conversationId, localId)
    setItem(localId, null)
    receiveMessage(r.data, { appActive: true })
  } else if (r.error === 'conflict' && attempt < 5) {
    // The first try is still being saved on the server: ask again in a moment.
    setItem(localId, { ...current, slow: true })
    setTimeout(() => {
      const still = useOutbox.getState().items[localId]
      if (still && still.status === 'sending') void deliver(localId, still, attempt + 1)
    }, 2000)
  } else {
    setItem(localId, { ...current, status: 'failed', slow: false, error: r.message, offline: r.error === 'unreachable' })
  }
}

export function retry(localId: string) {
  const item = useOutbox.getState().items[localId]
  if (!item) return
  const next = { ...item, status: 'sending' as const, error: undefined, slow: false, offline: false }
  setItem(localId, next)
  void deliver(localId, next)
}

// Your own message arriving live with its clientId (0.7.5 servers): the copy waiting here (one
// whose answer got lost, say) is that same message, so it's settled at once, no retry needed.
onReceive((m) => {
  if (!m.clientId) return
  for (const [localId, item] of Object.entries(useOutbox.getState().items)) {
    if (item.clientId !== m.clientId) continue
    dropLocal(item.conversationId, localId)
    setItem(localId, null)
  }
})

// Back online: messages that failed while the connection was down go again (once).
useStore.subscribe((state, prev) => {
  if (!state.connected || prev.connected) return
  for (const [localId, item] of Object.entries(useOutbox.getState().items)) {
    if (item.status === 'failed' && item.offline) retry(localId)
  }
})

export function discard(localId: string) {
  const item = useOutbox.getState().items[localId]
  if (!item) return
  dropLocal(item.conversationId, localId)
  setItem(localId, null)
}

function dropLocal(conversationId: string, localId: string) {
  const list = chatMessages(conversationId).list.filter((m) => m.id !== localId)
  setChatMessages(conversationId, { list })
}

export const isLocal = (m: Message) => m.id.startsWith('local-')

/** The chat on screen (no sounds, notifications or unread counts for it). */
export function setViewing(id: string | null) {
  useStore.setState({ viewing: id })
}
