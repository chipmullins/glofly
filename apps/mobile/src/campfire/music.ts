import { useEffect, useMemo, useState } from 'react'
import { Platform } from 'react-native'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { create } from 'zustand'
import type { MusicState, TableState } from '@glofly/shared'
import { authHeaders } from '@/api/http'
import { prefs } from '@/lib/storage'
import { fileUrl } from './api'
import { useCampfire } from './store'

// The jukebox on the phone: the GM plays one track for the table; every phone plays it at the
// same spot, worked out from the server's clock (`position + (serverNow − startedAt) / 1000`).
// Volume and mute are this person's own (kept on this phone).

type MusicPrefs = { volume: number; muted: boolean; loaded: boolean }
export const useMusicPrefs = create<MusicPrefs>(() => ({ volume: 0.75, muted: false, loaded: false }))

let prefsLoading = false
function loadPrefs() {
  if (prefsLoading) return
  prefsLoading = true
  void prefs.get<{ volume?: number; muted?: boolean }>('campfire.music', {}).then((p) =>
    useMusicPrefs.setState({ volume: typeof p.volume === 'number' ? Math.max(0, Math.min(1, p.volume)) : 0.75, muted: p.muted === true, loaded: true }),
  )
}
export function setMusicPrefs(change: Partial<Pick<MusicPrefs, 'volume' | 'muted'>>) {
  useMusicPrefs.setState(change)
  const { volume, muted } = useMusicPrefs.getState()
  void prefs.set('campfire.music', { volume, muted })
}

/** Where the track should be right now (seconds), or null when it has ended. */
export function expectedPosition(music: MusicState, offsetMs: number, durationSec: number | null): number | null {
  const serverNow = Date.now() + offsetMs
  const pos = music.playing ? music.position + (serverNow - music.startedAt) / 1000 : music.position
  if (!durationSec || durationSec <= 0) return Math.max(0, pos)
  if (pos < durationSec) return Math.max(0, pos)
  return music.loop ? pos % durationSec : null
}

/** The browser preview can't send headers with <audio>: it loads the file first. */
function useSource(fileId: string | null) {
  const [webUri, setWebUri] = useState<string | null>(null)
  useEffect(() => {
    if (Platform.OS !== 'web' || !fileId) return
    const stop = new AbortController()
    let made: string | null = null
    void fetch(fileUrl(fileId), { headers: authHeaders(), signal: stop.signal })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b) return
        made = URL.createObjectURL(b)
        setWebUri(made)
      })
      .catch(() => {})
    return () => {
      stop.abort()
      if (made) URL.revokeObjectURL(made)
      setWebUri(null)
    }
  }, [fileId])
  return useMemo(() => {
    if (!fileId) return null
    if (Platform.OS === 'web') return webUri ? { uri: webUri } : null
    return { uri: fileUrl(fileId), headers: authHeaders() }
  }, [fileId, webUri])
}

/** Plays the table's music while the table is open. Returns what's playing (for the Music panel). */
export function useTableMusic(campaignId: string, table: TableState | undefined) {
  useEffect(loadPrefs, [])
  const music = table?.music ?? null
  const track = music ? (table?.tracks.find((t) => t.id === music.trackId) ?? null) : null
  const source = useSource(track?.fileId ?? null)
  const player = useAudioPlayer(source, { updateInterval: 1000 })
  const status = useAudioPlayerStatus(player)
  const offset = useCampfire((s) => s.offsets[campaignId] ?? 0)
  const { volume, muted } = useMusicPrefs()
  const [tick, setTick] = useState(0)

  // Every few seconds: back in step if it drifted (a slow phone, a stall while loading).
  useEffect(() => {
    if (!music?.playing) return
    const t = setInterval(() => setTick((n) => n + 1), 5000)
    return () => clearInterval(t)
  }, [music?.playing])

  useEffect(() => {
    if (!source || !status.isLoaded) return
    try {
      player.volume = muted ? 0 : Math.max(0, Math.min(1, (music?.volume ?? 0.8) * volume))
      if (!music) {
        player.pause()
        return
      }
      player.loop = music.loop
      const duration = track?.durationSec ?? (status.duration > 0 ? status.duration : null)
      const want = expectedPosition(music, offset, duration)
      if (want === null) {
        player.pause()
        return
      }
      if (Math.abs((status.currentTime ?? 0) - want) > 1.5) void player.seekTo(want)
      if (music.playing && !status.playing) player.play()
      if (!music.playing && status.playing) player.pause()
    } catch {
      // the player went away (the table closed) while this ran
    }
    // status.currentTime changes every second: only the drift tick re-checks it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, status.isLoaded, music, offset, volume, muted, tick, track?.durationSec])

  // No music any more: stop at once.
  useEffect(() => {
    if (!music && status.playing) player.pause()
  }, [music, status.playing, player])

  return { music, track, playing: !!music?.playing && status.playing, loading: !!music && !status.isLoaded }
}
