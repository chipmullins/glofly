// 0.5.0 Broadcast now: share your screen (and its sound) for any friend to drop in and watch,
// without a call. Your broadcast runs in a LiveKit room of its own: you send, friends only watch.
import { useEffect, useRef, useState } from 'react'
import {
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
  type RemoteTrackPublication
} from 'livekit-client'
import type { PublicUser } from '../../../preload/api-types'
import { isWeb } from '../lib/platform'
import { useSocial } from '../lib/social'
import { goLive, stopLive, useMyBroadcast } from '../lib/broadcast'
import Avatar from './Avatar'
import EmojiText from './EmojiText'
import { ScreenPicker, SoundChoice } from './CallPanel'
import { ExitFullscreenIcon, FullscreenIcon, SpeakerIcon, SpeakerOffIcon } from './icons'
import { LiveIcon } from './Social'
import './Broadcast.css'

/** The time, updated every 20 seconds (for "12 min"). */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20_000)
    return () => clearInterval(t)
  }, [])
  return now
}

/** "Go live": a title, what to share, and whether its sound goes too. */
export function GoLiveDialog({
  onClose,
  onProblem
}: {
  onClose: () => void
  onProblem: (m: string) => void
}): React.JSX.Element {
  const [title, setTitle] = useState('')
  // Browser only (the desktop picker has its own "Include sound").
  const [sound, setSound] = useState(true)

  async function start(sourceId: string | null, withSound: boolean): Promise<void> {
    onClose()
    const problem = await goLive(title.trim() || null, sourceId, withSound)
    if (problem) onProblem(problem)
  }

  const options = (
    <div className="golive-options">
      <label className="golive-field">
        <span>What are you sharing? (optional)</span>
        <input
          value={title}
          maxLength={60}
          placeholder="Building a castle in Minecraft"
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
        />
      </label>
      {isWeb && <SoundChoice support="browser" picked={null} on={sound} onChange={setSound} />}
    </div>
  )

  if (isWeb) {
    return (
      <div
        className="dialog-backdrop"
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="golive-title"
          className="dialog golive-dialog"
        >
          <h1 id="golive-title">
            <LiveIcon size={20} /> Go live
          </h1>
          <p className="golive-sub">
            Friends can drop in and watch your screen, no call needed. Your browser will ask what to
            share.
          </p>
          {options}
          <div className="confirm-actions">
            <button type="button" className="small-button small-button--quiet" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="small-button golive-start"
              onClick={() => void start(null, sound)}
            >
              Go live
            </button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <ScreenPicker
      title="Go live"
      subtitle="Friends can drop in and watch, no call needed. Pick what they'll see."
      confirmLabel="Go live"
      extra={options}
      soundDefault="on"
      onPick={(id, withSound) => void start(id, withSound)}
      onClose={onClose}
    />
  )
}

/** Your broadcast: who's watching, and Stop. */
export function LivePanel({ onClose }: { onClose: () => void }): React.JSX.Element | null {
  const mine = useMyBroadcast()
  const now = useMinuteClock()
  const [viewers, setViewers] = useState<PublicUser[]>([])
  const social = useSocial()
  const count = social.broadcasts.find(
    (b) => b.userId === (mine.status === 'live' ? mine.broadcast.userId : '')
  )?.viewers
  useEffect(() => {
    void window.glofly.broadcasts.mine().then((r) => r.ok && setViewers(r.data.viewers))
  }, [count])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (mine.status !== 'live') return null
  const mins = Math.max(0, Math.floor((now - mine.startedAt) / 60_000))
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-title"
        className="dialog golive-dialog"
      >
        <h1 id="live-title">
          <span className="live-dot live-dot--red" aria-hidden="true" /> You&apos;re live
        </h1>
        <p className="golive-sub">
          {mine.broadcast.title ? <EmojiText text={mine.broadcast.title} /> : 'Sharing your screen'}{' '}
          · {mins < 1 ? 'just started' : `${mins} min`}
        </p>
        <div className="live-viewers">
          <span className="live-viewers-label">
            {viewers.length === 0 ? 'Nobody watching yet' : `${viewers.length} watching`}
          </span>
          <div className="live-viewers-faces">
            {viewers.map((v) => (
              <span key={v.id} title={v.displayName}>
                <Avatar id={v.id} name={v.displayName} avatarVersion={v.avatarVersion} size={34} />
              </span>
            ))}
          </div>
        </div>
        <div className="confirm-actions">
          <button type="button" className="small-button small-button--quiet" onClick={onClose}>
            Keep going
          </button>
          <button
            type="button"
            className="small-button small-button--danger"
            onClick={() => {
              onClose()
              void stopLive()
            }}
          >
            Stop broadcast
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Watching a friend's broadcast

export function BroadcastViewer({
  person,
  onClose
}: {
  person: PublicUser
  onClose: () => void
}): React.JSX.Element {
  const social = useSocial()
  const now = useMinuteClock()
  const live = social.broadcasts.find((b) => b.userId === person.id)
  const [state, setState] = useState<'joining' | 'waiting' | 'watching' | 'ended' | 'problem'>(
    'joining'
  )
  const [problem, setProblem] = useState('')
  const [volume, setVolume] = useState(80)
  const [muted, setMuted] = useState(false)
  const [full, setFull] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLDivElement>(null)
  const audioEls = useRef<HTMLMediaElement[]>([])
  const volumeRef = useRef({ volume, muted })
  useEffect(() => {
    volumeRef.current = { volume, muted }
    for (const el of audioEls.current) {
      el.volume = volume / 100
      el.muted = muted
    }
  }, [volume, muted])

  useEffect(() => {
    let room: Room | null = null
    let cancelled = false
    void window.glofly.broadcasts.watch(person.id).then(async (r) => {
      if (cancelled) return
      if (!r.ok) {
        setState(r.error === 'not_found' ? 'ended' : 'problem')
        setProblem(r.message)
        return
      }
      room = new Room({ adaptiveStream: true, dynacast: true })
      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
          if (
            track.kind === Track.Kind.Video &&
            pub.source === Track.Source.ScreenShare &&
            videoRef.current
          ) {
            track.attach(videoRef.current)
            setState('watching')
          }
          if (track.kind === Track.Kind.Audio) {
            const el = track.attach()
            el.volume = volumeRef.current.volume / 100
            el.muted = volumeRef.current.muted
            audioEls.current.push(el)
            audioRef.current?.append(el)
          }
        })
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
          track.detach().forEach((el) => {
            el.remove()
            audioEls.current = audioEls.current.filter((a) => a !== el)
          })
          if (track.kind === Track.Kind.Video) setState('waiting')
        })
        .on(RoomEvent.ParticipantDisconnected, (p) => {
          if (p.identity === person.id) setState('ended')
        })
        .on(RoomEvent.Disconnected, () =>
          setState((s) => (s === 'watching' || s === 'waiting' ? 'ended' : s))
        )
      try {
        await room.connect(r.data.url, r.data.token)
        if (!cancelled) setState((s) => (s === 'joining' ? 'waiting' : s))
      } catch {
        if (!cancelled) {
          setState('problem')
          setProblem("Couldn't connect to the broadcast. Check your connection and try again.")
        }
      }
    })
    return () => {
      cancelled = true
      void room?.disconnect()
      audioEls.current = []
    }
  }, [person.id])

  // Gone from the list (they stopped): it ended.
  const shownState = !live && state !== 'joining' && state !== 'problem' ? 'ended' : state

  useEffect(() => {
    const onFs = (): void => setFull(document.fullscreenElement === stageRef.current)
    document.addEventListener('fullscreenchange', onFs)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.fullscreenElement) onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const since = live
    ? Math.max(0, Math.floor((now - new Date(live.startedAt).getTime()) / 60_000))
    : 0
  return (
    <div className="bc-viewer" role="dialog" aria-label={`${person.displayName}'s broadcast`}>
      <header className="bc-head">
        <Avatar
          id={person.id}
          name={person.displayName}
          avatarVersion={person.avatarVersion}
          size={40}
        />
        <div className="bc-head-text">
          <span className="bc-name">
            <EmojiText text={person.displayName} />
            {shownState === 'watching' || shownState === 'waiting' ? (
              <span className="live-badge">LIVE</span>
            ) : null}
          </span>
          <span className="bc-sub">
            {live?.title ? <EmojiText text={live.title} /> : 'Sharing their screen'}
            {live
              ? ` · ${since < 1 ? 'just started' : `${since} min`} · ${live.viewers} watching`
              : ''}
          </span>
        </div>
        <button type="button" className="bc-close" onClick={onClose}>
          Leave
        </button>
      </header>
      <div className="bc-stage" ref={stageRef}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={shownState === 'watching' ? 'bc-video' : 'bc-video bc-video--hidden'}
        />
        {shownState !== 'watching' && (
          <div className="bc-state">
            {shownState === 'ended' ? (
              <>
                <p className="bc-state-big">The broadcast ended</p>
                <button
                  type="button"
                  className="small-button small-button--quiet"
                  onClick={onClose}
                >
                  Back to chats
                </button>
              </>
            ) : shownState === 'problem' ? (
              <p className="bc-state-big">{problem}</p>
            ) : (
              <>
                <span className="bc-spinner" aria-hidden="true" />
                <p>{shownState === 'joining' ? 'Joining…' : 'Waiting for the screen…'}</p>
              </>
            )}
          </div>
        )}
        {shownState === 'watching' && (
          <div className="bc-controls">
            <button
              type="button"
              className="bc-icon"
              aria-label={muted ? 'Unmute' : 'Mute'}
              title={muted ? 'Unmute' : 'Mute'}
              onClick={() => setMuted((m) => !m)}
            >
              {muted || volume === 0 ? <SpeakerOffIcon size={20} /> : <SpeakerIcon size={20} />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : volume}
              aria-label="Volume"
              className="bc-volume"
              onChange={(e) => {
                setVolume(Number(e.target.value))
                setMuted(false)
              }}
            />
            <span className="bc-spacer" />
            <button
              type="button"
              className="bc-icon"
              aria-label={full ? 'Exit full screen' : 'Full screen'}
              title={full ? 'Exit full screen' : 'Full screen'}
              onClick={() =>
                full ? void document.exitFullscreen() : void stageRef.current?.requestFullscreen()
              }
            >
              {full ? <ExitFullscreenIcon size={20} /> : <FullscreenIcon size={20} />}
            </button>
          </div>
        )}
        <div ref={audioRef} hidden />
      </div>
    </div>
  )
}
