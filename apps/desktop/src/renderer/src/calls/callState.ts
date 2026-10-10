import { createContext, useContext } from 'react'
import type { Room } from 'livekit-client'
import type { Call, CallMember, ConversationSummary, PublicUser } from '../../../preload/api-types'

// What the rest of the app sees of calls (the provider in CallContext.tsx does the work).

/**
 * starting: asking the server · ringing: waiting for someone to answer · connecting: you answered,
 * joining · connected: talking · reconnecting: the connection dropped, getting it back
 */
export type CallPhase = 'starting' | 'ringing' | 'connecting' | 'connected' | 'reconnecting'

/** The chat a call belongs to, as the call screens need it. */
export type CallChat = {
  kind: 'dm' | 'group'
  /** "Jacob Jones", or "Friday Squad" / "Maya, Jacob and 2 others" */
  title: string
  /** Everyone else in the chat */
  people: PublicUser[]
}

export type CurrentCall = {
  conversationId: string
  chat: CallChat
  /** Null for a moment while the call is being set up */
  call: Call | null
  /** Started (or joined) as a video call */
  video: boolean
  phase: CallPhase
  /** Something about the microphone, camera or screen sharing went wrong */
  problem: string | null
  /** 1-on-1: they dropped out of the call (their connection, probably) */
  partnerAway: boolean
}

export type IncomingCallInfo = { call: Call; caller: PublicUser; chat: CallChat }
/** You're in this call on another device (or Glofly restarted mid-call). */
export type ElsewhereCall = { call: Call; chat: CallChat }

/** Push to talk during a call. */
export type PttState = {
  /** The key, as shown ("`", "Mouse 4 (back)") */
  label: string
  /** Being held right now (you're talking) */
  held: boolean
  /** "permission": a Mac hasn't allowed Glofly under Accessibility yet */
  status: 'ok' | 'permission' | 'unavailable'
}

export type CallsValue = {
  current: CurrentCall | null
  incoming: IncomingCallInfo | null
  elsewhere: ElsewhereCall | null
  /** The call's LiveKit room, once connected */
  room: Room | null
  /** Changes whenever something in the room changes (tracks, mutes, who's talking) */
  tick: number
  /** Push to talk, when it's on (null = open mic) */
  ptt: PttState | null
  /** A ringing or ongoing call in this chat, if any (yours or not) */
  callIn: (conversationId: string) => Call | null
  /** Starts a call, or joins the one already going on in a group. */
  start: (conversation: ConversationSummary, video: boolean) => void
  answer: (video: boolean) => Promise<void>
  /** Declines a ringing call, optionally sending a message first. */
  decline: (message?: string) => Promise<void>
  /** Hangs up (1-on-1: ends it; group: leaves it). */
  hangUp: () => void
  toggleMic: () => void
  toggleCamera: () => void
  /** Shares a screen or window picked in Glofly's picker. */
  shareScreen: (sourceId: string) => Promise<void>
  stopSharing: () => void
  /** Group calls: rings people in the group who aren't in the call. */
  ring: (userIds: string[]) => Promise<void>
  /** Moves a call you're in on another device to this one. */
  moveHere: () => void
  clearProblem: () => void
}

export const CallsContext = createContext<CallsValue | null>(null)

export function useCalls(): CallsValue {
  const value = useContext(CallsContext)
  if (!value) throw new Error('useCalls must be used inside <CallProvider>')
  return value
}

export const firstName = (u: PublicUser): string =>
  u.displayName.trim().split(/\s+/)[0] || u.username

/** "4:05", or "1:02:03" for long calls. */
export function callDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Where this person stands in the call. Ringing ends when its time runs out, event or not. */
export function memberState(call: Call, userId: string, now = Date.now()): CallMember['state'] {
  const m = call.members.find((x) => x.userId === userId)
  if (!m) return 'out'
  if (m.state === 'ringing' && (!m.ringingUntil || new Date(m.ringingUntil).getTime() <= now)) {
    return 'out'
  }
  return m.state
}

/** How many people are in the call right now. */
export const joinedCount = (call: Call): number =>
  call.members.filter((m) => m.state === 'joined').length

export const isActive = (call: Call): boolean =>
  call.status === 'ringing' || call.status === 'ongoing'
