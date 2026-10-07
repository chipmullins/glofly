import { BrowserWindow } from 'electron'
import { io, type Socket } from 'socket.io-client'
import type { GloflyEvent } from '../preload/api-types'

// The live connection to the server lives here in the main process, like the
// session token. Events are passed on to the window as plain data.

let socket: Socket | null = null

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

  socket.on('connect', () => forward({ type: 'connection', connected: true }))
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
  socket.on('typing', (payload) => {
    if (typeof payload?.conversationId === 'string' && typeof payload?.userId === 'string') {
      forward({ type: 'typing', conversationId: payload.conversationId, userId: payload.userId })
    }
  })
  socket.on('friends:changed', () => forward({ type: 'friends:changed' }))
}

export function disconnectRealtime(): void {
  socket?.removeAllListeners()
  socket?.disconnect()
  socket = null
}

export function sendTyping(conversationId: string): void {
  socket?.emit('typing', { conversationId })
}
