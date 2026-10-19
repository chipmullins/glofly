import { useCallback, useEffect, useState, type JSX } from 'react'
import { api, openLastDay, type ErrorApp, type ErrorRow } from '../lib/api'
import { Chip, Dialog, type Tone } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { ago, longDate, plural } from '../lib/format'

// Errors (0.7.3): what went wrong in the apps, as they reported it (never message text or
// passwords: the apps and the server both take personal details out). One row per problem and
// app version; the same error again only adds to its count. Mark one fixed once a release has
// the fix; if it happens again it opens again by itself.

const APPS: { id: ErrorApp | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'desktop', label: 'Desktop' },
  { id: 'web', label: 'Browser' },
  { id: 'android', label: 'Android' },
  { id: 'ios', label: 'iPhone' },
  { id: 'server', label: 'Server' },
  { id: 'control', label: 'Control' }
]

const APP_LABEL: Record<ErrorApp, [string, Tone]> = {
  desktop: ['Desktop', 'purple'],
  web: ['Browser', 'purple'],
  android: ['Android', 'good'],
  ios: ['iPhone', 'good'],
  server: ['Server', 'bad'],
  control: ['Control', 'warn']
}

type Show = 'open' | 'fixed'

export function Errors({
  toast,
  onCountChange
}: {
  toast: (message: string, bad?: boolean) => void
  /** Keeps the sidebar's badge in step (open errors seen in the last 24 h) */
  onCountChange: (n: number) => void
}): JSX.Element {
  const [show, setShow] = useState<Show>('open')
  const [app, setApp] = useState<ErrorApp | 'all'>('all')
  const [rows, setRows] = useState<ErrorRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [loadedAt, setLoadedAt] = useState<number | null>(null)

  const load = useCallback(() => {
    void api.errors(show, app === 'all' ? undefined : app).then((result) => {
      if (!result.ok) {
        setError(result.message)
        return
      }
      setError(null)
      setRows(result.data.errors)
      setLoadedAt(Date.now())
      if (show === 'open' && app === 'all') onCountChange(openLastDay(result.data.errors))
    })
  }, [show, app, onCountChange])

  // On open, on every change of tab or filter, and every minute while this page is open.
  useEffect(() => {
    load()
    const timer = setInterval(load, 60_000)
    return () => clearInterval(timer)
  }, [load])

  const act = async (row: ErrorRow, action: 'resolve' | 'reopen'): Promise<void> => {
    setBusy(row.id)
    const result = await api.errorAction(row.id, action)
    setBusy(null)
    if (!result.ok) {
      toast(result.message, true)
      return
    }
    toast(
      action === 'resolve' ? 'Marked fixed. It opens again if it happens again.' : 'Opened again.'
    )
    setRows((old) => old?.filter((r) => r.id !== row.id) ?? null)
    load()
  }

  const toggle = (id: string): void =>
    setOpen((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Errors</h1>
          <p className="sub">
            Glofly apps send what went wrong (never message text or passwords). The same problem in
            the same version is one row.
          </p>
        </div>
        <div className="tools">
          {loadedAt && (
            <span className="muted errors-updated">
              Updated {ago(new Date(loadedAt).toISOString())}
            </span>
          )}
          <button type="button" className="btn" onClick={load}>
            <Icon d={ICONS.refresh} size={16} strokeWidth={2} />
            Refresh
          </button>
          {show === 'fixed' && (rows?.length ?? 0) > 0 && (
            <button
              type="button"
              className="btn btn--danger-soft"
              onClick={() => setClearing(true)}
            >
              Clear fixed
            </button>
          )}
        </div>
      </header>

      <div className="filters-bar">
        <div className="filters" role="group" aria-label="Open or fixed">
          {(['open', 'fixed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="filter"
              aria-pressed={show === s}
              onClick={() => {
                setRows(null)
                setShow(s)
              }}
            >
              {s === 'open' ? 'Open' : 'Fixed'}
            </button>
          ))}
        </div>
        <span className="errors-divider" aria-hidden="true" />
        <div className="filters" role="group" aria-label="Which app">
          {APPS.map((a) => (
            <button
              key={a.id}
              type="button"
              className="filter"
              aria-pressed={app === a.id}
              onClick={() => {
                setRows(null)
                setApp(a.id)
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <section className="card" aria-label={show === 'open' ? 'Open errors' : 'Fixed errors'}>
        {rows === null && !error && <p className="loading card-pad">Loading…</p>}
        {rows?.length === 0 && (
          <p className="empty card-pad errors-empty">
            {show === 'open' ? 'No errors. Nice.' : 'Nothing marked fixed.'}
          </p>
        )}
        {rows && rows.length > 0 && (
          <ul className="errors-list">
            {rows.map((row) => {
              const [label, tone] = APP_LABEL[row.app] ?? [row.app, 'plain']
              const expanded = open.has(row.id)
              return (
                <li key={row.id} className="errors-row">
                  <div className="errors-main">
                    <div className="errors-tags">
                      <Chip tone={tone} small>
                        {label}
                        {row.appVersion ? ` ${row.appVersion}` : ''}
                      </Chip>
                      {row.where && <span className="errors-where">{row.where}</span>}
                      {row.os && <span className="muted">{row.os}</span>}
                    </div>
                    <p className="errors-message">{row.message}</p>
                    <p className="errors-meta">
                      <strong>{plural(row.count, 'time')}</strong>
                      {row.people > 0 && <> · {plural(row.people, 'person', 'people')}</>}
                      {' · '}last {ago(row.lastAt)}
                      <span className="muted" title={longDate(row.firstAt)}>
                        {' · '}first {ago(row.firstAt)}
                      </span>
                      {row.resolvedAt && (
                        <span className="muted"> · fixed {ago(row.resolvedAt)}</span>
                      )}
                    </p>
                    {row.stack && (
                      <button
                        type="button"
                        className="link-btn errors-toggle"
                        aria-expanded={expanded}
                        onClick={() => toggle(row.id)}
                      >
                        {expanded ? 'Hide where it happened' : 'Show where it happened'}
                      </button>
                    )}
                    {expanded && row.stack && (
                      <div className="errors-stack-wrap">
                        <pre className="errors-stack">{row.stack}</pre>
                        <button
                          type="button"
                          className="btn btn--small"
                          onClick={() => {
                            void window.control
                              .copy(
                                [
                                  `${label} ${row.appVersion ?? ''} · ${row.where ?? ''} · ${row.os ?? ''}`,
                                  row.message,
                                  row.stack ?? ''
                                ]
                                  .join('\n')
                                  .slice(0, 5000)
                              )
                              .then(() => toast('Copied.'))
                          }}
                        >
                          Copy
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="errors-actions">
                    {show === 'open' ? (
                      <button
                        type="button"
                        className="btn btn--small"
                        disabled={busy === row.id}
                        onClick={() => void act(row, 'resolve')}
                      >
                        <Icon d={ICONS.check} size={15} strokeWidth={2.2} />
                        Mark fixed
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn--small"
                        disabled={busy === row.id}
                        onClick={() => void act(row, 'reopen')}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {clearing && (
        <ClearFixed
          onClose={() => setClearing(false)}
          onDone={(removed) => {
            setClearing(false)
            toast(`Cleared ${plural(removed, 'fixed error')}.`)
            load()
          }}
          onFail={(message) => toast(message, true)}
        />
      )}
    </>
  )
}

function ClearFixed({
  onClose,
  onDone,
  onFail
}: {
  onClose: () => void
  onDone: (removed: number) => void
  onFail: (message: string) => void
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      title="Clear fixed errors"
      intro="Removes every error marked fixed, for good. Open ones stay."
      onClose={onClose}
      narrow
      busy={busy}
    >
      <div className="dialog-buttons">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            const result = await api.clearFixedErrors()
            setBusy(false)
            if (result.ok) onDone(result.data.removed)
            else onFail(result.message)
          }}
        >
          {busy ? 'Clearing…' : 'Clear fixed'}
        </button>
      </div>
    </Dialog>
  )
}
