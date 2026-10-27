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
  /** "nebula" (2.0): a constellation's voice nebula (drop-in, nobody is rung) */
  kind: 'dm' | 'group' | 'nebula'
  /** Voice nebulas: which constellation and nebula (to open it, and report screen sharing) */
  nebula?: { constellationId: string; nebulaId: string }
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
  /**
   * Starts a call, or joins the one already going on in a group. `ring` (groups, 0.5.2): only
   * these people are rung; the rest of the group can join.
   */
  start: (conversation: ConversationSummary, video: boolean, ring?: string[]) => void
  answer: (video: boolean) => Promise<void>
  /** Declines a ringing call, optionally sending a message first. */
  decline: (message?: string) => Promise<void>
  /** Hangs up (1-on-1: ends it; group: leaves it). */
  hangUp: () => void
  toggleMic: () => void
  toggleCamera: () => void
  /** Shares a screen or window picked in Glofly's picker. */
  /** `sound`: send the shared app's sound too (desktop; the browser asks for itself). */
  shareScreen: (sourceId: string, sound?: boolean) => Promise<void>
  stopSharing: () => void
  /** Group calls: rings people in the group who aren't in the call. */
  ring: (userIds: string[]) => Promise<void>
  /**
   * 0.5.2 Add people: 1-on-1, the call moves to a new group with everyone (nobody drops out);
   * groups, they're rung (friends not in the group are added first). Null if it worked, else why not.
   */
  addPeople: (userIds: string[]) => Promise<string | null>
  /** 0.5.2 Group calls: on your own, keep the call going another 7 minutes. */
  stay: () => void
  /** Your friends (Add people picks from them) */
  friends: PublicUser[]
  /** Moves a call you're in on another device to this one. */
  moveHere: () => void
  /** 2.0: drops into a voice nebula (leaving any other call first). */
  joinVoice: (chat: CallChat & { nebula: { constellationId: string; nebulaId: string } }) => void
  clearProblem: () => void
  /**
   * The browser won't play the call's sound until you tap the page (phone and tablet browsers'
   * autoplay rule). Their voices are arriving but silent here until `turnOnSound` runs from a tap.
   */
  soundBlocked: boolean
  /** Starts the call's sound. Must run from a tap or click (the browser's rule). */
  turnOnSound: () => void
  /** Shows a short problem in the call panel (say, a Watch Together button that was refused). */
  showProblem: (message: string) => void
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
