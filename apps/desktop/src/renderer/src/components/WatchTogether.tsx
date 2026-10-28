import { useCallback, useEffect, useRef, useState } from 'react'
import { enterFullscreen, exitFullscreen, fullscreenElement, onFullscreenChange } from '../lib/fullscreen'
import {
  canControlWatch,
  isWatchVideoId,
  videoTime,
  watchActionText,
  watchLinkFrom,
  watchPositionAt,
  WATCH_REACTIONS,
  WATCH_SITE_NAMES,
  type WatchControl,
  type WatchSite,
  type WatchPreview,
  type WatchReaction
} from '@glofly/shared/watch'
import type { ApiResult, PublicUser, WatchUpdate } from '../../../preload/api-types'
import type { WatchValue } from '../calls/useWatch'
import WatchPlayer, { type PlayerInfo } from './WatchPlayer'
import Avatar from './Avatar'
import { isWeb } from '../lib/platform'
import {
  BackTenIcon,
  CloseIcon,
  ExitFullscreenIcon,
  ForwardTenIcon,
  FullscreenIcon,
  PauseIcon,
  PlayIcon,
  SpeakerIcon,
  SpeakerOffIcon
} from './icons'
import './dialogs.css'
import './WatchTogether.css'

// Watch Together (0.5.0, the "Glofly Watch Together" mockup): a YouTube video everyone in the
// call sees at the same moment, with play / pause / ±10 s for everyone, a video volume of your
// own, firefly reactions floating over it, and full screen just for you.

const VOLUME_KEY = 'glofly.watchVolume'
/** 0.7.2: the level before Mute, so unmuting goes back to it (it used to jump to 80) */
const VOLUME_BEFORE_MUTE_KEY = 'glofly.watchVolumeBeforeMute'
function storedLevel(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    const v = Number(raw)
    return raw !== null && Number.isFinite(v) && v >= 0 && v <= 100 ? v : fallback
  } catch {
    return fallback
  }
}
function savedVolume(): number {
  return storedLevel(VOLUME_KEY, 80)
}

const firstName = (p: PublicUser): string => p.displayName.trim().split(/\s+/)[0] || p.username

// ---------------------------------------------------------------------------------------------
// The Start dialog: paste a link, see what it is, pick who can pause and skip.

export function StartWatchDialog({
  changing,
  onStart,
  onClose,
  onShareScreen
}: {
  /** Changing the video that's on (no "who controls it" choice then) */
  changing: boolean
  onStart: (link: string, control: WatchControl) => Promise<ApiResult<WatchUpdate>>
  onClose: () => void
  /** 0.7.1: streaming services can't be synced; this shares a screen with sound instead */
  onShareScreen?: () => void
}): React.JSX.Element {
  const [link, setLink] = useState('')
  const [control, setControl] = useState<WatchControl>('everyone')
  /** What the server said about a link (kept with its video id) */
  const [found, setFound] = useState<{
    id: string
    preview: WatchPreview | null
    problem: string | null
  } | null>(null)
  /** Why starting failed, for the link it was about (a new link clears it) */
  const [startFailed, setStartFailed] = useState<{ id: string | null; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const found0 = watchLinkFrom(link)
  /** The link's site and video, as one key */
  const id = found0 ? `${found0.site}:${found0.videoId}` : null
  const site: WatchSite = found0?.site ?? 'youtube'
  const answer = found && found.id === id ? found : null
  const preview = answer?.preview ?? null
  const looking = !!id && !answer
  const startProblem = startFailed && startFailed.id === id ? startFailed.text : null
  const problem = startProblem ?? answer?.problem ?? null

  useEffect(() => {
    input.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // What the link is, a moment after typing stops.
  useEffect(() => {
    if (!id) return
    let gone = false
    const t = setTimeout(() => {
      void window.glofly.watch.preview(link).then((r) => {
        if (gone) return
        setFound(
          r.ok ? { id, preview: r.data, problem: null } : { id, preview: null, problem: r.message }
        )
      })
    }, 350)
    return () => {
      gone = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const submit = async (): Promise<void> => {
    if (!id || busy) return
    setBusy(true)
    const r = await onStart(link.trim(), control)
    setBusy(false)
    if (r.ok) onClose()
    else setStartFailed({ id, text: r.message })
  }

  // Only YouTube's own picture address is ever shown.
  const picture =
    preview?.thumbnailUrl &&
    /^https:\/\/i\.ytimg\.com\/vi\/[A-Za-z0-9_-]{11}\/\w+\.jpg$/.test(preview.thumbnailUrl)
      ? preview.thumbnailUrl
      : null

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="watch-start-title"
        className="dialog watch-start"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div className="dialog-head">
          <div>
            <h1 id="watch-start-title">{changing ? 'Change the video' : 'Watch together'}</h1>
            <p>
              Everyone in this call sees the same video at the same moment. Works with YouTube,
              Twitch, Vimeo and Dailymotion.
            </p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <label className="watch-start-field">
          <span>Video link</span>
          <input
            ref={input}
            value={link}
            onChange={(e) => {
              setLink(e.target.value)
              setStartFailed(null)
            }}
            placeholder="https://youtu.be/… or a Twitch, Vimeo or Dailymotion link"
            maxLength={500}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!link.trim() && !id}
          />
        </label>
        {link.trim() && !id && (
          <p className="watch-start-hint">
            Paste a link from YouTube, Twitch, Vimeo or Dailymotion.
          </p>
        )}
        {/* 0.7.2: Twitch checks every page above its player, and the desktop app's window has no
            web address, so Twitch refuses to play here. Others (browser, phones) still can. */}
        {site === 'twitch' && id && !isWeb && (
          <p className="watch-start-hint">
            Twitch doesn&apos;t play in the desktop app. People on chat.glofly.app or a phone can
            still watch it; you&apos;ll see a note instead of the video.
          </p>
        )}

        {id && (
          <div className="watch-start-preview" aria-live="polite">
            <div className="watch-start-thumb">
              {picture ? <img src={picture} alt="" /> : <span className="watch-start-thumb-glow" />}
            </div>
            <div className="watch-start-meta">
              <strong>
                {preview
                  ? preview.title
                  : looking
                    ? 'Looking it up…'
                    : `${WATCH_SITE_NAMES[site]} video`}
              </strong>
              <span>
                {preview?.channel ?? (looking ? '' : WATCH_SITE_NAMES[site])}
                {found0?.live ? ' · Live' : ''}
              </span>
            </div>
          </div>
        )}

        {!changing && (
          <fieldset className="watch-start-control">
            <legend>Who can pause and skip</legend>
            <div>
              {(['everyone', 'starter'] as const).map((c) => (
                <label
                  key={c}
                  className={control === c ? 'watch-choice watch-choice--on' : 'watch-choice'}
                >
                  <input
                    type="radio"
                    name="watch-control"
                    checked={control === c}
                    onChange={() => setControl(c)}
                  />
                  {c === 'everyone' ? 'Everyone' : 'Only me'}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {problem && (
          <p className="dialog-message" role="alert">
            {problem}
          </p>
        )}

        <p className="watch-start-streaming">
          Netflix, Disney+, Hulu, Max, Prime Video and other streaming services can&apos;t be kept
          in sync here.
          {onShareScreen ? (
            <>
              {' '}
              <button type="button" className="watch-note-link" onClick={onShareScreen}>
                Share your screen with sound
              </button>{' '}
              to watch them together.
            </>
          ) : (
            ' Share your screen with sound from the Glofly desktop app to watch them together.'
          )}
        </p>

        <div className="confirm-actions">
          <button type="button" className="small-button small-button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="small-button small-button--primary"
            disabled={!id || busy}
          >
            {busy ? 'Starting…' : changing ? 'Watch this instead' : 'Start watching'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------
// Firefly reactions: a glowing firefly with a little face and a name floats up over the video.

function ReactionGlyph({
  reaction,
  size = 14
}: {
  reaction: WatchReaction
  size?: number
}): React.JSX.Element {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true }
  switch (reaction) {
    case 'heart':
      return (
        <svg {...common} fill="currentColor">
          <path d="M12 21s-7-4.4-9.3-9C1 8.4 3.2 5 6.6 5c2 0 3.6 1.2 5.4 3 1.8-1.8 3.4-3 5.4-3C20.8 5 23 8.4 21.3 12 19 16.6 12 21 12 21z" />
        </svg>
      )
    case 'laugh':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
          <path d="M7 13.5s1.8 3 5 3 5-3 5-3z" fill="currentColor" />
          <path d="M8 8.5l2 1.2M16 8.5l-2 1.2" />
        </svg>
      )
    case 'wow':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
          <path d="M9 8.5h.01M15 8.5h.01" />
          <ellipse cx="12" cy="15" rx="2.6" ry="3" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'fire':
      return (
        <svg {...common} fill="currentColor">
          <path d="M12 2.5c.6 3.2 4.6 5.2 4.6 10A4.6 4.6 0 0 1 12 17.1a4.6 4.6 0 0 1-4.6-4.6c0-2 1-3.5 2.2-4.6.1 1.4.7 2.4 1.7 2.9-.4-3.1.1-5.8.7-8.3zM12 21.5c-3.9 0-7-2.9-7-6.6 0-.5.1-1 .2-1.5.8 3.2 3.6 5.3 6.8 5.3s6-2.1 6.8-5.3c.1.5.2 1 .2 1.5 0 3.7-3.1 6.6-7 6.6z" />
        </svg>
      )
  }
}

const REACTION_LABEL: Record<WatchReaction, string> = {
  heart: 'Love it',
  laugh: 'Haha',
  wow: 'Wow',
  fire: 'Fire'
}

type Flying = { id: string; reaction: WatchReaction; name: string; x: number; drift: number }

function WatchFireflies({
  callId,
  nameOf
}: {
  callId: string
  nameOf: (userId: string) => string
}): React.JSX.Element {
  const [flying, setFlying] = useState<Flying[]>([])
  const nameRef = useRef(nameOf)
  useEffect(() => {
    nameRef.current = nameOf
  })
  useEffect(() => {
    return window.glofly.onEvent((e) => {
      if (e.type !== 'watch:reaction' || e.callId !== callId) return
      const f: Flying = {
        id: e.id,
        reaction: e.reaction,
        name: nameRef.current(e.userId),
        x: 58 + Math.random() * 32,
        drift: Math.round((Math.random() - 0.5) * 80)
      }
      setFlying((all) => (all.some((x) => x.id === f.id) ? all : [...all.slice(-23), f]))
      setTimeout(() => setFlying((all) => all.filter((x) => x.id !== f.id)), 3400)
    })
  }, [callId])
  return (
    <div className="watch-fireflies" aria-hidden="true">
      {flying.map((f) => (
        <span
          key={f.id}
          className="watch-firefly"
          style={{ left: `${f.x}%`, '--drift': `${f.drift}px` } as React.CSSProperties}
        >
          <span className={`watch-firefly-glow watch-firefly-glow--${f.reaction}`}>
            <ReactionGlyph reaction={f.reaction} />
          </span>
          <span className="watch-firefly-name">{f.name}</span>
          <span className="visually-hidden">sent {REACTION_LABEL[f.reaction]}</span>
        </span>
      ))}
    </div>
  )
}

/** The little mark beside the title: each site's colours (0.7.1), never its logo. */
function SiteMark({ site }: { site: WatchSite }): React.JSX.Element {
  const fill =
    site === 'twitch'
      ? '#9146ff'
      : site === 'vimeo'
        ? '#17d5ff'
        : site === 'dailymotion'
          ? '#0d0d0d'
          : '#ff3b30'
  return (
    <svg width="18" height="13" viewBox="0 0 18 13" aria-label={WATCH_SITE_NAMES[site]} role="img">
      <rect
        width="18"
        height="13"
        rx="3.5"
        fill={fill}
        stroke={site === 'dailymotion' ? '#fff' : 'none'}
        strokeOpacity={0.5}
      />
      <path d="M7 3.6v5.8L12 6.5z" fill="#fff" />
    </svg>
  )
}

// ---------------------------------------------------------------------------------------------
// The video with its controls.

export function WatchStage({
  me,
  people,
  talking,
  api,
  playerUrl,
  parked = false
}: {
  me: PublicUser
  /** Everyone in the call's chat (not you) */
  people: PublicUser[]
  /** Who's talking right now (for the full screen strip) */
  talking: PublicUser[]
  api: WatchValue
  playerUrl: string
  /** 0.7.1: the call is showing something else big: keep playing, out of sight (no reload) */
  parked?: boolean
}): React.JSX.Element | null {
  const watch = api.watch
  /** "Only Jordan can pause and skip": a few seconds after a refused click (0.7.1) */
  const [refused, setRefused] = useState(0)
  useEffect(() => {
    if (!refused) return
    const t = setTimeout(() => setRefused(0), 3500)
    return () => clearTimeout(t)
  }, [refused])
  const fullRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [info, setInfo] = useState<PlayerInfo>({
    status: 'catching',
    error: null,
    muted: false,
    time: 0
  })
  const [volume, setVolumeState] = useState(savedVolume)
  const beforeMute = useRef<number | null>(null)
  const [unmute, setUnmute] = useState(0)
  /** 0.7.2: Alt-click (Option-click) the sync pill: what the player is doing, to read out to Claude */
  const [showDiag, setShowDiag] = useState(false)
  const [dragging, setDragging] = useState<number | null>(null)
  const [idle, setIdle] = useState(false)
  const [, setTick] = useState(0)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // The time line moves on its own while playing.
  useEffect(() => {
    if (!watch?.playing) return
    const t = setInterval(() => setTick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [watch?.playing])

  // Full screen on just the video (only for you), however it ends (button, Esc).
  useEffect(() => {
    const onChange = (): void => {
      setFull(!!fullRef.current && fullscreenElement() === fullRef.current)
      setIdle(false)
    }
    return onFullscreenChange(onChange)
  }, [])
  // Parked: out of full screen.
  useEffect(() => {
    const el = fullRef.current
    if (parked && el && fullscreenElement() === el) void exitFullscreen()
  }, [parked])
  // Leaving the video (it stopped, or the call ended) leaves full screen too.
  useEffect(() => {
    const el = fullRef.current
    return () => {
      if (el && fullscreenElement() === el) void exitFullscreen()
    }
  }, [])

  // Full screen: the controls show when the mouse moves (or a tap), and hide after 3 seconds.
  const wake = useCallback(() => {
    setIdle(false)
    clearTimeout(idleTimer.current)
    idleTimer.current = setTimeout(() => setIdle(true), 3000)
  }, [])
  useEffect(() => {
    if (!full) return
    idleTimer.current = setTimeout(() => setIdle(true), 3000)
    return () => clearTimeout(idleTimer.current)
  }, [full])

  // "Jordan went back 10 seconds": shown for a few seconds after each change.
  // Changes from before you joined (or opened the call) aren't announced.
  const [firstSeq] = useState(() => watch?.seq ?? 0)
  /** The change whose line has had its few seconds */
  const [doneSeq, setDoneSeq] = useState<number | null>(null)
  const nameOf = useCallback(
    (userId: string): string => {
      if (userId === me.id) return 'You'
      const p = people.find((x) => x.id === userId)
      return p ? firstName(p) : 'Someone'
    },
    [me.id, people]
  )
  const seq = watch?.seq ?? 0
  const fresh = !!watch?.last && seq > firstSeq && doneSeq !== seq && watch.last.action !== 'change'
  const said = fresh && watch?.last ? watchActionText(watch, nameOf(watch.last.userId)) : null
  useEffect(() => {
    if (!fresh) return
    const t = setTimeout(() => setDoneSeq(seq), 3500)
    return () => clearTimeout(t)
  }, [fresh, seq])

  if (!watch) return null
  const canControl = canControlWatch(watch, me.id)
  const position = watchPositionAt(watch, api.clock.now())
  const duration = watch.durationSec ?? 0
  const shown = dragging ?? position
  const starter = watch.startedBy === me.id ? 'you' : nameOf(watch.startedBy)
  const live = !!watch.live
  const refusedText = `Only ${starter === 'you' ? 'you' : starter} can pause and skip this video.`
  /** A button someone can't use explains why instead of doing nothing (0.7.1) */
  const tryControl = (run: () => void): void => {
    if (canControl) run()
    else setRefused(Date.now())
  }

  const setVolume = (v: number): void => {
    setVolumeState(v)
    try {
      localStorage.setItem(VOLUME_KEY, String(v))
    } catch {
      // storage off: just for now
    }
  }
  /** The speaker button: mute, or back to the level from before muting */
  const toggleMute = (): void => {
    if (volume === 0) {
      const before = beforeMute.current ?? storedLevel(VOLUME_BEFORE_MUTE_KEY, 80)
      setVolume(before > 0 ? before : 80)
      return
    }
    beforeMute.current = volume
    try {
      localStorage.setItem(VOLUME_BEFORE_MUTE_KEY, String(volume))
    } catch {
      // storage off: remembered until the call closes
    }
    setVolume(0)
  }

  const toggleFull = (): void => {
    const el = fullRef.current
    if (!el) return
    if (fullscreenElement() === el) void exitFullscreen()
    else void enterFullscreen(el)
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (!full || !canControl || (e.target as HTMLElement).closest('input')) return
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault()
      api.control(watch.playing ? 'pause' : 'play')
    } else if (!live && (e.key === 'ArrowLeft' || e.key === 'j')) api.control('back')
    else if (!live && (e.key === 'ArrowRight' || e.key === 'l')) api.control('forward')
    wake()
  }

  const pillBody = info.error ? null : info.status === 'ended' ? (
    <span className="watch-pill watch-pill--quiet">Ended</span>
  ) : info.status === 'paused' ? (
    <span className="watch-pill watch-pill--quiet">
      <span className="watch-pill-dot" />
      <span className="watch-pill-long">Paused for everyone</span>
      <span className="watch-pill-short">Paused</span>
    </span>
  ) : info.status === 'sync' ? (
    <span className="watch-pill watch-pill--good">
      <span className="watch-pill-dot" />
      <span className="watch-pill-long">Everyone in sync</span>
      <span className="watch-pill-short">In sync</span>
    </span>
  ) : (
    <span className="watch-pill watch-pill--wait">
      <span className="watch-pill-dot" />
      <span className="watch-pill-long">Catching up…</span>
      <span className="watch-pill-short">Catching up…</span>
    </span>
  )
  const pill = (
    <span
      className="watch-pill-wrap"
      title="Alt-click for player details"
      onClick={(e) => {
        if (e.altKey) setShowDiag((v) => !v)
      }}
    >
      {pillBody ?? (
        <span className="watch-pill watch-pill--quiet">
          <span className="watch-pill-long">Problem</span>
          <span className="watch-pill-short">Problem</span>
        </span>
      )}
    </span>
  )

  const bar = (
    <div className="watch-bar" role="group" aria-label="Video controls for everyone">
      {!live && (
        <button
          type="button"
          className="watch-skip"
          aria-label={`Back ${10} seconds for everyone`}
          title={canControl ? 'Back 10 seconds' : `Only ${starter} can skip`}
          aria-disabled={!canControl}
          onClick={() => tryControl(() => api.control('back'))}
        >
          <BackTenIcon size={20} />
        </button>
      )}
      <button
        type="button"
        className="watch-play"
        aria-label={watch.playing ? 'Pause for everyone' : 'Play for everyone'}
        title={
          canControl
            ? watch.playing
              ? 'Pause for everyone'
              : 'Play for everyone'
            : `Only ${starter} can pause`
        }
        aria-disabled={!canControl}
        onClick={() => tryControl(() => api.control(watch.playing ? 'pause' : 'play'))}
      >
        {watch.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
      {!live && (
        <button
          type="button"
          className="watch-skip"
          aria-label="Forward 10 seconds for everyone"
          title={canControl ? 'Forward 10 seconds' : `Only ${starter} can skip`}
          aria-disabled={!canControl}
          onClick={() => tryControl(() => api.control('forward'))}
        >
          <ForwardTenIcon size={20} />
        </button>
      )}
      {live ? (
        <span className="watch-live">
          <span className="watch-live-dot" />
          Live
        </span>
      ) : (
        <>
          <span className="watch-time">{videoTime(shown)}</span>
          <input
            type="range"
            className="watch-seek"
            aria-label="Where in the video, for everyone"
            aria-valuetext={`${videoTime(shown)} of ${duration ? videoTime(duration) : 'unknown'}`}
            min={0}
            max={Math.max(1, Math.ceil(duration || position + 1))}
            step={1}
            value={Math.min(Math.round(shown), Math.max(1, Math.ceil(duration || position + 1)))}
            aria-disabled={!canControl || !duration}
            style={
              {
                '--done': `${duration ? Math.min(100, (shown / duration) * 100) : 0}%`
              } as React.CSSProperties
            }
            onPointerDown={(e) => {
              // 0.7.1: a click or drag anywhere on the line seeks for everyone, once let go.
              if (!canControl) {
                e.preventDefault()
                setRefused(Date.now())
                return
              }
              if (!duration) e.preventDefault()
            }}
            onChange={(e) => {
              if (canControl && duration) setDragging(Number(e.target.value))
            }}
            onPointerUp={(e) => {
              const at = dragging ?? Number((e.currentTarget as HTMLInputElement).value)
              if (canControl && duration && Number.isFinite(at)) api.control('seek', at)
              setDragging(null)
            }}
            onPointerCancel={() => setDragging(null)}
            onKeyUp={(e) => {
              if (dragging !== null && e.key !== 'Tab') {
                api.control('seek', dragging)
                setDragging(null)
              }
            }}
            onBlur={() => setDragging(null)}
          />
          <span className="watch-time">{duration ? videoTime(duration) : '–:––'}</span>
        </>
      )}
      {pill}
      {/* 0.7.2: a group, not a <label>: a label re-sends a click on the speaker's icon to the button,
          so Mute ran twice (80 → 0 → 80: nothing seemed to happen, or it jumped to 80). */}
      <div
        className="watch-volume"
        role="group"
        aria-label="Video volume"
        title="Video volume (voices stay the same)"
      >
        <button
          type="button"
          className="watch-volume-icon"
          aria-label={volume === 0 ? 'Turn the video sound on' : 'Mute the video (voices stay on)'}
          onClick={toggleMute}
        >
          {volume === 0 ? <SpeakerOffIcon /> : <SpeakerIcon size={18} />}
        </button>
        <span className="watch-volume-label">Video</span>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          aria-label="Video volume"
          style={{ '--done': `${volume}%` } as React.CSSProperties}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
      <button
        type="button"
        className="watch-full-button"
        aria-label={full ? 'Exit full screen' : 'Full screen video (just for you)'}
        title={full ? 'Exit full screen (Esc)' : 'Full screen (just for you)'}
        onClick={toggleFull}
      >
        {full ? <ExitFullscreenIcon size={18} /> : <FullscreenIcon size={18} />}
      </button>
    </div>
  )

  const reactions = (
    <span className="watch-reactions" role="group" aria-label="Send a firefly reaction">
      {WATCH_REACTIONS.map((r) => (
        <button
          key={r}
          type="button"
          className="watch-react"
          aria-label={`Send a firefly: ${REACTION_LABEL[r]}`}
          title={REACTION_LABEL[r]}
          onClick={() => api.react(r)}
        >
          <span className={`watch-firefly-glow watch-firefly-glow--${r}`}>
            <ReactionGlyph reaction={r} size={13} />
          </span>
        </button>
      ))}
    </span>
  )

  const picker = people.find((p) => p.id === watch.startedBy)
  return (
    <div
      ref={fullRef}
      className={[
        'watch',
        full && 'watch--full',
        full && idle && 'watch--idle',
        parked && 'watch--parked'
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseMove={full ? wake : undefined}
      onPointerDown={full ? wake : undefined}
      onKeyDown={onKey}
    >
      <div className="watch-video">
        {isWatchVideoId(watch.site ?? 'youtube', watch.videoId) && (
          <WatchPlayer
            playerUrl={playerUrl}
            watch={watch}
            clock={api.clock}
            volume={volume}
            unmute={unmute}
            onInfo={setInfo}
            onDuration={(videoId, d, title) => api.report(videoId, d, title || undefined)}
            canControl={canControl}
            onToggle={() => api.control(watch.playing ? 'pause' : 'play')}
            onRefused={() => setRefused(Date.now())}
          />
        )}
        <span className="watch-tag watch-tag--title">
          <SiteMark site={watch.site ?? 'youtube'} />
          <span>{watch.title}</span>
        </span>
        <span className="watch-tag watch-tag--by">
          Picked by {watch.startedBy === me.id ? 'you' : picker ? firstName(picker) : 'someone'}
        </span>
        {refused ? (
          <span key={`r${refused}`} className="watch-said" role="status">
            {refusedText}
          </span>
        ) : (
          said && (
            <span key={seq} className="watch-said" role="status">
              {said}
            </span>
          )
        )}
        <WatchFireflies callId={watch.callId} nameOf={nameOf} />
        {info.error && (
          <div className="watch-problem" role="alert">
            <strong>{info.error}</strong>
            <span>
              {canControl
                ? 'Pick another video with Change video.'
                : 'Someone can pick another video.'}
            </span>
          </div>
        )}
        {!info.error && info.status === 'blocked' && (
          <span className="watch-hint">Tap the video to start it</span>
        )}
        {!info.error && info.muted && (
          <button
            type="button"
            className="watch-hint watch-hint--button"
            onClick={() => setUnmute((n) => n + 1)}
          >
            <SpeakerOffIcon /> Video is muted · Turn on sound
          </button>
        )}
        {full && talking.length > 0 && (
          <div className="watch-talking" aria-label="Talking now">
            {talking.slice(0, 4).map((p) => (
              <span key={p.id} className="watch-talking-person">
                <Avatar id={p.id} name={p.displayName} avatarVersion={p.avatarVersion} size={26} />
                {p.id === me.id ? 'You' : firstName(p)}
              </span>
            ))}
          </div>
        )}
        {full && (
          <div className="watch-full-controls">
            {bar}
            <div className="watch-full-row">
              {reactions}
              <span className="watch-full-hint">Esc to leave full screen</span>
            </div>
          </div>
        )}
      </div>
      {!full && (
        <>
          {bar}
          <div className="watch-note-row">
            <p className="watch-note">
              {watch.control === 'everyone'
                ? 'Anyone in the call can pause or skip.'
                : `Only ${starter} can pause or skip.`}{' '}
              {watch.startedBy === me.id && (
                <button
                  type="button"
                  className="watch-note-link"
                  onClick={() =>
                    api.setControl(watch.control === 'everyone' ? 'starter' : 'everyone')
                  }
                >
                  {watch.control === 'everyone' ? 'Only me' : 'Let everyone'}
                </button>
              )}
            </p>
            {reactions}
          </div>
          {info.limited && (
            <p className="watch-note watch-note--limited">
              {watch.site === 'dailymotion'
                ? "Dailymotion's player can't be kept exactly in step: skips reload the video, and you may need to press play on it."
                : "Glofly can't talk to the video player right now, so skips and pauses reload the video. Alt-click the pill above and tell Claude what it says."}
            </p>
          )}
          {showDiag && (
            <p className="watch-diag" role="status">
              {info.diag ?? 'player: no details yet'}
            </p>
          )}
        </>
      )}
    </div>
  )
}
