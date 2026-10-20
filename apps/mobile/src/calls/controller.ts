import { PermissionsAndroid, Platform } from 'react-native'
import { tap } from '@/lib/haptics'
import { router } from 'expo-router'
import { create } from 'zustand'
import { Room, RoomEvent, Track, createLocalAudioTrack, type LocalAudioTrack, type LocalVideoTrack, type Participant, type RemoteTrack, type RemoteTrackPublication, type VideoTrack } from 'livekit-client'
import { RING_MS, chatTitle, type Call, type PublicUser } from '@glofly/shared'
import * as Native from 'glofly-native'
import * as api from '@/api/glofly'
import { keepConnected, onLive } from '@/api/realtime'
import { useSession, onSignOut } from '@/state/session'
import { setCall, upsertConversation, useStore } from '@/state/store'
import { refreshConversations } from '@/state/sync'
import { firstName } from '@/lib/format'
import { confirm, inform } from '@/ui/dialogs'
import { playSound, startLoop } from '@/push/sounds'
import { isQuietNow } from '@/state/quiet'
import { usePhonePrefs } from '@/state/prefs'
import { audioEngineInfo, setupWebRTC, startCallAudio, stopCallAudio } from './media'
import { APP_SETTINGS } from '@/lib/config'
import { cx } from '@/api/constellations'

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
  /** Glofly 2.0: the call is a voice nebula (drop-in, nobody rung), and which one */
  voice: VoiceNebula | null
}

/** A voice nebula you're in (Glofly 2.0). */
export type VoiceNebula = { constellationId: string; nebulaId: string; nebulaName: string; constellationName: string }

export const useCall = create<CallState>(() => ({
  call: null,
  connecting: false,
  tiles: [],
  micOn: true,
  cameraOn: false,
  frontCamera: true,
  incoming: null,
  toast: null,
  voice: null,
}))

let room: Room | null = null
let stopRing: (() => void) | null = null
let stopOutgoing: (() => void) | null = null
let ringTimer: ReturnType<typeof setTimeout> | null = null
let rejoinedOnce = false
const audioEls = new Map<string, HTMLMediaElement>()

// ---- Call diagnostics (long-press the call's title) ----
// A short log of what the call did, so one test call on a phone without a Mac shows where audio
// (or the camera) stops working.

const diagLog: string[] = []
let diagStart = Date.now()
export function diag(line: string) {
  const t = ((Date.now() - diagStart) / 1000).toFixed(1)
  diagLog.push(`${t}s ${line}`)
  if (diagLog.length > 60) diagLog.shift()
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Everything the diagnostics panel shows, as label → value rows plus the log. */
export function callDiagnostics(): { rows: [string, string][]; log: string[] } {
  const rows: [string, string][] = []
  const r = room
  rows.push(['room', r ? r.state : 'none'])
  if (r) {
    const lp = r.localParticipant
    const mic = lp.getTrackPublication(Track.Source.Microphone)
    rows.push(['my mic', mic ? `published, ${mic.isMuted ? 'muted' : 'on'}${mic.track?.mediaStreamTrack ? `, track ${mic.track.mediaStreamTrack.readyState}${mic.track.mediaStreamTrack.enabled ? '' : ' (disabled)'}` : ', no track'}` : 'not published'])
    rows.push(['my speaking', String(lp.isSpeaking)])
    const cam = lp.getTrackPublication(Track.Source.Camera)
    if (cam?.track) {
      const st = (cam.track.mediaStreamTrack as MediaStreamTrack & { getSettings?: () => Record<string, unknown> }).getSettings?.() ?? {}
      rows.push(['my camera', `${String(st.facingMode ?? '?')} ${String(st.width ?? '?')}×${String(st.height ?? '?')}`])
    }
    for (const p of r.remoteParticipants.values()) {
      const name = peopleName(p.identity)
      const pubs = [...p.audioTrackPublications.values()] as RemoteTrackPublication[]
      if (!pubs.length) rows.push([`${name} audio`, 'nothing published'])
      for (const pub of pubs) {
        const mst = pub.track?.mediaStreamTrack
        rows.push([
          `${name} audio`,
          `${pub.isSubscribed ? 'subscribed' : 'NOT subscribed'}, ${pub.isMuted ? 'muted' : 'unmuted'}, ${pub.isEnabled ? 'enabled' : 'DISABLED'}${mst ? `, track ${mst.readyState}${mst.enabled ? '' : ' (off)'}${mst.muted ? ' (no data)' : ''}` : ', no track'}`,
        ])
      }
      rows.push([`${name} speaking`, String(p.isSpeaking)])
    }
  }
  for (const [k, v] of Object.entries(audioEngineInfo())) rows.push([k, v])
  for (const [k, v] of Object.entries(Native.audioSessionInfo())) rows.push([`session ${k}`, v])
  return { rows, log: [...diagLog] }
}

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
  const voice = useCall.getState().voice
  if (voice) return `${voice.nebulaName} · ${voice.constellationName}`
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
  diagStart = Date.now()
  diagLog.length = 0
  diag(`connect (${video ? 'video' : 'voice'})`)
  setupWebRTC()
  await startCallAudio(video)
  diag('audio policy set')
  // iPhone: the mic is opened before joining, so the call's audio engine starts with the mic and
  // the speaker together. Joining first meant the other person's voice started the engine in
  // "listen only", and turning the mic on a moment later restarted it (and their voice went
  // silent after a second).
  let mic: LocalAudioTrack | null = null
  if (Platform.OS === 'ios') {
    try {
      mic = await createLocalAudioTrack({ echoCancellation: true, noiseSuppression: true, autoGainControl: true })
      diag('mic opened')
    } catch (e) {
      diag(`mic failed: ${errText(e)}`)
    }
  }
  const r = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  room = r
  r.on(RoomEvent.ParticipantConnected, (p) => {
    refreshTiles()
    if (useCall.getState().call && room?.remoteParticipants.size && p.identity !== me()) {
      if (stopOutgoing) {
        stopOutgoing()
        stopOutgoing = null
        tap.firm() // 0.7.5: the call connected
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
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, p) => diag(`subscribed ${peopleName(p.identity)} ${track.kind}`))
  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub, p) => diag(`unsubscribed ${peopleName(p.identity)} ${track.kind}`))
  r.on(RoomEvent.TrackSubscriptionFailed, (_sid, p, reason) => diag(`subscribe FAILED ${peopleName(p.identity)} ${String(reason ?? '')}`))
  r.on(RoomEvent.TrackMuted, (pub, p) => diag(`${p === r.localParticipant ? 'me' : peopleName(p.identity)} muted ${pub.kind}`))
  r.on(RoomEvent.TrackUnmuted, (pub, p) => diag(`${p === r.localParticipant ? 'me' : peopleName(p.identity)} unmuted ${pub.kind}`))
  r.on(RoomEvent.LocalTrackPublished, (pub) => diag(`published my ${pub.source}`))
  r.on(RoomEvent.MediaDevicesError, (e) => diag(`device error: ${errText(e)}`))
  r.on(RoomEvent.AudioPlaybackStatusChanged, (ok: boolean) => diag(`audio playback allowed: ${ok}`))
  r.on(RoomEvent.Reconnecting, () => diag('reconnecting'))
  r.on(RoomEvent.Reconnected, () => diag('reconnected'))
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
        const voice = useCall.getState().voice
        const again = voice ? await cx.joinVoice(voice.constellationId, voice.nebulaId) : await api.joinCall(call.id)
        if (again.ok && useCall.getState().call?.id === call.id) {
          room = null
          await connect(again.data, useCall.getState().cameraOn)
        } else cleanup('The call dropped.')
      })()
    } else cleanup('The call dropped.')
  })
  try {
    await r.connect(join.url, join.token, { autoSubscribe: true })
  } catch (e) {
    diag(`join failed: ${errText(e)}`)
    mic?.stop()
    throw e
  }
  diag('joined the room')
  // 0.7.5: answering a call that's already going: a firm tap as it connects.
  if (r.remoteParticipants.size > 0) tap.firm()
  const micOn = mic
    ? r.localParticipant.publishTrack(mic).then(() => undefined)
    : r.localParticipant.setMicrophoneEnabled(true).then(() => undefined)
  await micOn.catch((e) => {
    diag(`mic publish failed: ${errText(e)}`)
    mic?.stop()
    useCall.setState({ micOn: false })
    // iPhone asks for the microphone the first time; if it was refused, say where to allow it.
    if (Platform.OS === 'ios') void inform("Glofly can't use your microphone", 'Allow it in Settings → Glofly → Microphone.')
  })
  if (video)
    await r.localParticipant.setCameraEnabled(true, { facingMode: 'user' }).catch((e) => {
      diag(`camera failed: ${errText(e)}`)
      useCall.setState({ cameraOn: false })
    })
  refreshTiles()
  Native.startOngoingCall(join.call.id, join.call.conversationId, title(join.call), video)
  if (video) Native.keepScreenOn(true)
}

function cleanup(message?: string) {
  const ending = useCall.getState().call
  if (ending) Native.endCallKitCall(ending.id) // iPhone: iOS's call screen ends too
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
  useCall.setState({ call: null, connecting: false, tiles: [], micOn: true, cameraOn: false, frontCamera: true, voice: null })
  if (had && usePhonePrefs.getState().sounds) playSound('ended', 0.8)
  if (message) toast(message)
}

/**
 * 0.7.3: one start at a time. A second tap on Call while the first was still waiting on the
 * microphone permission prompt used to start a second call (two ringing calls).
 */
let entering = false

async function enter(request: () => ReturnType<typeof api.startCall>, video: boolean, outgoing: boolean, voice: VoiceNebula | null = null) {
  if (entering) return
  entering = true
  try {
    await enterOnce(request, video, outgoing, voice)
  } finally {
    entering = false
  }
}

async function enterOnce(request: () => ReturnType<typeof api.startCall>, video: boolean, outgoing: boolean, voice: VoiceNebula | null) {
  if (useCall.getState().call) return void inform("You're already in a call", 'Hang up first to start another.')
  // Buttons show it's starting (and can't be pressed again) while the permission prompt is up.
  useCall.setState({ connecting: true })
  if (!(await permissions(video))) {
    if (!useCall.getState().call) useCall.setState({ connecting: false })
    return
  }
  useCall.setState({ connecting: true, cameraOn: video, micOn: true, voice })
  keepConnected('call', true)
  const r = await request()
  if (!r.ok) {
    useCall.setState({ connecting: false, voice: null })
    keepConnected('call', false)
    return void inform(r.error === 'conflict' ? "Can't call right now" : voice ? "Couldn't join voice" : "Couldn't connect the call", r.message)
  }
  setCall(r.data.call, null)
  useCall.setState({ call: r.data.call })
  // A voice nebula opens its stage on the night side (Glofly 2.0); a call, the call screen.
  if (voice) router.push('/constellations/voice')
  else router.push('/call')
  try {
    await connect(r.data, video)
  } catch {
    void api.leaveCall(r.data.call.id)
    cleanup("Couldn't connect the call. Check your connection.")
    return
  } finally {
    useCall.setState({ connecting: false })
  }
  // The outgoing jingle starts once the call's own audio is running (not while it's starting up),
  // and only if nobody has picked up in the meantime.
  if (
    outgoing &&
    r.data.call.status === 'ringing' &&
    usePhonePrefs.getState().sounds &&
    useCall.getState().call?.id === r.data.call.id &&
    !room?.remoteParticipants.size
  ) {
    stopOutgoing = startLoop('outgoing')
  }
}

// ---- What the screens call ----

/**
 * Drop into a voice nebula (Glofly 2.0): nobody is rung. Already in another call: leave it first.
 * Already in this one: just show its stage.
 */
export async function joinVoiceNebula(voice: VoiceNebula, video = false): Promise<void> {
  const s = useCall.getState()
  if (s.voice?.nebulaId === voice.nebulaId && s.call) {
    router.push('/constellations/voice')
    return
  }
  if (s.call) {
    const ok = await confirm({ title: s.voice ? `Leave ${s.voice.nebulaName}?` : 'Leave your call?', message: `You'll join ${voice.nebulaName} instead.`, confirmLabel: 'Switch' })
    if (!ok) return
    await hangUp()
  }
  await enter(() => cx.joinVoice(voice.constellationId, voice.nebulaId), video, false, voice)
}

/** `ring` (groups, 0.5.2): only these people are rung; the rest of the group can join. */
export async function startCallIn(conversationId: string, video: boolean, ring?: string[]): Promise<void> {
  const active = useStore.getState().calls[conversationId]
  if (active) return joinCallIn(conversationId, video)
  await enter(() => api.startCall(conversationId, video, ring), video, true)
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

export async function answer(video: boolean, fromCallKit = false): Promise<void> {
  const inc = useCall.getState().incoming
  if (!inc) return
  stopRinging()
  useCall.setState({ incoming: null })
  Native.cancelCallNotification(inc.call.id)
  // iPhone: answered on Glofly's own card while the lock-screen call was also ringing: stop that.
  if (!fromCallKit) Native.callKitAnsweredInApp(inc.call.id)
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
  Native.endCallKitCall(inc.call.id)
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
  const facingMode = front ? 'user' : 'environment'
  try {
    // Restart the camera track with the other camera (the old in-place _switchCamera did nothing:
    // iPhone's applyConstraints only changes size and frame rate). Phones: by the camera's device id
    // AND which way it faces. With only the id, iPhone's WebRTC kept thinking it was on the front
    // camera; with only facingMode, LiveKit fills in deviceId "default", which iPhone has no camera
    // for. The mirror follows only once the switch worked.
    const deviceId = Platform.OS === 'web' ? undefined : await cameraFor(front)
    diag(`flip to ${facingMode}: device ${deviceId ?? 'not found'}`)
    if (Platform.OS !== 'web' && !deviceId) throw new Error(`no ${front ? 'front' : 'back'} camera found`)
    await track.restartTrack(deviceId ? { deviceId: { exact: deviceId }, facingMode } : { facingMode })
    const st = (track.mediaStreamTrack as MediaStreamTrack & { getSettings?: () => Record<string, unknown> }).getSettings?.()
    diag(`flip done, camera now ${String(st?.facingMode ?? '?')}`)
    useCall.setState({ frontCamera: front })
    refreshTiles()
  } catch (e) {
    diag(`flip failed: ${errText(e)}`)
    toast("Couldn't switch cameras.")
  }
}

/** Ring more people into a group call (Add people before 0.5.2; kept for the same route). */
export async function ringPeople(userIds: string[]) {
  const call = useCall.getState().call
  if (!call || !userIds.length) return
  const r = await api.ringMore(call.id, userIds)
  if (!r.ok) void inform("Couldn't ring them", r.message)
}

/**
 * Add people (0.5.2). 1-on-1: the call carries on in a new group with everyone (nobody drops
 * out); groups: they're rung (friends not in the group join it first). Null if it worked, else why not.
 */
export async function addPeople(userIds: string[]): Promise<string | null> {
  const call = useCall.getState().call
  if (!call || !userIds.length) return null
  const r = await api.addToCall(call.id, userIds)
  if (!r.ok) return r.message
  upsertConversation(r.data.conversation)
  setCall(r.data.call, null)
  if (useCall.getState().call?.id === r.data.call.id) useCall.setState({ call: r.data.call })
  return null
}

/** Group calls on your own (0.5.2): keep the call going another 7 minutes. */
export async function stayInCall() {
  const call = useCall.getState().call
  if (call) await api.stayInCall(call.id)
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
  const silent = useStore.getState().myStatus?.status === 'dnd' || !usePhonePrefs.getState().sounds || isQuietNow(true)
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
    Native.endCallKitCall(call.id)
  } else if (!s.call && ringingForMe(call)) showIncoming(call, caller)

  // The call you're in.
  if (s.call?.id !== call.id) return
  // Add people (0.5.2) moved it to a new group: the call screen follows (once the group's here).
  if (call.conversationId !== s.call.conversationId && !useStore.getState().conversations[call.conversationId]) {
    void refreshConversations()
  }
  useCall.setState({ call })
  const meIn = call.members.find((m) => m.userId === me())?.state === 'joined'
  // A voice nebula (Glofly 2.0): out of it without hanging up = a moderator disconnected you, or
  // you joined it on another device.
  if (s.voice && !meIn && room && call.status === 'ongoing') {
    cleanup(`You're no longer in ${s.voice.nebulaName}.`)
    return
  }
  if (call.status === 'ended' || call.status === 'missed' || call.status === 'declined') {
    const others = call.members.filter((m) => m.userId !== me())
    const isDm = others.length === 1
    if (call.endReason === 'alone') cleanup('The call ended because nobody else was in it for 7 minutes.')
    else if (call.callerId === me() && !call.answeredAt && isDm) {
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
  // iPhone lock-screen calls (CallKit): answered there (now, or before the app had started).
  const takeAnswer = () => {
    const a = Native.takeCallKitAnswer()
    if (a) void openIncomingFromLink(a.callId, true, a.video === '1', true)
  }
  Native.onNativeEvent('callAnswer', takeAnswer)
  takeAnswer()
  // Hung up on iOS's call screen.
  Native.onNativeEvent('callEnd', ({ callId }) => {
    if (useCall.getState().call?.id === callId) void hangUp()
  })
  // Declined on the lock screen (the native side already told the server).
  Native.onNativeEvent('callDeclined', ({ callId }) => {
    if (useCall.getState().incoming?.call.id !== callId) return
    stopRinging()
    useCall.setState({ incoming: null })
  })
  // Muted / unmuted on iOS's call screen.
  Native.onNativeEvent('callMute', ({ muted }) => {
    if (useCall.getState().call) void setMic(muted !== '1')
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
export async function openIncomingFromLink(callId: string, answerNow: boolean, video: boolean, fromCallKit = false) {
  const r = await api.activeCalls()
  const found = r.ok ? r.data.find((a) => a.call.id === callId) : undefined
  Native.cancelCallNotification(callId)
  if (!found || !ringingForMe(found.call)) {
    Native.showOverLockScreen(false)
    if (fromCallKit) Native.endCallKitCall(callId) // it stopped ringing meanwhile
    if (found?.call.conversationId) router.replace({ pathname: '/chat/[id]', params: { id: found.call.conversationId } })
    else void inform('That call is over')
    return
  }
  setCall(found.call, null)
  showIncoming(found.call, null)
  if (answerNow) await answer(video, fromCallKit)
}

export async function confirmLeaveIfInCall(): Promise<boolean> {
  if (!useCall.getState().call) return true
  return confirm({ title: 'Leave the call?', confirmLabel: 'Leave call', danger: true })
}

