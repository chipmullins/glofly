import { useEffect, useMemo, useRef, useState } from 'react'
import { ROLE_COLORS, accentOf } from '@glofly/shared/constellations'
import type { ConstellationDetail, PublicUser, SignedInUser } from '../../../preload/api-types'
import { AvatarFace } from '../components/Avatar'
import { colorsFor } from '../lib/avatarColors'
import { api } from '../lib/constellations'
import { ConstellationIcon } from './bits'
import { BannerArt } from './identity'
import './WelcomeDialog.css'
import './RoleVisibility.css'

// 0.7.5 Constellations polish, "Welcome when you join" (the approved Welcome board): shown once,
// right after you fly in for the first time. The about (with friends who are already there), the
// house rules with "I agree", and "What do you play?": roles members can pick themselves. Steps
// without anything to show are skipped. Owners write the about and rules in Settings → Overview.

const firstName = (u: PublicUser): string => u.displayName.trim().split(/\s+/)[0] || u.username

function Face({ person, size }: { person: PublicUser; size: number }): React.JSX.Element {
  const [bg, fg] = colorsFor(person.id)
  return (
    <span
      className="cx-face cx-welcome-face"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        background: bg,
        color: fg,
        fontSize: Math.round(size * 0.36)
      }}
    >
      <AvatarFace id={person.id} name={person.displayName} avatarVersion={person.avatarVersion} />
    </span>
  )
}

/** Turns "#general" in the about into the highlighted nebula name. */
function AboutText({ text, names }: { text: string; names: Set<string> }): React.JSX.Element {
  const parts = text.split(/(#[\w-]+)/g)
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith('#') && names.has(p.slice(1).toLowerCase()) ? (
          <b key={i} className="cx-welcome-neb">
            {p}
          </b>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  )
}

type Step = 'about' | 'rules' | 'roles'

export default function WelcomeDialog({
  detail: c,
  me,
  friendIds,
  onDone,
  onProblem
}: {
  detail: ConstellationDetail
  me: SignedInUser
  friendIds: Set<string>
  /** Closed: the constellation as it is now (null if saving didn't work) */
  onDone: (next: ConstellationDetail | null) => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const rules = c.rules ?? []
  // 4.3: with onboarding on, its questions pick roles instead (right after this).
  const pickable = c.onboarding?.enabled ? [] : c.roles.filter((r) => r.selfAssign)
  const steps: Step[] = [
    'about',
    ...(rules.length ? (['rules'] as const) : []),
    ...(pickable.length ? (['roles'] as const) : [])
  ]
  const [at, setAt] = useState(0)
  const [agreed, setAgreed] = useState(false)
  const mine = c.members.find((m) => m.user.id === me.id)
  const [picks, setPicks] = useState<string[]>(() =>
    (mine?.roleIds ?? []).filter((id) => pickable.some((r) => r.id === id))
  )
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const step = steps[at]
  const a = accentOf(c)
  const owner = c.members.find((m) => m.user.id === c.ownerId)?.user
  const online = c.members.filter((m) => m.status !== 'offline').length
  const friends = c.members.filter((m) => friendIds.has(m.user.id)).map((m) => m.user)
  const faces = [
    ...friends,
    ...c.members.map((m) => m.user).filter((u) => u.id !== me.id && !friendIds.has(u.id))
  ].slice(0, 4)
  const nebulaNames = useMemo(
    () => new Set(c.nebulas.map((n) => n.name.toLowerCase())),
    [c.nebulas]
  )
  const firstText = c.nebulas.find((n) => n.kind === 'text' && !n.readOnly)?.name ?? 'general'
  const blocked = step === 'rules' && !agreed
  const last = at === steps.length - 1

  useEffect(() => {
    box.current?.focus()
  }, [at])

  async function finish(): Promise<void> {
    setBusy(true)
    const r = await api.welcomeDone(c.id, agreed, picks)
    setBusy(false)
    if (!r.ok) {
      onProblem(r.message)
      return
    }
    onDone(r.data.constellation)
  }
  function next(): void {
    if (blocked || busy) return
    if (last) void finish()
    else setAt(at + 1)
  }
  const nextLabel =
    step === 'rules' ? (agreed ? 'Continue' : 'Agree to continue') : last ? 'Open' : 'Next'

  return (
    <div className="cx-welcome-backdrop">
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Welcome to ${c.name}`}
        className="cx-welcome"
        style={{
          ['--cxa' as string]: a.color,
          ['--cxa-rgb' as string]: a.rgb,
          ['--cxa-on' as string]: a.on
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            // Escape is "later": the welcome comes back next time (rules still need agreeing).
            onDone(null)
          }
        }}
      >
        <div className="cx-welcome-banner">
          <BannerArt c={c} width={620} height={132} />
          <ConstellationIcon
            id={c.id}
            name={c.name}
            color={c.color}
            iconVersion={c.iconVersion}
            className="cx-welcome-icon"
            style={c.iconVersion ? undefined : { background: '#120c0a', color: a.color }}
          />
          {steps.length > 1 && (
            <div className="cx-welcome-dots" aria-label={`Step ${at + 1} of ${steps.length}`}>
              {steps.map((s, i) => (
                <span key={s} className={i === at ? 'on' : i < at ? 'done' : ''} />
              ))}
            </div>
          )}
        </div>
        <div className="cx-welcome-body">
          {step === 'about' && (
            <div className="cx-welcome-step">
              <div>
                <h2>
                  Welcome to {c.name}, {firstName(me)}!
                </h2>
                <div className="cx-welcome-line">
                  {(c.memberCount ?? c.members.length).toLocaleString('en-US')}{' '}
                  {(c.memberCount ?? c.members.length) === 1 ? 'member' : 'members'} ·{' '}
                  <span className="cx-welcome-online">{online} online now</span>
                  {owner ? ` · made by ${firstName(owner)}` : ''}
                </div>
              </div>
              <p className="cx-welcome-about">
                {c.description ? (
                  <AboutText text={c.description} names={nebulaNames} />
                ) : (
                  <>
                    Say hi in <b className="cx-welcome-neb">#{firstText}</b> once you&apos;re in!
                  </>
                )}
              </p>
              {faces.length > 0 && (
                <div className="cx-welcome-friends">
                  <span className="cx-welcome-faces">
                    {faces.map((p) => (
                      <Face key={p.id} person={p} size={30} />
                    ))}
                  </span>
                  {friends.length === 0
                    ? `${((c.memberCount ?? c.members.length) - 1).toLocaleString('en-US')} ${(c.memberCount ?? c.members.length) - 1 === 1 ? 'person is' : 'people are'} here`
                    : friends.length === 1
                      ? `${firstName(friends[0])} (your friend) is here`
                      : friends.length === 2
                        ? `${firstName(friends[0])} and ${firstName(friends[1])} (your friends) are here`
                        : `${firstName(friends[0])}, ${firstName(friends[1])} and ${friends.length - 2} more of your friends are here`}
                </div>
              )}
            </div>
          )}
          {step === 'rules' && (
            <div className="cx-welcome-step">
              <h2>House rules</h2>
              <ol className="cx-welcome-rules">
                {rules.map((r, i) => (
                  <li key={i}>
                    <span>{i + 1}</span>
                    {r}
                  </li>
                ))}
              </ol>
              <button
                type="button"
                role="checkbox"
                aria-checked={agreed}
                className={agreed ? 'cx-welcome-agree on' : 'cx-welcome-agree'}
                onClick={() => setAgreed((v) => !v)}
              >
                <span className="cx-welcome-box" aria-hidden="true">
                  {agreed ? '✓' : ''}
                </span>
                I agree to the house rules
              </button>
            </div>
          )}
          {step === 'roles' && (
            <div className="cx-welcome-step">
              <div>
                <h2>What do you play?</h2>
                <div className="cx-welcome-line">
                  Pick any. You get the role, so people know. Change it any time.
                </div>
              </div>
              <RoleChips c={c} picks={picks} onPicks={setPicks} />
              <div className="cx-welcome-unlock" aria-live="polite">
                {hasUnlocks(c) ? (
                  <YoullSee c={c} picks={picks} />
                ) : picks.length ? (
                  `You'll get: ${pickable
                    .filter((r) => picks.includes(r.id))
                    .map((r) => r.name)
                    .join(', ')}`
                ) : (
                  'No roles picked. You can pick some later from the menu by its name.'
                )}
              </div>
            </div>
          )}
          <div className="cx-welcome-nav">
            <button
              type="button"
              className="cx-welcome-back"
              style={{ visibility: at > 0 ? 'visible' : 'hidden' }}
              onClick={() => setAt(Math.max(0, at - 1))}
            >
              Back
            </button>
            <button
              type="button"
              className="cx-welcome-next"
              aria-disabled={blocked || busy}
              onClick={next}
            >
              {busy ? 'One moment…' : nextLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 0.8.0: does picking a role here show role-only nebulas? (From the server.) */
const hasUnlocks = (c: ConstellationDetail): boolean => Object.keys(c.unlocks ?? {}).length > 0

/** 0.8.0 "You'll see: #valorant, #minecraft" as roles are picked (RoleNebulas board). */
export function YoullSee({
  c,
  picks
}: {
  c: ConstellationDetail
  picks: string[]
}): React.JSX.Element {
  const shown = [...new Set(picks.flatMap((id) => c.unlocks?.[id] ?? []))]
  return (
    <span className="cx-welcome-sees">
      You&apos;ll see: <b>{shown.length ? shown.join(', ') : 'just the nebulas everyone sees'}</b>
    </span>
  )
}

/** The chips of roles you can pick yourself (welcome step 3, "Your roles"). */
export function RoleChips({
  c,
  picks,
  onPicks
}: {
  c: ConstellationDetail
  picks: string[]
  onPicks: (ids: string[]) => void
}): React.JSX.Element {
  const pickable = c.roles.filter((r) => r.selfAssign)
  return (
    <div className="cx-welcome-chips" role="group" aria-label="Roles you can pick">
      {pickable.map((r) => {
        const on = picks.includes(r.id)
        const dot = (ROLE_COLORS[r.color] ?? ROLE_COLORS.gray).dot
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={on}
            className={on ? 'cx-welcome-chip on' : 'cx-welcome-chip'}
            style={on ? { borderColor: dot } : undefined}
            onClick={() => onPicks(on ? picks.filter((x) => x !== r.id) : [...picks, r.id])}
          >
            <span style={{ background: dot }} />
            {r.name}
          </button>
        )
      })}
    </div>
  )
}

/** "Your roles": change the roles you picked yourself, any time (the menu by its name). */
export function YourRolesDialog({
  detail: c,
  me,
  onClose,
  onChanged,
  onProblem
}: {
  detail: ConstellationDetail
  me: SignedInUser
  onClose: () => void
  onChanged: (next: ConstellationDetail) => void
  onProblem: (message: string) => void
}): React.JSX.Element {
  const pickable = c.roles.filter((r) => r.selfAssign)
  const mine = c.members.find((m) => m.user.id === me.id)
  const [picks, setPicks] = useState<string[]>(() =>
    (mine?.roleIds ?? []).filter((id) => pickable.some((r) => r.id === id))
  )
  const [busy, setBusy] = useState(false)
  const a = accentOf(c)
  async function save(): Promise<void> {
    setBusy(true)
    const r = await api.myRoles(c.id, picks)
    setBusy(false)
    if (!r.ok) {
      onProblem(r.message)
      return
    }
    onChanged(r.data.constellation)
    onClose()
  }
  return (
    <div
      className="cx-welcome-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your roles"
        className="cx-welcome cx-welcome--small"
        style={{
          ['--cxa' as string]: a.color,
          ['--cxa-rgb' as string]: a.rgb,
          ['--cxa-on' as string]: a.on
        }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="cx-welcome-body">
          <div className="cx-welcome-step">
            <div>
              <h2>Your roles</h2>
              <div className="cx-welcome-line">
                Pick any. Everyone in {c.name} sees them on your card.
              </div>
            </div>
            <RoleChips c={c} picks={picks} onPicks={setPicks} />
            {hasUnlocks(c) && (
              <div className="cx-welcome-unlock" aria-live="polite">
                <YoullSee c={c} picks={picks} />
              </div>
            )}
          </div>
          <div className="cx-welcome-nav">
            <button type="button" className="cx-welcome-back" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="cx-welcome-next"
              aria-disabled={busy}
              onClick={() => void save()}
              autoFocus
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
