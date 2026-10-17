import { useCallback, useEffect, useState, type JSX } from 'react'
import { SignIn } from './screens/SignIn'
import { Dashboard } from './screens/Dashboard'
import { Accounts } from './screens/Accounts'
import { Signups } from './screens/Signups'
import { AuditLog } from './screens/AuditLog'
import { CreateAccount } from './screens/CreateAccount'
import { Reports } from './screens/Reports'
import { Announcements } from './screens/Announcements'
import { Server } from './screens/Server'
import { Constellations } from './screens/Constellations'
import { api } from './lib/api'
import { Sidebar, type Page } from './components/Sidebar'
import { Toast } from './components/common'
import type { AdminUser } from '../../preload/types'

type Session = { admin: AdminUser; expiresAt: string; backupCodesLeft: number }

export default function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  // Accounts can be opened on a search (from the dashboard) or a specific account.
  const [accountsQuery, setAccountsQuery] = useState({ q: '', select: null as string | null, n: 0 })
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<{ message: string; bad?: boolean } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [openReports, setOpenReports] = useState(0)
  // Glofly is paused (Server → Pause Glofly): a banner on every page and "Paused" in the sidebar.
  const [paused, setPaused] = useState(false)

  // The sidebar's open-reports count: on sign-in, then every minute.
  useEffect(() => {
    if (!session) return
    const check = (): void => {
      void api.reports('open').then((r) => r.ok && setOpenReports(r.data.counts.open))
      // Older servers don't have this (404): just never paused.
      void api.server().then((r) => r.ok && setPaused(r.data.pause.paused))
    }
    check()
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, [session])

  useEffect(
    () =>
      window.control.onSignedOut((reason) => {
        setSession(null)
        setCreating(false)
        setNotice(
          reason === 'expired'
            ? 'Your hour is up, so Control signed you out. Sign in again to carry on.'
            : 'Your Control session ended. Sign in again.'
        )
      }),
    []
  )

  useEffect(() => {
    if (session) window.control.setScreen('app')
  }, [session])

  const showToast = useCallback((message: string, bad?: boolean) => setToast({ message, bad }), [])
  const clearToast = useCallback(() => setToast(null), [])

  const openAccounts = (q: string, select: string | null = null): void => {
    setAccountsQuery((old) => ({ q, select, n: old.n + 1 }))
    setPage('accounts')
  }

  if (!session) {
    return (
      <SignIn
        notice={notice}
        onSignedIn={(result) => {
          setNotice(null)
          setPage('dashboard')
          setSession({
            admin: result.admin,
            expiresAt: result.expiresAt,
            backupCodesLeft: result.backupCodesLeft
          })
          if (result.backupCodesLeft <= 2) {
            showToast(
              `Only ${result.backupCodesLeft} backup code${result.backupCodesLeft === 1 ? '' : 's'} left. Run admin:setup on the server for new ones.`,
              true
            )
          }
        }}
      />
    )
  }

  return (
    <div className="shell">
      <div className="titlebar" aria-hidden="true" />
      <Sidebar
        page={page}
        onPage={setPage}
        admin={session.admin}
        expiresAt={session.expiresAt}
        openReports={openReports}
        paused={paused}
        onSignOut={() => {
          void window.control.signIn.signOut().then(() => {
            setSession(null)
            setNotice('Signed out.')
          })
        }}
      />
      <main className="page" key={page}>
        {paused && page !== 'server' && (
          <div className="paused-banner" role="status">
            <strong>Glofly is paused.</strong> Nobody can use it until you unpause it.
            <button type="button" className="link-btn" onClick={() => setPage('server')}>
              Go to Server
            </button>
          </div>
        )}
        {page === 'dashboard' && (
          <Dashboard
            onCreate={() => setCreating(true)}
            onFind={(q) => openAccounts(q)}
            onOpenAccount={(id) => openAccounts('', id)}
            onPage={setPage}
            dataVersion={refresh}
          />
        )}
        {page === 'accounts' && (
          <Accounts
            key={accountsQuery.n}
            initialQuery={accountsQuery.q}
            initialSelect={accountsQuery.select}
            adminUserId={session.admin.userId}
            onCreate={() => setCreating(true)}
            toast={showToast}
            dataVersion={refresh}
          />
        )}
        {page === 'signups' && <Signups toast={showToast} />}
        {page === 'reports' && (
          <Reports
            toast={showToast}
            onOpenAccount={(id) => openAccounts('', id)}
            onCountChange={setOpenReports}
          />
        )}
        {page === 'constellations' && (
          <Constellations toast={showToast} onOpenAccount={(id) => openAccounts('', id)} />
        )}
        {page === 'announcements' && <Announcements toast={showToast} />}
        {page === 'server' && <Server toast={showToast} onPauseChange={setPaused} />}
        {page === 'audit' && (
          <AuditLog toast={showToast} onOpenAccount={(id) => openAccounts('', id)} />
        )}
      </main>
      {creating && (
        <CreateAccount
          admin={session.admin}
          onClose={() => setCreating(false)}
          onDone={(message) => {
            setCreating(false)
            showToast(message)
            setRefresh((n) => n + 1)
          }}
        />
      )}
      {toast && <Toast message={toast.message} bad={toast.bad} onDone={clearToast} />}
    </div>
  )
}
