import { useEffect, useRef, useState } from 'react'
import { ROLE_COLORS, type NebulaVisibility } from '@glofly/shared/constellations'
import type { ConstellationDetail, ConstellationRole } from '../../../preload/api-types'
import './RoleVisibility.css'

// 0.8.0 role-only nebulas (approved RoleNebulas board): "Who can see this nebula" in the edit
// nebula form and on a category. Everyone, or only these roles (chips + "+ Add role"). The Owner
// and anyone who can manage nebulas always see it; the server enforces all of it.

/** The roles a nebula or category can be limited to (not the Owner, not Member). */
export const gateRoles = (c: ConstellationDetail): ConstellationRole[] =>
  c.roles.filter((r) => r.kind !== 'owner' && r.kind !== 'member')

export function LockIcon({ size = 10 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

/** "Valorant", "Valorant +1", or "No roles yet" for the sidebar's lock badge. */
export function gateLabel(c: ConstellationDetail, roleIds: string[] | undefined): string {
  const names = (roleIds ?? [])
    .map((id) => c.roles.find((r) => r.id === id)?.name)
    .filter((n): n is string => !!n)
  if (!names.length) return 'Owner and admins'
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
}

export default function WhoCanSee({
  c,
  what,
  visibility,
  roleIds,
  onChange
}: {
  c: ConstellationDetail
  /** "nebula" or "category" (the wording) */
  what: 'nebula' | 'category'
  visibility: NebulaVisibility
  roleIds: string[]
  onChange: (visibility: NebulaVisibility, roleIds: string[]) => void
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const roles = gateRoles(c)
  const chosen = roleIds
    .map((id) => roles.find((r) => r.id === id))
    .filter((r): r is ConstellationRole => !!r)
  const left = roles.filter((r) => !roleIds.includes(r.id))

  useEffect(() => {
    if (!adding) return
    const close = (e: MouseEvent): void => {
      if (!menuRef.current?.contains(e.target as Node)) setAdding(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [adding])

  return (
    <div className="cx-who" role="group" aria-label={`Who can see this ${what}`}>
      <div className="cx-who-title">Who can see this {what}</div>
      <div className="cx-who-options">
        <button
          type="button"
          aria-pressed={visibility === 'everyone'}
          className="cx-who-option"
          onClick={() => onChange('everyone', roleIds)}
        >
          <b>Everyone</b>
          <span>All members of {c.name}</span>
        </button>
        <button
          type="button"
          aria-pressed={visibility === 'roles'}
          className="cx-who-option"
          onClick={() => onChange('roles', roleIds)}
        >
          <b>Only these roles</b>
          <span>
            {what === 'category'
              ? 'Hides every nebula inside from everyone else'
              : "Everyone else won't know it's here"}
          </span>
        </button>
      </div>
      {visibility === 'roles' && (
        <div className="cx-who-roles">
          <div className="cx-who-chips">
            {chosen.map((r) => (
              <span key={r.id} className="cx-who-chip">
                <span
                  className="cx-who-dot"
                  style={{ background: (ROLE_COLORS[r.color] ?? ROLE_COLORS.gray).dot }}
                />
                {r.name}
                {r.selfAssign && <span className="cx-who-note">(members pick it)</span>}
                <button
                  type="button"
                  className="cx-who-remove"
                  aria-label={`Remove ${r.name}`}
                  onClick={() =>
                    onChange(
                      visibility,
                      roleIds.filter((id) => id !== r.id)
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
            {left.length > 0 && (
              <div className="cx-who-add-wrap" ref={menuRef}>
                <button
                  type="button"
                  className="cx-who-add"
                  aria-expanded={adding}
                  onClick={() => setAdding((v) => !v)}
                >
                  + Add role
                </button>
                {adding && (
                  <div className="cx-who-menu" role="menu">
                    {left.map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          onChange(visibility, [...roleIds, r.id])
                          setAdding(false)
                        }}
                      >
                        <span
                          className="cx-who-dot"
                          style={{ background: (ROLE_COLORS[r.color] ?? ROLE_COLORS.gray).dot }}
                        />
                        {r.name}
                        {r.selfAssign && <span className="cx-who-note">members pick it</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {chosen.length === 0 && (
            <div className="cx-who-hint cx-who-hint--warn">
              Add a role, or only the Owner and admins will see it.
            </div>
          )}
          <div className="cx-who-hint">Owner and admins can always see it.</div>
        </div>
      )}
    </div>
  )
}
