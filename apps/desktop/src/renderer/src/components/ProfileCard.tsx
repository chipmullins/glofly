import { useEffect, useRef, useState } from 'react'
import type { Presence, Profile, PublicUser } from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import { shortDate } from '../lib/names'
import { playedFor, playing, STATUS_LABEL } from '../lib/presence'
import Avatar from './Avatar'
import {
  BlockIcon,
  CalendarIcon,
  ChatIcon,
  CloseIcon,
  GameIcon,
  PhoneIcon,
  RemoveFriendIcon,
  VideoIcon
} from './icons'
import './dialogs.css'
import './ProfileDialogs.css'
import EmojiText from './EmojiText'

type Fly = { left: string; top: number; size: 'big' | 'small'; rotate: number }
type Spark = 'a' | 'b'

/** The dark strip across the top of a profile, with its fireflies. */
export function ProfileHero({
  flies,
  sparks,
  label,
  closeLabel,
  onClose
}: {
  flies: Fly[]
  sparks: Spark[]
  label?: string
  closeLabel: string
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="profile-hero">
      {sparks.map((s) => (
        <span key={s} className={`profile-spark profile-spark--${s}`} aria-hidden="true" />
      ))}
      {flies.map((f, i) => (
        <img
          key={i}
          src={fireflyImg}
          alt=""
          draggable={false}
          className={`profile-fly profile-fly--${f.size}`}
          style={{ left: f.left, top: f.top, transform: `rotate(${f.rotate}deg)` }}
        />
      ))}
      {label && <span className="profile-hero-label">{label}</span>}
      <button type="button" className="profile-close" aria-label={closeLabel} onClick={onClose}>
        <CloseIcon size={18} strokeWidth={2.2} />
      </button>
    </div>
  )
}

type ProfileCardProps = {
  /** What's already known, so the card shows right away while the rest loads. */
  person: PublicUser
  /** True if you're friends (shows Remove and Message). */
  isFriend: boolean
  /** Live status from the friends list, if they're a friend. */
  presence?: Presence
  onMessage: () => void
  /** Friends: start a voice or video call */
  onCall?: (video: boolean) => void
  onRemove: () => void
  onBlock: () => void
  onClose: () => void
  onSessionExpired: () => void
}

/** Someone's profile card (Profile.dc.html). */
export default function ProfileCard({
  person,
  isFriend,
  presence: livePresence,
  onMessage,
  onCall,
  onRemove,
  onBlock,
  onClose,
  onSessionExpired
}: ProfileCardProps): React.JSX.Element {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const expiredRef = useRef(onSessionExpired)
  useEffect(() => {
    closeRef.current = onClose
    expiredRef.current = onSessionExpired
  })

  // Load the profile, and reload it if they change it while it's open.
  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      window.glofly.profile.get(person.id).then((result) => {
        if (cancelled) return
        if (result.ok) {
          setProfile(result.data)
          setError(null)
        } else if (result.error === 'unauthorized') expiredRef.current()
        else if (result.error === 'not_found') closeRef.current()
        else setError(result.message)
      })
    }
    load()
    const stop = window.glofly.onEvent((event) => {
      if (event.type === 'profile:changed' && event.userId === person.id) load()
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [person.id])

  // Escape closes; focus starts on the card.
  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const shown = profile ?? { ...person, bio: null, joinedAt: null, presence: null }
  const presence = isFriend ? (livePresence ?? shown.presence ?? undefined) : undefined
  const statusText = presence && presence.status !== 'offline' ? presence.statusText : null
  const game = playing(presence)

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${shown.displayName} profile`}
        className="dialog profile-dialog"
        tabIndex={-1}
      >
        <ProfileHero
          sparks={['a', 'b']}
          flies={[
            { left: '50%', top: 44, size: 'big', rotate: -12 },
            { left: '84%', top: 56, size: 'small', rotate: 14 }
          ]}
          closeLabel="Close profile"
          onClose={onClose}
        />

        <div className="profile-body">
          <div className="profile-side">
            <Avatar
              id={shown.id}
              name={shown.displayName}
              avatarVersion={shown.avatarVersion}
              size={156}
              status={presence?.status}
              ring="var(--glo-surface)"
              className="profile-photo"
            />

            {presence && (
              <div className={`status-pill status-pill--${presence.status}`}>
                {STATUS_LABEL[presence.status]}
              </div>
            )}

            <div className="profile-actions">
              {isFriend && (
                <button type="button" className="profile-action" onClick={onRemove}>
                  <RemoveFriendIcon size={15} strokeWidth={2} />
                  Remove
                </button>
              )}
              <button
                type="button"
                className="profile-action profile-action--danger"
                onClick={onBlock}
              >
                <BlockIcon size={15} strokeWidth={2} />
                Block
              </button>
            </div>

            {shown.joinedAt && (
              <div className="profile-joined">
                <CalendarIcon size={15} strokeWidth={2} />
                Joined Glofly {shortDate(shown.joinedAt)}
              </div>
            )}
          </div>

          <div className="profile-main">
            <div className="profile-names">
              <h2>{shown.displayName}</h2>
              <span>@{shown.username}</span>
            </div>

            {game && (
              <div className="profile-playing">
                <GameIcon size={18} />
                <span>
                  Playing <strong>{game.name}</strong>
                  <span className="profile-playing-time"> · {playedFor(game)}</span>
                </span>
              </div>
            )}

            {statusText && (
              <div className="profile-status-text">
                <ChatIcon size={18} strokeWidth={2} />
                <EmojiText text={statusText} />
              </div>
            )}

            {shown.bio && (
              <div className="profile-about">
                <span className="profile-about-label">About me</span>
                <p>
                  <EmojiText text={shown.bio} />
                </p>
              </div>
            )}

            {error && (
              <p className="dialog-message" role="alert">
                {error}
              </p>
            )}

            {isFriend && (
              <div className="profile-buttons">
                <button type="button" className="profile-message" onClick={onMessage}>
                  <ChatIcon size={18} strokeWidth={2} />
                  Message
                </button>
                {onCall && (
                  <>
                    <button
                      type="button"
                      className="profile-call"
                      aria-label={`Voice call ${shown.displayName}`}
                      title="Voice call"
                      onClick={() => onCall(false)}
                    >
                      <PhoneIcon size={19} />
                    </button>
                    <button
                      type="button"
                      className="profile-call"
                      aria-label={`Video call ${shown.displayName}`}
                      title="Video call"
                      onClick={() => onCall(true)}
                    >
                      <VideoIcon size={20} />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
