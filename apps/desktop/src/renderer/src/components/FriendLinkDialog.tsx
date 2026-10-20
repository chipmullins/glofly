import { useEffect, useRef, useState } from 'react'
import type { FriendLinkPreview } from '../../../preload/api-types'
import Avatar from './Avatar'
import './dialogs.css'
import './InviteLink.css'

// 0.8.0: Glofly opened from a friend's invite link while signed in (glofly://i/<code> on the
// desktop, chat.glofly.app/?friend=<code> in a browser): "Add Chip as a friend?". Nothing happens
// until you say yes. Already friends, your own link, a dead link: it says so.

type State =
  | { kind: 'loading' }
  | { kind: 'ask'; preview: FriendLinkPreview }
  | { kind: 'busy'; preview: FriendLinkPreview }
  | { kind: 'done'; preview: FriendLinkPreview }
  | { kind: 'problem'; message: string }

const firstName = (name: string): string => name.trim().split(/\s+/)[0] || name

export default function FriendLinkDialog({
  code,
  onClose,
  onFriends,
  onMessage,
  onSessionExpired
}: {
  code: string
  onClose: () => void
  /** You're friends now: refresh the lists */
  onFriends: () => void
  /** "Say hi": open a chat with them */
  onMessage: (userId: string) => void
  onSessionExpired: () => void
}): React.JSX.Element {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const box = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    let live = true
    void window.glofly.friends.previewLink(code).then((r) => {
      if (!live) return
      if (r.ok)
        setState({ kind: r.data.relationship === 'friends' ? 'done' : 'ask', preview: r.data })
      else if (r.error === 'unauthorized') onSessionExpired()
      else setState({ kind: 'problem', message: r.message })
    })
    return () => {
      live = false
    }
  }, [code, onSessionExpired])

  useEffect(() => {
    box.current?.focus()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [])

  async function add(): Promise<void> {
    if (state.kind !== 'ask') return
    const preview = state.preview
    setState({ kind: 'busy', preview })
    const r = await window.glofly.friends.acceptLink(code)
    if (r.ok) {
      setState({ kind: 'done', preview: { ...preview, relationship: 'friends' } })
      onFriends()
    } else if (r.error === 'unauthorized') onSessionExpired()
    else setState({ kind: 'problem', message: r.message })
  }

  const preview = state.kind === 'loading' || state.kind === 'problem' ? null : state.preview
  const who = preview?.user
  const name = who ? firstName(who.displayName) : ''
  const self = preview?.relationship === 'self'

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="il-ask-title"
        className="dialog il-ask"
      >
        {state.kind === 'loading' && (
          <p role="status" className="il-ask-wait">
            Opening the invite link…
          </p>
        )}
        {state.kind === 'problem' && (
          <>
            <h1 id="il-ask-title">Invite link</h1>
            <p>{state.message}</p>
            <div className="il-ask-actions">
              <button
                type="button"
                className="small-button small-button--primary"
                onClick={onClose}
              >
                OK
              </button>
            </div>
          </>
        )}
        {who && (
          <>
            <span className="il-ask-face">
              <Avatar
                id={who.id}
                name={who.displayName}
                avatarVersion={who.avatarVersion}
                size={84}
              />
            </span>
            <h1 id="il-ask-title">
              {self
                ? 'This is your invite link'
                : state.kind === 'done'
                  ? `You and ${name} are friends`
                  : `Add ${name} as a friend?`}
            </h1>
            <p>
              {self
                ? 'Send it to friends. You’ll automatically be friends as soon as they join.'
                : `${who.displayName} · @${who.username}`}
            </p>
            <div className="il-ask-actions">
              {self ? (
                <button
                  type="button"
                  className="small-button small-button--primary"
                  onClick={onClose}
                >
                  OK
                </button>
              ) : state.kind === 'done' ? (
                <>
                  <button
                    type="button"
                    className="small-button small-button--quiet"
                    onClick={onClose}
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    className="small-button small-button--primary"
                    onClick={() => onMessage(who.id)}
                  >
                    Say hi
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="small-button small-button--quiet"
                    onClick={onClose}
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    className="small-button small-button--primary"
                    disabled={state.kind === 'busy'}
                    onClick={() => void add()}
                  >
                    {state.kind === 'busy' ? 'Adding…' : 'Add friend'}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
