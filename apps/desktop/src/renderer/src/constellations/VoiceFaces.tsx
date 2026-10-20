import { useEffect, useRef, useState } from 'react'
import { Room, RoomEvent, Track, VideoQuality, type RemoteTrackPublication } from 'livekit-client'
import type { PublicUser, VoiceNebulaState } from '../../../preload/api-types'
import { AvatarFace } from '../components/Avatar'
import { colorsFor } from '../lib/avatarColors'
import { api } from '../lib/constellations'
import { MicIconLine } from './bits'
import './Feel.css'

// 0.7.5 "See who's in voice" (canvas board 11, approved): faces under each voice nebula, a soft
// glow pulse on whoever's talking, stacked faces when it's busy, and a LIVE preview of a screen
// share on hover (a watch-only peek: no sound, hidden from the room, ended after a short while).

const firstName = (u: PublicUser): string => u.displayName.trim().split(/\s+/)[0] || u.username

/** More people than this (and you're not in it): stacked faces and "Marcus, Nora, Alex and 3 more" */
export const VOICE_LIST_MAX = 4

function Face({
  person,
  size,
  me,
  ring
}: {
  person: PublicUser
  size: number
  me: boolean
  ring?: string
}): React.JSX.Element {
  const [bg, fg] = me ? ['#f47a1f', '#2a1406'] : colorsFor(person.id)
  return (
    <span
      className="cx-face"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.42),
        boxShadow: ring
      }}
    >
      <AvatarFace id={person.id} name={person.displayName} avatarVersion={person.avatarVersion} />
    </span>
  )
}

/** "4 in voice" on the voice nebula's row. */
export function InVoiceCount({ count }: { count: number }): React.JSX.Element {
  return <span className="cx-neb-invoice">{count} in voice</span>
}

export function VoiceFaces({
  people,
  state,
  meId,
  inThisVoice,
  speakingIds,
  onLive,
  onLiveLeave
}: {
  people: PublicUser[]
  state: VoiceNebulaState | undefined
  meId: string
  /** You're in this voice nebula (the full list always shows, and LIVE needs no preview) */
  inThisVoice: boolean
  speakingIds: Set<string>
  /** LIVE pressed or hovered: who's sharing and its button */
  onLive: (sharer: PublicUser, anchor: HTMLElement, how: 'hover' | 'click') => void
  /** The pointer left a LIVE button */
  onLiveLeave: () => void
}): React.JSX.Element | null {
  if (!people.length) return null
  const stacked = people.length > VOICE_LIST_MAX && !inThisVoice
  const live = (p: PublicUser): React.ReactNode =>
    state?.sharing.includes(p.id) ? (
      <button
        type="button"
        className="cx-live cx-live-button"
        aria-label={`Preview ${firstName(p)}'s screen`}
        title={inThisVoice ? `${firstName(p)} is sharing` : `Preview ${firstName(p)}'s screen`}
        onMouseEnter={(e) => !inThisVoice && onLive(p, e.currentTarget, 'hover')}
        onMouseLeave={onLiveLeave}
        onFocus={(e) => !inThisVoice && onLive(p, e.currentTarget, 'hover')}
        onClick={(e) => {
          e.stopPropagation()
          onLive(p, e.currentTarget, 'click')
        }}
      >
        <span className="cx-live-dot" aria-hidden="true" />
        LIVE
      </button>
    ) : null
  if (stacked) {
    const shown = people.slice(0, 3)
    const more = people.length - shown.length
    const sharer = people.find((p) => state?.sharing.includes(p.id))
    return (
      <div className="cx-neb-voice cx-neb-voice--stacked">
        <span className="cx-voice-stack">
          {shown.map((p) => (
            <Face key={p.id} person={p} size={22} me={p.id === meId} ring="0 0 0 2px #1c1210" />
          ))}
          <span className="cx-voice-more">+{more}</span>
        </span>
        <span className="cx-neb-voice-name">
          {shown.map(firstName).join(', ')} and {more} more
        </span>
        {sharer && live(sharer)}
      </div>
    )
  }
  return (
    <div className="cx-neb-voice">
      {people.map((p) => {
        const talking = speakingIds.has(p.id)
        return (
          <div
            key={p.id}
            className={
              talking ? 'cx-neb-voice-person cx-neb-voice-person--talking' : 'cx-neb-voice-person'
            }
          >
            <span className={talking ? 'cx-voice-ring cx-voice-ring--talking' : 'cx-voice-ring'}>
              <Face person={p} size={22} me={p.id === meId} />
            </span>
            <span className="cx-neb-voice-name">
              {p.id === meId ? `${firstName(p)} (you)` : firstName(p)}
            </span>
            {state?.muted.includes(p.id) && (
              <span className="cx-neb-voice-muted" title="Muted by a moderator">
                <MicIconLine size={13} muted />
              </span>
            )}
            {live(p)}
          </div>
        )
      })}
    </div>
  )
}

type PreviewState = 'connecting' | 'playing' | 'ended' | { problem: string }

/**
 * The LIVE preview card: a small, low-frame-rate peek at someone's shared screen, no sound,
 * with Join and watch / Just join voice. It connects with a watch-only pass from the server.
 */
export function LivePreview({
  constellationId,
  nebulaId,
  nebulaName,
  sharer,
  game,
  watching,
  anchor,
  onJoinAndWatch,
  onJustJoin,
  onClose,
  onHoverChange
}: {
  constellationId: string
  nebulaId: string
  nebulaName: string
  sharer: PublicUser
  /** What they're playing ("Rocket League"), if known */
  game: string | null
  /** Everyone else in the voice nebula */
  watching: number
  anchor: DOMRect
  onJoinAndWatch: () => void
  onJustJoin: () => void
  onClose: () => void
  /** The pointer is over the card (hover previews stay open while it is) */
  onHoverChange: (over: boolean) => void
}): React.JSX.Element {
  const video = useRef<HTMLVideoElement>(null)
  const [state, setState] = useState<PreviewState>('connecting')
  const card = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let room: Room | null = null
    let cancelled = false
    let ended: ReturnType<typeof setTimeout> | null = null
    void (async () => {
      const r = await api.voicePreview(constellationId, nebulaId)
      if (cancelled) return
      if (!r.ok) {
        setState({ problem: r.message || "Can't show a preview right now." })
        return
      }
      room = new Room({ adaptiveStream: false, dynacast: false })
      const take = (pub: RemoteTrackPublication, identity: string): void => {
        if (identity !== sharer.id || pub.source !== Track.Source.ScreenShare) return
        pub.setSubscribed(true)
        pub.setVideoQuality(VideoQuality.LOW)
      }
      room.on(RoomEvent.TrackPublished, (pub, p) => take(pub, p.identity))
      room.on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
        if (p.identity !== sharer.id || track.source !== Track.Source.ScreenShare) return
        if (video.current) track.attach(video.current)
        setState('playing')
      })
      room.on(RoomEvent.TrackUnpublished, (pub, p) => {
        if (p.identity === sharer.id && pub.source === Track.Source.ScreenShare) setState('ended')
      })
      room.on(RoomEvent.Disconnected, () => {
        if (!cancelled) setState((s) => (s === 'playing' ? 'ended' : s))
      })
      try {
        await room.connect(r.data.url, r.data.token, { autoSubscribe: false })
        if (cancelled) {
          void room.disconnect()
          return
        }
        for (const p of room.remoteParticipants.values())
          for (const pub of p.trackPublications.values()) take(pub, p.identity)
        ended = setTimeout(() => void room?.disconnect(), r.data.lastsMs)
      } catch {
        if (!cancelled) setState({ problem: "Can't show a preview right now." })
      }
    })()
    return () => {
      cancelled = true
      if (ended) clearTimeout(ended)
      void room?.disconnect()
    }
  }, [constellationId, nebulaId, sharer.id])

  // Escape closes; so does a click elsewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onDown = (e: PointerEvent): void => {
      const t = e.target as HTMLElement
      if (card.current?.contains(t) || t.closest?.('.cx-live-button')) return
      onClose()
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [onClose])

  const top = Math.max(12, Math.min(anchor.top - 120, window.innerHeight - 380))
  const left = Math.min(anchor.right + 14, window.innerWidth - 396)
  const [bg, fg] = colorsFor(sharer.id)
  return (
    <div
      ref={card}
      className="cx-livepop"
      role="dialog"
      aria-label={`${firstName(sharer)} is sharing their screen`}
      style={{ top, left }}
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
    >
      <div className="cx-livepop-screen">
        <video ref={video} muted playsInline autoPlay aria-hidden="true" />
        {state !== 'playing' && (
          <span className="cx-livepop-wait">
            {state === 'connecting'
              ? 'Connecting…'
              : state === 'ended'
                ? 'The preview ended. Join to keep watching.'
                : state.problem}
          </span>
        )}
        <span className="cx-livepop-live">
          <span className="cx-live-dot" aria-hidden="true" />
          LIVE
        </span>
        {watching > 0 && (
          <span className="cx-livepop-watching">
            <span aria-hidden="true">👁</span> {watching} watching
          </span>
        )}
      </div>
      <div className="cx-livepop-body">
        <div className="cx-livepop-who">
          <span
            className="cx-face"
            aria-hidden="true"
            style={{ width: 34, height: 34, background: bg, color: fg, fontSize: 11 }}
          >
            <AvatarFace
              id={sharer.id}
              name={sharer.displayName}
              avatarVersion={sharer.avatarVersion}
            />
          </span>
          <span>
            <b>{firstName(sharer)} is sharing</b>
            <span className="cx-livepop-what">
              {game ? `${game} · ` : ''}in {nebulaName}
            </span>
          </span>
        </div>
        <div className="cx-livepop-actions">
          <button type="button" className="cx-livepop-watch" onClick={onJoinAndWatch}>
            Join and watch
          </button>
          <button type="button" className="cx-livepop-join" onClick={onJustJoin}>
            Just join voice
          </button>
        </div>
        <div className="cx-livepop-note">
          A small, low-frame-rate preview. No sound until you join.
        </div>
      </div>
    </div>
  )
}
