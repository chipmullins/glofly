import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MusicState, Track } from '@glofly/shared/campfire/types'
import { fileUrl } from './api'

// The jukebox's playback: follows the server's clock (position + time since it started), so
// everyone hears the same moment. Volume and mute are each person's own (kept on this device).

const KEY = 'glofly.campfire.audio'
type Mine = { volume: number; muted: boolean }
function readMine(): Mine {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Mine>
    return {
      volume: typeof v.volume === 'number' ? Math.min(1, Math.max(0, v.volume)) : 0.8,
      muted: v.muted === true
    }
  } catch {
    return { volume: 0.8, muted: false }
  }
}
let mine = readMine()
const listeners = new Set<() => void>()
function setMine(next: Mine): void {
  mine = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}
export function useMyAudio(): [Mine, (m: Mine) => void] {
  const v = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => mine
  )
  return [v, setMine]
}

/** Where the track should be right now (seconds). */
export const musicAt = (m: MusicState, serverOffset: number): number =>
  m.playing ? m.position + (Date.now() + serverOffset - m.startedAt) / 1000 : m.position

/** Plays the table's music in step with everyone. Returns whether the browser blocked it. */
export function useMusicPlayer(
  music: MusicState | null,
  tracks: Track[],
  serverOffset: number
): { blocked: boolean; resume: () => void } {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [my] = useMyAudio()
  const track = music ? tracks.find((x) => x.id === music.trackId) : undefined

  useEffect(() => {
    if (!audio.current) audio.current = new Audio()
    const a = audio.current
    a.preload = 'auto'
    return () => {
      a.pause()
      a.removeAttribute('src')
      a.load()
    }
  }, [])

  const sync = (): void => {
    const a = audio.current
    if (!a) return
    if (!music || !track) {
      a.pause()
      return
    }
    const src = fileUrl(track.fileId)
    if (a.dataset.src !== src) {
      a.dataset.src = src
      a.src = src
    }
    a.loop = music.loop
    a.volume = my.muted ? 0 : Math.min(1, Math.max(0, music.volume * my.volume))
    let at = musicAt(music, serverOffset)
    const dur = a.duration || track.durationSec || 0
    if (dur > 0 && at > dur) at = music.loop ? at % dur : dur
    if (Math.abs(a.currentTime - at) > 1.5 && Number.isFinite(at)) {
      try {
        a.currentTime = at
      } catch {
        // Not loaded enough yet: it seeks on loadedmetadata.
      }
    }
    if (music.playing && a.paused) {
      a.play().then(
        () => setBlocked(false),
        (err: DOMException) => setBlocked(err?.name === 'NotAllowedError')
      )
    } else if (!music.playing && !a.paused) a.pause()
  }

  useEffect(() => {
    sync()
    const a = audio.current
    const onMeta = (): void => sync()
    a?.addEventListener('loadedmetadata', onMeta)
    // Drift check now and then.
    const timer = window.setInterval(sync, 5000)
    return () => {
      a?.removeEventListener('loadedmetadata', onMeta)
      window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [music, track?.fileId, serverOffset, my.volume, my.muted])

  return {
    blocked,
    resume: () =>
      void audio.current?.play().then(
        () => setBlocked(false),
        () => undefined
      )
  }
}
