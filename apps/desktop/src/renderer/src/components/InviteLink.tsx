import { useEffect, useRef, useState } from 'react'
import { FRIEND_LINK_PITCH, friendLinkJoinedLine, friendLinkText } from '@glofly/shared/friendLinks'
import { copyFriendLink, resetFriendLink, useFriendLink } from '../lib/friendLink'
import './InviteLink.css'

// 0.8.0 shareable friend invite link (InviteLink.dc.html, approved Oct 20): the card in Add
// friend ("Not on Glofly yet?", the link, Copy link → Copied!, "3 friends joined from your link",
// Reset link with an inline "Make a new link?"), and the compact row in Settings → Friends.

function LinkGlyph(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </svg>
  )
}

/** "Copied!" for a moment after a copy. */
function useCopied(): [boolean, (code: string) => Promise<boolean>] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), [])
  const copy = async (code: string): Promise<boolean> => {
    const ok = await copyFriendLink(code)
    if (!ok) return false
    setCopied(true)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1600)
    return true
  }
  return [copied, copy]
}

/** The inline "Make a new link?" confirm (Cancel / New link). */
function ResetConfirm({
  busy,
  onCancel,
  onReset
}: {
  busy: boolean
  onCancel: () => void
  onReset: () => void
}): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  return (
    <div className="il-confirm" role="group" aria-label="Make a new invite link?">
      <span>
        Make a new link? Your old one stops working right away. People who already joined stay your
        friends.
      </span>
      <button
        ref={cancelRef}
        type="button"
        className="il-text-button il-text-button--ink"
        onClick={onCancel}
      >
        Cancel
      </button>
      <button type="button" className="il-new" disabled={busy} onClick={onReset}>
        {busy ? 'Making…' : 'New link'}
      </button>
    </div>
  )
}

/** Add friend's card. */
export function InviteLinkCard({
  userId,
  onCopied
}: {
  userId: string
  /** The link was copied (the welcome card ticks "Invite friends") */
  onCopied?: () => void
}): React.JSX.Element {
  const { link, problem, loading } = useFriendLink(userId)
  const [copied, copy] = useCopied()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function doCopy(): Promise<void> {
    if (!link) return
    if (await copy(link.code)) {
      setNote(null)
      onCopied?.()
    } else setNote("Couldn't copy the link. Select it and copy it yourself.")
  }

  async function doReset(): Promise<void> {
    setBusy(true)
    const failed = await resetFriendLink()
    setBusy(false)
    setConfirming(false)
    setNote(failed)
  }

  return (
    <section className="il-card" aria-labelledby="il-title">
      <svg className="il-art" width="140" height="90" viewBox="0 0 140 90" aria-hidden="true">
        <defs>
          <radialGradient id="il-glow">
            <stop offset="0" stopColor="#ffe9a8" />
            <stop offset=".35" stopColor="#ffb347" stopOpacity=".75" />
            <stop offset="1" stopColor="#ffb347" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path
          d="M20 70c26-34 64-40 100-26"
          className="il-art-path"
          strokeWidth="2"
          fill="none"
          strokeDasharray="2 6"
          strokeLinecap="round"
        />
        <circle cx="20" cy="70" r="14" fill="url(#il-glow)" />
        <circle cx="20" cy="70" r="2.6" fill="#fff4cf" />
        <circle cx="118" cy="44" r="18" fill="url(#il-glow)" />
        <circle cx="118" cy="44" r="3.2" fill="#fff4cf" />
      </svg>
      <div className="il-text">
        <h2 id="il-title">Not on Glofly yet?</h2>
        <p>{FRIEND_LINK_PITCH}</p>
      </div>
      <div className="il-row">
        <div className="il-link" title={link ? `https://${friendLinkText(link.code)}` : undefined}>
          <LinkGlyph />
          {link ? (
            <span className="il-link-text">
              glofly.app/i/<b>{link.code}</b>
            </span>
          ) : (
            <span className="il-link-text il-link-text--wait">
              {problem ?? (loading ? 'Making your link…' : '')}
            </span>
          )}
        </div>
        <button
          type="button"
          className={copied ? 'il-copy il-copy--done' : 'il-copy'}
          disabled={!link}
          onClick={() => void doCopy()}
        >
          {copied ? (
            <>
              <svg
                width="16"
                height="16"
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
              Copied!
            </>
          ) : (
            'Copy link'
          )}
        </button>
      </div>
      <span className="visually-hidden" role="status">
        {copied ? 'Link copied' : ''}
      </span>
      <div className="il-foot">
        <span>{link ? friendLinkJoinedLine(link.joined) : ''}</span>
        <button
          type="button"
          className="il-text-button"
          disabled={!link || confirming}
          onClick={() => setConfirming(true)}
        >
          Reset link
        </button>
      </div>
      {confirming && (
        <ResetConfirm
          busy={busy}
          onCancel={() => setConfirming(false)}
          onReset={() => void doReset()}
        />
      )}
      {note && (
        <p className="il-note" role="alert">
          {note}
        </p>
      )}
    </section>
  )
}

/** Settings → Friends: "Your invite link" with Copy and Reset. */
export function InviteLinkRow({ userId }: { userId: string }): React.JSX.Element {
  const { link, problem, loading } = useFriendLink(userId)
  const [copied, copy] = useCopied()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function doReset(): Promise<void> {
    setBusy(true)
    const failed = await resetFriendLink()
    setBusy(false)
    setConfirming(false)
    setNote(failed)
  }

  return (
    <div className="settings-row settings-row--stack il-settings" id="settings-invite-link">
      <div className="il-settings-line">
        <div className="settings-row-text">
          <span className="settings-row-label">Your invite link</span>
          <span className="settings-row-desc il-settings-link">
            {link ? friendLinkText(link.code) : (problem ?? (loading ? 'Making your link…' : ''))}
          </span>
          {link && <span className="settings-row-desc">{friendLinkJoinedLine(link.joined)}</span>}
        </div>
        <button
          type="button"
          className={copied ? 'il-settings-copy il-settings-copy--done' : 'il-settings-copy'}
          disabled={!link}
          onClick={() =>
            link &&
            void copy(link.code).then((ok) => setNote(ok ? null : "Couldn't copy the link."))
          }
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button
          type="button"
          className="il-text-button il-text-button--muted"
          disabled={!link || confirming}
          onClick={() => setConfirming(true)}
        >
          Reset
        </button>
      </div>
      {confirming && (
        <ResetConfirm
          busy={busy}
          onCancel={() => setConfirming(false)}
          onReset={() => void doReset()}
        />
      )}
      {note && (
        <p className="il-note" role="alert">
          {note}
        </p>
      )}
    </div>
  )
}
