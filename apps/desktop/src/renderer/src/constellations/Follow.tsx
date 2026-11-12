import { useEffect, useState } from 'react'
import type { AnnouncementFollow, AnnouncementFollower, FollowTarget } from '@glofly/shared/stages'
import type { ConstellationDetail, Nebula } from '../../../preload/api-types'
import { followApi } from '../lib/stage'
import { can } from '../lib/constellations'
import { ConstellationIcon } from './bits'

// Communities round 2, board 3b (approved): Follow on an announcement nebula, the follow dialog
// ("Your constellation" / "Into nebula"), and the lists in Constellation settings → Nebulas.

/** The header's Follow button (anyone who manages nebulas in some other constellation can use it). */
export function FollowButton({
  c,
  nebula,
  onProblem
}: {
  c: ConstellationDetail
  nebula: Nebula
  onProblem: (message: string) => void
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [targets, setTargets] = useState<FollowTarget[] | null>(null)
  useEffect(() => {
    let gone = false
    void followApi.targets(nebula.id).then((r) => !gone && setTargets(r.ok ? r.data.targets : []))
    return () => {
      gone = true
    }
  }, [nebula.id, open])
  if (!targets || !targets.length) return null
  return (
    <>
      <button type="button" className="cx-follow-button" onClick={() => setOpen(true)}>
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Follow
      </button>
      {open && (
        <FollowDialog
          c={c}
          nebula={nebula}
          targets={targets}
          onClose={() => setOpen(false)}
          onProblem={onProblem}
        />
      )}
    </>
  )
}

function FollowDialog({
  c,
  nebula,
  targets,
  onClose,
  onProblem
}: {
  c: ConstellationDetail
  nebula: Nebula
  targets: FollowTarget[]
  onClose: () => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const [where, setWhere] = useState(targets[0].constellationId)
  const target = targets.find((t) => t.constellationId === where) ?? targets[0]
  const free = target.nebulas.filter((n) => !n.following)
  const [pick, setInto] = useState('')
  const into = free.some((n) => n.id === pick) ? pick : (free[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  return (
    <div
      className="cx-dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cx-follow-title"
        className="cx-dialog cx-dialog--small"
      >
        <div className="cx-dialog-body">
          <h1 id="cx-follow-title">Follow #{nebula.name}</h1>
          {done ? (
            <p>
              New posts from {c.name} will show up in #
              {target.nebulas.find((n) => n.id === into)?.name ?? 'your nebula'}.
            </p>
          ) : (
            <>
              <p>New posts from {c.name} are copied into a nebula of yours.</p>
              <label className="cx-field">
                Your constellation
                <span className="cx-follow-pick">
                  <ConstellationIcon
                    id={target.constellationId}
                    name={target.name}
                    color={(target.color ?? 'ember') as ConstellationDetail['color']}
                    iconVersion={target.iconVersion}
                    className="cx-follow-icon"
                  />
                  <select value={where} onChange={(e) => setWhere(e.target.value)}>
                    {targets.map((t) => (
                      <option key={t.constellationId} value={t.constellationId}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </span>
              </label>
              <label className="cx-field">
                Into nebula
                <select value={into} onChange={(e) => setInto(e.target.value)}>
                  {target.nebulas.map((n) => (
                    <option key={n.id} value={n.id} disabled={n.following}>
                      #{n.name}
                      {n.following ? ' (already following)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <p className="cx-settings-text" style={{ fontSize: 12 }}>
                Only constellations where you can manage nebulas are listed. {c.name} sees that{' '}
                {target.name} follows (not who clicked).
              </p>
            </>
          )}
          <div className="cx-dialog-actions">
            <button type="button" className="cx-button" onClick={onClose}>
              {done ? 'Done' : 'Cancel'}
            </button>
            {!done && (
              <button
                type="button"
                className="cx-button cx-button--primary"
                disabled={busy || !into}
                onClick={async () => {
                  setBusy(true)
                  const r = await followApi.follow(c.id, nebula.id, into)
                  setBusy(false)
                  if (!r.ok) onProblem(r.message)
                  else setDone(true)
                }}
              >
                Follow
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Settings → Nebulas → an announcement nebula: which constellations follow it. */
export function FollowersList({
  c,
  nebula
}: {
  c: ConstellationDetail
  nebula: Nebula
}): React.JSX.Element | null {
  const [list, setList] = useState<AnnouncementFollower[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const load = (): void =>
    void followApi.followers(c.id, nebula.id).then((r) => {
      if (r.ok) setList(r.data.followers)
      else setProblem(r.message)
    })
  useEffect(load, [c.id, nebula.id])
  if (!can(c, 'manageNebulas')) return null
  return (
    <div className="cx-follow-list">
      <strong>Followed by {list ? list.length : '…'} constellations</strong>
      {problem && <p className="cx-settings-text">{problem}</p>}
      {list?.length === 0 && (
        <p className="cx-settings-text">
          Nobody follows it yet. Public constellations’ announcements can be followed by anyone.
        </p>
      )}
      {list?.map((f) => (
        <div key={f.followId} className="cx-follow-row">
          <ConstellationIcon
            id={f.constellationId}
            name={f.name}
            color={(f.color ?? 'ember') as ConstellationDetail['color']}
            iconVersion={f.iconVersion}
            className="cx-follow-icon"
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>{f.name}</b> · into #{f.nebulaName}
          </span>
          <button
            type="button"
            className="cx-link-button"
            onClick={async () => {
              const r = await followApi.removeFollower(c.id, nebula.id, f.followId)
              if (r.ok) load()
              else setProblem(r.message)
            }}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  )
}

/** Settings → Nebulas → a text nebula: announcement nebulas this one gets posts from. */
export function FollowingList({
  c,
  nebula
}: {
  c: ConstellationDetail
  nebula: Nebula
}): React.JSX.Element | null {
  const [list, setList] = useState<AnnouncementFollow[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const load = (): void =>
    void followApi.follows(c.id).then((r) => {
      if (r.ok) setList(r.data.follows)
      else setProblem(r.message)
    })
  useEffect(load, [c.id])
  const mine = list?.filter((f) => f.targetNebulaId === nebula.id) ?? []
  if (!mine.length && !problem) return null
  return (
    <div className="cx-follow-list">
      <strong>Gets posts from</strong>
      {problem && <p className="cx-settings-text">{problem}</p>}
      {mine.map((f) => (
        <div key={f.followId} className="cx-follow-row">
          <span style={{ flex: 1, minWidth: 0 }}>
            <b>{f.sourceName}</b> › #{f.sourceNebulaName}
          </span>
          <button
            type="button"
            className="cx-link-button"
            onClick={async () => {
              const r = await followApi.unfollow(c.id, f.followId)
              if (r.ok) load()
              else setProblem(r.message)
            }}
          >
            Unfollow
          </button>
        </div>
      ))}
    </div>
  )
}
