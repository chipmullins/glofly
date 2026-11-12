import { PermissionsAndroid, Platform } from 'react-native'
import { create } from 'zustand'
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client'
import { STAGE_PING_MS, type MyStage, type StagePass, type StageState } from '@glofly/shared'
import type { ApiResult } from '@glofly/shared'
import { request } from '@/api/http'
import { keepConnected, onLive } from '@/api/realtime'
import { setupWebRTC, startCallAudio, startWatchAudio, stopCallAudio, stopWatchAudio } from '@/calls/media'
import { useCall } from '@/calls/controller'

// Communities round 2 (board 3c): being on a stage on a phone (JS only: LiveKit is already in the
// app). Listening uses the media audio session (speaker / headphones, the microphone is never
// touched); coming up as a speaker switches to the call session and asks for the microphone only
// when you unmute. One stage at a time; the app says "still here" every 30 s.

const at = (cid: string, nid: string) => `/constellations/${cid}/nebulas/${nid}/stage`

export const stageApi = {
  get: (cid: string, nid: string) => request<{ stage: StageState | null; me: MyStage }>('GET', at(cid, nid)),
  start: (cid: string, nid: string, topic: string) => request<StagePass>('POST', at(cid, nid), { topic }),
  end: (cid: string, nid: string) => request<null>('DELETE', at(cid, nid)),
  hand: (cid: string, nid: string, up: boolean) => request<{ me: MyStage }>('POST', `${at(cid, nid)}/hand`, { up }),
  invite: (cid: string, nid: string, userId: string) => request<{ stage: StageState }>('POST', `${at(cid, nid)}/invite`, { userId, invited: true }),
  audience: (cid: string, nid: string, userId: string) => request<{ stage: StageState }>('POST', `${at(cid, nid)}/audience`, { userId }),
}

export type OnStage = {
  constellationId: string
  nebulaId: string
  role: 'speaker' | 'listener'
  status: 'connecting' | 'on' | 'problem'
  micOn: boolean
  speaking: string[]
  muted: string[]
  problem: string | null
  /** A manager asked me up (the pop-up), with their name */
  invitedBy: string | null
}

export const useStage = create<{ on: OnStage | null; invites: Record<string, string> }>(() => ({ on: null, invites: {} }))
const patch = (p: Partial<OnStage>) => {
  const on = useStage.getState().on
  if (on) useStage.setState({ on: { ...on, ...p } })
}

let room: Room | null = null
let pinger: ReturnType<typeof setInterval> | null = null
let audio: 'call' | 'watch' | null = null
const webAudio: HTMLMediaElement[] = []

function mutedSpeakers(r: Room): string[] {
  const out: string[] = []
  for (const p of r.remoteParticipants.values()) {
    if (p.identity.startsWith('listen:')) continue
    const mic = p.getTrackPublication(Track.Source.Microphone)
    if (!mic || mic.isMuted) out.push(p.identity)
  }
  if (!r.localParticipant.identity.startsWith('listen:') && !r.localParticipant.isMicrophoneEnabled) out.push(r.localParticipant.identity)
  return out
}

async function stopAudio() {
  if (audio === 'call') await stopCallAudio().catch(() => {})
  if (audio === 'watch') await stopWatchAudio().catch(() => {})
  audio = null
}

async function disconnect() {
  const r = room
  room = null
  for (const el of webAudio.splice(0)) el.remove()
  if (r) await r.disconnect().catch(() => {})
  await stopAudio()
}

async function connect(pass: StagePass, cid: string, nid: string): Promise<string | null> {
  await disconnect()
  setupWebRTC()
  // Listening is like a video (never the earpiece); speaking is a call.
  if (pass.role === 'speaker') {
    await startCallAudio(false).catch(() => {})
    audio = 'call'
  } else {
    await startWatchAudio().catch(() => {})
    audio = 'watch'
  }
  const r = new Room({ adaptiveStream: true, dynacast: true })
  room = r
  useStage.setState({ on: { constellationId: cid, nebulaId: nid, role: pass.role, status: 'connecting', micOn: false, speaking: [], muted: [], problem: null, invitedBy: null } })
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    // Phones play remote sound by themselves; the browser preview needs an element.
    if (track.kind === Track.Kind.Audio && Platform.OS === 'web') {
      const el = track.attach()
      webAudio.push(el)
      document.body.appendChild(el)
    }
  })
    .on(RoomEvent.ActiveSpeakersChanged, (people: Participant[]) => patch({ speaking: people.map((p) => p.identity).filter((id) => !id.startsWith('listen:')) }))
    .on(RoomEvent.TrackMuted, () => patch({ muted: mutedSpeakers(r) }))
    .on(RoomEvent.TrackUnmuted, () => patch({ muted: mutedSpeakers(r) }))
    .on(RoomEvent.TrackPublished, () => patch({ muted: mutedSpeakers(r) }))
    .on(RoomEvent.Disconnected, () => {
      if (room === r && useStage.getState().on?.status === 'on') patch({ status: 'problem', problem: 'The stage connection dropped.' })
    })
  try {
    await r.connect(pass.url, pass.token)
    if (room !== r) return null
    patch({ status: 'on', muted: mutedSpeakers(r) })
    keepConnected('stage', true)
    pinger ??= setInterval(() => void ping(), STAGE_PING_MS)
    return null
  } catch {
    if (room === r) patch({ status: 'problem', problem: "Couldn't connect to the stage. Try again." })
    return "Couldn't connect to the stage. Try again."
  }
}

async function ping() {
  const on = useStage.getState().on
  if (!on) return
  const r = await request<{ me: MyStage; live: boolean }>('POST', `${at(on.constellationId, on.nebulaId)}/ping`, { as: on.role })
  if (r.ok && !r.data.live && useStage.getState().on?.nebulaId === on.nebulaId) await leaveStage(false)
}

const inCall = () => (useCall.getState().call ? 'Leave your call first, then join the stage.' : null)

/** Listen in, or come up as a speaker (when asked up or a manager). Null when it worked. */
export async function joinStage(cid: string, nid: string, as: 'listener' | 'speaker'): Promise<string | null> {
  const busy = inCall()
  if (busy) return busy
  const r: ApiResult<StagePass> = await request<StagePass>('POST', `${at(cid, nid)}/join`, { as })
  if (!r.ok) return r.message
  const invites = { ...useStage.getState().invites }
  delete invites[nid]
  useStage.setState({ invites })
  return connect(r.data, cid, nid)
}

export async function startStage(cid: string, nid: string, topic: string): Promise<string | null> {
  const busy = inCall()
  if (busy) return busy
  const r = await stageApi.start(cid, nid, topic)
  if (!r.ok) return r.message
  return connect(r.data, cid, nid)
}

export async function leaveStage(tellServer = true): Promise<void> {
  const on = useStage.getState().on
  if (pinger) clearInterval(pinger)
  pinger = null
  useStage.setState({ on: null })
  keepConnected('stage', false)
  await disconnect()
  if (on && tellServer) await request('POST', `${at(on.constellationId, on.nebulaId)}/leave`)
}

/** Speakers: the microphone on or off (the first time asks for it). Null when it worked. */
export async function setStageMic(on: boolean): Promise<string | null> {
  if (!room || useStage.getState().on?.role !== 'speaker') return null
  if (on && Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO)
    if (result !== PermissionsAndroid.RESULTS.GRANTED) return "Glofly can't use your microphone. Allow it in Settings."
  }
  try {
    await room.localParticipant.setMicrophoneEnabled(on)
    patch({ micOn: on, muted: mutedSpeakers(room) })
    return null
  } catch {
    return "Couldn't start your microphone."
  }
}

// The server's news: moved to the audience → listen instead; the stage ended → leave; asked up.
onLive((event, payload) => {
  if (event !== 'cx') return
  const e = payload as { type: string; nebulaId?: string; constellationId?: string; stage?: unknown; byName?: string; invited?: boolean }
  const on = useStage.getState().on
  if (e.type === 'stage:invited' && e.nebulaId) {
    const invites = { ...useStage.getState().invites }
    if (e.invited) invites[e.nebulaId] = e.byName || 'A moderator'
    else delete invites[e.nebulaId]
    useStage.setState({ invites })
  }
  if (!on) return
  if (e.type === 'stage:moved' && e.nebulaId === on.nebulaId) void joinStage(on.constellationId, on.nebulaId, 'listener')
  else if (e.type === 'stage:updated' && e.nebulaId === on.nebulaId && e.stage === null) void leaveStage(false)
  else if (e.type === 'constellation:removed' && e.constellationId === on.constellationId) void leaveStage(false)
})
