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

export type NativeEvent = 'pushToken' | 'callRing' | 'hangUp'
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
