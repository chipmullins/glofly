import { useEffect, useRef, useState } from 'react'
import type { Relationship, SearchResult } from '../../../preload/api-types'
import { splitMatch } from '../lib/names'
import Avatar from './Avatar'
import { AddFriendIcon, ChatIcon, CloseIcon, SearchIcon } from './icons'
import './dialogs.css'

type AddFriendDialogProps = {
  onClose: () => void
  /** Called after any change, so the friends list can refresh. */
  onChanged: () => void
  onSessionExpired: () => void
  /** Opens a chat with a friend from the results. */
  onMessage: (userId: string) => void
  /** 0.7.4: where the cursor starts: the username search, or the invite-by-email box */
  startAt?: 'search' | 'invite'
  /** 0.7.4: an invite went out (the welcome card ticks "Invite friends") */
  onInvited?: () => void
  /** 0.7.5: "Find @name" from an empty search starts with that name typed */
  initialQuery?: string
}

function Highlight({ text, query }: { text: string; query: string }): React.JSX.Element {
  const parts = splitMatch(text, query)
  if (!parts) return <>{text}</>
  return (
    <>
      {parts.before}
      <strong className="match">{parts.match}</strong>
      {parts.after}
    </>
  )
}

export default function AddFriendDialog({
  onClose,
  onChanged,
  onSessionExpired,
  onMessage,
  startAt = 'search',
  onInvited,
  initialQuery = ''
}: AddFriendDialogProps): React.JSX.Element {
  const [query, setQuery] = useState(initialQuery)
  const [answer, setAnswer] = useState<{ query: string; results: SearchResult[] } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Always call the latest onClose, without re-running the effect (which would steal focus).
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (startAt !== 'invite') inputRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [startAt])

  // Results appear as you type, once typing pauses briefly.
  const trimmed = query.trim()
  useEffect(() => {
    if (trimmed.length < 2) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const result = await window.glofly.friends.search(trimmed)
      if (cancelled) return
      if (!result.ok) {
        if (result.error === 'unauthorized') onSessionExpired()
        else setMessage(result.message)
        return
      }
      setMessage(null)
      setAnswer({ query: trimmed, results: result.data })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, onSessionExpired])

  const results = trimmed.length >= 2 && answer?.query === trimmed ? answer.results : null
  const searching = trimmed.length >= 2 && answer?.query !== trimmed

  function setRelationship(id: string, relationship: Relationship): void {
    setAnswer((a) =>
      a ? { ...a, results: a.results.map((r) => (r.id === id ? { ...r, relationship } : r)) } : a
    )
  }

  async function act(person: SearchResult): Promise<void> {
    setBusyId(person.id)
    setMessage(null)
    let result
    if (person.relationship === 'none') {
      result = await window.glofly.friends.sendRequest(person.username)
      if (result.ok)
        setRelationship(person.id, result.data.status === 'accepted' ? 'friends' : 'outgoing')
    } else if (person.relationship === 'outgoing') {
      result = await window.glofly.friends.removeRequest(person.id)
      if (result.ok) setRelationship(person.id, 'none')
    } else if (person.relationship === 'incoming') {
      result = await window.glofly.friends.accept(person.id)
      if (result.ok) setRelationship(person.id, 'friends')
    }
    setBusyId(null)
    if (!result) return
    if (result.ok) onChanged()
    else if (result.error === 'unauthorized') onSessionExpired()
    else setMessage(result.message)
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-friend-title"
        className="dialog add-friend-dialog"
      >
        <div className="dialog-head">
          <div>
            <h1 id="add-friend-title">Add a friend</h1>
            <p>Search by username or display name. Results appear as you type.</p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="people-search">
          <SearchIcon size={20} strokeWidth={2.2} />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search for people"
            placeholder="Search for people"
            spellCheck={false}
            maxLength={32}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results && (
            <span className="people-count" aria-live="polite">
              {results.length === 1 ? '1 result' : `${results.length} results`}
            </span>
          )}
        </div>

        {message && (
          <p className="dialog-message" role="alert">
            {message}
          </p>
        )}

        <ul className="people-results">
          {trimmed.length < 2 && (
            <li className="people-hint">Type at least 2 letters to start searching.</li>
          )}
          {searching && <li className="people-hint">Searching…</li>}
          {results?.length === 0 && (
            <li className="people-hint">
              No one found. Check the spelling, or try their username.
            </li>
          )}
          {results?.map((person) => (
            <li
              key={person.id}
              className={person.relationship === 'friends' ? 'person person--friend' : 'person'}
            >
              <Avatar
                id={person.id}
                name={person.displayName}
                avatarVersion={person.avatarVersion}
              />
              <div className="person-text">
                <span className="person-name">
                  <Highlight text={person.displayName} query={trimmed} />
                </span>
                <span className="person-sub">
                  @<Highlight text={person.username} query={trimmed} />
                </span>
              </div>
              {person.relationship === 'friends' && (
                <span className="friends-badge">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  Friends
                </span>
              )}
              {person.relationship === 'friends' && (
                <button
                  type="button"
                  className="dialog-close"
                  aria-label={`Message ${person.displayName}`}
                  title="Message"
                  onClick={() => onMessage(person.id)}
                >
                  <ChatIcon size={18} />
                </button>
              )}
              {person.relationship === 'none' && (
                <button
                  type="button"
                  className="small-button small-button--primary"
                  disabled={busyId === person.id}
                  onClick={() => act(person)}
                >
                  <AddFriendIcon size={16} />
                  Add friend
                </button>
              )}
              {person.relationship === 'outgoing' && (
                <button
                  type="button"
                  className="small-button small-button--quiet"
                  disabled={busyId === person.id}
                  onClick={() => act(person)}
                >
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  Request sent · Cancel
                </button>
              )}
              {person.relationship === 'incoming' && (
                <button
                  type="button"
                  className="small-button small-button--primary"
                  disabled={busyId === person.id}
                  onClick={() => act(person)}
                >
                  Accept request
                </button>
              )}
            </li>
          ))}
        </ul>

        <InviteFriends
          onSessionExpired={onSessionExpired}
          focus={startAt === 'invite'}
          onInvited={onInvited}
        />

        <p className="dialog-foot">Blocked users never appear in search.</p>
      </div>
    </div>
  )
}

/**
 * "Invite your friends" (0.3.0): Glofly emails them a link to join, saying who invited them.
 * Joining from it makes you friends straight away. An address that already has an account gets
 * a different email, and this always just says "Invite sent" (nobody learns who's on Glofly).
 */
function InviteFriends({
  onSessionExpired,
  focus,
  onInvited
}: {
  onSessionExpired: () => void
  /** 0.7.4: opened from the welcome card's "Invite friends": start here */
  focus?: boolean
  onInvited?: () => void
}): React.JSX.Element {
  const [email, setEmail] = useState('')
  const emailRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focus) return
    emailRef.current?.scrollIntoView({ block: 'center' })
    emailRef.current?.focus()
  }, [focus])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)

  async function send(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const address = email.trim()
    if (!address || busy) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setNote({ ok: false, text: 'Enter a valid email address.' })
      return
    }
    setBusy(true)
    setNote(null)
    const result = await window.glofly.friends.invite(address)
    setBusy(false)
    if (result.ok) {
      setNote({ ok: true, text: `Invite sent to ${address}.` })
      setEmail('')
      onInvited?.()
    } else if (result.error === 'unauthorized') onSessionExpired()
    else setNote({ ok: false, text: result.message })
  }

  return (
    <form className="invite-friends" onSubmit={send}>
      <div className="invite-friends-text">
        <h2>Invite your friends</h2>
        <p>
          Not on Glofly yet? We&apos;ll email them an invite from you. When they join, you&apos;re
          friends.
        </p>
      </div>
      <div className="invite-friends-row">
        <input
          ref={emailRef}
          type="email"
          aria-label="Friend's email address"
          placeholder="friend@example.com"
          maxLength={320}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setNote(null)
          }}
        />
        <button
          type="submit"
          className="small-button small-button--primary"
          disabled={busy || !email.trim()}
        >
          {busy ? 'Sending…' : 'Send invite'}
        </button>
      </div>
      {note && (
        <p
          className={
            note.ok ? 'invite-friends-note invite-friends-note--ok' : 'invite-friends-note'
          }
          role={note.ok ? 'status' : 'alert'}
        >
          {note.text}
        </p>
      )}
    </form>
  )
}
