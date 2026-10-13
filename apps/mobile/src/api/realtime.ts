import { AppState, type AppStateStatus } from 'react-native'
import { io, type Socket } from 'socket.io-client'
import { upgradeEvents, type Call, type Message, type PublicUser } from '@glofly/shared'
import { APP_VERSION, PLATFORM, SERVER_URL } from '@/lib/config'
import { endSessionLocally, onSignOut, useSession } from '@/state/session'
import { patchConversation, rememberPeople, resetStore, setPresence, setTyping, useStore } from '@/state/store'
import {
  markChatRead,
  receiveMessage,
  refreshAll,
  refreshConversations,
  refreshFriends,
  refreshNotices,
  setCall,
  updateMessage,
} from '@/state/sync'
import { noteUpdateRequired } from './http'
import { refreshMe } from './auth'
import { refreshAccount } from '@/state/account'

// The live connection to the server. It's open while Glofly is on screen (and during a call);
// in the background Android delivers push notifications instead, so the server knows to send them.

let socket: Socket | null = null
let appState: AppStateStatus = AppState.currentState
let backgroundTimer: ReturnType<typeof setTimeout> | null = null
/** While a call is going, the connection stays open in the background. */
let keepAliveReasons = new Set<string>()

type Listener = (event: string, payload: unknown) => void
const listeners = new Set<Listener>()
/** Other parts of the app (calls, notifications) listen to live events here. */
export function onLive(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
const emit = (event: string, payload: unknown) => {
  for (const fn of listeners) {
    try {
      fn(event, payload)
    } catch (err) {
      console.warn('live listener failed', err)
    }
  }
}

export const isAppActive = () => appState === 'active'

function serverParts() {
  const u = new URL(SERVER_URL)
  const base = u.pathname.replace(/\/+$/, '')
  return { origin: u.origin, path: `${base}/socket.io` }
}

function connect() {
  const { token } = useSession.getState()
  if (!token || socket) return
  const { origin, path } = serverParts()
  socket = io(origin, {
    path,
    auth: { token, version: APP_VERSION, platform: PLATFORM },
    transports: ['websocket'],
    reconnectionDelayMax: 10_000,
  })
  const s = socket

  s.on('connect', () => {
    useStore.setState({ connected: true })
    void refreshAll()
  })
  s.on('disconnect', (reason) => {
    useStore.setState({ connected: false })
    // The server only hangs up itself when this phone was signed out elsewhere.
    if (reason === 'io server disconnect') {
      disconnect()
      void endSessionLocally('You were signed out. Please log in again.')
    }
  })
  s.on('connect_error', (err) => {
    if (err.message === 'update_required') {
      disconnect()
      noteUpdateRequired(null)
    } else if (err.message === 'unauthorized') {
      disconnect()
      void endSessionLocally('You were signed out. Please log in again.')
    }
  })
  s.on('app:update-required', (body) => {
    disconnect()
    noteUpdateRequired(body)
  })

  s.on('message:new', (p: { message?: Message; people?: PublicUser[] }) => {
    if (!p?.message?.id) return
    const message = upgradeEvents(p.message)
    if (Array.isArray(p.people)) rememberPeople(p.people)
    const { counts } = receiveMessage(message, { appActive: isAppActive() })
    if (useStore.getState().viewing === message.conversationId && isAppActive() && message.senderId !== useSession.getState().user?.id) {
      void markChatRead(message.conversationId)
    }
    emit('message:new', { message, counts })
  })
  s.on('message:updated', (p: { message?: Message }) => {
    if (p?.message?.id) updateMessage(upgradeEvents(p.message))
  })
  s.on('typing', (p: { conversationId?: string; userId?: string }) => {
    if (typeof p?.conversationId === 'string' && typeof p?.userId === 'string') setTyping(p.conversationId, p.userId, Date.now() + 6000)
  })
  s.on('presence', (p: { userId?: string; status?: string; statusText?: string | null; lastSeenAt?: string | null; activity?: unknown; mobile?: unknown }) => {
    if (typeof p?.userId !== 'string' || !['online', 'away', 'dnd', 'offline'].includes(String(p.status))) return
    const a = p.activity as { name?: unknown; since?: unknown } | null
    setPresence(p.userId, {
      status: p.status as 'online',
      statusText: typeof p.statusText === 'string' ? p.statusText : null,
      lastSeenAt: typeof p.lastSeenAt === 'string' ? p.lastSeenAt : null,
      activity: a && typeof a.name === 'string' && typeof a.since === 'string' ? { name: a.name, since: a.since } : null,
      mobile: p.mobile === true,
    })
    if (p.userId === useSession.getState().user?.id) emit('presence:me', p)
  })
  s.on('conversation:read', (p: { conversationId?: string; userId?: string; readAt?: string }) => {
    if (typeof p?.conversationId !== 'string' || typeof p?.userId !== 'string' || typeof p?.readAt !== 'string') return
    const meId = useSession.getState().user?.id
    if (p.userId === meId) {
      patchConversation(p.conversationId, { unreadCount: 0, mentionCount: 0 })
      emit('read:me', p.conversationId)
    } else {
      const c = useStore.getState().conversations[p.conversationId]
      if (c?.kind === 'dm') patchConversation(p.conversationId, { partnerReadAt: p.readAt })
    }
  })
  // 0.3.0: a friend you asked about came online / someone joined from your invite.
  s.on('friend:online', (p: { user?: PublicUser }) => {
    if (typeof p?.user?.id === 'string' && typeof p.user.displayName === 'string') emit('friend:online', p.user)
  })
  s.on('friend:joined', (p: { user?: PublicUser }) => {
    if (typeof p?.user?.id === 'string' && typeof p.user.displayName === 'string') {
      emit('friend:joined', p.user)
      void refreshFriends()
    }
  })
  s.on('friends:changed', () => {
    void refreshFriends()
    void refreshConversations()
  })
  s.on('conversations:changed', () => void refreshConversations())
  s.on('profile:changed', (p: { userId?: string }) => {
    if (p?.userId === useSession.getState().user?.id) void refreshMe()
    void refreshFriends()
    void refreshConversations()
    emit('profile:changed', p?.userId)
  })
  s.on('account:changed', () => {
    void refreshAccount()
    emit('account:changed', null)
  })
  s.on('call:updated', (p: { call?: Call; caller?: PublicUser | null }) => {
    if (!p?.call?.id) return
    setCall(p.call, p.caller ?? null)
    emit('call:updated', p)
  })
  s.on('notice:new', () => void refreshNotices())
  s.on('announcement', () => void refreshNotices())
}

function disconnect() {
  socket?.removeAllListeners()
  socket?.disconnect()
  socket = null
  useStore.setState({ connected: false })
}

/** Tells the people in a chat you're typing (at most every 3 seconds, like the desktop app). */
const lastTyping = new Map<string, number>()
export function sendTyping(conversationId: string) {
  const now = Date.now()
  if ((lastTyping.get(conversationId) ?? 0) > now - 3000) return
  lastTyping.set(conversationId, now)
  socket?.emit('typing', { conversationId })
}

/** Keeps the connection open while Glofly is in the background (calls). */
export function keepConnected(reason: string, on: boolean) {
  if (on) keepAliveReasons.add(reason)
  else keepAliveReasons.delete(reason)
  if (on && !socket && useSession.getState().status === 'signedIn') connect()
}

let started = false
/** Starts following sign-in and the app going to the background / coming back. */
export function startRealtime() {
  if (started) return
  started = true
  const sync = () => {
    const signedIn = useSession.getState().status === 'signedIn'
    if (!signedIn) return disconnect()
    if (appState === 'active') {
      if (backgroundTimer) clearTimeout(backgroundTimer)
      backgroundTimer = null
      if (!socket) connect()
      else if (socket.connected) void refreshAll()
    } else if (!backgroundTimer && keepAliveReasons.size === 0) {
      // A moment's grace for quick app switches, then push notifications take over.
      backgroundTimer = setTimeout(() => {
        backgroundTimer = null
        if (appState !== 'active' && keepAliveReasons.size === 0) disconnect()
      }, 1500)
    }
  }
  AppState.addEventListener('change', (next) => {
    appState = next
    sync()
  })
  useSession.subscribe((s, prev) => {
    if (s.status !== prev.status || s.token !== prev.token) {
      disconnect()
      sync()
    }
  })
  onSignOut(() => {
    disconnect()
    keepAliveReasons = new Set()
    resetStore()
  })
  sync()
}
