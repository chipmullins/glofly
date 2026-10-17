import { create } from 'zustand'
import type { Attachment, Message, ReplyPreview } from '@glofly/shared'
import * as api from '@/api/glofly'
import { onSignOut, useSession } from '@/state/session'
import { chatMessages, putMessage, setChatMessages, useStore } from '@/state/store'
import { receiveMessage } from '@/state/sync'

// Sending: the message shows straight away (dimmed while it's on its way), and is swapped for
// the server's copy when it lands. If it fails it stays, with "Didn't send · Tap to try again".

type Outgoing = {
  conversationId: string
  body: string
  replyToId?: string
  attachmentIds?: string[]
  /** 0.5.0: a lantern message */
  lantern?: boolean
  status: 'sending' | 'failed'
  error?: string
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
  putMessage(local)
  const item: Outgoing = { conversationId, body, replyToId: reply?.id, attachmentIds: attachments.map((a) => a.id), lantern, status: 'sending' }
  setItem(localId, item)
  void deliver(localId, item)
}

async function deliver(localId: string, item: Outgoing) {
  const r = await api.sendMessage(item.conversationId, item.body, item.replyToId, item.attachmentIds, item.lantern)
  if (r.ok) {
    dropLocal(item.conversationId, localId)
    setItem(localId, null)
    receiveMessage(r.data, { appActive: true })
  } else {
    setItem(localId, { ...item, status: 'failed', error: r.message })
  }
}

export function retry(localId: string) {
  const item = useOutbox.getState().items[localId]
  if (!item) return
  const next = { ...item, status: 'sending' as const, error: undefined }
  setItem(localId, next)
  void deliver(localId, next)
}

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
