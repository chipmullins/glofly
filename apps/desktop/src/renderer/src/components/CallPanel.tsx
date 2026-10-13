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
import { getCallPrefs, onCallPrefsChange, setCallPrefs, type CallPrefs } from '../lib/callPrefs'
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
  FullFrameIcon,
  FullscreenIcon,
  GridIcon,
  HangUpIcon,
  MicIcon,
  MicOffIcon,
  MinimizeIcon,
  PhoneIcon,
  ScreenShareIcon,
  ShrinkIcon,
  SideBySideIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  SpeakingIcon,
  StopShareIcon,
  VideoIcon,
  VideoOffIcon
} from './icons'
import { isMac } from '../lib/platform'
import { cameraFit, type VideoFit } from '../lib/videoFit'
import './CallPanel.css'

// The call, shown at the top of its chat. Dark in every theme. 0.2.2 layouts (the "Glofly call
// layouts" mockups): two people in full frame (their camera fills the call, yours small and
// draggable on top, controls on the video that hide until you move the mouse) or side by side;
// groups in a grid, or one person pinned with everyone else in a column; a shared screen big in
// its own shape with everyone beside it; and full screen on the whole call, one person or the
// screen. Cameras fill their box unless that would crop a lot (an upright phone in a wide tile
// shows whole, with bars); screens are never cropped.

/** A camera or screen, playing in a video element. */
function TrackVideo({
  track,
  mirror = false,
  fit = 'auto',
  onShape
}: {
  track: VideoTrack
  mirror?: boolean
  /** 'auto' (cameras): fill the box unless that would crop a lot, e.g. an upright phone in a wide tile */
  fit?: VideoFit | 'auto'
  /** The video's own width and height, when it starts and whenever it changes */
  onShape?: (w: number, h: number) => void
}): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null)
  const shapeRef = useRef(onShape)
  const [autoFit, setAutoFit] = useState<VideoFit>('cover')
  useEffect(() => {
    shapeRef.current = onShape
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    const refit = (): void => {
      const next = cameraFit(el.videoWidth, el.videoHeight, el.clientWidth, el.clientHeight)
      setAutoFit((f) => (f === next ? f : next))
    }
    const report = (): void => {
      if (el.videoWidth > 0 && el.videoHeight > 0) shapeRef.current?.(el.videoWidth, el.videoHeight)
      refit()
    }
    el.addEventListener('loadedmetadata', report)
    el.addEventListener('resize', report)
    // The box changes too: side by side vs full frame, full screen, the window resized.
    const boxWatch = new ResizeObserver(refit)
    boxWatch.observe(el)
    return () => {
      el.removeEventListener('loadedmetadata', report)
      el.removeEventListener('resize', report)
      boxWatch.disconnect()
      track.detach(el)
    }
  }, [track])
  const shown = fit === 'auto' ? autoFit : fit
  return (
    <video
      ref={ref}
      className={`call-video call-video--${shown}${mirror ? ' call-video--mirror' : ''}`}
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

/** The three sizes of the call: in the chat, bigger (message box still below), or full screen. */
export type CallView = 'normal' | 'large' | 'full'

/**
 * How the call area is laid out (0.2.2, the "Glofly call layouts" mockups):
 * - frame: one person (or a screen) fills the call, your camera small on top, controls on the video
 * - side: two people side by side
 * - grid: everyone in a grid (groups)
 * - pinned: one person big, everyone else in a column on the right (groups)
 * - screen: a shared screen big, in its own shape, with everyone beside it
 */
type Layout = 'frame' | 'side' | 'grid' | 'pinned' | 'screen'

/** Height of the call area for every layout but the grid. */
function areaHeight(layout: Layout, view: CallView): string {
  if (view === 'full') return '100%'
  const base = layout === 'frame' ? 'clamp(260px, 54vh, 560px)' : 'clamp(220px, 38vh, 420px)'
  if (view === 'normal') return base
  // Bigger: as tall as the window allows, leaving the chat header, a few messages and the
  // message box (full frame has its title and buttons on the video, so it needs less).
  return `max(${base}, calc(100vh - ${layout === 'frame' ? 370 : 510}px))`
}

/** Space the rest of the window needs around a bigger grid (px). */
const GRID_RESERVED = 510

/**
 * The grid for this many people: columns, rows and a tile height that follows the window. Tiles
 * share the width; cameras fill them.
 */
function gridFor(
  count: number,
  view: CallView,
  windowHeight: number
): { cols: number; rows: number; height: string; face: number; ringFace: number } {
  const cols = count <= 2 ? Math.max(count, 1) : count <= 4 ? 2 : count <= 9 ? 3 : 4
  const rows = Math.ceil(count / cols)
  const [min, vh, max, face] =
    count <= 4 ? [130, 22, 210, 76] : count <= 9 ? [100, 18, 180, 64] : [84, 13, 140, 48]
  const normalPx = Math.min(Math.max(min, (windowHeight * vh) / 100), max)
  if (view === 'normal') return { cols, rows, height: `${normalPx}px`, face, ringFace: face }
  // Bigger and full screen: up to three rows share the free height (more scroll).
  const shown = Math.min(rows, 3)
  const reserved = view === 'full' ? 100 : GRID_RESERVED // full: title row + margins
  const freePx = (windowHeight - reserved - (shown - 1) * 10) / shown
  const tilePx = Math.round(Math.max(normalPx, freePx))
  const bigFace = Math.max(face, Math.min(112, Math.round(tilePx * 0.4)))
  return { cols, rows, height: `${tilePx}px`, face: bigFace, ringFace: bigFace }
}

/** Bigger (the default) or normal is remembered while Glofly is open, so switching chats keeps your choice. */
let rememberedSize: 'normal' | 'large' = 'large'
/** "Hide my camera" lasts until Glofly closes. */
let rememberedPipHidden = false

type TileInfo = {
  person: PublicUser
  /** You */
  me?: boolean
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

/** The hover buttons in a tile's corner. */
type TileActions = {
  /** Groups: pin this person (they fill most of the call) */
  pin?: { pinned: boolean; onPin: () => void }
  /** Two people side by side: switch to full frame */
  onFrame?: () => void
  /** Full screen this person (or back) */
  full: boolean
  onFull: () => void
}

function Tile({
  tile,
  face,
  ringFace,
  onMenu,
  actions,
  className
}: {
  tile: TileInfo
  face: number
  ringFace: number
  /** Right-click: view options, and (others) their volume */
  onMenu?: (x: number, y: number) => void
  actions?: TileActions | null
  className?: string
}): React.JSX.Element {
  const { person, label, camera, mirror, speaking, ringing, status } = tile
  return (
    <div
      className={[
        'call-tile',
        tile.me && 'call-tile--me',
        speaking && 'call-tile--speaking',
        actions?.pin?.pinned && 'call-tile--pinned',
        className
      ]
        .filter(Boolean)
        .join(' ')}
      data-full={ringing ? undefined : person.id}
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
      <TileTag tile={tile} />
      {actions && (
        <span className="call-tile-actions">
          {actions.onFrame && (
            <button
              type="button"
              className="call-tile-action"
              aria-label={`Full frame ${label}`}
              title="Full frame"
              onClick={actions.onFrame}
            >
              <FullFrameIcon size={16} />
            </button>
          )}
          {actions.pin && (
            <button
              type="button"
              className="call-tile-action"
              aria-label={actions.pin.pinned ? `Unpin ${label}` : `Pin ${label}`}
              title={actions.pin.pinned ? 'Unpin' : 'Pin (make them big)'}
              aria-pressed={actions.pin.pinned}
              onClick={actions.pin.onPin}
            >
              <PinIcon size={16} />
            </button>
          )}
          <button
            type="button"
            className="call-tile-action"
            aria-label={actions.full ? 'Exit full screen' : `Full screen ${label}`}
            title={actions.full ? 'Exit full screen (Esc)' : 'Full screen'}
            onClick={actions.onFull}
          >
            {actions.full ? <ExitFullscreenIcon size={16} /> : <FullscreenIcon size={16} />}
          </button>
        </span>
      )}
    </div>
  )
}

/** The name tag in a tile's corner, with the muted / talking icons. */
function TileTag({ tile }: { tile: TileInfo }): React.JSX.Element {
  const { muted, speaking, mutedForMe, label } = tile
  return (
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
  )
}

/** A corner is "near" when a drop lands within this share of the free space from its edges. */
const SNAP = 0.18

/**
 * Your own camera, small on top of the video (full frame and full screen). Drag it anywhere; it
 * snaps into a corner when dropped near one, and the spot is remembered on this computer.
 * Double-click puts it back bottom-right. The − button shrinks it to a "You" chip.
 */
function SelfPip({
  tile,
  x,
  y,
  hidden,
  onMove,
  onDrop,
  onHide,
  onShow
}: {
  tile: TileInfo
  x: number
  y: number
  hidden: boolean
  /** While dragging (0..1 across the free space) */
  onMove: (x: number, y: number) => void
  /** Dropped (after snapping), or double-clicked back to the corner */
  onDrop: (x: number, y: number) => void
  onHide: () => void
  onShow: () => void
}): React.JSX.Element {
  const drag = useRef<{
    dx: number
    dy: number
    startX: number
    startY: number
    moved: boolean
    x: number
    y: number
  } | null>(null)
  const [dragging, setDragging] = useState(false)

  /** Where the box would be (0..1) with its top-left corner at this point on screen. */
  const fractionAt = (el: HTMLElement, left: number, top: number): { x: number; y: number } => {
    const area = el.offsetParent as HTMLElement | null
    if (!area) return { x, y }
    const rect = area.getBoundingClientRect()
    const css = getComputedStyle(el)
    const m = parseFloat(css.getPropertyValue('--pip-m')) || 0
    const mt = parseFloat(css.getPropertyValue('--pip-mt')) || 0
    const mb = parseFloat(css.getPropertyValue('--pip-mb')) || 0
    const freeW = rect.width - el.offsetWidth - 2 * m
    const freeH = rect.height - el.offsetHeight - mt - mb
    const clamp = (v: number): number => Math.min(1, Math.max(0, v))
    return {
      x: freeW > 0 ? clamp((left - rect.left - m) / freeW) : 1,
      y: freeH > 0 ? clamp((top - rect.top - mt) / freeH) : 1
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    const rect = e.currentTarget.getBoundingClientRect()
    drag.current = {
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      x,
      y
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
    if (!d.moved) setDragging(true)
    d.moved = true
    const f = fractionAt(e.currentTarget, e.clientX - d.dx, e.clientY - d.dy)
    d.x = f.x
    d.y = f.y
    onMove(f.x, f.y)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    drag.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d?.moved) return
    setDragging(false)
    const nearX = d.x < SNAP || d.x > 1 - SNAP
    const nearY = d.y < SNAP || d.y > 1 - SNAP
    if (nearX && nearY) onDrop(Math.round(d.x), Math.round(d.y))
    else onDrop(d.x, d.y)
  }

  const style = { '--px': x, '--py': y } as React.CSSProperties
  if (hidden) {
    return (
      <div className="call-pip call-pip--chip" style={style}>
        <button
          type="button"
          className="call-pip-show"
          aria-label="Show your camera"
          title="Show your camera"
          onClick={onShow}
        >
          {tile.muted ? <MicOffIcon size={14} strokeWidth={2.2} /> : <VideoIcon size={14} />}
          You
        </button>
      </div>
    )
  }
  return (
    <div
      className={[
        'call-pip',
        dragging && 'call-pip--dragging',
        tile.speaking && 'call-pip--speaking'
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
      title="Drag to move · double-click to put it back in the corner"
      data-self-pip=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null
        setDragging(false)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if ((e.target as HTMLElement).closest('button')) return
        onDrop(1, 1)
      }}
    >
      {tile.camera ? (
        <TrackVideo track={tile.camera} mirror={tile.mirror} />
      ) : (
        <div className="call-pip-face">
          <Avatar
            id={tile.person.id}
            name={tile.person.displayName}
            avatarVersion={tile.person.avatarVersion}
            size={44}
          />
        </div>
      )}
      <TileTag tile={tile} />
      <button
        type="button"
        className="call-pip-hide"
        aria-label="Hide your camera (they still see you)"
        title="Hide (they still see you)"
        onClick={onHide}
      >
        <MinimizeIcon size={14} />
      </button>
    </div>
  )
}

/** How long the call's title and buttons stay after the mouse stops (full frame, full screen). */
const HIDE_AFTER = 3000
/** …and at the start of a call, or when full frame / full screen begins. */
const FIRST_SHOW = 5000

/**
 * Full frame and full screen: the title and buttons fade away a few seconds after the mouse stops
 * moving over the call, and come back when it moves. `wake` brings them back for a moment.
 */
function useAutoHide(
  enabled: boolean,
  panelRef: React.RefObject<HTMLElement | null>
): { idle: boolean; wake: (ms?: number) => void } {
  const [idle, setIdle] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const enabledRef = useRef(enabled)
  const wake = useCallback((ms: number = HIDE_AFTER) => {
    clearTimeout(timer.current)
    setIdle(false)
    if (enabledRef.current) timer.current = setTimeout(() => setIdle(true), ms)
  }, [])
  useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) return
    const el = panelRef.current
    timer.current = setTimeout(() => setIdle(true), FIRST_SHOW)
    const onMove = (): void => wake()
    // Keys only count in full screen (typing a message under the call shouldn't wake it).
    const onKey = (): void => {
      if (el && document.fullscreenElement === el) wake()
    }
    el?.addEventListener('mousemove', onMove)
    el?.addEventListener('mousedown', onMove)
    el?.addEventListener('wheel', onMove, { passive: true })
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer.current)
      el?.removeEventListener('mousemove', onMove)
      el?.removeEventListener('mousedown', onMove)
      el?.removeEventListener('wheel', onMove)
      document.removeEventListener('keydown', onKey)
      setIdle(false)
    }
  }, [enabled, panelRef, wake])
  return { idle: enabled && idle, wake }
}

/** The settings this panel follows, kept up to date while it's open. */
function useCallPrefsLive(): CallPrefs {
  const [prefs, setPrefs] = useState(getCallPrefs)
  useEffect(() => onCallPrefsChange(setPrefs), [])
  return prefs
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
  const prefs = useCallPrefsLive()
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState(false)
  /** The Audio button's panel, and right-clicking someone's tile */
  const [audioOpen, setAudioOpen] = useState(false)
  /** Right-click on a tile (a person) or on the shared screen */
  const [menuAt, setMenuAt] = useState<MenuAt | null>(null)
  /** Pinned: one person big with everyone else in a column (groups), or the screen filling the call */
  const [focus, setFocus] = useState<{ kind: 'person'; id: string } | { kind: 'screen' } | null>(
    null
  )
  const panelRef = useRef<HTMLElement>(null)
  const [size, setSizeState] = useState<'normal' | 'large'>(rememberedSize)
  const [full, setFull] = useState(false)
  /** Full screen on one person ('person id') or the shared screen ('screen'); null = the whole call */
  const [fullTarget, setFullTarget] = useState<string | null>(null)
  /** Your camera's spot over the video, while it's being dragged (saved when dropped) */
  const [pip, setPip] = useState(() => ({ x: prefs.pipX, y: prefs.pipY }))
  const [pipHidden, setPipHiddenState] = useState(rememberedPipHidden)
  /** Keyboard focus is on the call's buttons: they stay showing */
  const [keyboardIn, setKeyboardIn] = useState(false)
  /** The bigger views size the grid from the window height. */
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight)
  /** A shared screen's shape, so its box fits it exactly */
  const [screenShape, setScreenShape] = useState({ w: 16, h: 9 })
  useEffect(() => {
    const onResize = (): void => setWindowHeight(window.innerHeight)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const setSize = (next: 'normal' | 'large'): void => {
    rememberedSize = next
    setSizeState(next)
  }
  const setPipHidden = (hidden: boolean): void => {
    rememberedPipHidden = hidden
    setPipHiddenState(hidden)
  }

  // Follow full screen however it ends (the button, Escape, or Windows).
  useEffect(() => {
    const onChange = (): void => {
      const isFull = !!panelRef.current && document.fullscreenElement === panelRef.current
      setFull(isFull)
      if (!isFull) setFullTarget(null)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // The call ending (or leaving its chat) takes the window out of full screen.
  useEffect(() => {
    const el = panelRef.current
    return () => {
      if (el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
    }
  }, [current?.conversationId])

  /** Full screen: the whole call (null), one person, or the shared screen. */
  const enterFull = useCallback((target: string | null): void => {
    setFullTarget(target)
    const el = panelRef.current
    if (el && document.fullscreenElement !== el) void el.requestFullscreen().catch(() => {})
  }, [])
  const exitFull = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
  }

  // ---- what's in the call ----
  const call = current?.call ?? null
  const group = current?.chat.kind === 'group'
  const local = room?.localParticipant
  const ready = !!room && room.state === 'connected'
  const micOn = local?.isMicrophoneEnabled ?? false
  const cameraOn = local?.isCameraEnabled ?? false
  const sharing = local?.isScreenShareEnabled ?? false
  const waiting = !call || call.status === 'ringing'

  // Everyone else to show: in the room, joined (still connecting), or being rung.
  const others: TileInfo[] = []
  for (const person of current?.chat.people ?? []) {
    const remote = room?.remoteParticipants.get(person.id)
    const state = call ? memberState(call, person.id) : 'ringing'
    const ringing = !remote && (state === 'ringing' || (!group && waiting))
    if (group && !remote && !ringing && state !== 'joined') continue
    let status: string | null = null
    if (ringing) status = 'Ringing…'
    else if (!remote && current?.partnerAway) status = 'Their connection dropped. Waiting for them…'
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
  const mine: TileInfo = {
    person: me,
    me: true,
    label: 'You',
    camera: videoOf(local, Track.Source.Camera),
    mirror: prefs.mirrorCamera,
    muted: ready && !micOn,
    speaking: !!local?.isSpeaking,
    ringing: false,
    status: null
  }
  const tiles: TileInfo[] = [mine, ...others]

  // A shared screen: someone else's first (one shows at a time), otherwise yours.
  let screen: VideoTrack | null = null
  let screenLabel = ''
  let sharerId: string | null = null
  for (const p of room?.remoteParticipants.values() ?? []) {
    const track = videoOf(p, Track.Source.ScreenShare)
    if (track) {
      screen = track
      sharerId = p.identity
      const person = current?.chat.people.find((x) => x.id === p.identity)
      screenLabel = person ? `${firstName(person)}'s screen` : 'Shared screen'
      break
    }
  }
  if (!screen) {
    screen = videoOf(local, Track.Source.ScreenShare)
    screenLabel = 'Your screen'
    if (screen) sharerId = me.id
  }

  // ---- the layout ----
  const duo = tiles.length === 2
  const live = (id: string): TileInfo | undefined =>
    tiles.find((t) => t.person.id === id && !t.ringing)
  const targetTile = full && fullTarget && fullTarget !== 'screen' ? live(fullTarget) : undefined
  const targetScreen = full && fullTarget === 'screen' && !!screen
  const pinnedTile = !duo && focus?.kind === 'person' ? live(focus.id) : undefined
  const screenFill = focus?.kind === 'screen' && !!screen
  let layout: Layout
  /** Full frame: who (or what) fills the call */
  let main: TileInfo | 'screen' | null = null
  if (targetScreen) {
    layout = 'frame'
    main = 'screen'
  } else if (targetTile) {
    layout = 'frame'
    main = targetTile
  } else if (screenFill) {
    layout = 'frame'
    main = 'screen'
  } else if (pinnedTile) {
    layout = 'pinned'
  } else if (screen) {
    layout = 'screen'
  } else if (duo) {
    layout = prefs.duoLayout
    if (layout === 'frame') main = others[0]
  } else {
    layout = 'grid'
  }
  const view: CallView = full ? 'full' : size
  const overlay = layout === 'frame' || full
  const autoHide = overlay && prefs.callControls === 'hover'
  const { idle, wake } = useAutoHide(autoHide, panelRef)
  const hold = audioOpen || !!menuAt || picking || adding || keyboardIn
  const hidden = idle && !hold

  // The buttons come back for a moment when something changes: you're muted or unmuted (not by
  // push to talk), your camera, or the connection.
  const pttOn = !!calls.ptt
  const micWake = pttOn ? null : micOn
  const phase = current?.phase
  const firstWake = useRef(true)
  useEffect(() => {
    if (firstWake.current) {
      firstWake.current = false
      return
    }
    const t = setTimeout(() => wake(), 0)
    return () => clearTimeout(t)
  }, [micWake, cameraOn, phase, wake])
  // …and stay a few seconds after a menu or the Audio panel closes.
  useEffect(() => {
    if (hold) return
    const t = setTimeout(() => wake(), 0)
    return () => clearTimeout(t)
  }, [hold, wake])

  if (!current) return null
  const title = titleOf(current)
  const canAdd =
    group &&
    ready &&
    !!call &&
    current.chat.people.some((p) => memberState(call, p.id) !== 'joined')

  // ---- view actions (hover buttons and right-click menus) ----
  const isFullOn = (id: string): boolean =>
    full && (fullTarget === id || (id !== 'screen' && main !== 'screen' && main?.person.id === id))
  const toggleFullOn = (id: string): void => (isFullOn(id) ? exitFull() : enterFull(id))
  const setDuoLayout = (duoLayout: 'frame' | 'side'): void => {
    setCallPrefs({ duoLayout })
  }
  const actionsFor = (t: TileInfo): TileActions | null =>
    t.ringing
      ? null
      : {
          pin: duo
            ? undefined
            : {
                pinned: t === pinnedTile,
                onPin: () => setFocus(t === pinnedTile ? null : { kind: 'person', id: t.person.id })
              },
          onFrame: duo && layout === 'side' && !t.me ? () => setDuoLayout('frame') : undefined,
          full: isFullOn(t.person.id),
          onFull: () => toggleFullOn(t.person.id)
        }
  const menuFor = (t: TileInfo): ((x: number, y: number) => void) | undefined =>
    t.ringing
      ? undefined
      : (x: number, y: number) =>
          setMenuAt({ kind: 'person', person: t.person, remote: !!t.remote, x, y })

  const tileEl = (
    t: TileInfo,
    face: number,
    className?: string,
    withActions = true
  ): React.JSX.Element => (
    <Tile
      key={t.person.id}
      tile={t}
      face={face}
      ringFace={face}
      onMenu={menuFor(t)}
      actions={withActions ? actionsFor(t) : null}
      className={className}
    />
  )

  const screenBox = (fill: boolean): React.JSX.Element | null =>
    screen && (
      <div
        className={fill ? 'call-stage call-stage--fill' : 'call-stage'}
        data-full="screen"
        style={
          fill
            ? undefined
            : ({
                '--shape': `${screenShape.w} / ${screenShape.h}`,
                '--ratio': screenShape.w / screenShape.h
              } as React.CSSProperties)
        }
        onContextMenu={(e) => {
          e.preventDefault()
          setMenuAt({ kind: 'screen', x: e.clientX, y: e.clientY })
        }}
      >
        <TrackVideo
          track={screen}
          fit="contain"
          onShape={(w, h) => setScreenShape((s) => (s.w === w && s.h === h ? s : { w, h }))}
        />
        <span className="call-tag">{screenLabel}</span>
        {!targetScreen && (
          <span className="call-tile-actions">
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
            <button
              type="button"
              className="call-tile-action"
              aria-label={isFullOn('screen') ? 'Exit full screen' : `Full screen ${screenLabel}`}
              title={isFullOn('screen') ? 'Exit full screen (Esc)' : 'Full screen'}
              onClick={() => toggleFullOn('screen')}
            >
              {isFullOn('screen') ? <ExitFullscreenIcon size={16} /> : <FullscreenIcon size={16} />}
            </button>
          </span>
        )}
      </div>
    )

  const grid = gridFor(tiles.length, view, windowHeight)
  let media: React.ReactNode
  if (layout === 'frame') {
    media = (
      <>
        {main === 'screen' ? screenBox(true) : main && tileEl(main, 136, 'call-tile--main', false)}
        {(main === 'screen' || !main?.me) && (
          <SelfPip
            tile={mine}
            x={pip.x}
            y={pip.y}
            hidden={pipHidden}
            onMove={(x, y) => setPip({ x, y })}
            onDrop={(x, y) => {
              setPip({ x, y })
              setCallPrefs({ pipX: x, pipY: y })
            }}
            onHide={() => setPipHidden(true)}
            onShow={() => setPipHidden(false)}
          />
        )}
      </>
    )
  } else if (layout === 'side') {
    // Them on the left, you on the right
    media = [...others, mine].map((t) => tileEl(t, view === 'normal' ? 96 : 136))
  } else if (layout === 'grid') {
    media = tiles.map((t) => tileEl(t, grid.face))
  } else if (layout === 'pinned' && pinnedTile) {
    media = (
      <>
        {tileEl(pinnedTile, 112, 'call-tile--big')}
        <div className="call-column">
          {tiles.filter((t) => t !== pinnedTile).map((t) => tileEl(t, 44, 'call-tile--small'))}
          {screen && (
            <button
              type="button"
              className="call-tile call-tile--small call-tile--screen-thumb"
              aria-label={`Show ${screenLabel} big`}
              title="Show the shared screen"
              onClick={() => setFocus(null)}
            >
              <TrackVideo track={screen} fit="contain" />
              <span className="call-tag">{screenLabel}</span>
            </button>
          )}
        </div>
      </>
    )
  } else {
    // A shared screen: big, in its own shape, with everyone beside it (who's sharing first).
    const beside = [...tiles].sort(
      (a, b) => Number(b.person.id === sharerId) - Number(a.person.id === sharerId)
    )
    const two = beside.length <= 2
    media = (
      <>
        {screenBox(false)}
        <div
          className={two ? 'call-beside call-beside--column' : 'call-beside'}
          data-odd={!two && beside.length % 2 === 1 ? '' : undefined}
        >
          {beside.map((t) => tileEl(t, two ? 64 : 40, 'call-tile--small'))}
        </div>
      </>
    )
  }

  const pinnedName =
    layout === 'pinned' && pinnedTile ? pinnedTile.label : screenFill && !full ? screenLabel : null

  return (
    <section
      ref={panelRef}
      className={[
        'call-panel',
        view === 'large' && 'call-panel--large',
        full && 'call-panel--full',
        overlay && 'call-panel--overlay',
        hidden && 'call-panel--hidden'
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label="Call"
      style={{ '--area-h': areaHeight(layout, view) } as React.CSSProperties}
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) setKeyboardIn(true)
      }}
      onBlur={() => setKeyboardIn(false)}
    >
      <div className="call-head">
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
        <span className="call-head-actions">
          {duo && (layout === 'frame' || layout === 'side') && !targetTile && !targetScreen && (
            <span className="call-layout" role="radiogroup" aria-label="Call layout">
              <button
                type="button"
                role="radio"
                aria-checked={layout === 'side'}
                className={
                  layout === 'side'
                    ? 'call-layout-option call-layout-option--on'
                    : 'call-layout-option'
                }
                onClick={() => setDuoLayout('side')}
              >
                <SideBySideIcon size={16} />
                Side by side
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={layout === 'frame'}
                className={
                  layout === 'frame'
                    ? 'call-layout-option call-layout-option--on'
                    : 'call-layout-option'
                }
                onClick={() => setDuoLayout('frame')}
              >
                <FullFrameIcon size={16} />
                Full frame
              </button>
            </span>
          )}
          {pinnedName && (
            <button type="button" className="call-head-button" onClick={() => setFocus(null)}>
              <GridIcon size={16} />
              {pinnedName} pinned · {layout === 'pinned' ? 'Back to grid' : 'Show everyone'}
            </button>
          )}
          {full ? (
            <button type="button" className="call-head-button" onClick={exitFull}>
              <ExitFullscreenIcon size={16} />
              Exit full screen (Esc)
            </button>
          ) : (
            <>
              <button
                type="button"
                className="call-view-button"
                aria-label={size === 'large' ? 'Make the call smaller' : 'Make the call bigger'}
                title={size === 'large' ? 'Smaller' : 'Bigger'}
                onClick={() => setSize(size === 'large' ? 'normal' : 'large')}
              >
                {size === 'large' ? <ShrinkIcon size={17} /> : <ExpandIcon size={17} />}
              </button>
              <button
                type="button"
                className="call-view-button"
                aria-label="Full screen"
                title="Full screen"
                onClick={() => enterFull(null)}
              >
                <FullscreenIcon size={17} />
              </button>
            </>
          )}
        </span>
      </div>

      {current.problem && (
        <p className="call-problem" role="alert">
          {current.problem}
          <button type="button" aria-label="Dismiss" onClick={calls.clearProblem}>
            ×
          </button>
        </p>
      )}

      <div
        className={`call-media call-media--${layout}`}
        style={
          {
            '--ratio': screenShape.w / screenShape.h,
            '--cols': grid.cols,
            '--rows': grid.rows,
            '--tile-h': grid.height
          } as React.CSSProperties
        }
        onDoubleClick={(e) => {
          // Double-click a person or the screen for full screen on them; again to come back.
          const el = e.target as HTMLElement
          if (el.closest('button') || el.closest('[data-self-pip]')) return
          if (full) return exitFull()
          const id = el.closest<HTMLElement>('[data-full]')?.dataset.full
          enterFull(layout === 'frame' ? null : (id ?? null))
        }}
      >
        {media}
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
        <TileViewMenu at={menuAt} items={menuItemsFor(menuAt)} onClose={() => setMenuAt(null)} />
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

  /** Right-click menu: the view options for that person or the screen. */
  function menuItemsFor(at: MenuAt): ViewMenuItem[] {
    const items: ViewMenuItem[] = []
    if (at.kind === 'screen') {
      if (!targetScreen) {
        items.push({
          label: screenFill ? 'Show everyone beside it' : 'Fill the call',
          icon: <PinIcon size={18} />,
          onClick: () => setFocus(screenFill ? null : { kind: 'screen' })
        })
      }
      items.push(fullItem('screen'))
      return items
    }
    const id = at.person.id
    if (duo) {
      if (layout === 'side' && at.remote) {
        items.push({
          label: 'Full frame',
          icon: <FullFrameIcon size={18} />,
          onClick: () => setDuoLayout('frame')
        })
      } else if (layout === 'frame' && !full) {
        items.push({
          label: 'Side by side',
          icon: <SideBySideIcon size={18} />,
          onClick: () => setDuoLayout('side')
        })
      }
    } else if (!targetTile) {
      const pinned = pinnedTile?.person.id === id
      items.push({
        label: pinned ? 'Unpin' : 'Pin',
        icon: <PinIcon size={18} />,
        onClick: () => setFocus(pinned ? null : { kind: 'person', id })
      })
    }
    items.push(fullItem(id))
    return items
  }
  function fullItem(id: string): ViewMenuItem {
    const on = isFullOn(id)
    return {
      label: on ? 'Exit full screen' : 'Full screen',
      icon: on ? <ExitFullscreenIcon size={18} /> : <FullscreenIcon size={18} />,
      onClick: () => toggleFullOn(id)
    }
  }
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
  const floatHidden = useFloatHidden()

  if (current && current.conversationId !== openChatId) {
    const micOn = room?.localParticipant.isMicrophoneEnabled ?? true
    const callKey = current.call?.id ?? current.conversationId
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
        {floatHidden === callKey && (
          <button
            type="button"
            className="call-strip-button"
            aria-label="Show the floating video"
            title="Show video"
            onClick={() => setFloatHidden(null)}
          >
            <VideoIcon size={18} />
          </button>
        )}
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

// The floating video's × hides it. It comes back when you open the call's chat (and leave it
// again), or from the sidebar strip's "Show video" button. (It used to stay hidden until the next
// call, with no way back.) Shared between CallFloat and CallStrip.
let floatHiddenFor: string | null = null
const floatListeners = new Set<() => void>()
function setFloatHidden(key: string | null): void {
  if (floatHiddenFor === key) return
  floatHiddenFor = key
  floatListeners.forEach((f) => f())
}
function useFloatHidden(): string | null {
  const [, force] = useState(0)
  useEffect(() => {
    const f = (): void => force((n) => n + 1)
    floatListeners.add(f)
    return () => {
      floatListeners.delete(f)
    }
  }, [])
  return floatHiddenFor
}

/**
 * While you're in a call but looking at another chat: a small floating video you can drag
 * anywhere in the window. Shows a shared screen first, then whoever's talking, then anyone with
 * their camera on (or their photo). Click it to go back to the call; mute, camera and hang up
 * are on it; × hides it until you go back to the call (or press the strip's Show video).
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
  const hiddenFor = useFloatHidden()
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

  // Back in the call's chat: the floating video shows again next time you leave it.
  const callChatOpen = !!current && current.conversationId === openChatId
  useEffect(() => {
    if (callChatOpen) setFloatHidden(null)
  }, [callChatOpen])

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
  let fit: VideoFit | 'auto' = 'auto'
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
          onClick={() => setFloatHidden(callKey)}
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

type ViewMenuItem = { label: string; icon: React.ReactNode; onClick: () => void }

/**
 * Right-click on a tile or the shared screen: its view options (pin, full frame, full screen).
 * For someone else, their volume follows.
 */
function TileViewMenu({
  at,
  items,
  onClose
}: {
  at: MenuAt
  items: ViewMenuItem[]
  onClose: () => void
}): React.JSX.Element {
  const list = (
    <>
      {items.map((item) => (
        <MenuItem key={item.label} icon={item.icon} onClose={onClose} onClick={item.onClick}>
          {item.label}
        </MenuItem>
      ))}
    </>
  )
  if (at.kind === 'person' && at.remote) {
    return (
      <PersonVolumeMenu person={at.person} x={at.x} y={at.y} onClose={onClose}>
        {list}
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
      {list}
    </ContextMenu>
  )
}
