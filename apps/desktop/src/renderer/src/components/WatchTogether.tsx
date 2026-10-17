import { useCallback, useEffect, useRef, useState } from 'react'
import {
  canControlWatch,
  isYouTubeId,
  videoTime,
  watchActionText,
  watchPositionAt,
  WATCH_REACTIONS,
  youTubeIdFrom,
  type WatchControl,
  type WatchPreview,
  type WatchReaction
} from '@glofly/shared/watch'
import type { ApiResult, PublicUser, WatchUpdate } from '../../../preload/api-types'
import type { WatchValue } from '../calls/useWatch'
import WatchPlayer, { type PlayerInfo } from './WatchPlayer'
import Avatar from './Avatar'
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
function savedVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY))
    return Number.isFinite(v) && v >= 0 && v <= 100 && localStorage.getItem(VOLUME_KEY) !== null
      ? v
      : 80
  } catch {
    return 80
  }
}

const firstName = (p: PublicUser): string => p.displayName.trim().split(/\s+/)[0] || p.username

// ---------------------------------------------------------------------------------------------
// The Start dialog: paste a link, see what it is, pick who can pause and skip.

export function StartWatchDialog({
  changing,
  onStart,
  onClose
}: {
  /** Changing the video that's on (no "who controls it" choice then) */
  changing: boolean
  onStart: (link: string, control: WatchControl) => Promise<ApiResult<WatchUpdate>>
  onClose: () => void
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
  const id = youTubeIdFrom(link)
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
            <p>Everyone in this call sees the same video at the same moment. Works with YouTube.</p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <label className="watch-start-field">
          <span>YouTube link</span>
          <input
            ref={input}
            value={link}
            onChange={(e) => {
              setLink(e.target.value)
              setStartFailed(null)
            }}
            placeholder="https://youtu.be/…"
            maxLength={500}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={!!link.trim() && !id}
          />
        </label>
        {link.trim() && !id && (
          <p className="watch-start-hint">Paste a link from YouTube (youtube.com or youtu.be).</p>
        )}

        {id && (
          <div className="watch-start-preview" aria-live="polite">
            <div className="watch-start-thumb">
              {picture ? <img src={picture} alt="" /> : <span className="watch-start-thumb-glow" />}
            </div>
            <div className="watch-start-meta">
              <strong>
                {preview ? preview.title : looking ? 'Looking it up…' : 'YouTube video'}
              </strong>
              <span>{preview?.channel ?? (looking ? '' : 'YouTube')}</span>
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

// ---------------------------------------------------------------------------------------------
// The video with its controls.

export function WatchStage({
  me,
  people,
  talking,
  api,
  playerUrl
}: {
  me: PublicUser
  /** Everyone in the call's chat (not you) */
  people: PublicUser[]
  /** Who's talking right now (for the full screen strip) */
  talking: PublicUser[]
  api: WatchValue
  playerUrl: string
}): React.JSX.Element | null {
  const watch = api.watch
  const fullRef = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [info, setInfo] = useState<PlayerInfo>({
    status: 'catching',
    error: null,
    muted: false,
    time: 0
  })
  const [volume, setVolumeState] = useState(savedVolume)
  const [unmute, setUnmute] = useState(0)
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
      setFull(!!fullRef.current && document.fullscreenElement === fullRef.current)
      setIdle(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  // Leaving the video (it stopped, or the call ended) leaves full screen too.
  useEffect(() => {
    const el = fullRef.current
    return () => {
      if (el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
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

  const setVolume = (v: number): void => {
    setVolumeState(v)
    try {
      localStorage.setItem(VOLUME_KEY, String(v))
    } catch {
      // storage off: just for now
    }
  }

  const toggleFull = (): void => {
    const el = fullRef.current
    if (!el) return
    if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen().catch(() => {})
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (!full || !canControl || (e.target as HTMLElement).closest('input')) return
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault()
      api.control(watch.playing ? 'pause' : 'play')
    } else if (e.key === 'ArrowLeft' || e.key === 'j') api.control('back')
    else if (e.key === 'ArrowRight' || e.key === 'l') api.control('forward')
    wake()
  }

  const pill = info.error ? null : info.status === 'ended' ? (
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

  const bar = (
    <div className="watch-bar" role="group" aria-label="Video controls for everyone">
      <button
        type="button"
        className="watch-skip"
        aria-label={`Back ${10} seconds for everyone`}
        title={canControl ? 'Back 10 seconds' : `Only ${starter} can skip`}
        disabled={!canControl}
        onClick={() => api.control('back')}
      >
        <BackTenIcon size={20} />
      </button>
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
        disabled={!canControl}
        onClick={() => api.control(watch.playing ? 'pause' : 'play')}
      >
        {watch.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
      <button
        type="button"
        className="watch-skip"
        aria-label="Forward 10 seconds for everyone"
        title={canControl ? 'Forward 10 seconds' : `Only ${starter} can skip`}
        disabled={!canControl}
        onClick={() => api.control('forward')}
      >
        <ForwardTenIcon size={20} />
      </button>
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
        disabled={!canControl || !duration}
        style={
          {
            '--done': `${duration ? Math.min(100, (shown / duration) * 100) : 0}%`
          } as React.CSSProperties
        }
        onChange={(e) => setDragging(Number(e.target.value))}
        onPointerUp={() => {
          if (dragging !== null) api.control('seek', dragging)
          setDragging(null)
        }}
        onKeyUp={(e) => {
          if (dragging !== null && e.key !== 'Tab') {
            api.control('seek', dragging)
            setDragging(null)
          }
        }}
        onBlur={() => setDragging(null)}
      />
      <span className="watch-time">{duration ? videoTime(duration) : '–:––'}</span>
      {pill}
      <label className="watch-volume" title="Video volume (voices stay the same)">
        <button
          type="button"
          className="watch-volume-icon"
          aria-label={volume === 0 ? 'Turn the video sound on' : 'Mute the video (voices stay on)'}
          onClick={() => setVolume(volume === 0 ? 80 : 0)}
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
      </label>
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
      className={['watch', full && 'watch--full', full && idle && 'watch--idle']
        .filter(Boolean)
        .join(' ')}
      onMouseMove={full ? wake : undefined}
      onPointerDown={full ? wake : undefined}
      onKeyDown={onKey}
    >
      <div className="watch-video">
        {isYouTubeId(watch.videoId) && (
          <WatchPlayer
            playerUrl={playerUrl}
            watch={watch}
            clock={api.clock}
            volume={volume}
            unmute={unmute}
            onInfo={setInfo}
            onDuration={(videoId, d, title) => api.report(videoId, d, title || undefined)}
          />
        )}
        <span className="watch-tag watch-tag--title">
          <svg width="18" height="13" viewBox="0 0 18 13" aria-hidden="true">
            <rect width="18" height="13" rx="3.5" fill="#ff3b30" />
            <path d="M7 3.6v5.8L12 6.5z" fill="#fff" />
          </svg>
          <span>{watch.title}</span>
        </span>
        <span className="watch-tag watch-tag--by">
          Picked by {watch.startedBy === me.id ? 'you' : picker ? firstName(picker) : 'someone'}
        </span>
        {said && (
          <span key={seq} className="watch-said" role="status">
            {said}
          </span>
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
        </>
      )}
    </div>
  )
}
