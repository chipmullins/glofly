import { createContext, useContext } from 'react'
import type { Room } from 'livekit-client'
import type { Call, DmSummary, PublicUser } from '../../../preload/api-types'

// What the rest of the app sees of calls (the provider in CallContext.tsx does the work).

/**
 * starting: asking the server · ringing: waiting for them to answer · connecting: you answered,
 * joining · connected: talking · reconnecting: the connection dropped, getting it back
 */
export type CallPhase = 'starting' | 'ringing' | 'connecting' | 'connected' | 'reconnecting'

export type CurrentCall = {
  conversationId: string
  /** The other person */
  partner: PublicUser
  /** Null for a moment while the call is being set up */
  call: Call | null
  /** Started as a video call */
  video: boolean
  phase: CallPhase
  /** Something about the microphone, camera or screen sharing went wrong */
  problem: string | null
  /** They dropped out of the call (their connection, probably) */
  partnerAway: boolean
}

export type IncomingCallInfo = { call: Call; caller: PublicUser }
/** You're in this call on another device (or Glofly restarted mid-call). */
export type ElsewhereCall = { call: Call; partner: PublicUser }

export type CallsValue = {
  current: CurrentCall | null
  incoming: IncomingCallInfo | null
  elsewhere: ElsewhereCall | null
  /** The call's LiveKit room, once connected */
  room: Room | null
  /** Changes whenever something in the room changes (tracks, mutes, who's talking) */
  tick: number
  start: (conversation: DmSummary, video: boolean) => void
  answer: (video: boolean) => Promise<void>
  /** Declines a ringing call, optionally sending a message first. */
  decline: (message?: string) => Promise<void>
  hangUp: () => void
  toggleMic: () => void
  toggleCamera: () => void
  /** Shares a screen or window picked in Glofly's picker. */
  shareScreen: (sourceId: string) => Promise<void>
  stopSharing: () => void
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
