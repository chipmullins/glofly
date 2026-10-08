import { useEffect, useRef, useState } from 'react'
import { Track, type Participant, type VideoTrack } from 'livekit-client'
import type {
  Call,
  ConversationSummary,
  PublicUser,
  ScreenSource,
  SignedInUser
} from '../../../preload/api-types'
import {
  callDuration,
  firstName,
  joinedCount,
  memberState,
  useCalls,
  type CurrentCall
} from '../calls/callState'
import { getCallPrefs } from '../lib/callPrefs'
import Avatar from './Avatar'
import {
  AddFriendIcon,
  FullscreenIcon,
  HangUpIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  ScreenShareIcon,
  SpeakingIcon,
  StopShareIcon,
  VideoIcon,
  VideoOffIcon
} from './icons'
import './CallPanel.css'

// The call, shown at the top of its chat (Calling.dc.html, GroupCall.dc.html): a tile for you
// and everyone in or being rung for the call, a shared screen beside them when someone shares,
// and the controls underneath. Dark in every theme.

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

/**
 * How the tiles are laid out for this many people: columns, and a tile height that shrinks with
 * the window. Tiles keep a 16:9 shape (centered), so a wide window doesn't stretch them.
 */
function gridFor(count: number): { cols: number; height: string; face: number; ringFace: number } {
  if (count <= 2) {
    return {
      cols: Math.max(count, 1),
      height: 'clamp(170px, 32vh, 300px)',
      face: 96,
      ringFace: 112
    }
  }
  if (count <= 4) return { cols: 2, height: 'clamp(120px, 21vh, 220px)', face: 76, ringFace: 76 }
  if (count <= 9) return { cols: 3, height: 'clamp(100px, 18vh, 200px)', face: 64, ringFace: 64 }
  return { cols: 4, height: 'clamp(84px, 13vh, 150px)', face: 48, ringFace: 48 }
}

type TileInfo = {
  person: PublicUser
  label: string
  camera: VideoTrack | null
  mirror?: boolean
  muted: boolean
  speaking: boolean
  ringing: boolean
  status: string | null
}

function Tile({
  tile,
  face,
  ringFace
}: {
  tile: TileInfo
  face: number
  ringFace: number
}): React.JSX.Element {
  const { person, label, camera, mirror, muted, speaking, ringing, status } = tile
  return (
    <div className={speaking ? 'call-tile call-tile--speaking' : 'call-tile'}>
      {camera ? (
        <TrackVideo track={camera} mirror={mirror} />
      ) : (
        <div className="call-tile-face">
          <div
            className={ringing ? 'call-glow-face' : 'call-glow-face call-glow-face--still'}
            style={{ width: ringing ? ringFace : face, height: ringing ? ringFace : face }}
          >
            {ringing && <span className="call-ring" aria-hidden="true" />}
            {ringing && <span className="call-ring call-ring--late" aria-hidden="true" />}
            <Avatar
              id={person.id}
              name={person.displayName}
              avatarVersion={person.avatarVersion}
              size={ringing ? ringFace : face}
              className={ringing ? 'call-glow-photo call-glow-photo--ringing' : 'call-glow-photo'}
            />
          </div>
          {status && (
            <div className="call-tile-status">
              {face >= 96 && <strong>{person.displayName}</strong>}
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

/** Group calls: ring people in the group who aren't in the call. */
function AddToCall({
  call,
  people,
  onRing,
  onClose
}: {
  call: Call
  people: PublicUser[]
  onRing: (userIds: string[]) => void
  onClose: () => void
}): React.JSX.Element {
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  const outside = people.filter((p) => memberState(call, p.id) !== 'joined')
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-call-title"
        className="dialog add-to-call"
      >
        <div className="dialog-head">
          <h1 id="add-to-call-title">Add people to the call</h1>
          <p>They&apos;ll be rung wherever they&apos;re signed in.</p>
        </div>
        <div className="add-to-call-list">
          {outside.length === 0 ? (
            <p className="screen-picker-note">Everyone in the group is already here.</p>
          ) : (
            outside.map((p) => {
              const ringing = memberState(call, p.id) === 'ringing'
              const on = picked.includes(p.id)
              return (
                <label
                  key={p.id}
                  className={
                    ringing ? 'add-to-call-row add-to-call-row--ringing' : 'add-to-call-row'
                  }
                >
                  <input
                    type="checkbox"
                    checked={on || ringing}
                    disabled={ringing}
                    onChange={() =>
                      setPicked((list) => (on ? list.filter((x) => x !== p.id) : [...list, p.id]))
                    }
                  />
                  <Avatar
                    id={p.id}
                    name={p.displayName}
                    avatarVersion={p.avatarVersion}
                    size={36}
                  />
                  <span className="add-to-call-name">
                    <strong>{p.displayName}</strong>
                    <span>{ringing ? 'Ringing…' : `@${p.username}`}</span>
                  </span>
                </label>
              )
            })
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="small-button small-button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="small-button small-button--primary"
            disabled={picked.length === 0}
            onClick={() => onRing(picked)}
          >
            {picked.length > 1 ? `Ring ${picked.length} people` : 'Ring'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The call's title line: "Video calling Jacob…", or the chat's name, who's joined and how long. */
function titleOf(c: CurrentCall): { text: string; sub: string | null; timerSince: string | null } {
  const partner = c.chat.kind === 'dm' ? c.chat.people[0] : undefined
  const call = c.call
  if (c.phase === 'reconnecting') return { text: 'Reconnecting…', sub: null, timerSince: null }
  if (c.phase === 'connecting') {
    return {
      text: c.chat.kind === 'group' ? 'Joining…' : 'Connecting…',
      sub: null,
      timerSince: null
    }
  }
  if (call?.status !== 'ongoing') {
    const name = partner ? firstName(partner) : c.chat.title
    return {
      text: c.video ? `Video calling ${name}…` : `Calling ${name}…`,
      sub: null,
      timerSince: null
    }
  }
  return {
    text: partner ? partner.displayName : c.chat.title,
    sub: c.chat.kind === 'group' ? `${joinedCount(call)} of ${call.members.length} joined` : null,
    timerSince: call.answeredAt
  }
}

export default function CallPanel({ me }: { me: SignedInUser }): React.JSX.Element | null {
  const calls = useCalls()
  const { current, room } = calls
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  if (!current) return null

  const call = current.call
  const group = current.chat.kind === 'group'
  const local = room?.localParticipant
  const ready = !!room && room.state === 'connected'
  const micOn = local?.isMicrophoneEnabled ?? false
  const cameraOn = local?.isCameraEnabled ?? false
  const sharing = local?.isScreenShareEnabled ?? false
  const waiting = !call || call.status === 'ringing'
  const title = titleOf(current)

  // Everyone else to show: in the room, joined (still connecting), or being rung.
  const others: TileInfo[] = []
  for (const person of current.chat.people) {
    const remote = room?.remoteParticipants.get(person.id)
    const state = call ? memberState(call, person.id) : 'ringing'
    const ringing = !remote && (state === 'ringing' || (!group && waiting))
    if (group && !remote && !ringing && state !== 'joined') continue
    let status: string | null = null
    if (ringing) status = 'Ringing…'
    else if (!remote && current.partnerAway) status = 'Their connection dropped. Waiting for them…'
    else if (!remote) status = 'Connecting…'
    others.push({
      person,
      label: group ? firstName(person) : person.displayName,
      camera: videoOf(remote, Track.Source.Camera),
      muted: !!remote && !remote.isMicrophoneEnabled,
      speaking: !!remote?.isSpeaking,
      ringing,
      status
    })
  }
  // People who are here first, then whoever's still being rung.
  others.sort((a, b) => Number(a.ringing) - Number(b.ringing))

  const tiles: TileInfo[] = [
    {
      person: me,
      label: 'You',
      camera: videoOf(local, Track.Source.Camera),
      mirror: getCallPrefs().mirrorCamera,
      muted: ready && !micOn,
      speaking: !!local?.isSpeaking,
      ringing: false,
      status: null
    },
    ...others
  ]

  // A shared screen: someone else's first (one shows at a time), otherwise yours.
  let screen: VideoTrack | null = null
  let screenLabel = ''
  for (const p of room?.remoteParticipants.values() ?? []) {
    const track = videoOf(p, Track.Source.ScreenShare)
    if (track) {
      screen = track
      const person = current.chat.people.find((x) => x.id === p.identity)
      screenLabel = person ? `${firstName(person)}'s screen` : 'Shared screen'
      break
    }
  }
  const sharedByOther = !!screen
  if (!screen) {
    screen = videoOf(local, Track.Source.ScreenShare)
    screenLabel = 'Your screen'
  }

  const grid = gridFor(tiles.length)
  const canAdd =
    group &&
    ready &&
    !!call &&
    current.chat.people.some((p) => memberState(call, p.id) !== 'joined')

  return (
    <section className="call-panel" aria-label="Call">
      <div className="call-title">
        <span className="call-dot" aria-hidden="true" />
        <h2>{title.text}</h2>
        {(title.sub || title.timerSince) && (
          <span className="call-sub">
            {title.sub && <>· {title.sub} </>}
            {title.timerSince && (
              <>
                · <CallTimer since={title.timerSince} />
              </>
            )}
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

      {/* With a shared screen, everyone's tiles sit in a column beside it. */}
      <div className={screen ? 'call-media call-media--screen' : 'call-media'}>
        {screen && (
          <div className="call-stage" ref={stageRef}>
            <TrackVideo track={screen} fit="contain" />
            <span className="call-tag">{screenLabel}</span>
            {sharedByOther && (
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

        <div
          className="call-tiles"
          style={{ '--cols': grid.cols, '--tile-h': grid.height } as React.CSSProperties}
        >
          {tiles.map((t) => (
            <Tile
              key={t.person.id}
              tile={t}
              face={screen ? Math.min(grid.face, 56) : grid.face}
              ringFace={screen ? Math.min(grid.ringFace, 56) : grid.ringFace}
            />
          ))}
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
        {group && (
          <button
            type="button"
            className="call-button"
            aria-label="Add people to call"
            title="Add people"
            disabled={!canAdd}
            onClick={() => setAdding(true)}
          >
            <AddFriendIcon size={22} />
          </button>
        )}
        <button
          type="button"
          className="call-hangup"
          aria-label={group ? 'Leave call' : waiting ? 'Cancel call' : 'Hang up'}
          title={group ? 'Leave call' : waiting ? 'Cancel call' : 'Hang up'}
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
      {adding && call && (
        <AddToCall
          call={call}
          people={current.chat.people}
          onClose={() => setAdding(false)}
          onRing={(ids) => {
            setAdding(false)
            void calls.ring(ids)
          }}
        />
      )}
    </section>
  )
}

/** A group call going on in this chat that you're not in: who's there, and Join. */
export function JoinCallBar({
  conversation,
  me
}: {
  conversation: ConversationSummary
  me: SignedInUser
}): React.JSX.Element | null {
  const calls = useCalls()
  const call = calls.callIn(conversation.id)
  if (!call || conversation.kind !== 'group') return null
  if (calls.current?.call?.id === call.id || calls.current?.conversationId === conversation.id) {
    return null
  }
  const mine = memberState(call, me.id)
  if (mine === 'joined' || mine === 'ringing') return null // another device / the Incoming card
  const here = conversation.members.filter((p) => memberState(call, p.id) === 'joined')
  const names = here.map(firstName)
  const who =
    names.length === 0
      ? 'Starting…'
      : `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`
  const busy = !!calls.current
  return (
    <div className="call-join" role="region" aria-label="Call in this group">
      <span className="call-dot" aria-hidden="true" />
      <span className="call-join-faces" aria-hidden="true">
        {here.slice(0, 4).map((p) => (
          <Avatar
            key={p.id}
            id={p.id}
            name={p.displayName}
            avatarVersion={p.avatarVersion}
            size={28}
          />
        ))}
      </span>
      <span className="call-join-text">
        <strong>
          {call.video ? 'Video call' : 'Voice call'} · {joinedCount(call)} of {call.members.length}{' '}
          joined
        </strong>
        <span>{who}</span>
      </span>
      <button
        type="button"
        className="call-join-button"
        title={busy ? "You're already in a call" : 'Join with your microphone'}
        disabled={busy}
        onClick={() => calls.start(conversation, false)}
      >
        <PhoneIcon size={16} strokeWidth={2.2} />
        Join
      </button>
      <button
        type="button"
        className="call-join-button"
        title={busy ? "You're already in a call" : 'Join with your camera on'}
        disabled={busy}
        onClick={() => calls.start(conversation, true)}
      >
        <VideoIcon size={17} strokeWidth={2.2} />
        Join with video
      </button>
    </div>
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
            <strong>{current.chat.title}</strong>
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
          aria-label={current.chat.kind === 'group' ? 'Leave call' : 'Hang up'}
          onClick={calls.hangUp}
        >
          <HangUpIcon size={18} />
        </button>
      </div>
    )
  }

  if (elsewhere && !current) {
    const calling = elsewhere.call.status === 'ringing' && elsewhere.call.callerId
    return (
      <div className="call-strip" role="region" aria-label="Call on another device">
        <span className="call-strip-main call-strip-main--static">
          <span className="call-dot" aria-hidden="true" />
          <span className="call-strip-text">
            <strong>{elsewhere.chat.title}</strong>
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
