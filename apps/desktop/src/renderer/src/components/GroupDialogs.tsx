import { useEffect, useRef, useState } from 'react'
import type {
  ConversationSummary,
  FriendEntry,
  GroupSummary,
  Presence,
  PublicUser
} from '../../../preload/api-types'
import { chatTitle, GROUP_MAX, GROUP_NAME_MAX, memberCountLabel } from '../lib/groups'
import { presenceLine } from '../lib/presence'
import Avatar from './Avatar'
import ConfirmDialog from './ConfirmDialog'
import EmojiText from './EmojiText'
import { AddFriendIcon, CloseIcon, LeaveIcon, PencilIcon, SearchIcon } from './icons'
import './dialogs.css'

/** Closes on Escape (always calling the latest onClose, without stealing focus again). */
function useEscape(onClose: () => void, enabled = true): void {
  const ref = useRef(onClose)
  useEffect(() => {
    ref.current = onClose
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') ref.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [enabled])
}

const matches = (p: PublicUser, q: string): boolean => {
  const s = q.trim().toLowerCase().replace(/^@/, '')
  return !s || p.displayName.toLowerCase().includes(s) || p.username.toLowerCase().includes(s)
}

function Check({ on }: { on: boolean }): React.JSX.Element {
  return (
    <span className={on ? 'pick-check pick-check--on' : 'pick-check'} aria-hidden="true">
      {on && (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </span>
  )
}

type PickerProps = {
  /** Your friends (only friends can be added to a group) */
  friends: FriendEntry[]
  presence: Record<string, Presence>
  now: number
  /** Start a new group, or add people to this one */
  group: GroupSummary | null
  onDone: (conversation: ConversationSummary) => void
  onClose: () => void
  onSessionExpired: () => void
}

/** "New group chat" and "Add people": pick friends (and, for a new group, a name). */
export function GroupPeopleDialog({
  friends,
  presence,
  now,
  group,
  onDone,
  onClose,
  onSessionExpired
}: PickerProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  useEscape(onClose)
  useEffect(() => searchRef.current?.focus(), [])

  const inGroup = new Set(group?.members.map((m) => m.id) ?? [])
  const choices = friends
    .filter((f) => !inGroup.has(f.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
  const shown = choices.filter((f) => matches(f, query))
  // Room left, counting you (and everyone already in the group).
  const room = GROUP_MAX - (group ? group.memberCount : 1)
  const full = picked.length >= room
  const needed = group ? 1 : 2
  const pickedPeople = picked
    .map((id) => choices.find((f) => f.id === id))
    .filter((f): f is FriendEntry => !!f)

  function toggle(id: string): void {
    setMessage(null)
    setPicked((list) => {
      if (list.includes(id)) return list.filter((x) => x !== id)
      if (list.length >= room) return list
      return [...list, id]
    })
  }

  async function submit(): Promise<void> {
    if (picked.length < needed || busy) return
    setBusy(true)
    setMessage(null)
    const result = group
      ? await window.glofly.conversations.addMembers(group.id, picked)
      : await window.glofly.conversations.createGroup(picked, name.trim() || null)
    setBusy(false)
    if (result.ok) onDone(result.data)
    else if (result.error === 'unauthorized') onSessionExpired()
    else setMessage(result.message)
  }

  const title = group ? `Add people to ${chatTitle(group)}` : 'New group chat'
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-people-title"
        className="dialog add-friend-dialog group-dialog"
      >
        <div className="dialog-head">
          <div>
            <h1 id="group-people-title">
              <EmojiText text={title} />
            </h1>
            <p>
              {group
                ? `Add your friends. Groups can have up to ${GROUP_MAX} people.`
                : `Pick at least two friends. Groups can have up to ${GROUP_MAX} people, including you.`}
            </p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {!group && (
          <label className="group-name-field">
            <span>Group name (optional)</span>
            <input
              type="text"
              value={name}
              maxLength={GROUP_NAME_MAX}
              placeholder="Road trip crew, Study group…"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
          </label>
        )}

        <div className="people-search">
          <SearchIcon size={20} strokeWidth={2.2} />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search your friends"
            placeholder="Search your friends"
            spellCheck={false}
            maxLength={32}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <span className="people-count" aria-live="polite">
            {picked.length} picked
          </span>
        </div>

        {pickedPeople.length > 0 && (
          <div className="picked-chips" aria-label="Picked">
            {pickedPeople.map((p) => (
              <button
                key={p.id}
                type="button"
                className="picked-chip"
                aria-label={`Remove ${p.displayName}`}
                onClick={() => toggle(p.id)}
              >
                <Avatar id={p.id} name={p.displayName} avatarVersion={p.avatarVersion} size={22} />
                {p.displayName}
                <CloseIcon size={14} />
              </button>
            ))}
          </div>
        )}

        {message && (
          <p className="dialog-message" role="alert">
            {message}
          </p>
        )}

        <ul className="people-results" aria-label="Friends" role="listbox" aria-multiselectable>
          {choices.length === 0 && (
            <li className="people-hint">
              {group
                ? 'All your friends are already in this group.'
                : 'Add some friends first, then start a group with them.'}
            </li>
          )}
          {choices.length > 0 && shown.length === 0 && (
            <li className="people-hint">No friends match “{query.trim()}”.</li>
          )}
          {shown.map((f) => {
            const on = picked.includes(f.id)
            const p = presence[f.id] ?? f.presence
            return (
              <li key={f.id} role="option" aria-selected={on}>
                <button
                  type="button"
                  className={on ? 'pick-row pick-row--on' : 'pick-row'}
                  disabled={!on && full}
                  onClick={() => toggle(f.id)}
                >
                  <Avatar
                    id={f.id}
                    name={f.displayName}
                    avatarVersion={f.avatarVersion}
                    status={p?.status ?? 'offline'}
                    ring={on ? 'var(--glo-accent-soft)' : 'var(--glo-surface)'}
                  />
                  <span className="person-text">
                    <span className="person-name">{f.displayName}</span>
                    <span className="person-sub">
                      @{f.username}
                      {p ? ' · ' : ''}
                      {p && <EmojiText text={presenceLine(p, now)} />}
                    </span>
                  </span>
                  <Check on={on} />
                </button>
              </li>
            )
          })}
        </ul>

        <div className="group-dialog-foot">
          <span>
            {full
              ? `That's the most this group can have (${GROUP_MAX} people).`
              : group
                ? `${memberCountLabel(group.memberCount + picked.length)} after adding`
                : `${memberCountLabel(picked.length + 1)}, including you`}
          </span>
          <button type="button" className="small-button small-button--quiet" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="small-button small-button--primary"
            disabled={picked.length < needed || busy}
            onClick={() => void submit()}
          >
            {group
              ? picked.length > 1
                ? `Add ${picked.length} people`
                : 'Add to group'
              : 'Create group'}
          </button>
        </div>
      </div>
    </div>
  )
}

type SettingsProps = {
  group: GroupSummary
  me: PublicUser
  presence: Record<string, Presence>
  onRenamed: (conversation: ConversationSummary) => void
  onAddPeople: () => void
  onViewProfile: (user: PublicUser) => void
  onLeave: () => void
  onClose: () => void
  onSessionExpired: () => void
}

/** Group settings: rename it, see who's in it, add people, remove people (creator), leave. */
export function GroupSettingsDialog({
  group,
  me,
  presence,
  onRenamed,
  onAddPeople,
  onViewProfile,
  onLeave,
  onClose,
  onSessionExpired
}: SettingsProps): React.JSX.Element {
  const [name, setName] = useState(group.name ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [removing, setRemoving] = useState<PublicUser | null>(null)
  const [busyRemove, setBusyRemove] = useState(false)
  useEscape(onClose, !removing)

  // Someone else renamed it while this is open: show the new name (unless you're typing).
  const [shownName, setShownName] = useState(group.name)
  if (group.name !== shownName) {
    setShownName(group.name)
    if (name.trim() === (shownName ?? '')) setName(group.name ?? '')
  }

  const iMadeIt = group.createdBy === me.id
  const full = group.memberCount >= GROUP_MAX
  const changed = name.trim() !== (group.name ?? '')
  const people: PublicUser[] = [me, ...group.members]
  // Whoever can remove people is shown first after you.
  const creatorFirst = [...people].sort(
    (a, b) =>
      Number(b.id === me.id) - Number(a.id === me.id) ||
      Number(b.id === group.createdBy) - Number(a.id === group.createdBy)
  )

  async function save(): Promise<void> {
    if (!changed || saving) return
    setSaving(true)
    setMessage(null)
    const result = await window.glofly.conversations.renameGroup(group.id, name.trim() || null)
    setSaving(false)
    if (result.ok) onRenamed(result.data)
    else if (result.error === 'unauthorized') onSessionExpired()
    else setMessage(result.message)
  }

  async function remove(): Promise<void> {
    if (!removing) return
    setBusyRemove(true)
    const result = await window.glofly.conversations.removeMember(group.id, removing.id)
    setBusyRemove(false)
    setRemoving(null)
    if (!result.ok) {
      if (result.error === 'unauthorized') onSessionExpired()
      else setMessage(result.message)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-settings-title"
        className="dialog add-friend-dialog group-dialog"
      >
        <div className="dialog-head">
          <div>
            <h1 id="group-settings-title">Group settings</h1>
            <p>Anyone in the group can rename it and add their friends.</p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <form
          className="group-name-field group-name-field--row"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <label htmlFor="group-name">
            <PencilIcon size={15} />
            Group name
          </label>
          <div className="group-name-row">
            <input
              id="group-name"
              type="text"
              value={name}
              maxLength={GROUP_NAME_MAX}
              placeholder={chatTitle({ ...group, name: null })}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              type="submit"
              className="small-button small-button--primary"
              disabled={!changed || saving}
            >
              {name.trim() || !group.name ? 'Save' : 'Clear name'}
            </button>
          </div>
        </form>

        {message && (
          <p className="dialog-message" role="alert">
            {message}
          </p>
        )}

        <div className="group-members-head">
          <h2>{memberCountLabel(group.memberCount)}</h2>
          <button
            type="button"
            className="small-button small-button--quiet"
            disabled={full}
            title={full ? `Groups can have up to ${GROUP_MAX} people.` : undefined}
            onClick={onAddPeople}
          >
            <AddFriendIcon size={16} />
            Add people
          </button>
        </div>

        <ul className="people-results group-members">
          {creatorFirst.map((p) => {
            const isMe = p.id === me.id
            const status = isMe ? undefined : presence[p.id]?.status
            return (
              <li key={p.id} className="person">
                <button
                  type="button"
                  className="member-face"
                  aria-label={`View ${isMe ? 'your' : `${p.displayName}'s`} profile`}
                  onClick={() => onViewProfile(p)}
                >
                  <Avatar
                    id={p.id}
                    name={p.displayName}
                    avatarVersion={p.avatarVersion}
                    status={status}
                    ring="var(--glo-surface)"
                    mine={isMe}
                  />
                </button>
                <span className="person-text">
                  <span className="person-name">
                    {p.displayName}
                    {isMe && <span className="member-you"> (you)</span>}
                  </span>
                  <span className="person-sub">@{p.username}</span>
                </span>
                {p.id === group.createdBy && <span className="member-badge">Group owner</span>}
                {iMadeIt && !isMe && (
                  <button
                    type="button"
                    className="small-button small-button--quiet"
                    onClick={() => setRemoving(p)}
                  >
                    Remove
                  </button>
                )}
              </li>
            )
          })}
        </ul>

        <div className="group-dialog-foot">
          <span>
            {iMadeIt
              ? 'You made this group, so you can remove people.'
              : 'The group owner can remove people.'}
          </span>
          <button type="button" className="small-button small-button--danger" onClick={onLeave}>
            <LeaveIcon size={16} />
            Leave group
          </button>
        </div>
      </div>

      {removing && (
        <ConfirmDialog
          title={`Remove ${removing.displayName}?`}
          message={`@${removing.username} will be taken out of ${chatTitle(group)} and won't see new messages. Anyone in the group can add them back later.`}
          confirmLabel="Remove"
          danger
          busy={busyRemove}
          onConfirm={() => void remove()}
          onCancel={() => setRemoving(null)}
        />
      )}
    </div>
  )
}
