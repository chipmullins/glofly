import { useEffect, useRef, useState } from 'react'
import { Track, type Participant, type VideoTrack } from 'livekit-client'
import type { PublicUser, ScreenSource, SignedInUser } from '../../../preload/api-types'
import { callDuration, firstName, useCalls, type CurrentCall } from '../calls/callState'
import { getCallPrefs } from '../lib/callPrefs'
import Avatar from './Avatar'
import {
  FullscreenIcon,
  HangUpIcon,
  MicIcon,
  MicOffIcon,
  ScreenShareIcon,
  SpeakingIcon,
  StopShareIcon,
  VideoIcon,
  VideoOffIcon
} from './icons'
import './CallPanel.css'

// The call, shown at the top of its chat (Calling.dc.html): you and them side by side, a shared
// screen above when someone shares, and the controls underneath. Dark in every theme.

/** A camera or screen, playing in a video element. */
function TrackVideo({
  track,
  mirror = false,
  fit = 'cover'
}: {
  track: VideoTrack
  mirror?: boolean
  fit?: 'cover' | 'contain'
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <video
      ref={ref}
      className={`call-video call-video--${fit}${mirror ? ' call-video--mirror' : ''}`}
      autoPlay
      playsInline
      muted
    />
  )
}

/** "12:48", counting up from when the call was answered. */
export function CallTimer({ since }: { since: string }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <>{callDuration((now - new Date(since).getTime()) / 1000)}</>
}

/** The participant's camera or screen, if it's on and arriving. */
function videoOf(p: Participant | undefined, source: Track.Source): VideoTrack | null {
  const pub = p?.getTrackPublication(source)
  if (!pub || pub.isMuted || !pub.videoTrack) return null
  return pub.videoTrack
}

function Tile({
  person,
  label,
  camera,
  mirror,
  muted,
  speaking,
  ringing,
  status
}: {
  person: PublicUser
  label: string
  camera: VideoTrack | null
  mirror?: boolean
  muted: boolean
  speaking: boolean
  /** Glowing rings while it rings */
  ringing: boolean
  /** "Ringing…", "Connecting…" under their face */
  status: string | null
}): React.JSX.Element {
  return (
    <div className={speaking ? 'call-tile call-tile--speaking' : 'call-tile'}>
      {camera ? (
        <TrackVideo track={camera} mirror={mirror} />
      ) : (
        <div className="call-tile-face">
          <div className={ringing ? 'call-glow-face' : 'call-glow-face call-glow-face--still'}>
            {ringing && <span className="call-ring" aria-hidden="true" />}
            {ringing && <span className="call-ring call-ring--late" aria-hidden="true" />}
            <Avatar
              id={person.id}
              name={person.displayName}
              avatarVersion={person.avatarVersion}
              size={ringing ? 112 : 96}
              className="call-glow-photo"
            />
          </div>
          {status && (
            <div className="call-tile-status">
              <strong>{person.displayName}</strong>
              <span>{status}</span>
            </div>
          )}
        </div>
      )}
      <span className="call-tag">
        {muted && (
          <span className="call-tag-muted" title="Muted">
            <MicOffIcon size={14} strokeWidth={2.2} />
          </span>
        )}
        {speaking && !muted && (
          <span className="call-tag-speaking">
            <SpeakingIcon />
          </span>
        )}
        {label}
      </span>
    </div>
  )
}

/** Pick a screen or window to share (pictures from Windows, like the system picker). */
export function ScreenPicker({
  onPick,
  onClose
}: {
  onPick: (sourceId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [sources, setSources] = useState<ScreenSource[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.glofly.calls.screenSources().then((list) => {
      if (cancelled) return
      setSources(list)
      setPicked(list[0]?.id ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const screens = sources?.filter((s) => s.kind === 'screen') ?? []
  const windows = sources?.filter((s) => s.kind === 'window') ?? []
  const group = (title: string, list: ScreenSource[]): React.ReactNode =>
    list.length > 0 && (
      <section className="screen-group">
        <h2>{title}</h2>
        <div className="screen-grid" role="radiogroup" aria-label={title}>
          {list.map((s, i) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={picked === s.id}
              className={picked === s.id ? 'screen-option screen-option--picked' : 'screen-option'}
              onClick={() => setPicked(s.id)}
              onDoubleClick={() => onPick(s.id)}
            >
              <span className="screen-thumb">
                {s.thumbnail ? <img src={s.thumbnail} alt="" draggable={false} /> : null}
              </span>
              <span className="screen-name">
                {s.icon && <img src={s.icon} alt="" className="screen-icon" draggable={false} />}
                <span>
                  {s.kind === 'screen'
                    ? screens.length > 1
                      ? `Screen ${i + 1}`
                      : 'Entire screen'
                    : s.name}
                </span>
              </span>
            </button>
          ))}
        </div>
      </section>
    )

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-picker-title"
        className="dialog screen-picker"
      >
        <div className="dialog-head">
          <h1 id="screen-picker-title">Share your screen</h1>
          <p>Pick what they&apos;ll see. You can stop sharing anytime.</p>
        </div>
        <div className="screen-picker-body">
          {sources === null ? (
            <p className="screen-picker-note">Looking for screens and windows…</p>
          ) : sources.length === 0 ? (
            <p className="screen-picker-note">Couldn&apos;t find anything to share.</p>
          ) : (
            <>
              {group('Screens', screens)}
              {group('Windows', windows)}
            </>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="small-button small-button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="small-button small-button--primary"
            disabled={!picked}
            onClick={() => picked && onPick(picked)}
          >
            Share
          </button>
        </div>
      </div>
    </div>
  )
}

/** The call's title line: "Video calling Jacob…", or their name and how long you've talked. */
function titleOf(c: CurrentCall): { text: string; timerSince: string | null } {
  const name = firstName(c.partner)
  switch (c.phase) {
    case 'starting':
    case 'ringing':
      return { text: c.video ? `Video calling ${name}…` : `Calling ${name}…`, timerSince: null }
    case 'connecting':
      return { text: 'Connecting…', timerSince: null }
    case 'reconnecting':
      return { text: 'Reconnecting…', timerSince: null }
    case 'connected':
      return { text: c.partner.displayName, timerSince: c.call?.answeredAt ?? null }
  }
}

export default function CallPanel({ me }: { me: SignedInUser }): React.JSX.Element | null {
  const calls = useCalls()
  const { current, room } = calls
  const [picking, setPicking] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  if (!current) return null

  const local = room?.localParticipant
  const remote = room?.remoteParticipants.get(current.partner.id)
  const ready = !!room && room.state === 'connected'
  const micOn = local?.isMicrophoneEnabled ?? false
  const cameraOn = local?.isCameraEnabled ?? false
  const sharing = local?.isScreenShareEnabled ?? false
  const myCamera = videoOf(local, Track.Source.Camera)
  const theirCamera = videoOf(remote, Track.Source.Camera)
  const theirScreen = videoOf(remote, Track.Source.ScreenShare)
  const myScreen = videoOf(local, Track.Source.ScreenShare)
  const screen = theirScreen ?? myScreen
  const ringing = current.phase === 'starting' || current.phase === 'ringing'
  const title = titleOf(current)

  const theirStatus = ringing
    ? 'Ringing…'
    : current.phase === 'connecting' ||
        (!remote && current.phase === 'connected' && !current.partnerAway)
      ? 'Connecting…'
      : current.partnerAway
        ? 'Their connection dropped. Waiting for them…'
        : null

  return (
    <section className="call-panel" aria-label="Call">
      <div className="call-title">
        <span className="call-dot" aria-hidden="true" />
        <h2>{title.text}</h2>
        {title.timerSince && (
          <span className="call-sub">
            · <CallTimer since={title.timerSince} />
          </span>
        )}
      </div>

      {current.problem && (
        <p className="call-problem" role="alert">
          {current.problem}
          <button type="button" aria-label="Dismiss" onClick={calls.clearProblem}>
            ×
          </button>
        </p>
      )}

      {/* With a shared screen, the cameras sit in a column beside it. */}
      <div className={screen ? 'call-media call-media--screen' : 'call-media'}>
        {screen && (
          <div className="call-stage" ref={stageRef}>
            <TrackVideo track={screen} fit="contain" />
            <span className="call-tag">
              {theirScreen ? `${firstName(current.partner)}'s screen` : 'Your screen'}
            </span>
            {theirScreen && (
              <button
                type="button"
                className="call-stage-full"
                aria-label="Full screen"
                title="Full screen"
                onClick={() => {
                  const el = stageRef.current
                  if (!el) return
                  if (document.fullscreenElement) void document.exitFullscreen()
                  else void el.requestFullscreen().catch(() => {})
                }}
              >
                <FullscreenIcon size={18} />
              </button>
            )}
          </div>
        )}

        <div className="call-tiles">
          <Tile
            person={me}
            label="You"
            camera={myCamera}
            mirror={getCallPrefs().mirrorCamera}
            muted={ready && !micOn}
            speaking={!!local?.isSpeaking}
            ringing={false}
            status={null}
          />
          <Tile
            person={current.partner}
            label={current.partner.displayName}
            camera={theirCamera}
            muted={!!remote && !remote.isMicrophoneEnabled}
            speaking={!!remote?.isSpeaking}
            ringing={ringing}
            status={theirStatus}
          />
        </div>
      </div>

      <div className="call-controls">
        <button
          type="button"
          className={cameraOn ? 'call-button' : 'call-button call-button--off'}
          aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          aria-pressed={cameraOn}
          title={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          disabled={!ready}
          onClick={calls.toggleCamera}
        >
          {cameraOn ? <VideoIcon size={22} /> : <VideoOffIcon size={22} />}
        </button>
        <button
          type="button"
          className={micOn || !ready ? 'call-button' : 'call-button call-button--off'}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={!micOn}
          title={micOn ? 'Mute' : 'Unmute'}
          disabled={!ready}
          onClick={calls.toggleMic}
        >
          {micOn || !ready ? <MicIcon size={22} /> : <MicOffIcon size={22} />}
        </button>
        <button
          type="button"
          className={sharing ? 'call-button call-button--sharing' : 'call-button'}
          aria-label={sharing ? 'Stop sharing your screen' : 'Share your screen'}
          title={sharing ? 'Stop sharing' : 'Share screen'}
          disabled={!ready}
          onClick={() => (sharing ? calls.stopSharing() : setPicking(true))}
        >
          {sharing ? <StopShareIcon size={22} /> : <ScreenShareIcon size={22} />}
        </button>
        <button
          type="button"
          className="call-hangup"
          aria-label={ringing ? 'Cancel call' : 'Hang up'}
          title={ringing ? 'Cancel call' : 'Hang up'}
          onClick={calls.hangUp}
        >
          <HangUpIcon />
        </button>
      </div>

      {picking && (
        <ScreenPicker
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false)
            void calls.shareScreen(id)
          }}
        />
      )}
    </section>
  )
}

/**
 * In the sidebar while a call is going on somewhere you can't see it: in another chat (with mute
 * and hang up), or on another of your devices (with "Switch here").
 */
export function CallStrip({
  openChatId,
  onOpenChat
}: {
  openChatId: string | null
  onOpenChat: (conversationId: string) => void
}): React.JSX.Element | null {
  const calls = useCalls()
  const { current, elsewhere, room } = calls

  if (current && current.conversationId !== openChatId) {
    const micOn = room?.localParticipant.isMicrophoneEnabled ?? true
    const status =
      current.phase === 'connected' && current.call?.answeredAt ? (
        <CallTimer since={current.call.answeredAt} />
      ) : current.phase === 'reconnecting' ? (
        'Reconnecting…'
      ) : current.phase === 'connecting' ? (
        'Connecting…'
      ) : (
        'Ringing…'
      )
    return (
      <div className="call-strip" role="region" aria-label="Your call">
        <button
          type="button"
          className="call-strip-main"
          title="Go to the call"
          onClick={() => onOpenChat(current.conversationId)}
        >
          <span className="call-dot" aria-hidden="true" />
          <span className="call-strip-text">
            <strong>{current.partner.displayName}</strong>
            <span>{status}</span>
          </span>
        </button>
        <button
          type="button"
          className={micOn ? 'call-strip-button' : 'call-strip-button call-strip-button--off'}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={!micOn}
          disabled={!room}
          onClick={calls.toggleMic}
        >
          {micOn ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
        </button>
        <button
          type="button"
          className="call-strip-button call-strip-button--hangup"
          aria-label="Hang up"
          onClick={calls.hangUp}
        >
          <HangUpIcon size={18} />
        </button>
      </div>
    )
  }

  if (elsewhere && !current) {
    const calling = elsewhere.call.status === 'ringing'
    return (
      <div className="call-strip" role="region" aria-label="Call on another device">
        <span className="call-strip-main call-strip-main--static">
          <span className="call-dot" aria-hidden="true" />
          <span className="call-strip-text">
            <strong>{elsewhere.partner.displayName}</strong>
            <span>{calling ? 'Calling from another device' : 'In a call on another device'}</span>
          </span>
        </span>
        <button type="button" className="call-strip-switch" onClick={calls.moveHere}>
          Switch here
        </button>
      </div>
    )
  }

  return null
}
