import { PermissionsAndroid, Platform } from 'react-native'
import { router } from 'expo-router'
import { create } from 'zustand'
import { Room, RoomEvent, Track, type LocalVideoTrack, type Participant, type RemoteTrack, type VideoTrack } from 'livekit-client'
import { RING_MS, chatTitle, type Call, type PublicUser } from '@glofly/shared'
import * as Native from 'glofly-native'
import * as api from '@/api/glofly'
import { keepConnected, onLive } from '@/api/realtime'
import { useSession, onSignOut } from '@/state/session'
import { setCall, useStore } from '@/state/store'
import { firstName } from '@/lib/format'
import { confirm, inform } from '@/ui/dialogs'
import { playSound, setCallAudioMode, startLoop } from '@/push/sounds'
import { usePhonePrefs } from '@/state/prefs'
import { setupWebRTC, startCallAudio, stopCallAudio } from './media'
import { APP_SETTINGS } from '@/lib/config'

// Calls: starting, answering and leaving, the LiveKit room, ringing in the app, and the
// "Call in progress" service that keeps a call going when Glofly leaves the screen.

export type Tile = {
  userId: string
  local: boolean
  camera: VideoTrack | null
  screen: VideoTrack | null
  micMuted: boolean
  speaking: boolean
}

type CallState = {
  /** The call you're in (or calling out on). */
  call: Call | null
  connecting: boolean
  tiles: Tile[]
  micOn: boolean
  cameraOn: boolean
  frontCamera: boolean
  /** Someone calling you, while you're not in a call. */
  incoming: { call: Call; caller: PublicUser | null } | null
  /** A short message at the bottom ("Jacob didn't pick up."). */
  toast: string | null
}

export const useCall = create<CallState>(() => ({
  call: null,
  connecting: false,
  tiles: [],
  micOn: true,
  cameraOn: false,
  frontCamera: true,
  incoming: null,
  toast: null,
}))

let room: Room | null = null
let stopRing: (() => void) | null = null
let stopOutgoing: (() => void) | null = null
let ringTimer: ReturnType<typeof setTimeout> | null = null
let rejoinedOnce = false
const audioEls = new Map<string, HTMLMediaElement>()

const me = () => useSession.getState().user?.id ?? ''
const peopleName = (id: string) => {
  const p = useStore.getState().people[id]
  return p ? firstName(p.displayName, p.username) : 'They'
}

function toast(text: string) {
  useCall.setState({ toast: text })
  setTimeout(() => {
    if (useCall.getState().toast === text) useCall.setState({ toast: null })
  }, 4000)
}

async function permissions(video: boolean): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  const wanted = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, ...(video ? [PermissionsAndroid.PERMISSIONS.CAMERA] : [])]
  const result = await PermissionsAndroid.requestMultiple(wanted)
  if (result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED) {
    void inform("Glofly can't use your microphone", `Allow it in ${APP_SETTINGS} to make calls.`)
    return false
  }
  return true
}

function title(call: Call): string {
  const chat = useStore.getState().conversations[call.conversationId]
  return chat ? chatTitle(chat) : 'Glofly call'
}

// ---- Tiles from the LiveKit room ----

function refreshTiles() {
  if (!room) return useCall.setState({ tiles: [] })
  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()]
  const tiles: Tile[] = all.map((p) => {
    const cam = p.getTrackPublication(Track.Source.Camera)
    const screen = p.getTrackPublication(Track.Source.ScreenShare)
    const mic = p.getTrackPublication(Track.Source.Microphone)
    return {
      userId: p.identity,
      local: p === room!.localParticipant,
      camera: cam?.track && !cam.isMuted ? (cam.track as VideoTrack) : null,
      screen: screen?.track && !screen.isMuted ? (screen.track as VideoTrack) : null,
      micMuted: !mic || mic.isMuted,
      speaking: p.isSpeaking,
    }
  })
  useCall.setState({ tiles })
}

async function connect(join: { token: string; url: string; call: Call }, video: boolean) {
  setupWebRTC()
  setCallAudioMode(true)
  await startCallAudio(video)
  const r = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  room = r
  r.on(RoomEvent.ParticipantConnected, (p) => {
    refreshTiles()
    if (useCall.getState().call && room?.remoteParticipants.size && p.identity !== me()) {
      if (stopOutgoing) {
        stopOutgoing()
        stopOutgoing = null
        if (usePhonePrefs.getState().sounds) playSound('connected')
      } else if ((useCall.getState().call?.members.length ?? 0) > 2 && usePhonePrefs.getState().sounds) playSound('joined', 0.7)
    }
  })
  r.on(RoomEvent.ParticipantDisconnected, () => {
    refreshTiles()
    if ((useCall.getState().call?.members.length ?? 0) > 2 && usePhonePrefs.getState().sounds) playSound('left', 0.7)
  })
  for (const ev of [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged]) {
    r.on(ev, () => refreshTiles())
  }
  if (Platform.OS === 'web') {
    // Browsers need an <audio> element per voice (phones play them by themselves).
    r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
      if (track.kind !== Track.Kind.Audio) return
      const el = track.attach()
      audioEls.set(track.sid ?? String(Math.random()), el)
      document.body.appendChild(el)
    })
  }
  r.on(RoomEvent.Disconnected, () => {
    // Dropped (not by us): try once to get back in, like the desktop app.
    const call = useCall.getState().call
    if (!call || room !== r) return
    if (!rejoinedOnce) {
      rejoinedOnce = true
      void (async () => {
        const again = await api.joinCall(call.id)
        if (again.ok && useCall.getState().call?.id === call.id) {
          room = null
          await connect(again.data, useCall.getState().cameraOn)
        } else cleanup('The call dropped.')
      })()
    } else cleanup('The call dropped.')
  })
  await r.connect(join.url, join.token, { autoSubscribe: true })
  await r.localParticipant.setMicrophoneEnabled(true).catch(() => {
    useCall.setState({ micOn: false })
    // iPhone asks for the microphone the first time; if it was refused, say where to allow it.
    if (Platform.OS === 'ios') void inform("Glofly can't use your microphone", 'Allow it in Settings → Glofly → Microphone.')
  })
  if (video) await r.localParticipant.setCameraEnabled(true, { facingMode: 'user' }).catch(() => useCall.setState({ cameraOn: false }))
  refreshTiles()
  Native.startOngoingCall(join.call.id, join.call.conversationId, title(join.call), video)
  if (video) Native.keepScreenOn(true)
}

function cleanup(message?: string) {
  const r = room
  room = null
  rejoinedOnce = false
  stopOutgoing?.()
  stopOutgoing = null
  if (r) void r.disconnect()
  for (const el of audioEls.values()) el.remove()
  audioEls.clear()
  void stopCallAudio()
  Native.stopOngoingCall()
  Native.keepScreenOn(false)
  keepConnected('call', false)
  const had = !!useCall.getState().call
  useCall.setState({ call: null, connecting: false, tiles: [], micOn: true, cameraOn: false, frontCamera: true })
  setCallAudioMode(false)
  if (had && usePhonePrefs.getState().sounds) playSound('ended', 0.8)
  if (message) toast(message)
}

async function enter(request: () => ReturnType<typeof api.startCall>, video: boolean, outgoing: boolean) {
  if (useCall.getState().call) return void inform("You're already in a call", 'Hang up first to start another.')
  if (!(await permissions(video))) return
  useCall.setState({ connecting: true, cameraOn: video, micOn: true })
  keepConnected('call', true)
  const r = await request()
  if (!r.ok) {
    useCall.setState({ connecting: false })
    keepConnected('call', false)
    return void inform(r.error === 'conflict' ? "Can't call right now" : "Couldn't connect the call", r.message)
  }
  setCall(r.data.call, null)
  useCall.setState({ call: r.data.call })
  router.push('/call')
  setCallAudioMode(true) // before the jingle, so it doesn't take the audio session from the call
  if (outgoing && r.data.call.status === 'ringing' && usePhonePrefs.getState().sounds) stopOutgoing = startLoop('outgoing')
  try {
    await connect(r.data, video)
  } catch {
    void api.leaveCall(r.data.call.id)
    cleanup("Couldn't connect the call. Check your connection.")
    return
  } finally {
    useCall.setState({ connecting: false })
  }
}

// ---- What the screens call ----

export async function startCallIn(conversationId: string, video: boolean): Promise<void> {
  const active = useStore.getState().calls[conversationId]
  if (active) return joinCallIn(conversationId, video)
  await enter(() => api.startCall(conversationId, video), video, true)
}

export async function startCallWith(userId: string, video: boolean): Promise<void> {
  const dm = Object.values(useStore.getState().conversations).find((c) => c.kind === 'dm' && c.partner.id === userId)
  if (dm) return startCallIn(dm.id, video)
  const r = await api.openDm(userId)
  if (!r.ok) return void inform("Couldn't start the call", r.message)
  useStore.setState({ conversations: { ...useStore.getState().conversations, [r.data.id]: r.data } })
  await startCallIn(r.data.id, video)
}

export async function joinCallIn(conversationId: string, video: boolean): Promise<void> {
  const call = useStore.getState().calls[conversationId]
  if (!call) return void inform('That call is over')
  await enter(() => api.joinCall(call.id), video, false)
}

export async function answer(video: boolean): Promise<void> {
  const inc = useCall.getState().incoming
  if (!inc) return
  stopRinging()
  useCall.setState({ incoming: null })
  Native.cancelCallNotification(inc.call.id)
  Native.showOverLockScreen(false)
  await enter(() => api.answerCall(inc.call.id), video, false)
}

export async function decline(withMessage?: string): Promise<void> {
  const inc = useCall.getState().incoming
  if (!inc) return
  stopRinging()
  useCall.setState({ incoming: null })
  Native.cancelCallNotification(inc.call.id)
  Native.showOverLockScreen(false)
  if (withMessage) await api.sendMessage(inc.call.conversationId, withMessage)
  await api.declineCall(inc.call.id)
}

export async function hangUp(): Promise<void> {
  const call = useCall.getState().call
  if (!call) return
  cleanup()
  await api.leaveCall(call.id)
}

export async function setMic(on: boolean) {
  useCall.setState({ micOn: on })
  await room?.localParticipant.setMicrophoneEnabled(on).catch(() => useCall.setState({ micOn: !on }))
  refreshTiles()
}

export async function setCamera(on: boolean) {
  if (on && Platform.OS === 'android') {
    const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA)
    if (r !== PermissionsAndroid.RESULTS.GRANTED) return void inform("Glofly can't use your camera", `Allow it in ${APP_SETTINGS}.`)
  }
  useCall.setState({ cameraOn: on })
  await room?.localParticipant.setCameraEnabled(on, { facingMode: useCall.getState().frontCamera ? 'user' : 'environment' }).catch(() => {
    useCall.setState({ cameraOn: !on })
    if (on && Platform.OS === 'ios') void inform("Glofly can't use your camera", 'Allow it in Settings → Glofly → Camera.')
  })
  Native.keepScreenOn(on)
  refreshTiles()
}

/** The other camera's device id on a phone (react-native-webrtc labels them "front" / "environment"). */
async function cameraFor(front: boolean): Promise<string | undefined> {
  try {
    const devices = (await navigator.mediaDevices.enumerateDevices()) as (MediaDeviceInfo & { facing?: string })[]
    const cams = devices.filter((d) => d.kind === 'videoinput')
    const want = front ? 'front' : 'environment'
    return (cams.find((d) => d.facing === want) ?? cams.find((d) => (front ? /front/i : /back|rear/i).test(d.label)))?.deviceId
  } catch {
    return undefined
  }
}

export async function flipCamera() {
  const front = !useCall.getState().frontCamera
  const pub = room?.localParticipant.getTrackPublication(Track.Source.Camera)
  const track = pub?.track as LocalVideoTrack | undefined
  if (!track) return void useCall.setState({ frontCamera: front })
  try {
    // Restart the camera track with the other camera (by its device id on phones, which is what
    // actually switches it; the old in-place _switchCamera did nothing on newer WebRTC, so only
    // the picture's mirroring flipped). The mirror follows only once the switch worked.
    const deviceId = Platform.OS === 'web' ? undefined : await cameraFor(front)
    await track.restartTrack(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: front ? 'user' : 'environment' })
    useCall.setState({ frontCamera: front })
    refreshTiles()
  } catch {
    /* only one camera: stay as it was */
  }
}

/** Ring more people into a group call (Add people). */
export async function ringPeople(userIds: string[]) {
  const call = useCall.getState().call
  if (!call || !userIds.length) return
  const r = await api.ringMore(call.id, userIds)
  if (!r.ok) void inform("Couldn't ring them", r.message)
}

// ---- Ringing for you ----

function stopRinging() {
  stopRing?.()
  stopRing = null
  if (ringTimer) clearTimeout(ringTimer)
  ringTimer = null
}

function ringingForMe(call: Call): string | null {
  const m = call.members.find((x) => x.userId === me())
  return m?.state === 'ringing' && call.callerId !== me() ? (m.ringingUntil ?? new Date(Date.now() + RING_MS).toISOString()) : null
}

export function showIncoming(call: Call, caller: PublicUser | null) {
  if (useCall.getState().call) return // busy: the server already told them
  const until = ringingForMe(call)
  if (!until) return
  const left = new Date(until).getTime() - Date.now()
  if (left <= 0) return
  const already = useCall.getState().incoming?.call.id === call.id
  useCall.setState({ incoming: { call, caller: caller ?? useStore.getState().callers[call.id] ?? null } })
  if (already) return
  const silent = useStore.getState().myStatus?.status === 'dnd' || !usePhonePrefs.getState().sounds
  stopRinging()
  if (!silent) stopRing = startLoop('ringtone')
  ringTimer = setTimeout(() => {
    stopRinging()
    if (useCall.getState().incoming?.call.id === call.id) useCall.setState({ incoming: null })
  }, left)
}

function onCallUpdated(call: Call, caller: PublicUser | null) {
  const s = useCall.getState()
  // Ringing for you?
  if (s.incoming?.call.id === call.id && !ringingForMe(call)) {
    stopRinging()
    useCall.setState({ incoming: null })
    Native.cancelCallNotification(call.id)
  } else if (!s.call && ringingForMe(call)) showIncoming(call, caller)

  // The call you're in.
  if (s.call?.id !== call.id) return
  useCall.setState({ call })
  const meIn = call.members.find((m) => m.userId === me())?.state === 'joined'
  if (call.status === 'ended' || call.status === 'missed' || call.status === 'declined') {
    const others = call.members.filter((m) => m.userId !== me())
    const isDm = others.length === 1
    if (call.callerId === me() && !call.answeredAt && isDm) {
      if (usePhonePrefs.getState().sounds) playSound('noAnswer')
      cleanup(`${peopleName(others[0].userId)} didn't pick up.`)
    } else cleanup()
  } else if (!meIn && call.status === 'ongoing' && !room) {
    cleanup('Your call moved to another device.')
  }
}

let started = false
export function startCalls() {
  if (started) return
  started = true
  onLive((event, payload) => {
    if (event !== 'call:updated') return
    const { call, caller } = payload as { call: Call; caller: PublicUser | null }
    onCallUpdated(call, caller)
  })
  Native.onNativeEvent('hangUp', () => {
    if (useCall.getState().call) cleanup()
  })
  // Calls found when the app opens or reconnects (refreshCalls) can be ringing for you too.
  useStore.subscribe((st, prev) => {
    if (st.calls === prev.calls) return
    for (const call of Object.values(st.calls)) if (ringingForMe(call) && useCall.getState().incoming?.call.id !== call.id) showIncoming(call, null)
  })
  onSignOut(() => {
    stopRinging()
    cleanup()
    useCall.setState({ incoming: null, toast: null })
  })
}

/** From a notification link (glofly://incoming/<callId>): show the incoming card, or answer. */
export async function openIncomingFromLink(callId: string, answerNow: boolean, video: boolean) {
  const r = await api.activeCalls()
  const found = r.ok ? r.data.find((a) => a.call.id === callId) : undefined
  Native.cancelCallNotification(callId)
  if (!found || !ringingForMe(found.call)) {
    Native.showOverLockScreen(false)
    if (found?.call.conversationId) router.replace({ pathname: '/chat/[id]', params: { id: found.call.conversationId } })
    else void inform('That call is over')
    return
  }
  setCall(found.call, null)
  showIncoming(found.call, null)
  if (answerNow) await answer(video)
}

export async function confirmLeaveIfInCall(): Promise<boolean> {
  if (!useCall.getState().call) return true
  return confirm({ title: 'Leave the call?', confirmLabel: 'Leave call', danger: true })
}

