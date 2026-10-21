import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

// Glofly's own native code: Kotlin on Android (modules/glofly-native/android), Swift on iPhone
// (modules/glofly-native/ios; Android-only calls are safe no-ops there). The web preview gets
// stand-ins so the app can be tried in a browser.

type Native = {
  getPushToken(): Promise<string | null>
  configurePush(config: PushConfig): void
  clearPush(): void
  cancelChatNotification(conversationId: string): void
  cancelCallNotification(callId: string): void
  showOverLockScreen(on: boolean): void
  keepScreenOn(on: boolean): void
  startOngoingCall(callId: string, conversationId: string, title: string, video: boolean): void
  stopOngoingCall(): void
  addListener(event: string, fn: (body: Record<string, string>) => void): { remove(): void }
  notificationsEnabled(): boolean
  /** iPhone only: 'granted' | 'denied' | 'unknown' (not asked yet). */
  notificationStatus?(): Promise<string>
  /** iPhone only: asks for notifications (once; later calls return the answer). */
  requestNotifications?(): Promise<boolean>
  /** iPhone only: the screen a notification tapped before the app was ready should open. */
  takeLaunchLink?(): string | null
  openNotificationSettings(): boolean
  canUseFullScreenIntent(): boolean
  openFullScreenIntentSettings(): boolean
  startVoice(): Promise<void>
  voiceLevel(): number
  stopVoice(): Promise<{ uri: string; durationMs: number; mime: string; size: number } | null>
  cancelVoice(): void
  /** iPhone only: call sounds that leave the call's audio session alone (CallTones.swift). */
  playCallTone?(name: string, repeating: boolean, volume: number): boolean
  stopCallTone?(): void
  /** iPhone only: Apple's VoIP push token for lock-screen calls ("sandbox:" in front on dev builds). */
  voipToken?(): string | null
  /** iPhone only: a call answered on the lock screen, waiting for the app (cleared by taking it). */
  takeCallKitAnswer?(): { callId: string; video: string } | null
  /** iPhone only: ends the lock-screen call for this call (it ended or stopped ringing). */
  endCallKitCall?(callId: string): void
  /** iPhone only: answered on Glofly's own Incoming card, so the lock-screen ringing stops. */
  callKitAnsweredInApp?(callId: string): void
  /** iPhone only: iOS's shared audio session right now (call diagnostics). */
  audioSessionInfo?(): Record<string, string>
  /** iPhone only: keep the call on the speaker unless headphones / Bluetooth are in use (CallSpeaker.swift). */
  keepCallOnSpeaker?(on: boolean): void
  stopCallSpeaker?(): void
  /** iPhone only: where the call plays now: speaker | earpiece | headset | bluetooth | car | airplay | other | none. */
  callAudioRoute?(): string
  /** The picked message sound and ringtone (native names, see @glofly/shared PHONE_*). Builds from Oct 13. */
  setSounds?(message: string, ringtone: string): void
  /** Android only (iPhone uses LiveKit's video view): picture-in-picture during calls (Pip.kt). */
  pipSupported?(): boolean
  setPipCall?(on: boolean, width: number, height: number): void
  enterPip?(): boolean
  isInPip?(): boolean
  /** 0.8.0 keyboard shortcuts (iPad, Android tablets / Chromebooks): the commands the app can do right now. */
  setKeyCommands?(ids: string[]): void
}

const native = requireOptionalNativeModule<Native>('GloflyNative')

export type PushConfig = {
  serverUrl: string
  token: string
  version: string
  platform: string
  meId: string
  meName: string
  meAvatar: string | null
  vibrate: boolean
}

export type Recording = { uri: string; durationMs: number; mime: string; size: number }

// ---- Voice messages ----

type WebState = { recorder: MediaRecorder; chunks: Blob[]; started: number; analyser: AnalyserNode; stream: MediaStream; ctx: AudioContext; buf: Uint8Array<ArrayBuffer> }
let web: WebState | null = null

export async function startVoice(): Promise<void> {
  if (native) return native.startVoice()
  if (Platform.OS !== 'web') throw new Error('Voice messages need the Glofly app')
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
  const recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 32000 })
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  ctx.createMediaStreamSource(stream).connect(analyser)
  const state: WebState = { recorder, chunks: [], started: Date.now(), analyser, stream, ctx, buf: new Uint8Array(new ArrayBuffer(analyser.fftSize)) }
  recorder.ondataavailable = (e) => e.data.size && state.chunks.push(e.data)
  recorder.start(250)
  web = state
}

export function voiceLevel(): number {
  if (native) return native.voiceLevel()
  if (!web) return 0
  web.analyser.getByteTimeDomainData(web.buf)
  let peak = 0
  for (const v of web.buf) peak = Math.max(peak, Math.abs(v - 128) / 128)
  return Math.min(1, peak * 1.4)
}

export async function stopVoice(): Promise<Recording | null> {
  if (native) return native.stopVoice()
  const s = web
  web = null
  if (!s) return null
  const done = new Promise<void>((resolve) => (s.recorder.onstop = () => resolve()))
  s.recorder.stop()
  await done
  s.stream.getTracks().forEach((t) => t.stop())
  void s.ctx.close()
  const blob = new Blob(s.chunks, { type: 'audio/webm' })
  if (!blob.size) return null
  return { uri: URL.createObjectURL(blob), durationMs: Date.now() - s.started, mime: 'audio/webm', size: blob.size }
}

export function cancelVoice(): void {
  if (native) return native.cancelVoice()
  const s = web
  web = null
  if (!s) return
  s.recorder.onstop = null
  try {
    s.recorder.stop()
  } catch {
    /* already stopped */
  }
  s.stream.getTracks().forEach((t) => t.stop())
  void s.ctx.close()
}

export const hasNative = !!native

// ---- Notifications and lock-screen calls ----

export const notificationsEnabled = (): boolean => (native ? native.notificationsEnabled() : false)
export const openNotificationSettings = (): boolean => (native ? native.openNotificationSettings() : false)
export const notificationStatus = async (): Promise<string> => (native?.notificationStatus ? native.notificationStatus() : 'unknown')
export const requestNotifications = async (): Promise<boolean> => (native?.requestNotifications ? native.requestNotifications() : false)
export const canUseFullScreenIntent = (): boolean => (native ? native.canUseFullScreenIntent() : false)
export const openFullScreenIntentSettings = (): boolean => (native ? native.openFullScreenIntentSettings() : false)

// ---- Push ----

/** The Firebase token for this phone (null on the web preview or builds without Firebase). */
export const getPushToken = async (): Promise<string | null> => (native ? native.getPushToken() : null)
/** What notification buttons (Reply, Decline) need to reach the server without the app open. */
export const configurePush = (c: PushConfig) => native?.configurePush(c)
export const clearPush = () => native?.clearPush()
export const cancelChatNotification = (id: string) => native?.cancelChatNotification(id)
export const cancelCallNotification = (id: string) => native?.cancelCallNotification(id)
/** iPhone: a glofly:// link from a notification tapped while the app was starting (once). */
export const takeLaunchLink = (): string | null => native?.takeLaunchLink?.() ?? null

export type NativeEvent = 'pushToken' | 'callRing' | 'hangUp' | 'voipToken' | 'callAnswer' | 'callEnd' | 'callDeclined' | 'callMute' | 'pipChanged' | 'keyCommand'
export function onNativeEvent(event: NativeEvent, fn: (body: Record<string, string>) => void): () => void {
  if (!native) return () => {}
  const sub = native.addListener(event, fn)
  return () => sub.remove()
}

// ---- Calls ----

export const showOverLockScreen = (on: boolean) => native?.showOverLockScreen(on)
export const keepScreenOn = (on: boolean) => native?.keepScreenOn(on)
export const startOngoingCall = (callId: string, conversationId: string, title: string, video: boolean) => native?.startOngoingCall(callId, conversationId, title, video)
export const stopOngoingCall = () => native?.stopOngoingCall()
/** iPhone: plays a call sound natively. False when this build can't (then use expo-audio). */
export const playCallTone = (name: string, repeating: boolean, volume: number): boolean =>
  native?.playCallTone ? native.playCallTone(name, repeating, volume) : false
export const stopCallTone = () => native?.stopCallTone?.()
// ---- Lock-screen calls (iPhone CallKit; no-ops elsewhere) ----

export const voipToken = (): string | null => native?.voipToken?.() ?? null
export const takeCallKitAnswer = (): { callId: string; video: string } | null => native?.takeCallKitAnswer?.() ?? null
export const endCallKitCall = (callId: string) => native?.endCallKitCall?.(callId)
export const callKitAnsweredInApp = (callId: string) => native?.callKitAnsweredInApp?.(callId)

/** iPhone: keep calls on the speaker (false = let the earpiece be used). False when this build can't. */
export const keepCallOnSpeaker = (on: boolean): boolean => {
  if (!native?.keepCallOnSpeaker) return false
  native.keepCallOnSpeaker(on)
  return true
}
export const stopCallSpeaker = () => native?.stopCallSpeaker?.()
export const callAudioRoute = (): string | null => native?.callAudioRoute?.() ?? null

/** Call diagnostics: iOS's audio session (category, mode, route…). Empty where there's none / older builds. */
export const audioSessionInfo = (): Record<string, string> => {
  try {
    return native?.audioSessionInfo?.() ?? {}
  } catch {
    return {}
  }
}

// ---- Picture-in-picture (Android; iPhone's comes from LiveKit's video view) ----

export const pipSupported = (): boolean => native?.pipSupported?.() ?? false
/** While a call is going: leaving Glofly shrinks it into a floating window. */
export const setPipCall = (on: boolean, width = 9, height = 16) => native?.setPipCall?.(on, Math.round(width), Math.round(height))
export const enterPip = (): boolean => native?.enterPip?.() ?? false
export const isInPip = (): boolean => native?.isInPip?.() ?? false

// ---- Chosen sounds ----

/** Tells the native side which message sound and ringtone were picked (native file names). False on older builds. */
export const setSounds = (message: string, ringtone: string): boolean => {
  if (!native?.setSounds) return false
  native.setSounds(message, ringtone)
  return true
}

// ---- 0.8.0: hardware keyboard shortcuts ----

/** This build sends keyboard shortcuts (0.8.0 builds). */
export const hasKeyCommands = (): boolean => !!native?.setKeyCommands
export const setKeyCommands = (ids: string[]) => native?.setKeyCommands?.(ids)
