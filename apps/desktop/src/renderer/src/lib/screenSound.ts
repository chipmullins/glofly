// 0.5.0: sharing a screen or window with its sound, the best way this computer allows.
//
// Desktop app on Windows 10 2004+ / macOS 14.2+ ('app'): Glofly captures the sound itself
// (main/screenSound): a window sends only that app's sound (a game's, say), a whole screen sends
// everything except Glofly (so nobody hears their own voice come back). The sound arrives here as
// PCM and becomes a call track through a MediaStreamTrackGenerator, published as the screen
// share's audio.
// Older Windows ('system'): Electron's loopback (everything, Glofly included).
// Browser ('browser'): the browser asks; Glofly's own tab is left out where the browser can.
import {
  AudioPresets,
  ParticipantEvent,
  Track,
  type LocalParticipant,
  type LocalTrackPublication,
  type VideoResolution
} from 'livekit-client'
import type { ScreenSoundFormat, ScreenSoundSupport } from '../../../preload/api-types'
import { sendErrorReport } from './errorReports'

let support: Promise<ScreenSoundSupport> | null = null
export function screenSoundSupport(): Promise<ScreenSoundSupport> {
  support ??= window.glofly.calls.screenSound.support().catch(() => 'none' as const)
  return support
}

// Chromium's MediaStreamTrackGenerator (Breakout Box) isn't in TypeScript's DOM types yet.
type TrackGenerator = MediaStreamTrack & { writable: WritableStream<AudioData> }
type TrackGeneratorCtor = new (init: { kind: 'audio' }) => TrackGenerator
const Generator = (globalThis as { MediaStreamTrackGenerator?: TrackGeneratorCtor })
  .MediaStreamTrackGenerator

/** A live audio track fed by Glofly's own capture, or null if it couldn't start. */
async function capturedSound(sourceId: string): Promise<{
  track: MediaStreamTrack
  format: ScreenSoundFormat
  stop: () => void
  received: () => number
} | null> {
  if (!Generator || typeof AudioData === 'undefined') {
    sendErrorReport(new Error('Screen sound: no MediaStreamTrackGenerator'), 'screen sound')
    return null
  }
  const sound = window.glofly.calls.screenSound
  const generator = new Generator({ kind: 'audio' })
  const writer = generator.writable.getWriter()
  let format: ScreenSoundFormat | null = null
  let frames = 0
  let leftover: Uint8Array | null = null
  let chunks = 0
  const offChunk = sound.onChunk((pcm) => {
    if (!format) return
    chunks++
    const bytesPerFrame = format.channels * (format.float ? 4 : 2)
    let data = pcm
    if (leftover) {
      data = new Uint8Array(leftover.length + pcm.length)
      data.set(leftover)
      data.set(pcm, leftover.length)
      leftover = null
    }
    const count = Math.floor(data.length / bytesPerFrame)
    if (data.length % bytesPerFrame) leftover = data.slice(count * bytesPerFrame)
    if (!count) return
    // Far behind (the window was busy): drop rather than let the sound drift later and later.
    if ((writer.desiredSize ?? 0) < -25) return
    const chunk = new AudioData({
      format: format.float ? 'f32' : 's16',
      sampleRate: format.sampleRate,
      numberOfChannels: format.channels,
      numberOfFrames: count,
      timestamp: Math.round((frames * 1_000_000) / format.sampleRate),
      data: data.subarray(0, count * bytesPerFrame) as Uint8Array<ArrayBuffer>
    })
    frames += count
    writer.write(chunk).catch(() => chunk.close())
  })
  let stopped = false
  const stop = (): void => {
    if (stopped) return
    stopped = true
    offChunk()
    offEnded()
    void sound.stop()
    void writer.close().catch(() => undefined)
    generator.stop()
  }
  // The capture stopped by itself: end the track (the share's video carries on).
  const offEnded = sound.onEnded(stop)
  const started = await sound.start(sourceId).catch(() => ({ ok: false as const }))
  if (!started.ok) {
    stop()
    return null
  }
  format = started.format
  return { track: generator, format, stop, received: () => chunks }
}

export type ShareResult = { sound: 'app' | 'computer' | 'everything' | null }

/**
 * Starts sharing the picked screen or window (desktop app) on `local`, with its sound when asked.
 * Returns what sound went with it (null: none). Throws like setScreenShareEnabled.
 */
export async function shareDesktopScreen(
  local: LocalParticipant,
  sourceId: string,
  withSound: boolean,
  resolution?: VideoResolution
): Promise<ShareResult> {
  const kind = withSound ? await screenSoundSupport() : 'none'
  await window.glofly.calls.chooseScreen(sourceId, kind === 'system')
  await local.setScreenShareEnabled(true, {
    audio: kind === 'system',
    ...(resolution ? { resolution } : {})
  })
  if (kind === 'system') {
    return { sound: local.getTrackPublication(Track.Source.ScreenShareAudio) ? 'everything' : null }
  }
  if (kind !== 'app') return { sound: null }

  const captured = await capturedSound(sourceId)
  if (!captured) return { sound: null }
  // Stopped sharing in the meantime (a very quick Stop): don't send sound on its own.
  if (!local.getTrackPublication(Track.Source.ScreenShare)) {
    captured.stop()
    return { sound: null }
  }
  let published: LocalTrackPublication
  try {
    published = await local.publishTrack(captured.track, {
      source: Track.Source.ScreenShareAudio,
      name: 'screen_share_audio',
      audioPreset: AudioPresets.musicHighQualityStereo,
      forceStereo: captured.format.channels === 2,
      dtx: false,
      red: false
    })
  } catch (err) {
    console.warn('[screen sound] could not send the sound', err)
    captured.stop()
    return { sound: null }
  }
  // When the share ends (Stop, the window closed), the sound goes too. When the sound stops by
  // itself (the game quit), its track goes and the picture carries on.
  const offEnded = window.glofly.calls.screenSound.onEnded(() => {
    if (published.track) void local.unpublishTrack(published.track)
  })
  const onUnpublished = (pub: LocalTrackPublication): void => {
    if (pub.source !== Track.Source.ScreenShare && pub !== published) return
    local.off(ParticipantEvent.LocalTrackUnpublished, onUnpublished)
    offEnded()
    captured.stop()
    if (pub !== published && published.track) void local.unpublishTrack(published.track)
  }
  local.on(ParticipantEvent.LocalTrackUnpublished, onUnpublished)
  // Oct 30, 2026 (Chip: "PC audio doesn't work"): if nothing at all has arrived after 30 s of
  // sharing, tell Control → Errors (silence is skipped by the capture, so this can also mean
  // nothing was playing).
  setTimeout(() => {
    if (
      published.track &&
      local.getTrackPublication(Track.Source.ScreenShare) &&
      !captured.received()
    )
      sendErrorReport(
        new Error(`Screen sound: nothing arrived in 30 s (${captured.format.scope})`),
        'screen sound'
      )
  }, 30_000)
  return { sound: captured.format.scope }
}

/**
 * Browser: the browser shows its own picker (a tab, a window or the whole screen) and can share
 * that tab's or the computer's sound (Chrome and Edge). Glofly's own tab (call voices, Watch
 * Together) is left out of the computer's sound where the browser supports it (restrictOwnAudio),
 * and the sound isn't treated like a voice (no echo or noise filtering).
 */
export async function shareBrowserScreen(
  local: LocalParticipant,
  withSound: boolean,
  resolution?: VideoResolution
): Promise<void> {
  await local.setScreenShareEnabled(true, {
    audio: withSound
      ? {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          restrictOwnAudio: true
        }
      : false,
    systemAudio: withSound ? 'include' : 'exclude',
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    ...(resolution ? { resolution } : {})
  })
}
