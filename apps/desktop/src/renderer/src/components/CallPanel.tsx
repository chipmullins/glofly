import { useCallback, useEffect, useRef, useState } from 'react'
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
  type CurrentCall,
  type PttState
} from '../calls/callState'
import { getCallPrefs } from '../lib/callPrefs'
import { isMutedForMe } from '../lib/callAudio'
import { CallAudioPanel, PersonVolumeMenu } from './CallAudio'
import ContextMenu, { MenuItem } from './ContextMenu'
import { PinIcon } from './ChatList'
import Avatar from './Avatar'
import {
  AddFriendIcon,
  CloseIcon,
  ExitFullscreenIcon,
  ExpandIcon,
  FullscreenIcon,
  HangUpIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  ScreenShareIcon,
  ShrinkIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  SpeakingIcon,
  StopShareIcon,
  VideoIcon,
  VideoOffIcon
} from './icons'
import { isMac } from '../lib/platform'
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

/** The three ways to see a call: in the chat, bigger (message box still below), or full screen. */
export type CallView = 'normal' | 'large' | 'full'

/** Space the rest of the window needs around the tiles, in each view (px). */
const RESERVED: Record<'large' | 'full', number> = {
  large: 470, // chat header + panel title/controls + a few messages + the message box
  full: 200 // title and controls
}

/**
 * How the tiles are laid out for this many people: columns, and a tile height that follows the
 * window. Tiles keep a 16:9 shape (centered), so a wide window doesn't stretch them.
 */
function gridFor(
  count: number,
  view: CallView = 'normal',
  windowHeight: number = window.innerHeight
): { cols: number; height: string; face: number; ringFace: number } {
  const cols = count <= 2 ? Math.max(count, 1) : count <= 4 ? 2 : count <= 9 ? 3 : 4
  // Normal view: [smallest, share of the window height, largest] tile height, and photo sizes.
  const [min, vh, max, face, ringFace] =
    count <= 2
      ? [170, 32, 300, 96, 112]
      : count <= 4
        ? [120, 21, 220, 76, 76]
        : count <= 9
          ? [100, 18, 200, 64, 64]
          : [84, 13, 150, 48, 48]
  if (view === 'normal')
    return { cols, height: `clamp(${min}px, ${vh}vh, ${max}px)`, face, ringFace }
  // Bigger views: as many rows as needed (up to three; more scroll) share the free height, never
  // smaller than the normal view (on a short window they match it). Photos grow with the tiles.
  const normalPx = Math.min(Math.max(min, (windowHeight * vh) / 100), max)
  const rows = Math.min(Math.ceil(count / cols), 3)
  const freePx = (windowHeight - RESERVED[view]) / rows - ((rows - 1) * 16) / rows
  const tilePx = Math.round(Math.max(normalPx, freePx))
  const bigFace = Math.max(face, Math.min(count <= 2 ? 136 : 112, Math.round(tilePx * 0.45)))
  return { cols, height: `${tilePx}px`, face: bigFace, ringFace: Math.max(ringFace, bigFace) }
}

/** Height of a shared screen in each view. */
function stageHeight(view: CallView): string {
  return view === 'normal'
    ? 'clamp(220px, 44vh, 480px)'
    : `max(clamp(220px, 44vh, 480px), calc(100vh - ${RESERVED[view]}px))`
}

/** Bigger or normal is remembered while Glofly is open, so switching chats keeps your choice. */
let rememberedSize: 'normal' | 'large' = 'normal'

type TileInfo = {
  person: PublicUser
  /** Someone else (right-click for their volume) */
  remote?: boolean
  /** You muted them for yourself (the call's Audio button) */
  mutedForMe?: boolean
  label: string
  camera: VideoTrack | null
  mirror?: boolean
  muted: boolean
  speaking: boolean
  ringing: boolean
  status: string | null
}

type TileView = {
  pinned: boolean
  full: boolean
  onPin: () => void
  onFull: () => void
  register: (el: HTMLDivElement | null) => void
}

function Tile({
  tile,
  face,
  ringFace,
  onMenu,
  view
}: {
  tile: TileInfo
  face: number
  ringFace: number
  /** Right-click: pin, full screen, and (others) their volume */
  onMenu?: (x: number, y: number) => void
  /** The hover buttons: pin / unpin and full screen (null = none, e.g. while ringing) */
  view?: TileView | null
}): React.JSX.Element {
  const { person, label, camera, mirror, muted, speaking, ringing, status, mutedForMe } = tile
  return (
    <div
      ref={view?.register}
      className={[
        'call-tile',
        speaking && 'call-tile--speaking',
        view?.pinned && 'call-tile--pinned'
      ]
        .filter(Boolean)
        .join(' ')}
      title={
        onMenu
          ? tile.remote
            ? `Right-click for ${person.displayName}'s volume and view options`
            : 'Right-click for view options'
          : undefined
      }
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault()
              const rect = e.currentTarget.getBoundingClientRect()
              onMenu(e.clientX || rect.left + 20, e.clientY || rect.top + 20)
            }
          : undefined
      }
    >
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
        {mutedForMe && (
          <span className="call-tag-muted" title="Muted for you">
            <SpeakerOffIcon />
          </span>
        )}
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
      {view && (
        <span className="call-tile-actions">
          <button
            type="button"
            className="call-tile-action"
            aria-label={view.pinned ? `Unpin ${label}` : `Pin ${label}`}
            title={view.pinned ? 'Unpin' : 'Pin (fill the call)'}
            aria-pressed={view.pinned}
            onClick={view.onPin}
          >
            <PinIcon size={16} />
          </button>
          <button
            type="button"
            className="call-tile-action"
            aria-label={view.full ? 'Exit full screen' : `Full screen ${label}`}
            title={view.full ? 'Exit full screen (Esc)' : 'Full screen'}
            onClick={view.onFull}
          >
            {view.full ? <ExitFullscreenIcon size={16} /> : <FullscreenIcon size={16} />}
          </button>
        </span>
      )}
    </div>
  )
}

/** Pick a screen or window to share (with pictures, like the system picker). */
export function ScreenPicker({
  onPick,
  onClose
}: {
  onPick: (sourceId: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [sources, setSources] = useState<ScreenSource[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  // Mac: macOS must allow Screen Recording, or the list only has Glofly and the wallpaper.
  const [needsMacPermission, setNeedsMacPermission] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.glofly.calls.screenSources().then(async (list) => {
      if (cancelled) return
      setSources(list)
      setPicked(list[0]?.id ?? null)
      // Asked after listing: the first listing is what makes macOS show its own prompt.
      if (isMac && (await window.glofly.calls.screenAccess()) !== 'granted' && !cancelled) {
        setNeedsMacPermission(true)
      }
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
        className="dialog dialog--panel screen-picker"
      >
        <div className="dialog-head">
          <h1 id="screen-picker-title">Share your screen</h1>
          <p>Pick what they&apos;ll see. You can stop sharing anytime.</p>
        </div>
        <div className="screen-picker-body">
          {needsMacPermission && (
            <div className="screen-picker-permission" role="note">
              <p>
                To share your screen, allow Glofly in System Settings → Privacy &amp; Security →
                Screen &amp; System Audio Recording, then quit and reopen Glofly.
              </p>
              <button
                type="button"
                className="small-button small-button--quiet"
                onClick={() => window.glofly.app.openPrivacySettings('screen')}
              >
                Open System Settings
              </button>
            </div>
          )}
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
        className="dialog dialog--panel add-to-call"
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
  /** The Audio button's panel, and right-clicking someone's tile */
  const [audioOpen, setAudioOpen] = useState(false)
  /** Right-click on a tile (a person) or on the shared screen */
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null)
  /** Pinned: one person, or the shared screen, fills the call; everyone else in a strip */
  const [focus, setFocus] = useState<{ kind: 'person'; id: string } | { kind: 'screen' } | null>(
    null
  )
  /** Which tile (person id) or 'screen' is full screen on its own */
  const [fullOne, setFullOne] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const tileEls = useRef(new Map<string, HTMLDivElement>())
  const registerTile = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) tileEls.current.set(id, el)
    else tileEls.current.delete(id)
  }, [])
  /** One person's tile (or the shared screen) full screen on its own, or back. */
  const toggleFullOne = useCallback((id: string): void => {
    const el = id === 'screen' ? stageRef.current : tileEls.current.get(id)
    if (!el) return
    if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen().catch(() => {})
  }, [])
  const panelRef = useRef<HTMLElement>(null)
  const [size, setSizeState] = useState<'normal' | 'large'>(rememberedSize)
  const [full, setFull] = useState(false)
  /** Full screen: the title and controls fade away after a few seconds without the mouse moving. */
  const [idle, setIdle] = useState(false)
  /** The bigger views size their tiles from the window height. */
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight)
  useEffect(() => {
    const onResize = (): void => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const setSize = (next: 'normal' | 'large'): void => {
    rememberedSize = next
    setSizeState(next)
  }

  // Follow full screen however it ends (the button, Escape, or Windows).
  useEffect(() => {
    const onChange = (): void => {
      setIdle(false)
      const el = document.fullscreenElement
      setFull(!!panelRef.current && el === panelRef.current)
      let one: string | null = el && el === stageRef.current ? 'screen' : null
      for (const [id, tile] of tileEls.current) if (el === tile) one = id
      setFullOne(one)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    if (!full) return
    let timer = setTimeout(() => setIdle(true), 3000)
    const wake = (): void => {
      setIdle(false)
      clearTimeout(timer)
      timer = setTimeout(() => setIdle(true), 3000)
    }
    const el = panelRef.current
    el?.addEventListener('mousemove', wake)
    el?.addEventListener('mousedown', wake)
    document.addEventListener('keydown', wake)
    return () => {
      clearTimeout(timer)
      el?.removeEventListener('mousemove', wake)
      el?.removeEventListener('mousedown', wake)
      document.removeEventListener('keydown', wake)
    }
  }, [full])

  // The call ending (or leaving its chat) takes the window out of full screen.
  useEffect(() => {
    const el = panelRef.current
    return () => {
      if (el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
    }
  }, [current?.conversationId])

  const toggleFull = (): void => {
    const el = panelRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen().catch(() => {})
  }

  if (!current) return null
  const view: CallView = full ? 'full' : size

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
      remote: true,
      mutedForMe: isMutedForMe(person.id),
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

  const grid = gridFor(tiles.length, view, windowHeight)
  const canAdd =
    group &&
    ready &&
    !!call &&
    current.chat.people.some((p) => memberState(call, p.id) !== 'joined')

  // Pinning (from a tile's hover buttons or its right-click menu). A pin on someone who's
  // gone, or on a screen that stopped, is simply ignored.
  const pinnedTile =
    focus?.kind === 'person' ? tiles.find((t) => t.person.id === focus.id && !t.ringing) : undefined
  const screenFill = focus?.kind === 'screen' && !!screen
  const spotlight = !!pinnedTile || screenFill
  const viewFor = (t: TileInfo): TileView | null =>
    t.ringing
      ? null
      : {
          pinned: t === pinnedTile,
          full: fullOne === t.person.id,
          onPin: () => setFocus(t === pinnedTile ? null : { kind: 'person', id: t.person.id }),
          onFull: () => toggleFullOne(t.person.id),
          register: (el: HTMLDivElement | null) => registerTile(t.person.id, el)
        }
  const menuFor = (t: TileInfo): ((x: number, y: number) => void) | undefined =>
    t.ringing
      ? undefined
      : (x: number, y: number) =>
          setMenuAt({ kind: 'person', person: t.person, remote: !!t.remote, x, y })
  const screenStage = (track: VideoTrack): React.JSX.Element => (
    <div
      className="call-stage"
      ref={stageRef}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenuAt({ kind: 'screen', x: e.clientX, y: e.clientY })
      }}
    >
      <TrackVideo track={track} fit="contain" />
      <span className="call-tag">{screenLabel}</span>
      <span className="call-tile-actions call-tile-actions--stage">
        <button
          type="button"
          className="call-tile-action"
          aria-label={
            screenFill ? 'Show everyone beside the screen' : 'Make the screen fill the call'
          }
          title={screenFill ? 'Show everyone beside it' : 'Fill the call'}
          aria-pressed={screenFill}
          onClick={() => setFocus(screenFill ? null : { kind: 'screen' })}
        >
          <PinIcon size={16} />
        </button>
        {(sharedByOther || screenFill) && (
          <button
            type="button"
            className="call-tile-action"
            aria-label={fullOne === 'screen' ? 'Exit full screen' : 'Full screen'}
            title={fullOne === 'screen' ? 'Exit full screen (Esc)' : 'Full screen'}
            onClick={() => toggleFullOne('screen')}
          >
            {fullOne === 'screen' ? <ExitFullscreenIcon size={16} /> : <FullscreenIcon size={16} />}
          </button>
        )}
      </span>
    </div>
  )

  return (
    <section
      ref={panelRef}
      className={[
        'call-panel',
        view === 'large' && 'call-panel--large',
        full && 'call-panel--full',
        full && idle && 'call-panel--idle'
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Call"
    >
      <div className="call-view-buttons">
        {!full && (
          <button
            type="button"
            className="call-view-button"
            aria-label={size === 'large' ? 'Make the call smaller' : 'Make the call bigger'}
            title={size === 'large' ? 'Smaller' : 'Bigger'}
            onClick={() => setSize(size === 'large' ? 'normal' : 'large')}
          >
            {size === 'large' ? <ShrinkIcon size={18} /> : <ExpandIcon size={18} />}
          </button>
        )}
        <button
          type="button"
          className="call-view-button"
          aria-label={full ? 'Exit full screen' : 'Full screen'}
          title={full ? 'Exit full screen (Esc)' : 'Full screen'}
          onClick={toggleFull}
        >
          {full ? <ExitFullscreenIcon size={18} /> : <FullscreenIcon size={18} />}
        </button>
      </div>

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

      {/* A shared screen sits beside everyone's tiles; pinning someone (or the screen) makes
          it fill the call with everyone else in a strip underneath. */}
      <div
        className={
          spotlight
            ? 'call-media call-media--spotlight'
            : screen
              ? 'call-media call-media--screen'
              : 'call-media'
        }
        style={{ '--stage-h': stageHeight(view) } as React.CSSProperties}
        onDoubleClick={(e) => {
          // Double-click the video to go full screen (or back), like most video players.
          if ((e.target as HTMLElement).closest('button')) return
          toggleFull()
        }}
      >
        {screen && (!spotlight || screenFill) && screenStage(screen)}
        {pinnedTile && (
          <div className="call-spot">
            <Tile
              tile={pinnedTile}
              face={Math.max(grid.face, 112)}
              ringFace={Math.max(grid.ringFace, 112)}
              onMenu={menuFor(pinnedTile)}
              view={viewFor(pinnedTile)}
            />
          </div>
        )}

        <div
          className={spotlight ? 'call-tiles call-tiles--strip' : 'call-tiles'}
          style={{ '--cols': grid.cols, '--tile-h': grid.height } as React.CSSProperties}
        >
          {tiles
            .filter((t) => t !== pinnedTile)
            .map((t) => (
              <Tile
                key={t.person.id}
                tile={t}
                face={spotlight ? 40 : screen ? Math.min(grid.face, 56) : grid.face}
                ringFace={spotlight ? 40 : screen ? Math.min(grid.ringFace, 56) : grid.ringFace}
                onMenu={menuFor(t)}
                view={viewFor(t)}
              />
            ))}
          {pinnedTile && screen && (
            <button
              type="button"
              className="call-tile call-tile--screen-thumb"
              aria-label={`Show ${screenLabel} big`}
              title="Pin the shared screen"
              onClick={() => setFocus({ kind: 'screen' })}
            >
              <TrackVideo track={screen} fit="contain" />
              <span className="call-tag">{screenLabel}</span>
            </button>
          )}
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
        <span className="call-audio-wrap">
          <button
            type="button"
            className={
              audioOpen
                ? 'call-button call-audio-button call-button--open'
                : 'call-button call-audio-button'
            }
            aria-label="Call audio: microphone, speakers and volume"
            aria-expanded={audioOpen}
            aria-haspopup="dialog"
            title="Audio"
            onClick={() => setAudioOpen((v) => !v)}
          >
            <SpeakerIcon size={22} />
          </button>
          {audioOpen && (
            <CallAudioPanel
              people={others.filter((t) => !t.ringing).map((t) => t.person)}
              onClose={() => setAudioOpen(false)}
            />
          )}
        </span>
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

      {calls.ptt && ready && <PttNote ptt={calls.ptt} talking={micOn} />}

      {menuAt && (
        <TileViewMenu
          at={menuAt}
          pinned={
            menuAt.kind === 'screen' ? screenFill : pinnedTile?.person.id === menuAt.person.id
          }
          full={fullOne === (menuAt.kind === 'screen' ? 'screen' : menuAt.person.id)}
          onPin={(pin) =>
            setFocus(
              !pin
                ? null
                : menuAt.kind === 'screen'
                  ? { kind: 'screen' }
                  : { kind: 'person', id: menuAt.person.id }
            )
          }
          onFull={() => toggleFullOne(menuAt.kind === 'screen' ? 'screen' : menuAt.person.id)}
          onClose={() => setMenuAt(null)}
        />
      )}
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

const FLOAT_POS_KEY = 'glofly.callFloat.pos'

function loadFloatPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(FLOAT_POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown }
    return typeof p.x === 'number' && typeof p.y === 'number' ? { x: p.x, y: p.y } : null
  } catch {
    return null
  }
}

/**
 * While you're in a call but looking at another chat: a small floating video you can drag
 * anywhere in the window. Shows a shared screen first, then whoever's talking, then anyone with
 * their camera on (or their photo). Click it to go back to the call; mute, camera and hang up
 * are on it; × hides it until the next call (the sidebar strip stays).
 */
export function CallFloat({
  openChatId,
  onOpenChat
}: {
  openChatId: string | null
  onOpenChat: (conversationId: string) => void
}): React.JSX.Element | null {
  const calls = useCalls()
  const { current, room } = calls
  const [hiddenFor, setHiddenFor] = useState<string | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(loadFloatPos)
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    dx: number
    dy: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)

  // Keep it inside the window when the window gets smaller.
  useEffect(() => {
    const onResize = (): void => {
      setPos((p) => {
        const el = boxRef.current
        if (!p || !el) return p
        return {
          x: Math.min(Math.max(8, p.x), window.innerWidth - el.offsetWidth - 8),
          y: Math.min(Math.max(8, p.y), window.innerHeight - el.offsetHeight - 8)
        }
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!current || current.conversationId === openChatId) return null
  const callKey = current.call?.id ?? current.conversationId
  if (hiddenFor === callKey) return null

  const local = room?.localParticipant
  const micOn = local?.isMicrophoneEnabled ?? true
  const cameraOn = local?.isCameraEnabled ?? false
  const ready = !!room && room.state === 'connected'
  const remotes = [...(room?.remoteParticipants.values() ?? [])]
  const personOf = (id: string): PublicUser | undefined =>
    current.chat.people.find((p) => p.id === id)

  // What to show, most interesting first.
  let video: VideoTrack | null = null
  let fit: 'cover' | 'contain' = 'cover'
  let label = ''
  let who: PublicUser | undefined
  for (const p of remotes) {
    const track = videoOf(p, Track.Source.ScreenShare)
    if (track) {
      video = track
      fit = 'contain'
      const person = personOf(p.identity)
      label = person ? `${firstName(person)}'s screen` : 'Shared screen'
      break
    }
  }
  if (!video) {
    const withCamera = remotes.filter((p) => videoOf(p, Track.Source.Camera))
    const pick = withCamera.find((p) => p.isSpeaking) ?? withCamera[0]
    if (pick) {
      video = videoOf(pick, Track.Source.Camera)
      who = personOf(pick.identity)
      label = who ? firstName(who) : ''
    }
  }
  if (!video) {
    const talking = remotes.find((p) => p.isSpeaking) ?? remotes[0]
    who = (talking && personOf(talking.identity)) ?? current.chat.people[0]
    label = who ? firstName(who) : ''
  }

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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return
    d.moved = true
    const el = e.currentTarget
    setPos({
      x: Math.min(Math.max(8, e.clientX - d.dx), window.innerWidth - el.offsetWidth - 8),
      y: Math.min(Math.max(8, e.clientY - d.dy), window.innerHeight - el.offsetHeight - 8)
    })
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d.moved) {
      onOpenChat(current.conversationId) // a click, not a drag: back to the call
      return
    }
    setPos((p) => {
      try {
        if (p) localStorage.setItem(FLOAT_POS_KEY, JSON.stringify(p))
      } catch {
        // not saved; it still stays put until Glofly closes
      }
      return p
    })
  }

  return (
    <div
      ref={boxRef}
      className="call-float"
      role="region"
      aria-label={`Your call with ${current.chat.title}`}
      title="Drag to move · click to go back to the call"
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="call-float-video">
        {video ? (
          <TrackVideo track={video} fit={fit} />
        ) : (
          who && (
            <Avatar
              id={who.id}
              name={who.displayName}
              avatarVersion={who.avatarVersion}
              size={64}
            />
          )
        )}
        {label && <span className="call-tag">{label}</span>}
        <button
          type="button"
          className="call-float-hide"
          aria-label="Hide the floating video"
          title="Hide (the call keeps going)"
          onClick={() => setHiddenFor(callKey)}
        >
          <CloseIcon size={14} />
        </button>
      </div>
      <div className="call-float-bar">
        <span className="call-dot" aria-hidden="true" />
        <span className="call-float-text">
          <strong>{current.chat.title}</strong>
          <span>{status}</span>
        </span>
        <button
          type="button"
          className={cameraOn ? 'call-strip-button' : 'call-strip-button call-strip-button--off'}
          aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          aria-pressed={cameraOn}
          disabled={!ready}
          onClick={calls.toggleCamera}
        >
          {cameraOn ? <VideoIcon size={17} /> : <VideoOffIcon size={17} />}
        </button>
        <button
          type="button"
          className={micOn ? 'call-strip-button' : 'call-strip-button call-strip-button--off'}
          aria-label={micOn ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={!micOn}
          disabled={!room}
          onClick={calls.toggleMic}
        >
          {micOn ? <MicIcon size={17} /> : <MicOffIcon size={17} />}
        </button>
        <button
          type="button"
          className="call-strip-button call-strip-button--hangup"
          aria-label={current.chat.kind === 'group' ? 'Leave call' : 'Hang up'}
          onClick={calls.hangUp}
        >
          <HangUpIcon size={17} />
        </button>
      </div>
    </div>
  )
}

/** Under the call controls while push to talk is on: "Hold ` to talk", or "Talking…". */
function PttNote({ ptt, talking }: { ptt: PttState; talking: boolean }): React.JSX.Element {
  if (ptt.status === 'permission') {
    return (
      <p className="call-ptt call-ptt--warn" role="status">
        Push to talk needs Glofly allowed under Accessibility. Your mic is on until then.
        <button
          type="button"
          className="call-ptt-link"
          onClick={() => window.glofly.app.openPrivacySettings('accessibility')}
        >
          Open System Settings
        </button>
      </p>
    )
  }
  if (ptt.status === 'unavailable') {
    return (
      <p className="call-ptt call-ptt--warn" role="status">
        Push to talk isn&apos;t working on this computer. Your mic is on.
      </p>
    )
  }
  return (
    <p className={talking ? 'call-ptt call-ptt--talking' : 'call-ptt'} role="status">
      {talking ? (
        <>
          <MicIcon size={14} /> Talking…
        </>
      ) : (
        <>
          Hold <kbd>{ptt.label}</kbd> to talk
        </>
      )}
    </p>
  )
}

type MenuAt =
  | { kind: 'person'; person: PublicUser; remote: boolean; x: number; y: number }
  | { kind: 'screen'; x: number; y: number }

/**
 * Right-click on a tile or the shared screen: pin it (it fills the call) or full screen it.
 * For someone else, their volume follows.
 */
function TileViewMenu({
  at,
  pinned,
  full,
  onPin,
  onFull,
  onClose
}: {
  at: MenuAt
  pinned: boolean
  full: boolean
  onPin: (pin: boolean) => void
  onFull: () => void
  onClose: () => void
}): React.JSX.Element {
  const items = (
    <>
      <MenuItem icon={<PinIcon size={18} />} onClose={onClose} onClick={() => onPin(!pinned)}>
        {at.kind === 'screen'
          ? pinned
            ? 'Show everyone beside it'
            : 'Fill the call'
          : pinned
            ? 'Unpin'
            : 'Pin'}
      </MenuItem>
      <MenuItem
        icon={full ? <ExitFullscreenIcon size={18} /> : <FullscreenIcon size={18} />}
        onClose={onClose}
        onClick={onFull}
      >
        {full ? 'Exit full screen' : 'Full screen'}
      </MenuItem>
    </>
  )
  if (at.kind === 'person' && at.remote) {
    return (
      <PersonVolumeMenu person={at.person} x={at.x} y={at.y} onClose={onClose}>
        {items}
      </PersonVolumeMenu>
    )
  }
  return (
    <ContextMenu
      x={at.x}
      y={at.y}
      label={at.kind === 'screen' ? 'Shared screen' : 'Your tile'}
      onClose={onClose}
    >
      {items}
    </ContextMenu>
  )
}
