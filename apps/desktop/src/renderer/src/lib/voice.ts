// Voice messages (0.2.1): recording in the message box, and playing them in the chat.
//
// Recording uses the microphone picked in Settings → Voice & video and saves Opus audio in
// WebM, about 32 kbit/s (5 minutes ≈ 1.2 MB). While recording, the loudness is sampled so the
// message can carry a small waveform (up to 48 bars, 0–100).
//
// Playing decodes the whole message with Web Audio, so the length is exact and seeking works
// (WebM files from a browser recorder don't say how long they are). One plays at a time.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { VoiceInfo } from '../../../preload/api-types'
import { audioCapture, getCallPrefs } from './callPrefs'
import { toPeaks } from '@glofly/shared/voice'

export const VOICE_MAX_MS = 5 * 60 * 1000
const SAMPLE_MS = 50

export type Recorded = { data: ArrayBuffer; type: string; voice: VoiceInfo }

export { voiceTime, toPeaks } from '@glofly/shared/voice'

type RecorderState = 'idle' | 'starting' | 'recording'

/**
 * The recorder behind the message box's mic button. `finish` hands the recording to
 * `onDone`; `cancel` throws it away.
 */
export function useVoiceRecorder(
  onDone: (r: Recorded) => void,
  onError: (message: string) => void
): {
  state: RecorderState
  elapsedMs: number
  /** The latest loudness samples (0–1), for the live bars */
  live: number[]
  start: () => void
  finish: () => void
  cancel: () => void
} {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsedMs, setElapsed] = useState(0)
  const [live, setLive] = useState<number[]>([])
  const session = useRef<{
    stream: MediaStream
    recorder: MediaRecorder
    context: AudioContext
    timer: ReturnType<typeof setInterval>
    levels: number[]
    startedAt: number
    keep: boolean
    chunks: Blob[]
  } | null>(null)
  const wanted = useRef<'record' | 'finish' | 'cancel'>('cancel')
  const callbacks = useRef({ onDone, onError })
  useEffect(() => {
    callbacks.current = { onDone, onError }
  })

  const stopAll = useCallback((keep: boolean) => {
    const s = session.current
    if (!s) return
    session.current = null
    s.keep = keep
    clearInterval(s.timer)
    if (s.recorder.state !== 'inactive') s.recorder.stop()
    else s.stream.getTracks().forEach((t) => t.stop())
    void s.context.close().catch(() => {})
    setState('idle')
    setLive([])
  }, [])

  const finish = useCallback(() => {
    wanted.current = 'finish'
    stopAll(true)
  }, [stopAll])

  const cancel = useCallback(() => {
    wanted.current = 'cancel'
    stopAll(false)
    setState('idle')
  }, [stopAll])

  const start = useCallback(() => {
    if (session.current || wanted.current === 'record') return
    wanted.current = 'record'
    setState('starting')
    setElapsed(0)
    void (async () => {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioCapture(getCallPrefs()) })
      } catch (err) {
        wanted.current = 'cancel'
        setState('idle')
        const name = (err as { name?: string })?.name
        callbacks.current.onError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? "Glofly isn't allowed to use your microphone."
            : name === 'NotFoundError'
              ? 'No microphone found. Plug one in, or pick another in Settings → Voice & video.'
              : "Couldn't start your microphone."
        )
        return
      }
      // Let go (or cancelled) before the microphone was ready.
      if (wanted.current !== 'record') {
        stream.getTracks().forEach((t) => t.stop())
        if (wanted.current === 'cancel') setState('idle')
        else {
          setState('idle')
          callbacks.current.onError('Hold the mic button a little longer to record.')
        }
        return
      }
      const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType: type, audioBitsPerSecond: 32_000 })
      const context = new AudioContext()
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      context.createMediaStreamSource(stream).connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      const s = {
        stream,
        recorder,
        context,
        levels: [] as number[],
        startedAt: performance.now(),
        keep: false,
        chunks: [] as Blob[],
        timer: setInterval(() => {
          analyser.getFloatTimeDomainData(samples)
          let sum = 0
          for (const v of samples) sum += v * v
          // Loudness, a little boosted so normal speech fills the bars.
          const level = Math.min(1, Math.sqrt(sum / samples.length) * 4)
          s.levels.push(level)
          const elapsed = performance.now() - s.startedAt
          setElapsed(elapsed)
          setLive((l) => [...l.slice(-39), level])
          if (elapsed >= VOICE_MAX_MS) finish() // the limit: it's sent as it is
        }, SAMPLE_MS)
      }
      recorder.ondataavailable = (e) => {
        if (e.data.size) s.chunks.push(e.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        if (!s.keep) return
        const durationMs = Math.min(VOICE_MAX_MS, performance.now() - s.startedAt)
        if (durationMs < 500) {
          callbacks.current.onError('That was too short to send. Hold the mic button to record.')
          return
        }
        void new Blob(s.chunks, { type: 'audio/webm' }).arrayBuffer().then((data) =>
          callbacks.current.onDone({
            data,
            type: 'audio/webm',
            voice: { durationMs: Math.round(durationMs), peaks: toPeaks(s.levels) }
          })
        )
      }
      session.current = s
      recorder.start(1000)
      setState('recording')
    })()
  }, [finish])

  // Leaving the chat throws away a recording in progress.
  useEffect(() => () => stopAll(false), [stopAll])

  return { state, elapsedMs, live, start, finish, cancel }
}

// ---------------------------------------------------------------------------------------
// Playing

const decoded = new Map<string, AudioBuffer>()
let context: AudioContext | null = null
let playing: { url: string; source: AudioBufferSourceNode; stop: () => void } | null = null

async function bufferFor(url: string): Promise<AudioBuffer> {
  const known = decoded.get(url)
  if (known) return known
  const response = await fetch(url)
  if (!response.ok) throw new Error(`voice ${response.status}`)
  context ??= new AudioContext()
  const buffer = await context.decodeAudioData(await response.arrayBuffer())
  decoded.set(url, buffer)
  // Keep a handful decoded; older ones are fetched again if played.
  while (decoded.size > 8) decoded.delete(decoded.keys().next().value as string)
  return buffer
}

/** Stops whichever voice message is playing. */
export function stopVoice(): void {
  playing?.stop()
}

/**
 * Plays a voice message from `fromSec`. `onTick` gets the position (seconds) while it plays;
 * `onEnd` runs when it finishes or is stopped (true if it reached the end).
 * Resolves with the exact length in seconds.
 */
export async function playVoice(
  url: string,
  fromSec: number,
  onTick: (sec: number) => void,
  onEnd: (reachedEnd: boolean) => void
): Promise<number> {
  stopVoice()
  const buffer = await bufferFor(url)
  context ??= new AudioContext()
  const ctx = context as AudioContext & { setSinkId?: (id: string) => Promise<void> }
  const speaker = getCallPrefs().speakerId
  if (ctx.setSinkId) await ctx.setSinkId(speaker).catch(() => {})
  if (ctx.state === 'suspended') await ctx.resume()
  const start = Math.min(Math.max(0, fromSec), Math.max(0, buffer.duration - 0.05))
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  const begunAt = ctx.currentTime - start
  let done = false
  const timer = setInterval(() => onTick(Math.min(buffer.duration, ctx.currentTime - begunAt)), 100)
  const end = (reached: boolean): void => {
    if (done) return
    done = true
    clearInterval(timer)
    if (playing?.source === source) playing = null
    onEnd(reached)
  }
  source.onended = () => end(ctx.currentTime - begunAt >= buffer.duration - 0.1)
  playing = {
    url,
    source,
    stop: () => {
      try {
        source.stop()
      } catch {
        // Already finished.
      }
      end(false)
    }
  }
  source.start(0, start)
  return buffer.duration
}
