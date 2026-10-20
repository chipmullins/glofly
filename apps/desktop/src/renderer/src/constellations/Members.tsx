import { useEffect, useState } from 'react'
import { ROLE_COLORS, gameInitials, playingFor } from '@glofly/shared/constellations'
import type {
  ConstellationDetail,
  ConstellationMember,
  MemberCardInfo,
  PublicUser,
  SignedInUser
} from '../../../preload/api-types'
import { AvatarFace } from '../components/Avatar'
import StatusDot from '../components/StatusDot'
import { colorsFor } from '../lib/avatarColors'
import { api, topRole } from '../lib/constellations'
import { SpeakerIcon } from './bits'
import './Members.css'

// 0.7.5 Constellations polish, "Members list with life" (the approved Members board): members
// grouped by role in role colors, what people play and for how long, Offline folded away with
// "Last here 2 h ago", and the member card (roles, playing now, mutual friends, member since,
// Message / Call / ⋯).

export type MemberGroup = {
  key: string
  title: string
  color: string
  members: ConstellationMember[]
}

const firstName = (u: PublicUser): string => u.displayName.trim().split(/\s+/)[0] || u.username

/** A game's little tile color (the same game always gets the same one). */
const GAME_TILES = ['#1d4fa0', '#e0193a', '#2e9e5b', '#7457e6', '#d4448c', '#127a85', '#b8430a']
function gameTileColor(name: string): string {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return GAME_TILES[h % GAME_TILES.length]
}

export function GameTile({ name, size = 18 }: { name: string; size?: number }): React.JSX.Element {
  const code = gameInitials(name)
  return (
    <span
      className="cx-game-tile"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.26),
        background: gameTileColor(name),
        fontSize: code.length > 2 ? Math.round(size * 0.36) : Math.round(size * 0.42)
      }}
    >
      {code}
    </span>
  )
}

/** "2 h ago", "yesterday", "3 days ago" */
function lastHere(iso: string, now: number): string {
  const min = Math.max(1, Math.floor((now - new Date(iso).getTime()) / 60_000))
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.floor(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

function Face({
  person,
  size,
  me
}: {
  person: PublicUser
  size: number
  me: boolean
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
        fontSize: Math.round(size * 0.38)
      }}
    >
      <AvatarFace id={person.id} name={person.displayName} avatarVersion={person.avatarVersion} />
    </span>
  )
}

function readFolded(id: string, offline: number): boolean {
  try {
    const v = localStorage.getItem(`glofly.cx.offlineFolded.${id}`)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* storage blocked */
  }
  // Big constellations start with Offline folded away.
  return offline > 12
}

export function MembersPanel({
  c,
  me,
  groups,
  now,
  openId,
  onOpen
}: {
  c: ConstellationDetail
  me: SignedInUser
  groups: MemberGroup[]
  now: number
  /** The member whose card is open */
  openId: string | null
  onOpen: (member: ConstellationMember, rect: DOMRect) => void
}): React.JSX.Element {
  const offline = groups.find((g) => g.key === 'offline')
  const [folded, setFolded] = useState(() => readFolded(c.id, offline?.members.length ?? 0))
  const [foldedFor, setFoldedFor] = useState(c.id)
  if (foldedFor !== c.id) {
    setFoldedFor(c.id)
    setFolded(readFolded(c.id, offline?.members.length ?? 0))
  }
  const toggleFold = (): void => {
    setFolded((v) => {
      try {
        localStorage.setItem(`glofly.cx.offlineFolded.${c.id}`, v ? '0' : '1')
      } catch {
        /* storage blocked */
      }
      return !v
    })
  }
  const nameColor = (userId: string): string | undefined => {
    const role = topRole(c, userId)
    return role.kind === 'member' ? undefined : (ROLE_COLORS[role.color] ?? ROLE_COLORS.gray).light
  }
  /** What shows under a name: voice, playing (with how long), timed out, last here. */
  function sub(m: ConstellationMember): React.ReactNode {
    if (m.timedOutUntil) return 'Timed out'
    const v = c.voice.find((x) => x.userIds.includes(m.user.id))
    if (v) {
      const n = c.nebulas.find((x) => x.id === v.nebulaId)
      if (v.sharing.includes(m.user.id)) return `Streaming in ${n?.name ?? 'voice'}`
      return (
        <>
          <SpeakerIcon size={13} color="currentColor" waves={false} />
          In {n?.name ?? 'voice'}
        </>
      )
    }
    if (m.playing) {
      return (
        <>
          <GameTile name={m.playing.name} />
          <span className="cx-member-game">
            {m.playing.name} · {playingFor(m.playing.since, now)}
          </span>
        </>
      )
    }
    if (m.activity) return m.activity
    if (m.status === 'offline')
      return m.lastSeenAt ? `Last here ${lastHere(m.lastSeenAt, now)}` : null
    if (m.user.id === c.ownerId || topRole(c, m.user.id).kind !== 'member') return 'Online'
    return null
  }
  return (
    <>
      {groups.map((g) => {
        const isOffline = g.key === 'offline'
        const rows = (
          <>
            {g.members.map((m) => {
              const s = sub(m)
              const mine = m.user.id === me.id
              return (
                <button
                  key={m.user.id}
                  type="button"
                  className={[
                    'cx-member',
                    m.status === 'offline' && 'cx-member--offline',
                    openId === m.user.id && 'cx-member--open'
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={(e) => onOpen(m, e.currentTarget.getBoundingClientRect())}
                  aria-haspopup="dialog"
                  aria-expanded={openId === m.user.id}
                >
                  <span style={{ position: 'relative', display: 'inline-flex' }}>
                    <Face person={m.user} size={32} me={mine} />
                    <StatusDot status={m.status} ring="var(--glo-subtle)" size={11} />
                  </span>
                  <span className="cx-member-text">
                    <span className="cx-member-name" style={{ color: nameColor(m.user.id) }}>
                      {mine ? `${firstName(m.user)} (you)` : m.user.displayName}
                    </span>
                    {s && <span className="cx-member-sub cx-member-sub--row">{s}</span>}
                  </span>
                </button>
              )
            })}
          </>
        )
        if (isOffline) {
          return (
            <div key={g.key}>
              <button
                type="button"
                className={folded ? 'cx-members-fold cx-members-fold--closed' : 'cx-members-fold'}
                aria-expanded={!folded}
                onClick={toggleFold}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
                {g.title} · {g.members.length}
              </button>
              {!folded && rows}
            </div>
          )
        }
        return (
          <div key={g.key}>
            <h2 style={{ color: g.color }}>
              {g.title} · {g.members.length}
            </h2>
            {rows}
          </div>
        )
      })}
    </>
  )
}

/** "Oct 2026" */
const monthYear = (iso: string): string =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })

/**
 * The top of the member card: banner in their colors, their face, name, roles, what they're
 * playing, mutual friends, member since, and Message / Call / ⋯ (moderation and more).
 */
export function MemberCardTop({
  c,
  m,
  me,
  now,
  friend,
  more,
  onMore,
  onMessage,
  onCall,
  onViewProfile
}: {
  c: ConstellationDetail
  m: ConstellationMember
  me: SignedInUser
  now: number
  /** You two are friends (Message and Call need that) */
  friend: boolean
  more: boolean
  onMore: () => void
  onMessage: () => void
  onCall: () => void
  onViewProfile: () => void
}): React.JSX.Element {
  const mine = m.user.id === me.id
  const [info, setInfo] = useState<MemberCardInfo | null>(null)
  useEffect(() => {
    if (mine) return
    let live = true
    void api.memberCard(c.id, m.user.id).then((r) => live && r.ok && setInfo(r.data))
    return () => {
      live = false
    }
  }, [c.id, m.user.id, mine])
  const [bg, fg] = mine ? ['#f47a1f', '#2a1406'] : colorsFor(m.user.id)
  const owner = m.user.id === c.ownerId
  const roles = [
    ...(owner ? [{ id: 'owner', name: 'Owner', dot: ROLE_COLORS.ember.dot }] : []),
    ...c.roles
      .filter((r) => r.kind !== 'owner' && r.kind !== 'member' && m.roleIds.includes(r.id))
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, dot: (ROLE_COLORS[r.color] ?? ROLE_COLORS.gray).dot }))
  ]
  if (!roles.length) roles.push({ id: 'member', name: 'Member', dot: ROLE_COLORS.gray.dot })
  const v = c.voice.find((x) => x.userIds.includes(m.user.id))
  const voiceName = v ? c.nebulas.find((n) => n.id === v.nebulaId)?.name : null
  const mutual = info
    ? info.mutualCount === 0
      ? 'No mutual friends yet'
      : info.mutualCount === 1
        ? `${firstName(info.mutualFriends[0])} is a mutual friend`
        : info.mutualCount === 2
          ? `${firstName(info.mutualFriends[0])} and ${firstName(info.mutualFriends[1])} are mutual friends`
          : `${info.mutualFriends.slice(0, 2).map(firstName).join(', ')} and ${info.mutualCount - 2} more are mutual friends`
    : null
  const since = owner
    ? `Made ${c.name} · ${monthYear(c.createdAt)}`
    : `Member since ${new Date(m.joinedAt).toDateString() === new Date(now).toDateString() ? 'today 🎉' : monthYear(m.joinedAt)}${friend || info?.friend ? ' · your friend' : ''}`
  return (
    <>
      <div
        className="cx-mcard-banner"
        style={{
          background: `linear-gradient(120deg, ${bg}, color-mix(in srgb, ${bg} 45%, #ffd27a))`
        }}
      />
      <div className="cx-mcard-body">
        <button
          type="button"
          className="cx-mcard-face"
          style={{ background: bg, color: fg }}
          onClick={onViewProfile}
          aria-label={`View ${m.user.displayName}'s profile`}
        >
          <AvatarFace
            id={m.user.id}
            name={m.user.displayName}
            avatarVersion={m.user.avatarVersion}
          />
          <StatusDot status={m.status} ring="#ffffff" size={14} />
        </button>
        <div>
          <div className="cx-mcard-name">{m.user.displayName}</div>
          <div className="cx-mcard-handle">@{m.user.username}</div>
        </div>
        <div className="cx-mcard-roles" aria-label="Roles">
          {roles.map((r) => (
            <span key={r.id} className="cx-mcard-role">
              <span style={{ background: r.dot }} />
              {r.name}
            </span>
          ))}
        </div>
        {m.playing && (
          <div className="cx-mcard-playing">
            <GameTile name={m.playing.name} size={44} />
            <span>
              <span className="cx-mcard-kicker">Playing now</span>
              <b>{m.playing.name}</b>
              <span className="cx-mcard-time">
                For {playingFor(m.playing.since, now)}
                {voiceName ? ` · in ${voiceName}` : ''}
              </span>
            </span>
          </div>
        )}
        {!mine && mutual && (
          <div className="cx-mcard-mutual">
            {info && info.mutualFriends.length > 0 && (
              <span className="cx-mcard-faces">
                {info.mutualFriends.map((p) => (
                  <Face key={p.id} person={p} size={24} me={false} />
                ))}
              </span>
            )}
            {mutual}
          </div>
        )}
        <div className="cx-mcard-since">
          {m.status === 'offline' && m.lastSeenAt
            ? `Last here ${lastHere(m.lastSeenAt, now)}`
            : since}
        </div>
        <div className="cx-mcard-actions">
          {!mine && friend ? (
            <>
              <button type="button" className="cx-mcard-message" onClick={onMessage}>
                Message
              </button>
              <button type="button" className="cx-mcard-call" onClick={onCall}>
                Call
              </button>
            </>
          ) : (
            <button
              type="button"
              className="cx-mcard-call cx-mcard-call--wide"
              onClick={onViewProfile}
            >
              View profile
            </button>
          )}
          <button
            type="button"
            className={more ? 'cx-mcard-more cx-mcard-more--on' : 'cx-mcard-more'}
            aria-label="More"
            aria-expanded={more}
            onClick={onMore}
          >
            ⋯
          </button>
        </div>
      </div>
    </>
  )
}
