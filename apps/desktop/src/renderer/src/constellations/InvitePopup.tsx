import { useEffect, useState } from 'react'
import type { InvitePopup as Invite } from '@glofly/shared/constellations'
import { api } from '../lib/constellations'
import { playSound } from '../lib/sounds'
import { ConstellationIcon } from './bits'
import { GalaxyIcon } from './sky'

// 0.7.1: someone invites you to a constellation: it pops up straight away, on Glofly home and on
// the night side alike (bottom right, in the night style), with Join and Decline. It also stays
// on your Constellations dashboard under Invites until you answer.

export default function InvitePopup({
  onJoined,
  onProblem
}: {
  /** Joined: fly into it */
  onJoined: (constellationId: string) => void
  onProblem: (message: string) => void
}): React.JSX.Element | null {
  const [queue, setQueue] = useState<Invite[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(
    () =>
      window.glofly.onEvent((event) => {
        if (event.type !== 'constellation:invited') return
        playSound('friendRequest')
        setQueue((q) =>
          [
            ...q.filter((i) => i.constellationId !== event.invite.constellationId),
            event.invite
          ].slice(-4)
        )
      }),
    []
  )
  const invite = queue[0]
  // A pop-up nobody answers folds away after a minute (the invite stays on the dashboard).
  useEffect(() => {
    if (!invite) return
    const t = setTimeout(() => setQueue((q) => q.filter((i) => i.id !== invite.id)), 60_000)
    return () => clearTimeout(t)
  }, [invite])
  if (!invite) return null
  const done = (): void => setQueue((q) => q.filter((i) => i.id !== invite.id))
  const first = invite.by.displayName.trim().split(/\s+/)[0] || invite.by.username

  return (
    <div
      className="cx-invite-pop"
      role="dialog"
      aria-live="polite"
      aria-label={`${first} invited you to ${invite.name}`}
    >
      <span className="cx-invite-pop-glow" aria-hidden="true" />
      <div className="cx-invite-pop-head">
        <GalaxyIcon size={14} color="#ffb347" />
        <span>Constellation invite</span>
        <button type="button" className="cx-invite-pop-close" aria-label="Close" onClick={done}>
          ×
        </button>
      </div>
      <div className="cx-invite-pop-body">
        <ConstellationIcon
          id={invite.constellationId}
          name={invite.name}
          color={invite.color}
          iconVersion={invite.iconVersion}
          className="cx-invite-icon"
        />
        <span className="cx-invite-text">
          <strong>{invite.name}</strong>
          <span>
            {first} invited you · {invite.memberCount}{' '}
            {invite.memberCount === 1 ? 'member' : 'members'}
          </span>
        </span>
      </div>
      <div className="cx-invite-pop-actions">
        <button
          type="button"
          className="cx-small-pill"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api.dismissInvite(invite.id).finally(() => {
              setBusy(false)
              done()
            })
          }}
        >
          Decline
        </button>
        <button
          type="button"
          className="cx-small-pill cx-small-pill--join"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void api.join(invite.constellationId).then((r) => {
              setBusy(false)
              if (!r.ok) {
                onProblem(r.message)
                return
              }
              done()
              onJoined(invite.constellationId)
            })
          }}
        >
          Join
        </button>
      </div>
    </div>
  )
}
