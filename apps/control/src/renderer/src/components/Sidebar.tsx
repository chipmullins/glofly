import { useEffect, useState, type JSX } from 'react'
import { Icon, ICONS, Logo } from './icons'
import { initials } from '../lib/format'
import type { AdminUser } from '../../../preload/types'

export type Page =
  | 'dashboard'
  | 'insights'
  | 'accounts'
  | 'signups'
  | 'reports'
  | 'inbox'
  | 'errors'
  | 'constellations'
  | 'signinApps'
  | 'announcements'
  | 'server'
  | 'audit'

const ITEMS: {
  id: Page
  label: string
  icon: string
}[] = [
  { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard },
  { id: 'insights', label: 'Insights', icon: ICONS.insights },
  { id: 'accounts', label: 'Accounts', icon: ICONS.accounts },
  { id: 'signups', label: 'Sign-ups', icon: ICONS.signups },
  { id: 'reports', label: 'Reports', icon: ICONS.reports },
  { id: 'inbox', label: 'Inbox', icon: ICONS.inbox },
  { id: 'errors', label: 'Errors', icon: ICONS.errors },
  { id: 'constellations', label: 'Constellations', icon: ICONS.constellations },
  { id: 'signinApps', label: 'Sign-in apps', icon: ICONS.lock },
  { id: 'announcements', label: 'Announcements', icon: ICONS.announcements },
  { id: 'server', label: 'Server', icon: ICONS.server },
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
  openReports,
  newErrors = 0,
  paused,
  lockdown = false,
  inboxUnread = 0,
  onSearch,
  onSignOut
}: {
  page: Page
  onPage: (page: Page) => void
  admin: AdminUser
  expiresAt: string
  /** Reports waiting for review (a count next to Reports) */
  openReports: number
  /** 0.7.3: open errors seen in the last 24 hours (a count next to Errors) */
  newErrors?: number
  /** Glofly is paused (Server → Pause Glofly): a red "Paused" next to Server */
  paused: boolean
  /** 0.8.2: Lockdown is on (a red "Lockdown" next to Server) */
  lockdown?: boolean
  /** 0.8.2: replies waiting in the Inbox */
  inboxUnread?: number
  /** 0.8.2: opens the command bar (Ctrl+K) */
  onSearch: () => void
  onSignOut: () => void
}): JSX.Element {
  const mac = window.control.platform === 'darwin'
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
      <button
        type="button"
        className="sidebar-search"
        onClick={onSearch}
        aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
      >
        <Icon d={ICONS.search} size={16} strokeWidth={2} />
        <span className="label">Search</span>
        <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      <div className="nav">
        {ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            aria-current={item.id === page ? 'page' : undefined}
            onClick={() => onPage(item.id)}
          >
            <Icon d={item.icon} />
            <span className="label">{item.label}</span>
            {item.id === 'server' && paused && (
              <span className="nav-count nav-count--paused">Paused</span>
            )}
            {item.id === 'server' && lockdown && (
              <span className="nav-count nav-count--paused">Lockdown</span>
            )}
            {item.id === 'inbox' && inboxUnread > 0 && (
              <span className="nav-count" aria-label={`${inboxUnread} unread`}>
                {inboxUnread > 99 ? '99+' : inboxUnread}
              </span>
            )}
            {item.id === 'errors' && newErrors > 0 && (
              <span className="nav-count" aria-label={`${newErrors} in the last day`}>
                {newErrors > 99 ? '99+' : newErrors}
              </span>
            )}
            {item.id === 'reports' && openReports > 0 && (
              <span className="nav-count" aria-label={`${openReports} open`}>
                {openReports > 99 ? '99+' : openReports}
              </span>
            )}
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
