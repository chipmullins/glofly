import { useEffect, useState, type JSX } from 'react'
import { Icon, ICONS, Logo } from './icons'
import { initials } from '../lib/format'
import type { AdminUser } from '../../../preload/types'

export type Page = 'dashboard' | 'accounts' | 'signups' | 'audit'

const ITEMS: {
  id: Page | 'reports' | 'announcements'
  label: string
  icon: string
  later?: boolean
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard },
  { id: 'accounts', label: 'Accounts', icon: ICONS.accounts },
  { id: 'signups', label: 'Sign-ups', icon: ICONS.signups },
  { id: 'reports', label: 'Reports', icon: ICONS.reports, later: true },
  { id: 'announcements', label: 'Announcements', icon: ICONS.announcements, later: true },
  { id: 'audit', label: 'Audit log', icon: ICONS.audit }
]

/** "signs out in 54 min", counting down. */
function useMinutesLeft(expiresAt: string): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60_000))
}

export function Sidebar({
  page,
  onPage,
  admin,
  expiresAt,
  onSignOut
}: {
  page: Page
  onPage: (page: Page) => void
  admin: AdminUser
  expiresAt: string
  onSignOut: () => void
}): JSX.Element {
  const minutes = useMinutesLeft(expiresAt)
  const host = window.control.serverUrl.replace(/^https?:\/\//, '')
  return (
    <nav className="sidebar" aria-label="Glofly Control">
      <div className="sidebar-brand">
        <Logo />
        <div className="words">
          <span className="glofly">Glofly</span>
          <span className="control">Control</span>
        </div>
      </div>
      <div className="nav">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            disabled={item.later}
            aria-current={item.id === page ? 'page' : undefined}
            title={item.later ? 'Coming in Control v2' : undefined}
            onClick={() => !item.later && onPage(item.id as Page)}
          >
            <Icon d={item.icon} />
            <span className="label">{item.label}</span>
            {item.later && <span className="later">v2</span>}
          </button>
        ))}
      </div>
      <div className="sidebar-foot">
        <div className="server-line">
          <span className="dot" aria-hidden="true" />
          {host.startsWith('localhost') || host.startsWith('127.')
            ? `Your PC · ${host}`
            : `Live server · ${host}`}
        </div>
        <div className="me">
          <span className="avatar" aria-hidden="true">
            {initials(admin.displayName)}
          </span>
          <div className="who">
            <span className="name">{admin.displayName}</span>
            <span className="session">Two-step on · signs out in {minutes} min</span>
          </div>
        </div>
        <button type="button" className="signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </nav>
  )
}
