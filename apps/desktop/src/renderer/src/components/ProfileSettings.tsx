import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  BoardTile,
  BoardTileView,
  ConstellationCard,
  MyGame,
  PhotoType,
  Profile,
  ProfileAudience,
  ProfilePrivacy,
  SignedInUser
} from '../../../preload/api-types'
import {
  BIO_MAX,
  BOARD_GAMES_MAX,
  BOARD_NOTE_MAX,
  BOARD_TAGS_MAX,
  BOARD_TAG_MAX,
  BOARD_TILES_MAX,
  DEFAULT_PROFILE_PRIVACY,
  PRONOUNS_MAX,
  PRONOUN_PICKS,
  IGDB_CREDIT,
  IGDB_URL,
  cleanInterestTag,
  type GameSearchResult
} from '@glofly/shared'
import type { ConstellationColor } from '@glofly/shared/constellations'
import { api } from '../lib/constellations'
import { headerUrl } from '../lib/media'
import { PHOTO_TYPES, readPhoto } from '../lib/photoPick'
import { ConstellationIcon } from '../constellations/bits'
import Avatar from './Avatar'
import { BoardGrid, GameArt } from './ProfileBoard'
import { CloseIcon } from './icons'
import './ProfileSettings.css'

// Settings → Profile (0.9.1, canvas "Glofly profiles" boards Edit and AddTile): header image,
// display name, pronouns, About me, your board (up to 6 tiles, drag to reorder), who sees what,
// and a live preview. Nothing is saved until Save.

const DISPLAY_NAME_MAX = 32

type HeaderChange = { kind: 'new'; data: ArrayBuffer; type: PhotoType; src: string } | { kind: 'remove' } | null

const AUDIENCE: { value: ProfileAudience; label: string }[] = [
  { value: 'everyone', label: 'Everyone' },
  { value: 'friends', label: 'Friends' },
  { value: 'only_me', label: 'Only me' }
]

const TILE_NAMES: Record<BoardTile['kind'], string> = {
  games: 'Favorite games',
  constellation: 'A constellation I love',
  note: 'Note',
  into: 'I’m into',
  playing: 'Currently playing'
}

export default function ProfileSettings({
  user,
  onSaved,
  onSessionExpired
}: {
  user: SignedInUser
  onSaved?: (changes: { displayName: string }) => void
  onSessionExpired: () => void
}): React.JSX.Element {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [pronouns, setPronouns] = useState('')
  const [bio, setBio] = useState('')
  const [board, setBoard] = useState<BoardTile[]>([])
  const [privacy, setPrivacy] = useState<ProfilePrivacy>(DEFAULT_PROFILE_PRIVACY)
  const [header, setHeader] = useState<HeaderChange>(null)
  const [focus, setFocus] = useState(50)
  const [adding, setAdding] = useState<{ index: number | null; kind: BoardTile['kind'] | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mine, setMine] = useState<ConstellationCard[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const load = (p: Profile): void => {
    setProfile(p)
    setDisplayName(p.displayName)
    setPronouns(p.pronouns ?? '')
    setBio(p.bio ?? '')
    setBoard(p.boardSource ?? [])
    setPrivacy(p.privacy ?? DEFAULT_PROFILE_PRIVACY)
    setFocus(p.header?.focus ?? 50)
    setHeader(null)
  }
  useEffect(() => {
    void window.glofly.profile.getMine().then((r) => {
      if (r.ok) load(r.data)
      else if (r.error === 'unauthorized') onSessionExpired()
      else setError(r.message)
    })
    void api.dashboard().then((r) => {
      if (r.ok) setMine(r.data.constellations)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const headerSrc =
    header?.kind === 'new'
      ? header.src
      : header?.kind === 'remove'
        ? null
        : profile?.header
          ? headerUrl(user.id, profile.header.version)
          : null

  const dirty =
    !!profile &&
    (header !== null ||
      displayName.trim() !== profile.displayName ||
      (pronouns.trim() || null) !== (profile.pronouns ?? null) ||
      (bio.trim() || null) !== (profile.bio ?? null) ||
      JSON.stringify(board) !== JSON.stringify(profile.boardSource ?? []) ||
      JSON.stringify(privacy) !== JSON.stringify(profile.privacy ?? DEFAULT_PROFILE_PRIVACY) ||
      (!!headerSrc && focus !== (profile.header?.focus ?? 50)))

  async function pick(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const picked = await readPhoto(file)
    if ('error' in picked) {
      setError(picked.error.replace('photo', 'picture'))
      return
    }
    setError(null)
    setHeader({ kind: 'new', ...picked })
    setFocus(50)
  }

  async function save(): Promise<void> {
    if (!profile) return
    const name = displayName.trim()
    if (!name) {
      setError('Enter a display name.')
      return
    }
    setSaving(true)
    setError(null)
    const fail = (r: { error: string; message: string }): void => {
      setSaving(false)
      if (r.error === 'unauthorized') onSessionExpired()
      else setError(r.message)
    }
    if (header?.kind === 'new') {
      const r = await window.glofly.profile.setHeader(header.data, header.type)
      if (!r.ok) return fail(r)
    } else if (header?.kind === 'remove') {
      const r = await window.glofly.profile.removeHeader()
      if (!r.ok) return fail(r)
    }
    const changes = {
      ...(name !== profile.displayName ? { displayName: name } : {}),
      ...((pronouns.trim() || null) !== (profile.pronouns ?? null) ? { pronouns: pronouns.trim() || null } : {}),
      ...((bio.trim() || null) !== (profile.bio ?? null) ? { bio: bio.trim() || null } : {}),
      ...(JSON.stringify(board) !== JSON.stringify(profile.boardSource ?? []) ? { board } : {}),
      ...(JSON.stringify(privacy) !== JSON.stringify(profile.privacy) ? { privacy } : {}),
      ...(headerSrc && header?.kind !== 'remove' ? { headerFocus: focus } : {})
    }
    const r = Object.keys(changes).length
      ? await window.glofly.profile.update(changes)
      : await window.glofly.profile.getMine()
    if (!r.ok) return fail(r)
    load(r.data)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    if (r.data.displayName !== user.displayName) onSaved?.({ displayName: r.data.displayName })
  }

  // Dragging the header picture up and down.
  const drag = useRef<{ y: number; focus: number; h: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!headerSrc) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { y: e.clientY, focus, h: e.currentTarget.clientHeight }
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current
    if (!d) return
    const next = Math.round(Math.min(100, Math.max(0, d.focus - ((e.clientY - d.y) / d.h) * 60)))
    setFocus(next)
  }

  // Reordering the board by dragging its rows.
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const move = (from: number, to: number): void => {
    if (to < 0 || to >= board.length || from === to) return
    setBoard((b) => {
      const next = [...b]
      const [t] = next.splice(from, 1)
      next.splice(to, 0, t)
      return next
    })
  }

  const constellationById = useMemo(() => new Map(mine.map((c) => [c.id, c])), [mine])
  const previewTiles: BoardTileView[] = board.flatMap((t): BoardTileView[] => {
    if (t.kind !== 'constellation') return t.kind === 'playing' ? [{ kind: 'playing', game: null }] : [t]
    const c = constellationById.get(t.constellationId)
    return c
      ? [
          {
            kind: 'constellation',
            constellation: {
              id: c.id,
              name: c.name,
              color: c.color,
              iconVersion: c.iconVersion,
              accent: null,
              memberCount: c.memberCount,
              joined: true,
              visibility: c.visibility === 'approval' ? 'approval' : 'public'
            }
          }
        ]
      : []
  })

  const summary = (t: BoardTile): string =>
    t.kind === 'games'
      ? t.games.map((g) => g.name).join(', ')
      : t.kind === 'note'
        ? t.text.length > 34
          ? `${t.text.slice(0, 34)}…`
          : t.text
        : t.kind === 'constellation'
          ? (constellationById.get(t.constellationId)?.name ?? 'A constellation')
          : t.kind === 'into'
            ? `${t.tags.length} ${t.tags.length === 1 ? 'thing' : 'things'}`
            : 'The game you’re in right now'

  return (
    <div className="ps">
      <div className="ps-form">
        <section className="ps-field">
          <h2 className="ps-h">Header image</h2>
          <div
            className={headerSrc ? 'ps-header ps-header--photo' : 'ps-header'}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            role={headerSrc ? 'slider' : undefined}
            aria-label={headerSrc ? 'Header position' : undefined}
            aria-valuemin={headerSrc ? 0 : undefined}
            aria-valuemax={headerSrc ? 100 : undefined}
            aria-valuenow={headerSrc ? focus : undefined}
            tabIndex={headerSrc ? 0 : undefined}
            onKeyDown={(e) => {
              if (!headerSrc) return
              if (e.key === 'ArrowUp') setFocus((f) => Math.max(0, f - 5))
              else if (e.key === 'ArrowDown') setFocus((f) => Math.min(100, f + 5))
              else return
              e.preventDefault()
            }}
          >
            {headerSrc && (
              <img src={headerSrc} alt="" draggable={false} style={{ objectPosition: `50% ${focus}%` }} />
            )}
            <span className="ps-header-tip">{headerSrc ? 'Drag to move it' : 'The night sky (no picture)'}</span>
          </div>
          <div className="ps-buttons">
            <button type="button" className="ps-primary" onClick={() => fileRef.current?.click()}>
              {headerSrc ? 'Change image' : 'Choose an image'}
            </button>
            {headerSrc && (
              <button
                type="button"
                className="ps-quiet"
                onClick={() => setHeader(profile?.header ? { kind: 'remove' } : null)}
              >
                Use the night sky
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" hidden accept={PHOTO_TYPES.join(',')} onChange={(e) => void pick(e)} />
          <span className="ps-hint">PNG, JPG, WebP or GIF (still frame), up to 8 MB. Wide pictures work best (3:1).</span>
        </section>

        <div className="ps-row">
          <label className="ps-label ps-grow">
            Display name
            <input
              className="ep-input"
              value={displayName}
              maxLength={DISPLAY_NAME_MAX}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label className="ps-label ps-pronouns">
            Pronouns
            <input
              className="ep-input"
              value={pronouns}
              maxLength={PRONOUNS_MAX}
              placeholder="Optional"
              onChange={(e) => setPronouns(e.target.value)}
            />
          </label>
        </div>
        <div className="ps-picks">
          {PRONOUN_PICKS.map((p) => (
            <button
              key={p}
              type="button"
              className={pronouns.trim() === p ? 'ps-pick ps-pick--on' : 'ps-pick'}
              aria-pressed={pronouns.trim() === p}
              onClick={() => setPronouns(pronouns.trim() === p ? '' : p)}
            >
              {p}
            </button>
          ))}
          <span className="ps-hint">or type your own (optional)</span>
        </div>

        <label className="ps-label">
          <span className="ps-label-row">
            About me
            <span className={bio.length > BIO_MAX ? 'ps-hint ep-count--over' : 'ps-hint'}>
              {bio.length} / {BIO_MAX}
            </span>
          </span>
          <textarea
            className="ep-textarea"
            rows={2}
            maxLength={BIO_MAX}
            value={bio}
            placeholder="Tell people a little about yourself"
            onChange={(e) => setBio(e.target.value)}
          />
        </label>

        <section className="ps-field">
          <div className="ps-board-head">
            <h2 className="ps-h">
              Your board · {board.length} of {BOARD_TILES_MAX}
            </h2>
            <button
              type="button"
              className="ps-dark"
              disabled={board.length >= BOARD_TILES_MAX}
              onClick={() => setAdding({ index: null, kind: null })}
            >
              + Add to your board
            </button>
          </div>
          {board.length === 0 && (
            <p className="ps-hint">Show off your favorite games, a constellation you love, a note or what you’re into.</p>
          )}
          <ul className="ps-tiles">
            {board.map((t, i) => (
              <li
                key={i}
                className={dragIndex === i ? 'ps-tile ps-tile--drag' : 'ps-tile'}
                draggable
                onDragStart={(e) => {
                  setDragIndex(i)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (dragIndex !== null && dragIndex !== i) {
                    move(dragIndex, i)
                    setDragIndex(i)
                  }
                }}
                onDragEnd={() => setDragIndex(null)}
              >
                <button
                  type="button"
                  className="ps-handle"
                  aria-label={`Move ${TILE_NAMES[t.kind]} (arrow keys)`}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') move(i, i - 1)
                    else if (e.key === 'ArrowDown') move(i, i + 1)
                    else return
                    e.preventDefault()
                  }}
                >
                  ⋮⋮
                </button>
                <b>{TILE_NAMES[t.kind]}</b>
                <span className="ps-tile-sum">{summary(t)}</span>
                {t.kind !== 'playing' && (
                  <button type="button" className="ps-edit" onClick={() => setAdding({ index: i, kind: t.kind })}>
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  className="ps-x"
                  aria-label={`Remove ${TILE_NAMES[t.kind]}`}
                  onClick={() => setBoard((b) => b.filter((_, n) => n !== i))}
                >
                  <CloseIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="ps-field">
          <h2 className="ps-h">Who sees what</h2>
          {(
            [
              ['board', 'Your board'],
              ['activity', 'Activity'],
              ['mutuals', 'Mutual friends and constellations']
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="ps-who">
              <span>{label}</span>
              <select
                className="settings-select"
                value={privacy[key]}
                onChange={(e) => setPrivacy((p) => ({ ...p, [key]: e.target.value as ProfileAudience }))}
              >
                {AUDIENCE.map((a) => (
                  <option key={a.value} value={a.value}>
                    {key === 'mutuals' && a.value === 'everyone' ? 'People who share them' : a.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <span className="ps-hint">
            Activity only shows games (if My games is shared) and public constellations you join. Family-managed
            accounts only ever show these to friends.
          </span>
        </section>
      </div>

      <aside className="ps-preview">
        <h2 className="ps-h">Preview</h2>
        <div className="ps-card">
          <div className="ps-card-head">
            {headerSrc && <img src={headerSrc} alt="" draggable={false} style={{ objectPosition: `50% ${focus}%` }} />}
          </div>
          <div className="ps-card-body">
            <Avatar id={user.id} name={displayName || user.displayName} avatarVersion={user.avatarVersion} size={68} mine ring="var(--glo-surface)" className="ps-card-photo" />
            <div className="ps-card-name">
              <b>{displayName.trim() || user.displayName}</b>
              {pronouns.trim() && <span>{pronouns.trim()}</span>}
            </div>
            <span className="ps-card-user">@{user.username}</span>
            {previewTiles.length > 0 && <BoardGrid tiles={previewTiles} name={displayName} preview />}
          </div>
        </div>
        <span className="ps-hint">This is roughly what friends see. Changes save when you press Save.</span>
        {error && (
          <p className="dialog-message" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="ps-save" disabled={!dirty || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        </button>
      </aside>

      {adding && (
        <AddTileDialog
          kind={adding.kind}
          tile={adding.index !== null ? board[adding.index] : null}
          taken={board}
          mine={mine}
          onDone={(t) => {
            setBoard((b) => (adding.index !== null ? b.map((x, n) => (n === adding.index ? t : x)) : [...b, t]))
            setAdding(null)
          }}
          onCancel={() => setAdding(null)}
        />
      )}
    </div>
  )
}

/** "Add to your board": pick a kind, then fill it in (or edit a tile already there). */
function AddTileDialog({
  kind: startKind,
  tile,
  taken,
  mine,
  onDone,
  onCancel
}: {
  kind: BoardTile['kind'] | null
  tile: BoardTile | null
  taken: BoardTile[]
  mine: ConstellationCard[]
  onDone: (t: BoardTile) => void
  onCancel: () => void
}): React.JSX.Element {
  const [kind, setKind] = useState<BoardTile['kind'] | null>(startKind)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onCancel])
  const hasPlaying = taken.some((t) => t.kind === 'playing')
  const kinds: { kind: BoardTile['kind']; sub: string }[] = [
    { kind: 'games', sub: `Up to ${BOARD_GAMES_MAX}, with their pictures` },
    { kind: 'constellation', sub: 'Public ones you’re in, with Join' },
    { kind: 'note', sub: `A few words, up to ${BOARD_NOTE_MAX} characters` },
    { kind: 'into', sub: `Up to ${BOARD_TAGS_MAX} short tags` },
    ...(hasPlaying ? [] : [{ kind: 'playing' as const, sub: 'Shows the game you’re in right now' }])
  ]
  return (
    <div className="dialog-backdrop ps-add-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={kind ? TILE_NAMES[kind] : 'Add to your board'} className="dialog ps-add" tabIndex={-1}>
        {!kind ? (
          <>
            <h2 className="ps-add-title">Add to your board</h2>
            {kinds.map((k) => (
              <button
                key={k.kind}
                type="button"
                className="ps-kind"
                onClick={() => (k.kind === 'playing' ? onDone({ kind: 'playing' }) : setKind(k.kind))}
              >
                <span className={`ps-kind-icon ps-kind-icon--${k.kind}`} aria-hidden="true" />
                <span>
                  <b>{TILE_NAMES[k.kind]}</b>
                  <span>{k.sub}</span>
                </span>
              </button>
            ))}
            <div className="ps-add-buttons">
              <button type="button" className="ps-quiet" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        ) : kind === 'games' ? (
          <GamesEditor tile={tile?.kind === 'games' ? tile : null} onDone={onDone} onCancel={onCancel} />
        ) : kind === 'constellation' ? (
          <ConstellationEditor
            tile={tile?.kind === 'constellation' ? tile : null}
            taken={taken}
            mine={mine}
            onDone={onDone}
            onCancel={onCancel}
          />
        ) : kind === 'note' ? (
          <NoteEditor tile={tile?.kind === 'note' ? tile : null} onDone={onDone} onCancel={onCancel} />
        ) : (
          <IntoEditor tile={tile?.kind === 'into' ? tile : null} onDone={onDone} onCancel={onCancel} />
        )}
      </div>
    </div>
  )
}

function EditorButtons({ ok, onDone, onCancel }: { ok: boolean; onDone: () => void; onCancel: () => void }): React.JSX.Element {
  return (
    <div className="ps-add-buttons">
      <button type="button" className="ps-quiet" onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className="ps-primary" disabled={!ok} onClick={onDone}>
        Done
      </button>
    </div>
  )
}

function GamesEditor({
  tile,
  onDone,
  onCancel
}: {
  tile: Extract<BoardTile, { kind: 'games' }> | null
  onDone: (t: BoardTile) => void
  onCancel: () => void
}): React.JSX.Element {
  const [picked, setPicked] = useState<string[]>(tile?.games.map((g) => g.name) ?? [])
  const [query, setQuery] = useState('')
  const [played, setPlayed] = useState<MyGame[]>([])
  useEffect(() => {
    void api.myGames().then((r) => r.ok && setPlayed(r.data.games.filter((g) => !g.hidden)))
  }, [])
  const q = query.trim().toLowerCase()
  const matches = played.filter((g) => !q || g.name.toLowerCase().includes(q)).slice(0, 6)
  // 0.9.1: IGDB results through Glofly, a moment after typing stops.
  const [found, setFound] = useState<GameSearchResult[]>([])
  const [credit, setCredit] = useState(false)
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    if (q.length < 2) {
      setFound([])
      return
    }
    let live = true
    setSearching(true)
    const timer = setTimeout(() => {
      void api.searchGames(q).then((r) => {
        if (!live) return
        setSearching(false)
        if (r.ok) {
          setFound(r.data.games)
          setCredit(r.data.available)
        }
      })
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [q])
  const playedKeys = new Set(matches.map((g) => g.name.toLowerCase()))
  const more = found.filter((g) => !playedKeys.has(g.name.toLowerCase())).slice(0, 6)
  const typed = query.trim().replace(/\s+/g, ' ').slice(0, 80)
  const showTyped =
    typed &&
    !played.some((g) => g.name.toLowerCase() === typed.toLowerCase()) &&
    !found.some((g) => g.name.toLowerCase() === typed.toLowerCase())
  const coverOf = (name: string): string | undefined =>
    played.find((g) => g.name.toLowerCase() === name.toLowerCase())?.cover ??
    found.find((g) => g.name.toLowerCase() === name.toLowerCase())?.cover ??
    tile?.games.find((g) => g.name.toLowerCase() === name.toLowerCase())?.cover ??
    undefined
  const isPicked = (name: string): boolean => picked.some((p) => p.toLowerCase() === name.toLowerCase())
  const toggle = (name: string): void =>
    setPicked((p) =>
      isPicked(name) ? p.filter((x) => x.toLowerCase() !== name.toLowerCase()) : p.length >= BOARD_GAMES_MAX ? p : [...p, name]
    )
  return (
    <>
      <h2 className="ps-add-title">Favorite games</h2>
      <label className="ps-label">
        Find a game
        <input className="ep-input" value={query} autoFocus placeholder="Type a game’s name" onChange={(e) => setQuery(e.target.value)} />
      </label>
      {picked.length > 0 && (
        <div className="ps-picked">
          {picked.map((p) => (
            <button key={p} type="button" className="ps-pick ps-pick--on" onClick={() => toggle(p)} aria-label={`Remove ${p}`}>
              {p} <CloseIcon size={12} />
            </button>
          ))}
        </div>
      )}
      <div className="ps-results" role="listbox" aria-label="Games" aria-multiselectable="true">
        {showTyped && (
          <button type="button" role="option" aria-selected={isPicked(typed)} className="ps-result" onClick={() => toggle(typed)}>
            <GameArt name={typed} className="pb-art ps-result-art" />
            <b>Add “{typed}”</b>
            {isPicked(typed) && <span className="ps-result-on">✓ Picked</span>}
          </button>
        )}
        {matches.map((g) => (
          <button
            key={g.key}
            type="button"
            role="option"
            aria-selected={isPicked(g.name)}
            className={isPicked(g.name) ? 'ps-result ps-result--on' : 'ps-result'}
            onClick={() => toggle(g.name)}
          >
            <GameArt name={g.name} cover={g.cover} className="pb-art ps-result-art" />
            <b>{g.name}</b>
            <span className={isPicked(g.name) ? 'ps-result-on' : 'ps-hint'}>{isPicked(g.name) ? '✓ Picked' : 'Played on Glofly'}</span>
          </button>
        ))}
        {more.map((g) => (
          <button
            key={`igdb-${g.key}`}
            type="button"
            role="option"
            aria-selected={isPicked(g.name)}
            className={isPicked(g.name) ? 'ps-result ps-result--on' : 'ps-result'}
            onClick={() => toggle(g.name)}
          >
            <GameArt name={g.name} cover={g.cover} className="pb-art ps-result-art" />
            <b>{g.name}</b>
            <span className={isPicked(g.name) ? 'ps-result-on' : 'ps-hint'}>{isPicked(g.name) ? '✓ Picked' : (g.year ?? '')}</span>
          </button>
        ))}
        {searching && !more.length && <p className="ps-hint">Looking…</p>}
        {!matches.length && !showTyped && <p className="ps-hint">Games you’ve played on Glofly show here. Or type any game.</p>}
      </div>
      <span className="ps-hint">
        Up to {BOARD_GAMES_MAX}. Games you’ve played on Glofly come first.
        {credit && (
          <>
            {' '}Pictures:{' '}
            <a href={IGDB_URL} target="_blank" rel="noreferrer">
              {IGDB_CREDIT.replace('Game info', 'game info')}
            </a>
            .
          </>
        )}
      </span>
      <EditorButtons
        ok={picked.length > 0}
        onCancel={onCancel}
        onDone={() =>
          onDone({
            kind: 'games',
            games: picked.map((name) => {
              const cover = coverOf(name)
              return { key: name.toLowerCase(), name, ...(cover ? { cover } : {}) }
            })
          })
        }
      />
    </>
  )
}

function ConstellationEditor({
  tile,
  taken,
  mine,
  onDone,
  onCancel
}: {
  tile: Extract<BoardTile, { kind: 'constellation' }> | null
  taken: BoardTile[]
  mine: ConstellationCard[]
  onDone: (t: BoardTile) => void
  onCancel: () => void
}): React.JSX.Element {
  const [pick, setPick] = useState<string | null>(tile?.constellationId ?? null)
  const used = new Set(taken.flatMap((t) => (t.kind === 'constellation' && t.constellationId !== tile?.constellationId ? [t.constellationId] : [])))
  const choices = mine.filter((c) => c.visibility !== 'invite' && !used.has(c.id))
  return (
    <>
      <h2 className="ps-add-title">A constellation I love</h2>
      <div className="ps-results" role="radiogroup" aria-label="Constellations">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={pick === c.id}
            className={pick === c.id ? 'ps-result ps-result--on' : 'ps-result'}
            onClick={() => setPick(c.id)}
          >
            <ConstellationIcon id={c.id} name={c.name} color={c.color as ConstellationColor} iconVersion={c.iconVersion} className="pb-cx-icon" />
            <b>{c.name}</b>
            <span className="ps-hint">
              {c.memberCount.toLocaleString()} {c.memberCount === 1 ? 'member' : 'members'}
            </span>
          </button>
        ))}
        {!choices.length && (
          <p className="ps-hint">Only public or ask-to-join constellations you’re in can go on your board. Invite-only ones stay private.</p>
        )}
      </div>
      <EditorButtons ok={!!pick} onCancel={onCancel} onDone={() => pick && onDone({ kind: 'constellation', constellationId: pick })} />
    </>
  )
}

function NoteEditor({
  tile,
  onDone,
  onCancel
}: {
  tile: Extract<BoardTile, { kind: 'note' }> | null
  onDone: (t: BoardTile) => void
  onCancel: () => void
}): React.JSX.Element {
  const [text, setText] = useState(tile?.text ?? '')
  return (
    <>
      <h2 className="ps-add-title">Note</h2>
      <label className="ps-label">
        <span className="ps-label-row">
          A few words
          <span className="ps-hint">
            {text.length} / {BOARD_NOTE_MAX}
          </span>
        </span>
        <textarea
          className="ep-textarea"
          rows={4}
          autoFocus
          maxLength={BOARD_NOTE_MAX}
          value={text}
          placeholder="Looking for a duo for ranked on weekends…"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <EditorButtons ok={!!text.trim()} onCancel={onCancel} onDone={() => onDone({ kind: 'note', text: text.trim() })} />
    </>
  )
}

function IntoEditor({
  tile,
  onDone,
  onCancel
}: {
  tile: Extract<BoardTile, { kind: 'into' }> | null
  onDone: (t: BoardTile) => void
  onCancel: () => void
}): React.JSX.Element {
  const [tags, setTags] = useState<string[]>(tile?.tags ?? [])
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const t = cleanInterestTag(draft)
    if (t && tags.length < BOARD_TAGS_MAX && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) setTags([...tags, t])
    setDraft('')
  }
  return (
    <>
      <h2 className="ps-add-title">I’m into</h2>
      <label className="ps-label">
        Add a thing (Enter adds it)
        <input
          className="ep-input"
          autoFocus
          value={draft}
          maxLength={BOARD_TAG_MAX}
          placeholder="Cozy games, lo-fi, cats…"
          disabled={tags.length >= BOARD_TAGS_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            }
          }}
        />
      </label>
      <div className="ps-picked">
        {tags.map((t) => (
          <button key={t} type="button" className="ps-pick ps-pick--on" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>
            {t} <CloseIcon size={12} />
          </button>
        ))}
      </div>
      <span className="ps-hint">
        {tags.length} of {BOARD_TAGS_MAX}
      </span>
      <EditorButtons
        ok={tags.length > 0 || !!cleanInterestTag(draft)}
        onCancel={onCancel}
        onDone={() => {
          const extra = cleanInterestTag(draft)
          onDone({ kind: 'into', tags: extra && !tags.includes(extra) && tags.length < BOARD_TAGS_MAX ? [...tags, extra] : tags })
        }}
      />
    </>
  )
}
