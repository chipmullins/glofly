import { useSyncExternalStore } from 'react'
import type { Attachment, Message, ReplyPreview } from '../../../preload/api-types'
import { playSound } from './sounds'

// 0.7.5 sending state. Messages on their way live here, not in the chat on screen, so a
// message keeps sending (and a failed one keeps its "Not sent · Retry") when you switch chats
// and come back. Each one carries a clientId: a retry sends the same one, and the server hands
// back the first copy if the first try actually got there (no doubles).
//
// - Shows straight away, dimmed.
// - Still no answer after 1.5 s: a quiet "Sending…".
// - Failed: "Not sent · Retry · Delete". Failures from the connection being down are retried
//   once by themselves when Glofly reconnects.

/** A message still on its way, or one that didn't send. */
export type Pending = {
  tempId: string
  clientId: string
  conversationId: string
  body: string
  createdAt: string
  failed: boolean
  /** Still waiting after 1.5 s: shows "Sending…" */
  slow: boolean
  replyTo: ReplyPreview | null
  attachments: Attachment[]
  /** 0.5.0: fades once everyone else has read it */
  lantern: boolean
  /** Failed because the connection was down: retried once on reconnect */
  offline?: boolean
}

export type NewPending = Pick<Pending, 'body' | 'replyTo' | 'attachments' | 'lantern'>

/** How long before a message still on its way says "Sending…". */
export const SLOW_AFTER_MS = 1500

const EMPTY: Pending[] = []
let byChat: Record<string, Pending[]> = {}
const listeners = new Set<() => void>()
const sentListeners = new Set<(item: Pending, message: Message) => void>()
const failListeners = new Set<(item: Pending, error: string, message: string) => void>()
let counter = 0

function emit(): void {
  for (const l of listeners) l()
}

function update(conversationId: string, change: (list: Pending[]) => Pending[]): void {
  const next = change(byChat[conversationId] ?? EMPTY)
  byChat = { ...byChat }
  if (next.length) byChat[conversationId] = next
  else delete byChat[conversationId]
  emit()
}

function patch(item: Pending, changes: Partial<Pending>): void {
  update(item.conversationId, (list) =>
    list.map((x) => (x.tempId === item.tempId ? { ...x, ...changes } : x))
  )
}

function find(conversationId: string, tempId: string): Pending | undefined {
  return byChat[conversationId]?.find((x) => x.tempId === tempId)
}

/** A random id for one message (kept across its retries). */
export function newClientId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  }
}

/** Messages on their way in one chat, oldest first. */
export function useOutbox(conversationId: string): Pending[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => byChat[conversationId] ?? EMPTY
  )
}

/** Called with the server's copy when a message lands (for the chat on screen to show it). */
export function onSent(listener: (item: Pending, message: Message) => void): () => void {
  sentListeners.add(listener)
  return () => sentListeners.delete(listener)
}

/** Called when a message fails (the chat on screen shows why). */
export function onSendFailed(
  listener: (item: Pending, error: string, message: string) => void
): () => void {
  failListeners.add(listener)
  return () => failListeners.delete(listener)
}

// Your own message arriving live with its clientId (0.7.5 servers): the copy waiting here (one
// whose answer got lost, say) is the same message, so it's settled at once, no Retry needed.
let listening = false
function listen(): void {
  if (listening) return
  listening = true
  window.glofly.onEvent((event) => {
    if (event.type !== 'message:new' || !event.message.clientId) return
    const m = event.message
    const item = byChat[m.conversationId]?.find((x) => x.clientId === m.clientId)
    if (!item) return
    update(m.conversationId, (list) => list.filter((x) => x.tempId !== item.tempId))
    for (const l of sentListeners) l(item, m)
  })
}

/** Shows a new message straight away and sends it. */
export function enqueue(conversationId: string, message: NewPending): Pending {
  listen()
  counter += 1
  const item: Pending = {
    ...message,
    tempId: `pending-${counter}`,
    clientId: newClientId(),
    conversationId,
    createdAt: new Date().toISOString(),
    failed: false,
    slow: false
  }
  update(conversationId, (list) => [...list, item])
  // Oct 30, 2026: the "Message sent" sound (off unless picked in Settings).
  playSound('messageSent')
  void deliver(item)
  return item
}

async function deliver(item: Pending, attempt = 0): Promise<void> {
  const slowTimer = setTimeout(() => {
    if (find(item.conversationId, item.tempId)) patch(item, { slow: true })
  }, SLOW_AFTER_MS)
  const result = await window.glofly.conversations.send(
    item.conversationId,
    item.body,
    item.replyTo?.id,
    item.attachments.map((a) => a.id),
    { ...(item.lantern ? { lantern: true } : {}), clientId: item.clientId }
  )
  clearTimeout(slowTimer)
  if (!find(item.conversationId, item.tempId)) return // deleted meanwhile
  if (result.ok) {
    update(item.conversationId, (list) => list.filter((x) => x.tempId !== item.tempId))
    for (const l of sentListeners) l(item, result.data)
  } else {
    if (result.error === 'conflict' && attempt < 5) {
      // 409 "in_flight": the first try is still being saved on the server. Ask again in a
      // moment (it answers with that same message once it's in).
      patch(item, { slow: true })
      setTimeout(() => {
        const still = find(item.conversationId, item.tempId)
        if (still && !still.failed) void deliver(still, attempt + 1)
      }, 2000)
      return
    }
    patch(item, { failed: true, slow: false, offline: result.error === 'unreachable' })
    for (const l of failListeners) l(item, result.error, result.message)
  }
}

/** "Retry": sends it again with the same clientId. */
export function retry(conversationId: string, tempId: string): void {
  const item = find(conversationId, tempId)
  if (!item || !item.failed) return
  const next = { ...item, failed: false, slow: false, offline: false }
  patch(item, { failed: false, slow: false, offline: false })
  void deliver(next)
}

/** "Delete": drops a failed message. Returns it (its uploads can be tidied away). */
export function discard(conversationId: string, tempId: string): Pending | undefined {
  const item = find(conversationId, tempId)
  if (item) update(conversationId, (list) => list.filter((x) => x.tempId !== tempId))
  return item
}

/** Back online: messages that failed because the connection was down go again (once). */
export function retryOffline(): void {
  for (const list of Object.values(byChat)) {
    for (const item of list)
      if (item.failed && item.offline) retry(item.conversationId, item.tempId)
  }
}

/** Signing out: nothing waits to be sent for the next person. */
export function clearOutbox(): void {
  byChat = {}
  emit()
}
