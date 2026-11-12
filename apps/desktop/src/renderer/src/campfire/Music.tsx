import { useState } from 'react'
import type { MusicState, Track } from '@glofly/shared/campfire/types'
import { AUDIO_ACCEPT, cf, pickFile, uploadFile } from './api'
import { useMyAudio } from './musicPlayer'
import { useCf } from './ctx'

// The jukebox: the GM uploads music and plays, pauses, loops one track for the table. Playback
// follows the server's clock (position + time since it started), so everyone hears the same
// moment. Volume and mute are each person's own (kept on this device).

export function MusicPanel(): React.JSX.Element {
  const { t, isGm, say, ctl } = useCf()
  const [my, setMy] = useMyAudio()
  const [busy, setBusy] = useState(false)
  const music = t.music
  const current = music ? t.tracks.find((x) => x.id === music.trackId) : null
  const op = async (body: Record<string, unknown>): Promise<void> => {
    const r = await cf.post<{ music: MusicState | null; serverNow: number }>(
      `/campfire/campaigns/${t.campaign.id}/music`,
      body
    )
    if (!r.ok) return say(r.message)
    ctl.update((s) => ({ ...s, music: r.data.music }))
  }
  const upload = async (): Promise<void> => {
    const file = await pickFile(AUDIO_ACCEPT)
    if (!file) return
    setBusy(true)
    const up = await uploadFile(t.campaign.id, 'audio', file)
    if (!up.ok) {
      setBusy(false)
      return say(up.message)
    }
    const title = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Untitled track'
    const r = await cf.post<Track>(`/campfire/campaigns/${t.campaign.id}/tracks`, {
      fileId: up.data.id,
      title
    })
    setBusy(false)
    if (!r.ok) return say(r.message)
    ctl.update((s) =>
      s.tracks.some((x) => x.id === r.data.id) ? s : { ...s, tracks: [...s.tracks, r.data] }
    )
  }
  return (
    <section className="cf-panel" aria-label="Music">
      <div className="cf-panel-head">
        <h2 className="cf-h2">Music and ambience</h2>
        {isGm && (
          <button type="button" className="cf-soft" disabled={busy} onClick={() => void upload()}>
            {busy ? 'Uploading…' : 'Upload music'}
          </button>
        )}
      </div>
      <div className="cf-now">
        <span className="cf-now-icon" aria-hidden="true">
          ♫
        </span>
        <span className="cf-now-title">
          {current ? `${current.title}${music?.playing ? '' : ' (paused)'}` : 'Nothing playing'}
        </span>
        {isGm && music && (
          <button
            type="button"
            className="cf-ghost cf-small"
            onClick={() => void op({ op: music.playing ? 'pause' : 'play' })}
          >
            {music.playing ? 'Pause' : 'Play'}
          </button>
        )}
        {isGm && music && (
          <button
            type="button"
            className="cf-ghost cf-small"
            onClick={() => void op({ op: 'stop' })}
          >
            Stop
          </button>
        )}
      </div>
      <label className="cf-field cf-field--row">
        <span>Your volume</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={my.volume}
          onChange={(e) => setMy({ ...my, volume: Number(e.target.value) })}
          aria-label="Your music volume"
        />
      </label>
      <label className="cf-check">
        <input
          type="checkbox"
          checked={my.muted}
          onChange={(e) => setMy({ ...my, muted: e.target.checked })}
        />
        Mute the music for me
      </label>
      {isGm && music && (
        <>
          <label className="cf-field cf-field--row">
            <span>Table volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              defaultValue={music.volume}
              key={music.volume}
              onPointerUp={(e) =>
                void op({ op: 'seek', volume: Number((e.target as HTMLInputElement).value) })
              }
              onKeyUp={(e) =>
                void op({ op: 'seek', volume: Number((e.target as HTMLInputElement).value) })
              }
              aria-label="Table music volume"
            />
          </label>
          <label className="cf-check">
            <input
              type="checkbox"
              checked={music.loop}
              onChange={(e) => void op({ op: 'seek', loop: e.target.checked })}
            />
            Loop the track
          </label>
        </>
      )}
      {isGm && (
        <ul className="cf-list">
          {t.tracks.map((tr) => (
            <li key={tr.id} className="cf-track">
              <button
                type="button"
                className="cf-list-row"
                onClick={() =>
                  void op({
                    op: 'play',
                    trackId: tr.id,
                    position: music?.trackId === tr.id ? undefined : 0
                  })
                }
                aria-label={`Play ${tr.title}`}
              >
                <span aria-hidden="true">
                  {music?.trackId === tr.id && music.playing ? '❚❚' : '▶'}
                </span>
                <span className="cf-list-title">{tr.title}</span>
                {tr.durationSec && (
                  <span className="cf-sub">
                    {Math.floor(tr.durationSec / 60)}:{String(tr.durationSec % 60).padStart(2, '0')}
                  </span>
                )}
              </button>
              <button
                type="button"
                className="cf-x"
                aria-label={`Delete ${tr.title}`}
                onClick={async () => {
                  if (!window.confirm(`Delete "${tr.title}"?`)) return
                  const r = await cf.del(`/campfire/tracks/${tr.id}`)
                  if (!r.ok) say(r.message)
                  else ctl.update((s) => ({ ...s, tracks: s.tracks.filter((x) => x.id !== tr.id) }))
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {isGm && (
        <p className="cf-hint">
          MP3, Ogg, M4A or WAV, up to 20 MB each. Only upload music you have the rights to share.
        </p>
      )}
    </section>
  )
}
