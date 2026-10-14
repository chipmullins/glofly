import { useEffect, useRef, useState } from 'react'
import type { Presence, Profile, PublicUser } from '../../../preload/api-types'
import fireflyImg from '../assets/firefly.png'
import { shortDate } from '../lib/names'
import { mobileLabel, onMobile, playedFor, playing, STATUS_LABEL } from '../lib/presence'
import Avatar from './Avatar'
import {
  BellIcon,
  BellOffIcon,
  BlockIcon,
  FlagIcon,
  CalendarIcon,
  ChatIcon,
  CloseIcon,
  GameIcon,
  PencilIcon,
  PhoneIcon,
  RemoveFriendIcon,
  VideoIcon
} from './icons'
import './dialogs.css'
import './ProfileDialogs.css'
import EmojiText from './EmojiText'
import { NICKNAME_MAX } from '@glofly/shared/rules'

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
  /** Missing for a restricted (family-managed) account: their family removes friends. */
  onRemove?: () => void
  onBlock: () => void
  /** Report this person to the Glofly team */
  onReport?: () => void
  /** "Notify me when they come online": on or off (undefined: not a friend, or an older server) */
  onlineAlert?: boolean
  onOnlineAlert?: (on: boolean) => void
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
  onReport,
  onlineAlert,
  onOnlineAlert,
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
              mobile={onMobile(presence ?? undefined)}
              ring="var(--glo-surface)"
              className="profile-photo"
            />

            {presence && (
              <div className={`status-pill status-pill--${presence.status}`}>
                {mobileLabel(presence) ?? STATUS_LABEL[presence.status]}
              </div>
            )}

            <div className="profile-actions">
              {isFriend && onRemove && (
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
            {onReport && (
              <button type="button" className="profile-report" onClick={onReport}>
                <FlagIcon size={14} />
                Report @{person.username}
              </button>
            )}

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
              <span>
                @{shown.username}
                {shown.realName && <> · their name is {shown.realName}</>}
              </span>
            </div>
            <NicknameRow
              userId={person.id}
              nickname={shown.realName ? shown.displayName : null}
              placeholder={shown.realName ?? shown.displayName}
            />

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
                {onlineAlert !== undefined && onOnlineAlert && (
                  <button
                    type="button"
                    className={onlineAlert ? 'profile-call profile-call--on' : 'profile-call'}
                    aria-pressed={onlineAlert}
                    aria-label={`Notify me when ${shown.displayName} comes online`}
                    title={
                      onlineAlert
                        ? 'You’ll be notified when they come online (click to stop)'
                        : 'Notify me when they come online'
                    }
                    onClick={() => onOnlineAlert(!onlineAlert)}
                  >
                    {onlineAlert ? <BellIcon size={19} /> : <BellOffIcon size={19} />}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Your own name for someone (Oct 2026): only you see it, everywhere in Glofly. The server swaps it
 * in for their display name; their own name stays on the card ("their name is …").
 */
function NicknameRow({
  userId,
  nickname,
  placeholder
}: {
  userId: string
  nickname: string | null
  placeholder: string
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(nickname ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const save = async (next: string | null): Promise<void> => {
    setBusy(true)
    setProblem(null)
    const result = await window.glofly.profile.setNickname(userId, next)
    setBusy(false)
    if (result.ok) setEditing(false)
    else setProblem(result.message)
    // The card and every list reload by themselves (the server sends profile:changed).
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="profile-nickname-button"
        onClick={() => {
          setValue(nickname ?? '')
          setEditing(true)
        }}
      >
        <PencilIcon size={14} strokeWidth={2} />
        {nickname ? 'Change nickname' : 'Give them a nickname'}
      </button>
    )
  }
  return (
    <form
      className="profile-nickname-form"
      onSubmit={(e) => {
        e.preventDefault()
        void save(value.trim() || null)
      }}
    >
      <label className="profile-nickname-label" htmlFor="profile-nickname">
        Nickname · only you see it
      </label>
      <input
        id="profile-nickname"
        className="ep-input"
        value={value}
        maxLength={NICKNAME_MAX}
        placeholder={placeholder}
        autoFocus
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            setEditing(false)
          }
        }}
      />
      {problem && (
        <p className="dialog-message" role="alert">
          {problem}
        </p>
      )}
      <div className="profile-nickname-buttons">
        {nickname && (
          <button
            type="button"
            className="small-button small-button--quiet"
            disabled={busy}
            onClick={() => void save(null)}
          >
            Remove nickname
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="small-button small-button--quiet"
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
        <button type="submit" className="small-button small-button--primary" disabled={busy}>
          Save
        </button>
      </div>
    </form>
  )
}
