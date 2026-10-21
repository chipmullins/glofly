import type { Page } from '../components/Sidebar'

// Control's pages, by name (the command bar, shortcuts, alerts).

export const PAGE_LABELS: Record<Page, string> = {
  dashboard: 'Dashboard',
  accounts: 'Accounts',
  signups: 'Sign-ups',
  reports: 'Reports',
  inbox: 'Inbox',
  errors: 'Errors',
  constellations: 'Constellations',
  announcements: 'Announcements',
  server: 'Server',
  audit: 'Audit log'
}

export const isPage = (value: string): value is Page => value in PAGE_LABELS
