import { useEffect, useState } from 'react'
import type { Announcement, TeamNotice } from '../../../preload/api-types'
import { TEAM_REPLY_MAX } from '@glofly/shared/types'
import fireflyImg from '../assets/firefly.png'
import { MegaphoneIcon } from './icons'
import './dialogs.css'
import './Safety.css'

// Messages from the Glofly team: a warning (a dialog until "I understand") and the
// announcement banner at the top of the app (Glofly Control → Announcements).

/**
 * "A message from the Glofly team": a warning stays until you press I understand. 0.9.0: a message
 * sent with Control's "Message as Glofly team" shows as from the Glofly Team (Official), with a reply
 * box when replies are allowed (the reply goes to the team's Inbox).
 */
export function TeamNoticeDialog({
  notice,
  onSeen,
  onReply
}: {
  notice: TeamNotice
  onSeen: () => void
  /** Sends the reply; resolves true when it went through */
  onReply?: (body: string) => Promise<boolean>
}): React.JSX.Element {
  const isMessage = notice.kind === 'message'
  const canReply = isMessage && notice.allowReply === true && !!onReply
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [failed, setFailed] = useState(false)

  const send = async (): Promise<void> => {
    if (!onReply || !reply.trim() || sending) return
    setSending(true)
    setFailed(false)
    const ok = await onReply(reply.trim())
    setSending(false)
    if (!ok) setFailed(true)
  }

  return (
    <div className="dialog-backdrop">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="team-notice-title"
        aria-describedby="team-notice-body"
        className="dialog confirm team-notice"
      >
        <div className="team-notice-head">
          <img src={fireflyImg} alt="" draggable={false} />
          {isMessage ? (
            <h1 id="team-notice-title" className="team-notice-from">
              Glofly Team <span className="team-notice-official">Official</span>
            </h1>
          ) : (
            <h1 id="team-notice-title">A message from the Glofly team</h1>
          )}
        </div>
        <p
          id="team-notice-body"
          className={isMessage ? 'team-notice-body team-notice-bubble' : 'team-notice-body'}
        >
          {notice.body}
        </p>
        {canReply ? (
          <>
            <label className="team-notice-reply">
              <span>Reply to the Glofly team</span>
              <textarea
                rows={3}
                maxLength={TEAM_REPLY_MAX}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply (optional)"
                disabled={sending}
              />
            </label>
            {failed && (
              <p className="team-notice-error" role="alert">
                That didn&apos;t send. Check your connection and try again.
              </p>
            )}
          </>
        ) : (
          <p className="team-notice-foot">
            Questions? Email <strong>support@glofly.app</strong>.
          </p>
        )}
        <div className="confirm-actions">
          {canReply && reply.trim() ? (
            <>
              <button type="button" className="small-button" onClick={onSeen} disabled={sending}>
                Close
              </button>
              <button
                type="button"
                className="small-button small-button--primary"
                onClick={() => void send()}
                disabled={sending}
              >
                {sending ? 'Sending…' : 'Send reply'}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="small-button small-button--primary"
              autoFocus
              onClick={onSeen}
            >
              {isMessage ? 'Got it' : 'I understand'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const DISMISSED_KEY = 'glofly.dismissedAnnouncements'

function dismissedIds(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** The announcement banner. Dismissing hides that announcement on this computer. */
export function AnnouncementBar({
  announcement
}: {
  announcement: Announcement | null
}): React.JSX.Element | null {
  const [dismissed, setDismissed] = useState<string[]>(dismissedIds)
  // An announcement that ends by itself goes away on time, without waiting for the server.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!announcement?.endsAt) return
    const ms = new Date(announcement.endsAt).getTime() - Date.now()
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Math.min(ms + 500, 2 ** 31 - 1)))
    return () => clearTimeout(timer)
  }, [announcement])

  if (!announcement || dismissed.includes(announcement.id)) return null
  if (announcement.endsAt && new Date(announcement.endsAt).getTime() <= now) return null

  const dismiss = (): void => {
    const next = [...dismissed, announcement.id].slice(-20)
    setDismissed(next)
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
    } catch {
      // Storage unavailable: it's hidden until Glofly restarts.
    }
  }

  return (
    <div
      className={
        announcement.tone === 'important'
          ? 'announcement-bar announcement-bar--important'
          : 'announcement-bar'
      }
      role="status"
    >
      <MegaphoneIcon size={18} />
      <span className="announcement-text">{announcement.body}</span>
      {announcement.linkUrl && (
        <a
          className="announcement-link"
          href={announcement.linkUrl}
          target="_blank"
          rel="noreferrer"
        >
          {announcement.linkLabel || 'Learn more'}
        </a>
      )}
      <button type="button" className="announcement-close" aria-label="Dismiss" onClick={dismiss}>
        ×
      </button>
    </div>
  )
}
