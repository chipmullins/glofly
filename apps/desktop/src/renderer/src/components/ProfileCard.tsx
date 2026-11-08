import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  ProfileIcon,
  RemoveFriendIcon,
  VideoIcon
} from './icons'
import './dialogs.css'
import './ProfileDialogs.css'
import EmojiText from './EmojiText'
import MyGamesPanel from './MyGames'
import { usePresence } from '../lib/usePresence'
import { headerUrl } from '../lib/media'
import { ActivityList, BoardGrid, MutualConstellations, MutualFriends } from './ProfileBoard'
import { NICKNAME_MAX } from '@glofly/shared/rules'
import { siteName } from '@glofly/shared/connections'
import { isStreamPage, useFriendsLive } from '../lib/connections'
import '../connections/Connections.css'

type Fly = { left: string; top: number; size: 'big' | 'small'; rotate: number }
type Spark = 'a' | 'b'

/** The dark strip across the top of a profile, with its fireflies. */
export function ProfileHero({
  flies,
  sparks,
  label,
  closeLabel,
  onClose,
  photo
}: {
  flies: Fly[]
  sparks: Spark[]
  label?: string
  /** 0.9.1: their header image (and how far down it shows, 0–100) instead of the night sky */
  photo?: { url: string; focus: number } | null
  closeLabel: string
  onClose: () => void
}): React.JSX.Element {
  const [failed, setFailed] = useState<string | null>(null)
  if (photo && photo.url !== failed) {
    return (
      <div className="profile-hero profile-hero--photo">
        <img
          className="profile-hero-photo"
          src={photo.url}
          alt=""
          draggable={false}
          style={{ objectPosition: `50% ${photo.focus}%` }}
          onError={() => setFailed(photo.url)}
        />
        {label && <span className="profile-hero-label">{label}</span>}
        <button type="button" className="profile-close" aria-label={closeLabel} onClick={onClose}>
          <CloseIcon size={18} strokeWidth={2.2} />
        </button>
      </div>
    )
  }
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
  /** 2.0: it's your own card (My games can be edited) */
  isMe?: boolean
  /** 0.9.1: open someone from Mutual friends */
  onViewPerson?: (person: PublicUser) => void
  /** 0.9.1: open a constellation from the board or Mutual constellations */
  onOpenConstellation?: (id: string) => void
  /** 0.9.1: your own card: Settings → Profile */
  onEditProfile?: () => void
  /**
   * 0.9.1 "View my profile": your own card as a friend or anyone else sees it (the server works
   * it out), with a switch between the two and Edit profile. No actions on it.
   */
  preview?: boolean
}

type Tab = 'board' | 'friends' | 'constellations' | 'activity'

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
  onSessionExpired,
  isMe,
  onViewPerson,
  onOpenConstellation,
  onEditProfile,
  preview
}: ProfileCardProps): React.JSX.Element {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [viewAs, setViewAs] = useState<'friend' | 'everyone'>('friend')
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
      ;(preview
        ? window.glofly.profile.getMine(viewAs)
        : window.glofly.profile.get(person.id)
      ).then((result) => {
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
  }, [person.id, preview, viewAs])

  // Escape closes; focus starts on the card.
  useEffect(() => {
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // A preview opened from Settings closes alone (Settings skips handled Escapes).
      if (preview) e.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey, preview)
    return () => document.removeEventListener('keydown', onKey, preview)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = profile ?? { ...person, bio: null, joinedAt: null, presence: null }
  const stream = useFriendsLive().get(person.id) ?? null
  const presence = preview
    ? viewAs === 'friend'
      ? (livePresence ?? shown.presence ?? undefined)
      : undefined
    : isFriend
      ? (livePresence ?? shown.presence ?? undefined)
      : undefined
  const statusText = presence && presence.status !== 'offline' ? presence.statusText : null
  const game = playing(presence)
  // 2.0 My games: the pop-out beside the card.
  const [gamesOpen, setGamesOpen] = useState(false)
  // 0.9.1: it slides out from behind the card (and back) instead of popping in and shoving it over.
  const games = usePresence(gamesOpen)

  // 0.9.1 tabs: only the ones with something you may see.
  const counts = shown.counts
  const tabs: { id: Tab; label: string }[] = [
    ...(shown.board?.length ? [{ id: 'board' as const, label: 'Board' }] : []),
    ...(!isMe && counts?.mutualFriends
      ? [{ id: 'friends' as const, label: `Mutual friends · ${counts.mutualFriends}` }]
      : []),
    ...(!isMe && counts?.mutualConstellations
      ? [
          {
            id: 'constellations' as const,
            label: `Mutual constellations · ${counts.mutualConstellations}`
          }
        ]
      : []),
    ...(shown.activityShown ? [{ id: 'activity' as const, label: 'Activity' }] : [])
  ]
  const [tabChoice, setTab] = useState<Tab | null>(null)
  const tab = tabs.find((t) => t.id === tabChoice)?.id ?? tabs[0]?.id ?? null
  const header = shown.header
    ? { url: headerUrl(shown.id, shown.header.version), focus: shown.header.focus }
    : null

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* The card and (2.0) My games side by side. My games used to sit inside the card, whose
          scrolling cut off anything beside it, so it never showed. */}
      <div className="profile-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={`${shown.displayName} profile`}
          className={
            tabs.length ? 'dialog profile-dialog profile-dialog--wide' : 'dialog profile-dialog'
          }
          tabIndex={-1}
        >
          {preview && (
            <div className="profile-preview-bar">
              <span className="profile-preview-label">
                <ProfileIcon size={16} />
                Preview: how {viewAs === 'friend'
                  ? 'a friend sees'
                  : 'anyone else on Glofly sees'}{' '}
                your profile
              </span>
              <span className="profile-preview-switch" role="radiogroup" aria-label="See it as">
                {(
                  [
                    ['friend', 'A friend'],
                    ['everyone', 'Anyone else']
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={viewAs === v}
                    onClick={() => setViewAs(v)}
                  >
                    {label}
                  </button>
                ))}
              </span>
              {onEditProfile && (
                <button type="button" className="profile-preview-edit" onClick={onEditProfile}>
                  <PencilIcon size={14} strokeWidth={2} />
                  Edit profile
                </button>
              )}
            </div>
          )}
          <ProfileHero
            photo={header}
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

              {!preview && (
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
              )}
              {onReport && !preview && (
                <button type="button" className="profile-report" onClick={onReport}>
                  <FlagIcon size={14} />
                  Report @{person.username}
                </button>
              )}

              {shown.gamesShown !== false && (
                <button
                  type="button"
                  className="profile-games"
                  aria-expanded={gamesOpen}
                  onClick={() => setGamesOpen((v) => !v)}
                >
                  <GameIcon size={16} />
                  My games
                </button>
              )}

              {/* 0.9.3: their Steam page (they chose to show it) */}
              {!preview &&
                shown.steamUrl &&
                /^https:\/\/steamcommunity\.com\//.test(shown.steamUrl) && (
                  <a
                    className="profile-games profile-steam"
                    href={shown.steamUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="profile-steam-mark" aria-hidden="true">
                      S
                    </span>
                    Steam profile
                  </a>
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
                <div className="profile-name-row">
                  <h2>{shown.displayName}</h2>
                  {shown.pronouns && <span className="profile-pronouns">{shown.pronouns}</span>}
                  {stream && !preview && <span className="live-pill">LIVE</span>}
                </div>
                {/* 0.9.3 (board 9): live on Twitch or Kick */}
                {stream && !preview && (
                  <div className="profile-live">
                    <span className="profile-live-text">
                      <b>Live on {siteName(stream.source)}</b>
                      <span>{[stream.title, stream.game].filter(Boolean).join(' · ')}</span>
                    </span>
                    {isStreamPage(stream.url) && (
                      <a
                        className="profile-live-open"
                        href={stream.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Watch on {siteName(stream.source)}
                      </a>
                    )}
                  </div>
                )}
                <span>
                  @{shown.username}
                  {shown.realName && <> · their name is {shown.realName}</>}
                </span>
              </div>
              {!preview && (
                <NicknameRow
                  userId={person.id}
                  nickname={shown.realName ? shown.displayName : null}
                  placeholder={shown.realName ?? shown.displayName}
                />
              )}

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

              {isFriend && !preview && (
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

              {isMe && !preview && onEditProfile && (
                <button type="button" className="profile-nickname-button" onClick={onEditProfile}>
                  <PencilIcon size={14} strokeWidth={2} />
                  Header, pronouns and board
                </button>
              )}

              {tab && (
                <div className="profile-tabs-area">
                  <div
                    role="tablist"
                    aria-label="Profile"
                    className="pb-tabs"
                    onKeyDown={(e) => {
                      // Arrow keys move between tabs (the usual tab list keys).
                      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                      const i = tabs.findIndex((t) => t.id === tab)
                      const next =
                        tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
                      setTab(next.id)
                      document.getElementById(`pt-${next.id}`)?.focus()
                      e.preventDefault()
                    }}
                  >
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        role="tab"
                        id={`pt-${t.id}`}
                        aria-selected={tab === t.id}
                        tabIndex={tab === t.id ? 0 : -1}
                        aria-controls="pt-panel"
                        className="pb-tab"
                        onClick={() => setTab(t.id)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <SteadyPanel resetKey={`${person.id}:${preview ? viewAs : ''}`}>
                    <div
                      role="tabpanel"
                      id="pt-panel"
                      aria-labelledby={`pt-${tab}`}
                      className="pb-panel"
                      key={tab}
                    >
                      {tab === 'board' && shown.board ? (
                        <BoardGrid
                          tiles={shown.board}
                          name={shown.displayName}
                          onOpenConstellation={onOpenConstellation}
                          onAllGames={() => setGamesOpen(true)}
                        />
                      ) : tab === 'friends' ? (
                        <MutualFriends userId={person.id} onViewPerson={(p) => onViewPerson?.(p)} />
                      ) : tab === 'constellations' ? (
                        <MutualConstellations
                          userId={person.id}
                          name={shown.displayName}
                          onOpenConstellation={onOpenConstellation}
                        />
                      ) : tab === 'activity' ? (
                        <ActivityList userId={person.id} as={preview ? viewAs : undefined} />
                      ) : null}
                    </div>
                  </SteadyPanel>
                </div>
              )}
            </div>
          </div>
        </div>
        {games.shown && (
          <MyGamesPanel
            leaving={games.leaving}
            userId={person.id}
            name={shown.displayName}
            isMe={isMe === true}
            onClose={() => setGamesOpen(false)}
          />
        )}
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

/**
 * 0.9.1: the tabs' area never shrinks while the card is open (it keeps the tallest tab's height so
 * far), so switching between Board, Mutual friends and Activity doesn't make the card jump. It can
 * still grow, gently, when a longer tab is opened.
 */
function SteadyPanel({
  children,
  resetKey
}: {
  children: React.ReactNode
  resetKey: string
}): React.JSX.Element {
  const inner = useRef<HTMLDivElement>(null)
  const [min, setMin] = useState(0)
  useEffect(() => setMin(0), [resetKey])
  useLayoutEffect(() => {
    const el = inner.current
    if (!el) return
    const note = (): void =>
      setMin((m) => Math.max(m, Math.ceil(el.getBoundingClientRect().height)))
    note()
    const ro = new ResizeObserver(note)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="pb-steady" style={{ minHeight: min || undefined }}>
      <div ref={inner}>{children}</div>
    </div>
  )
}
