import { BrowserWindow } from 'electron'
import { io, type Socket } from 'socket.io-client'
import type { GloflyEvent } from '../preload/api-types'

// The live connection to the server lives here in the main process, like the
// session token. Events are passed on to the window as plain data.

let socket: Socket | null = null
let idle = false

function forward(event: GloflyEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('glofly:event', event)
  }
}

export function connectRealtime(url: string, token: string, onUnauthorized: () => void): void {
  disconnectRealtime()
  socket = io(url, {
    auth: { token },
    transports: ['websocket'],
    reconnectionDelayMax: 10_000 // keeps retrying if the connection drops
  })

  socket.on('connect', () => {
    forward({ type: 'connection', connected: true })
    if (idle) socket?.emit('idle', true) // the server assumes a fresh connection is active
  })
  socket.on('disconnect', () => forward({ type: 'connection', connected: false }))
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') {
      disconnectRealtime()
      onUnauthorized()
      forward({ type: 'session:expired' })
    }
  })

  // Only these events are passed on, and only their expected fields.
  socket.on('message:new', (payload) => {
    if (payload?.message?.id) forward({ type: 'message:new', message: payload.message })
  })
  socket.on('message:updated', (payload) => {
    if (payload?.message?.id) forward({ type: 'message:updated', message: payload.message })
  })
  socket.on('typing', (payload) => {
    if (typeof payload?.conversationId === 'string' && typeof payload?.userId === 'string') {
      forward({ type: 'typing', conversationId: payload.conversationId, userId: payload.userId })
    }
  })
  socket.on('friends:changed', () => forward({ type: 'friends:changed' }))
  socket.on('conversations:changed', () => forward({ type: 'conversations:changed' }))
  socket.on('conversation:read', (p) => {
    if (
      typeof p?.conversationId === 'string' &&
      typeof p?.userId === 'string' &&
      typeof p?.readAt === 'string'
    ) {
      forward({
        type: 'conversation:read',
        conversationId: p.conversationId,
        userId: p.userId,
        readAt: p.readAt
      })
    }
  })
  socket.on('presence', (p) => {
    const statuses = ['online', 'away', 'dnd', 'offline']
    if (typeof p?.userId !== 'string' || !statuses.includes(p?.status)) return
    forward({
      type: 'presence',
      userId: p.userId,
      status: p.status,
      statusText: typeof p.statusText === 'string' ? p.statusText : null,
      lastSeenAt: typeof p.lastSeenAt === 'string' ? p.lastSeenAt : null
    })
  })
}

export function disconnectRealtime(): void {
  socket?.removeAllListeners()
  socket?.disconnect()
  socket = null
}

/** Tells the server whether someone is using the computer (idle shows as Away). */
export function setIdle(value: boolean): void {
  if (value === idle) return
  idle = value
  socket?.emit('idle', value)
}

export function sendTyping(conversationId: string): void {
  socket?.emit('typing', { conversationId })
}
