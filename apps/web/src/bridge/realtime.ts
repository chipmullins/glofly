import { io, type Socket } from 'socket.io-client'
import type {
  Activity,
  Announcement,
  Call,
  CallMember,
  GloflyEvent,
  PublicUser
} from '../../../desktop/src/preload/api-types'
import { upgradeEvents } from '@glofly/shared/events'
import { cleanWatchReaction, cleanWatchUpdate } from '@glofly/shared/watch'
import { cleanFireflies } from '@glofly/shared/types'
import { CONSTELLATION_EVENT_NAMES, cleanConstellationEvent } from '@glofly/shared/constellations'
import { API_URL, VERSION } from './config'
import { notePaused, noteUpdateRequired } from './appStatus'
import { emit } from './events'

// The live connection (the desktop app's src/main/realtime.ts, for a browser). The browser sends
// the session cookie with the WebSocket; the server only accepts it from chat.glofly.app.
// Events are checked the same way before they reach the window.

let socket: Socket | null = null
let idle = false

const forward = (event: GloflyEvent): void => emit(event)

/** Only the fields the banner uses, and only https links. */
export function cleanAnnouncement(a: unknown): Announcement | null {
  const x = a as Record<string, unknown> | null | undefined
  if (!x || typeof x.id !== 'string' || typeof x.body !== 'string') return null
  let linkUrl: string | null = null
  if (typeof x.linkUrl === 'string') {
    try {
      linkUrl = new URL(x.linkUrl).protocol === 'https:' ? x.linkUrl : null
    } catch {
      linkUrl = null
    }
  }
  return {
    id: x.id,
    body: x.body.slice(0, 300),
    tone: x.tone === 'important' ? 'important' : 'info',
    linkUrl,
    linkLabel: linkUrl && typeof x.linkLabel === 'string' ? x.linkLabel.slice(0, 40) : null,
    createdAt: String(x.createdAt ?? ''),
    endsAt: typeof x.endsAt === 'string' ? x.endsAt : null
  }
}

export function connectRealtime(onUnauthorized: () => void): void {
  disconnectRealtime()
  socket = io(API_URL, {
    auth: {
      version: VERSION,
      platform: 'web',
      features: ['constellations', 'callMove', 'watchSites', 'watchKick']
    },
    transports: ['websocket'],
    withCredentials: true,
    reconnectionDelayMax: 10_000 // keeps retrying if the connection drops
  })

  socket.on('connect', () => {
    forward({ type: 'connection', connected: true })
    if (idle) socket?.emit('idle', true) // the server assumes a fresh connection is active
  })
  socket.on('app:update-required', (body) => {
    disconnectRealtime()
    noteUpdateRequired(body)
  })
  // Glofly Control → Pause Glofly. The server closes the connection right after this.
  socket.on('server:paused', (body) => {
    disconnectRealtime()
    notePaused(body)
  })
  socket.on('notice:new', (p) => {
    const n = p?.notice
    if (typeof n?.id === 'string' && typeof n.body === 'string') {
      forward({
        type: 'notice:new',
        notice: {
          id: n.id,
          kind: typeof n.kind === 'string' ? n.kind : 'warning',
          body: n.body.slice(0, 1000),
          createdAt: String(n.createdAt),
          allowReply: n.allowReply === true
        }
      })
    }
  })
  socket.on('announcement', (p) => {
    forward({ type: 'announcement', announcement: cleanAnnouncement(p?.announcement) })
  })
  // 2.0 Constellations and My games: only these, checked field by field.
  for (const name of CONSTELLATION_EVENT_NAMES) {
    socket.on(name, (p) => {
      const event = cleanConstellationEvent(name, p)
      if (event) forward(event)
    })
  }
  socket.on('disconnect', (reason) => {
    // The server only closes a connection itself when that device was signed out.
    if (reason === 'io server disconnect') {
      disconnectRealtime()
      onUnauthorized()
      forward({ type: 'session:expired' })
      return
    }
    forward({ type: 'connection', connected: false })
  })
  socket.on('connect_error', (err) => {
    if (err.message === 'update_required') {
      disconnectRealtime()
      noteUpdateRequired(null)
      return
    }
    if (err.message === 'unauthorized') {
      disconnectRealtime()
      onUnauthorized()
      forward({ type: 'session:expired' })
    }
  })

  // Only these events are passed on, and only their expected fields.
  // 0.7.3: pins, marked unread, send later (ids only; the screens ask for the rest).
  socket.on('pins:changed', (p) => {
    if (typeof p?.conversationId === 'string')
      forward({ type: 'pins:changed', conversationId: p.conversationId })
  })
  socket.on('scheduled:changed', (p) => {
    if (typeof p?.conversationId === 'string')
      forward({ type: 'scheduled:changed', conversationId: p.conversationId })
  })
  socket.on('conversation:unread', (p) => {
    if (typeof p?.conversationId === 'string' && typeof p?.lastReadAt === 'string')
      forward({
        type: 'conversation:unread',
        conversationId: p.conversationId,
        lastReadAt: p.lastReadAt
      })
  })
  socket.on('message:new', (payload) => {
    if (payload?.message?.id) {
      const people = Array.isArray(payload.people) ? payload.people : undefined
      const nebula = payload.nebula === true ? { nebula: true } : {}
      forward({ type: 'message:new', message: upgradeEvents(payload.message), people, ...nebula })
    }
  })
  socket.on('message:updated', (payload) => {
    if (payload?.message?.id) {
      forward({ type: 'message:updated', message: upgradeEvents(payload.message) })
    }
  })
  socket.on('typing', (payload) => {
    if (typeof payload?.conversationId === 'string' && typeof payload?.userId === 'string') {
      forward({ type: 'typing', conversationId: payload.conversationId, userId: payload.userId })
    }
  })
  // 0.5.0 Watch Together: what a call is watching, and firefly reactions over the video.
  socket.on('watch:updated', (p) => {
    const update = cleanWatchUpdate(p)
    if (update) forward({ type: 'watch:updated', ...update })
  })
  socket.on('watch:reaction', (p) => {
    const reaction = cleanWatchReaction(p)
    if (reaction) forward({ type: 'watch:reaction', ...reaction })
  })
  // 0.5.0: a swarm of fireflies across a chat.
  socket.on('chat:fireflies', (p) => {
    const swarm = cleanFireflies(p)
    if (swarm) forward({ type: 'chat:fireflies', ...swarm })
  })
  // 0.5.0: glows, hangs, birthdays or broadcasts changed (the app fetches /social again).
  socket.on('social:changed', () => forward({ type: 'social:changed' }))
  socket.on('hang:ping', (p) => {
    if (typeof p?.userId === 'string' && typeof p?.until === 'string') {
      forward({ type: 'hang:ping', userId: p.userId, until: p.until })
    }
  })
  socket.on('friends:changed', () => forward({ type: 'friends:changed' }))
  socket.on('conversations:changed', () => forward({ type: 'conversations:changed' }))
  socket.on('account:changed', () => forward({ type: 'account:changed' }))
  socket.on('profile:changed', (p) => {
    if (typeof p?.userId === 'string') forward({ type: 'profile:changed', userId: p.userId })
  })
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
  socket.on('call:updated', (p) => {
    const call = cleanCall(p?.call)
    if (call) forward({ type: 'call:updated', call, caller: cleanUser(p?.caller) })
  })
  // 0.3.0: a friend you asked about came online / someone joined from your invite.
  socket.on('friend:online', (p) => {
    const user = cleanUser(p?.user)
    if (user) forward({ type: 'friend:online', user })
  })
  socket.on('friend:joined', (p) => {
    const user = cleanUser(p?.user)
    if (user) forward({ type: 'friend:joined', user })
  })
  // 0.8.0: someone added you with your invite link.
  socket.on('friend:linked', (p) => {
    const user = cleanUser(p?.user)
    if (user) forward({ type: 'friend:linked', user })
  })
  socket.on('presence', (p) => {
    const statuses = ['online', 'away', 'dnd', 'offline']
    if (typeof p?.userId !== 'string' || !statuses.includes(p?.status)) return
    forward({
      type: 'presence',
      userId: p.userId,
      status: p.status,
      statusText: typeof p.statusText === 'string' ? p.statusText : null,
      lastSeenAt: typeof p.lastSeenAt === 'string' ? p.lastSeenAt : null,
      activity: cleanActivity(p.activity),
      mobile: p.mobile === true
    })
  })
}

/** "Playing …": a short name and when it started, or nothing. */
function cleanActivity(a: unknown): Activity | null {
  const x = a as { name?: unknown; since?: unknown } | null
  if (!x || typeof x.name !== 'string' || !x.name || x.name.length > 64) return null
  if (typeof x.since !== 'string' || x.since.length > 40) return null
  return { name: x.name, since: x.since }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CALL_STATUSES = ['ringing', 'ongoing', 'ended', 'missed', 'declined']
const isoOrNull = (v: unknown): string | null =>
  typeof v === 'string' && v.length <= 40 ? v : null

/** Only a well-formed call, with just its known fields, reaches the window. */
function cleanCall(c: unknown): Call | null {
  const x = c as Record<string, unknown> | null
  if (
    !x ||
    typeof x.id !== 'string' ||
    !UUID.test(x.id) ||
    typeof x.conversationId !== 'string' ||
    !UUID.test(x.conversationId) ||
    typeof x.callerId !== 'string' ||
    !UUID.test(x.callerId) ||
    typeof x.video !== 'boolean' ||
    !CALL_STATUSES.includes(x.status as string) ||
    typeof x.createdAt !== 'string'
  ) {
    return null
  }
  const members: CallMember[] = []
  if (Array.isArray(x.members)) {
    for (const m of x.members.slice(0, 50) as Record<string, unknown>[]) {
      if (
        typeof m?.userId === 'string' &&
        UUID.test(m.userId) &&
        ['joined', 'ringing', 'out'].includes(m.state as string)
      ) {
        members.push({
          userId: m.userId,
          state: m.state as CallMember['state'],
          ringingUntil: isoOrNull(m.ringingUntil)
        })
      }
    }
  }
  return {
    members,
    id: x.id,
    conversationId: x.conversationId,
    callerId: x.callerId,
    video: x.video,
    status: x.status as Call['status'],
    createdAt: x.createdAt,
    answeredAt: isoOrNull(x.answeredAt),
    endedAt: isoOrNull(x.endedAt)
  }
}

function cleanUser(u: unknown): PublicUser | null {
  const x = u as Record<string, unknown> | null
  if (!x || typeof x.id !== 'string' || !UUID.test(x.id)) return null
  return {
    id: x.id,
    username: typeof x.username === 'string' ? x.username.slice(0, 40) : '',
    displayName: typeof x.displayName === 'string' ? x.displayName.slice(0, 64) : '',
    avatarVersion: typeof x.avatarVersion === 'string' ? x.avatarVersion.slice(0, 64) : null
  }
}

export function disconnectRealtime(): void {
  socket?.removeAllListeners()
  socket?.disconnect()
  socket = null
}

/** Tells the server whether someone is using Glofly (idle shows as Away). */
export function setIdle(value: boolean): void {
  if (value === idle) return
  idle = value
  socket?.emit('idle', value)
}

export function sendTyping(conversationId: string): void {
  socket?.emit('typing', { conversationId })
}
