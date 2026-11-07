import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { SignIn } from './screens/SignIn'
import { Dashboard } from './screens/Dashboard'
import { Insights } from './screens/Insights'
import { Accounts } from './screens/Accounts'
import { Signups } from './screens/Signups'
import { AuditLog } from './screens/AuditLog'
import { CreateAccount } from './screens/CreateAccount'
import { Reports } from './screens/Reports'
import { Announcements } from './screens/Announcements'
import { Server } from './screens/Server'
import { Constellations } from './screens/Constellations'
import { Errors } from './screens/Errors'
import { Inbox } from './screens/Inbox'
import { api, openLastDay, type ControlAlert } from './lib/api'
import { Sidebar, type Page } from './components/Sidebar'
import { isPage } from './lib/pages'
import { Dialog, Toast } from './components/common'
import { CommandBar, type CommandAction } from './components/CommandBar'
import { forgetQuickNotes, loadQuickNotes } from './lib/quickNotes'
import { GO_KEYS, isMac, modalOpen, plainShortcut, SHORTCUTS } from './lib/shortcuts'
import { SignInApps } from './screens/SignInApps'
import type { AdminUser } from '../../preload/types'

type Session = { admin: AdminUser; expiresAt: string; backupCodesLeft: number }

/** The page an alert is about (its data.open). */
const alertPage = (alert: ControlAlert): Page => {
  const open = alert.data.open ?? 'dashboard'
  return isPage(open) ? open : 'dashboard'
}

export default function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [page, setPage] = useState<Page>('dashboard')
  // Accounts can be opened on a search (from the dashboard) or a specific account.
  const [accountsQuery, setAccountsQuery] = useState({
    q: '',
    select: null as string | null,
    then: null as 'message' | 'friend' | null,
    n: 0
  })
  // 0.8.2: Constellations / Inbox opened on one (the command bar, an alert).
  const [constellationOpen, setConstellationOpen] = useState({ id: null as string | null, n: 0 })
  const [inboxOpen, setInboxOpen] = useState({ id: null as string | null, n: 0 })
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<{ message: string; bad?: boolean } | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [openReports, setOpenReports] = useState(0)
  const [newErrors, setNewErrors] = useState(0)
  // Glofly is paused (Server → Pause Glofly): a banner on every page and "Paused" in the sidebar.
  const [paused, setPaused] = useState(false)
  // 0.8.2: Lockdown ("Lockdown" in the sidebar), Inbox replies to read, the command bar.
  const [lockdown, setLockdown] = useState(false)
  const [inboxUnread, setInboxUnread] = useState(0)
  const [commandOpen, setCommandOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [serverRequest, setServerRequest] = useState<{ action: CommandAction; n: number } | null>(
    null
  )
  const desktopAlerts = useRef(false)

  // The sidebar's open-reports count: on sign-in, then every minute.
  useEffect(() => {
    if (!session) return
    const check = (): void => {
      void api.reports('open').then((r) => r.ok && setOpenReports(r.data.counts.open))
      // 0.7.3 (older servers answer 404: no badge)
      void api.errors('open').then((r) => r.ok && setNewErrors(openLastDay(r.data.errors)))
      // Older servers don't have this (404): just never paused.
      void api.server().then((r) => {
        if (!r.ok) return
        setPaused(r.data.pause.paused)
        if (r.data.lockdown) setLockdown(r.data.lockdown.on)
      })
      // 0.8.2 (older servers answer 404: no badge)
      void api.inbox().then((r) => r.ok && setInboxUnread(r.data.unreadTotal))
    }
    check()
    const timer = setInterval(check, 60_000)
    return () => clearInterval(timer)
  }, [session])

  // 0.8.2: the quick notes, once per session.
  useEffect(() => {
    if (session) void loadQuickNotes(true)
    else forgetQuickNotes()
  }, [session])

  // 0.8.2: new alerts become desktop notifications (when that's on in Server → Alerts). The first
  // check only notes the newest alert, so old ones don't pop up.
  useEffect(() => {
    if (!session) return
    let newest: string | null = null
    let first = true
    let stopped = false
    // Each alert pops up once, whatever the server sends back.
    const shown = new Set<string>()
    const check = async (): Promise<void> => {
      const r = await api.alerts(newest ?? undefined)
      if (stopped || !r.ok) return
      desktopAlerts.current = r.data.prefs.desktop
      const fresh = r.data.alerts.filter((a) => !shown.has(a.id))
      for (const a of fresh) shown.add(a.id)
      if (fresh.length && (!newest || fresh[0].createdAt > newest)) newest = fresh[0].createdAt
      else if (!newest) newest = r.data.now
      if (first) {
        first = false
        return
      }
      if (!desktopAlerts.current) return
      for (const a of [...fresh].reverse().slice(-5)) {
        window.control.notify({
          title: a.title.slice(0, 120),
          body: a.body.slice(0, 300),
          page: alertPage(a)
        })
      }
    }
    void check()
    const timer = setInterval(() => void check(), 30_000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [session])

  // Clicking a desktop notification opens its page.
  useEffect(
    () =>
      window.control.onOpenPage((p) => {
        if (isPage(p)) setPage(p)
      }),
    []
  )

  // 0.8.2: Ctrl+K / ⌘K (command bar), G then a letter (pages), ? (shortcuts).
  useEffect(() => {
    if (!session) return
    let goAt = 0
    const onKey = (e: KeyboardEvent): void => {
      const mod = isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (commandOpen) setCommandOpen(false)
        else if (!modalOpen()) setCommandOpen(true)
        return
      }
      if (!plainShortcut(e)) return
      if (e.key === '?') {
        e.preventDefault()
        setShortcutsOpen(true)
        return
      }
      const key = e.key.toLowerCase()
      if (goAt && Date.now() - goAt < 1500 && key in GO_KEYS) {
        e.preventDefault()
        goAt = 0
        setPage(GO_KEYS[key as keyof typeof GO_KEYS])
        return
      }
      goAt = key === 'g' && !e.shiftKey ? Date.now() : 0
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [session, commandOpen])

  useEffect(
    () =>
      window.control.onSignedOut((reason) => {
        setSession(null)
        setCreating(false)
        setCommandOpen(false)
        setShortcutsOpen(false)
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

  const openAccounts = useCallback(
    (q: string, select: string | null = null, then: 'message' | 'friend' | null = null): void => {
      setAccountsQuery((old) => ({ q, select, then, n: old.n + 1 }))
      setPage('accounts')
    },
    []
  )
  const openConstellation = useCallback((id: string | null): void => {
    setConstellationOpen((old) => ({ id, n: old.n + 1 }))
    setPage('constellations')
  }, [])

  const openAlert = useCallback(
    (alert: ControlAlert): void => {
      const target = alertPage(alert)
      if (target === 'accounts' && alert.data.userId) openAccounts('', alert.data.userId)
      else if (target === 'constellations' && alert.data.constellationId)
        openConstellation(alert.data.constellationId)
      else if (target === 'inbox') {
        setInboxOpen((old) => ({ id: alert.data.userId ?? null, n: old.n + 1 }))
        setPage('inbox')
      } else setPage(target)
    },
    [openAccounts, openConstellation]
  )

  const clearServerRequest = useCallback(() => setServerRequest(null), [])

  const runCommand = useCallback((action: CommandAction): void => {
    if (action === 'create-account') setCreating(true)
    else if (action === 'shortcuts') setShortcutsOpen(true)
    else {
      setServerRequest({ action, n: Date.now() })
      setPage('server')
    }
  }, [])

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
        newErrors={newErrors}
        paused={paused}
        lockdown={lockdown}
        inboxUnread={inboxUnread}
        onSearch={() => setCommandOpen(true)}
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
            onOpenAlert={openAlert}
            dataVersion={refresh}
          />
        )}
        {page === 'insights' && <Insights />}
        {page === 'accounts' && (
          <Accounts
            key={accountsQuery.n}
            initialQuery={accountsQuery.q}
            initialSelect={accountsQuery.select}
            initialThen={accountsQuery.then}
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
        {page === 'inbox' && (
          <Inbox
            key={inboxOpen.n}
            initialUser={inboxOpen.id}
            toast={showToast}
            onOpenAccount={(id) => openAccounts('', id)}
            onUnreadChange={setInboxUnread}
          />
        )}
        {page === 'errors' && <Errors toast={showToast} onCountChange={setNewErrors} />}
        {page === 'constellations' && (
          <Constellations
            key={constellationOpen.n}
            initialSelect={constellationOpen.id}
            toast={showToast}
            onOpenAccount={(id) => openAccounts('', id)}
          />
        )}
        {page === 'signinApps' && <SignInApps toast={showToast} />}
        {page === 'announcements' && <Announcements toast={showToast} />}
        {page === 'server' && (
          <Server
            toast={showToast}
            onPauseChange={setPaused}
            onLockdownChange={setLockdown}
            onDesktopAlertsChange={(on) => {
              desktopAlerts.current = on
            }}
            request={serverRequest}
            onRequestDone={clearServerRequest}
          />
        )}
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
      {commandOpen && (
        <CommandBar
          state={{ paused, lockdown }}
          onClose={() => setCommandOpen(false)}
          onPage={setPage}
          onOpenAccount={(id, then) => openAccounts('', id, then ?? null)}
          onOpenConstellation={openConstellation}
          onAction={runCommand}
        />
      )}
      {shortcutsOpen && (
        <Dialog title="Keyboard shortcuts" onClose={() => setShortcutsOpen(false)} narrow>
          <dl className="shortcut-list">
            {SHORTCUTS.map((s) => (
              <div key={s.what} className="shortcut-row">
                <dt>
                  {s.keys.map((k, i) => (
                    <span key={i}>
                      {i > 0 && (
                        <span className="then">
                          {k === 'K' && s.keys[0] === 'Ctrl' ? '+' : 'then'}
                        </span>
                      )}
                      <kbd>{k === 'Ctrl' && isMac() ? '⌘' : k}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{s.what}</dd>
              </div>
            ))}
          </dl>
          <p className="hint" style={{ margin: 0 }}>
            Letter shortcuts don’t work while you’re typing in a box or a dialog is open.
          </p>
          <div className="dialog-buttons">
            <button type="button" className="btn" onClick={() => setShortcutsOpen(false)}>
              Close
            </button>
          </div>
        </Dialog>
      )}
      {toast && <Toast message={toast.message} bad={toast.bad} onDone={clearToast} />}
    </div>
  )
}
