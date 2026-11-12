import { useSyncExternalStore } from 'react'
import { Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client'
import { STAGE_PING_MS } from '@glofly/shared/stages'
import type {
  AnnouncementFollow,
  AnnouncementFollower,
  FollowTarget,
  MyStage,
  StagePass,
  StageState
} from '@glofly/shared/stages'
import type { ApiResult, ConstellationMethod } from '../../../preload/api-types'
import { audioCapture, getCallPrefs } from './callPrefs'

// Communities round 2 (board 3a): being on a stage. One stage at a time, kept while you move around
// the app (like a voice nebula): a LiveKit room that only receives for listeners, and sends your
// microphone for speakers (asked for only when you first unmute). The app says "still here" every
// 30 s. Requests go through the constellations gateway.

const call = <T>(
  method: ConstellationMethod,
  path: string,
  body?: unknown
): Promise<ApiResult<T>> => window.glofly.constellations.request<T>(method, path, body)

const at = (cid: string, nid: string): string => `/constellations/${cid}/nebulas/${nid}/stage`

export type StageSettings = {
  topic?: string
  handsOn?: boolean
  listenerChat?: boolean
  speakerLimit?: number
}

export const stageApi = {
  get: (cid: string, nid: string) =>
    call<{ stage: StageState | null; me: MyStage }>('GET', at(cid, nid)),
  start: (cid: string, nid: string, s: StageSettings & { topic: string }) =>
    call<StagePass>('POST', at(cid, nid), s),
  change: (cid: string, nid: string, s: StageSettings) =>
    call<{ stage: StageState; me: MyStage }>('PATCH', at(cid, nid), s),
  end: (cid: string, nid: string) => call<null>('DELETE', at(cid, nid)),
  hand: (cid: string, nid: string, up: boolean) =>
    call<{ me: MyStage }>('POST', `${at(cid, nid)}/hand`, { up }),
  invite: (cid: string, nid: string, userId: string, invited = true) =>
    call<{ stage: StageState }>('POST', `${at(cid, nid)}/invite`, { userId, invited }),
  audience: (cid: string, nid: string, userId: string) =>
    call<{ stage: StageState }>('POST', `${at(cid, nid)}/audience`, { userId })
}

// Announcement nebulas (board 3b)
export const followApi = {
  targets: (nebulaId: string) =>
    call<{ targets: FollowTarget[] }>(
      'GET',
      `/constellations/announcements/targets?nebulaId=${encodeURIComponent(nebulaId)}`
    ),
  follow: (cid: string, nid: string, targetNebulaId: string) =>
    call<{ followId: string | null }>('POST', `/constellations/${cid}/nebulas/${nid}/follow`, {
      targetNebulaId
    }),
  followers: (cid: string, nid: string) =>
    call<{ followers: AnnouncementFollower[] }>(
      'GET',
      `/constellations/${cid}/nebulas/${nid}/followers`
    ),
  removeFollower: (cid: string, nid: string, followId: string) =>
    call<null>('DELETE', `/constellations/${cid}/nebulas/${nid}/followers/${followId}`),
  follows: (cid: string) =>
    call<{ follows: AnnouncementFollow[] }>('GET', `/constellations/${cid}/follows`),
  unfollow: (cid: string, followId: string) =>
    call<null>('DELETE', `/constellations/${cid}/follows/${followId}`)
}

export type OnStage = {
  constellationId: string
  nebulaId: string
  role: 'speaker' | 'listener'
  status: 'connecting' | 'on' | 'problem'
  micOn: boolean
  /** Speakers talking right now (LiveKit's active speakers) */
  speaking: string[]
  /** Speakers with their microphone off */
  muted: string[]
  problem: string | null
}

let current: OnStage | null = null
let room: Room | null = null
let pinger: ReturnType<typeof setInterval> | null = null
const audio = new Set<HTMLMediaElement>()
const listeners = new Set<() => void>()
const tell = (): void => listeners.forEach((l) => l())
const set = (next: OnStage | null): void => {
  current = next
  tell()
}
const patch = (p: Partial<OnStage>): void => {
  if (current) set({ ...current, ...p })
}

export function useOnStage(): OnStage | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}
export const onStageNow = (): OnStage | null => current

function mutedSpeakers(r: Room): string[] {
  const out: string[] = []
  for (const p of r.remoteParticipants.values()) {
    if (p.identity.startsWith('listen:')) continue
    const mic = p.getTrackPublication(Track.Source.Microphone)
    if (!mic || mic.isMuted) out.push(p.identity)
  }
  if (r.localParticipant.identity && !r.localParticipant.identity.startsWith('listen:')) {
    if (!r.localParticipant.isMicrophoneEnabled) out.push(r.localParticipant.identity)
  }
  return out
}

async function disconnect(): Promise<void> {
  const r = room
  room = null
  for (const el of audio) el.remove()
  audio.clear()
  if (r) await r.disconnect().catch(() => undefined)
}

async function connect(pass: StagePass, cid: string, nid: string): Promise<boolean> {
  await disconnect()
  const prefs = getCallPrefs()
  const r = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: audioCapture(prefs),
    ...(prefs.speakerId ? { audioOutput: { deviceId: prefs.speakerId } } : {})
  })
  room = r
  set({
    constellationId: cid,
    nebulaId: nid,
    role: pass.role,
    status: 'connecting',
    micOn: false,
    speaking: [],
    muted: [],
    problem: null
  })
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio) return
    const el = track.attach()
    el.style.display = 'none'
    document.body.append(el)
    audio.add(el)
  })
    .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      for (const el of track.detach()) {
        el.remove()
        audio.delete(el)
      }
    })
    .on(RoomEvent.ActiveSpeakersChanged, (people: Participant[]) =>
      patch({ speaking: people.map((p) => p.identity).filter((id) => !id.startsWith('listen:')) })
    )
    .on(RoomEvent.TrackMuted, () => patch({ muted: mutedSpeakers(r) }))
    .on(RoomEvent.TrackUnmuted, () => patch({ muted: mutedSpeakers(r) }))
    .on(RoomEvent.TrackPublished, () => patch({ muted: mutedSpeakers(r) }))
    .on(RoomEvent.ParticipantConnected, () => patch({ muted: mutedSpeakers(r) }))
    .on(RoomEvent.Disconnected, () => {
      if (room === r && current?.status === 'on')
        patch({ status: 'problem', problem: 'The stage connection dropped.' })
    })
  try {
    await r.connect(pass.url, pass.token, { autoSubscribe: true })
    if (room !== r) return false
    patch({ status: 'on', muted: mutedSpeakers(r) })
    pinger ??= setInterval(() => void ping(), STAGE_PING_MS)
    return true
  } catch {
    if (room === r)
      patch({ status: 'problem', problem: "Couldn't connect to the stage. Try again." })
    return false
  }
}

async function ping(): Promise<void> {
  const c = current
  if (!c) return
  const r = await call<{ me: MyStage; live: boolean }>(
    'POST',
    `${at(c.constellationId, c.nebulaId)}/ping`,
    {
      as: c.role
    }
  )
  if (current !== c && current?.nebulaId !== c.nebulaId) return
  if (r.ok && !r.data.live) await leaveStage(false)
}

/** Joins a stage (listening, or up as a speaker when allowed). Null when it worked. */
export async function joinStage(
  cid: string,
  nid: string,
  as: 'listener' | 'speaker'
): Promise<string | null> {
  const r = await call<StagePass>('POST', `${at(cid, nid)}/join`, { as })
  if (!r.ok) return r.message
  return (await connect(r.data, cid, nid)) ? null : "Couldn't connect to the stage. Try again."
}

/** Starts a stage (you're its host, up as a speaker). Null when it worked. */
export async function startStage(
  cid: string,
  nid: string,
  s: StageSettings & { topic: string }
): Promise<string | null> {
  const r = await stageApi.start(cid, nid, s)
  if (!r.ok) return r.message
  return (await connect(r.data, cid, nid)) ? null : "Couldn't connect to the stage. Try again."
}

export async function leaveStage(tellServer = true): Promise<void> {
  const c = current
  if (pinger) clearInterval(pinger)
  pinger = null
  set(null)
  await disconnect()
  if (c && tellServer) await call('POST', `${at(c.constellationId, c.nebulaId)}/leave`)
}

/** Speakers: the microphone on or off (the first time asks for it). Null when it worked. */
export async function setStageMic(on: boolean): Promise<string | null> {
  if (!room || current?.role !== 'speaker') return null
  try {
    await room.localParticipant.setMicrophoneEnabled(on)
    patch({ micOn: on, muted: mutedSpeakers(room) })
    return null
  } catch {
    return "Couldn't start your microphone. Check Settings → Voice & video."
  }
}

// The server's news about the stage I'm on: moved to the audience → listen instead; ended → leave.
window.glofly.onEvent((e) => {
  const c = current
  if (!c) return
  if (e.type === 'stage:moved' && e.nebulaId === c.nebulaId) {
    void joinStage(c.constellationId, c.nebulaId, 'listener')
  } else if (e.type === 'stage:updated' && e.nebulaId === c.nebulaId && e.stage === null) {
    void leaveStage(false)
  } else if (e.type === 'constellation:removed' && e.constellationId === c.constellationId) {
    void leaveStage(false)
  }
})
