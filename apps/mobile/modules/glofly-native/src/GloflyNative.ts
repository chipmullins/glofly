import { Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo-modules-core'

// Glofly's own Android code (modules/glofly-native/android). The web preview gets stand-ins so
// the app can be tried in a browser.

type Native = {
  notificationsEnabled(): boolean
  openNotificationSettings(): boolean
  canUseFullScreenIntent(): boolean
  openFullScreenIntentSettings(): boolean
  startVoice(): Promise<void>
  voiceLevel(): number
  stopVoice(): Promise<{ uri: string; durationMs: number; mime: string; size: number } | null>
  cancelVoice(): void
}

const native = requireOptionalNativeModule<Native>('GloflyNative')

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
export const canUseFullScreenIntent = (): boolean => (native ? native.canUseFullScreenIntent() : false)
export const openFullScreenIntentSettings = (): boolean => (native ? native.openFullScreenIntentSettings() : false)
