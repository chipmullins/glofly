import { useEffect, useRef, useState, type JSX } from 'react'
import { api, type AuditEntry } from '../lib/api'
import { Chip, type Tone } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { when } from '../lib/format'

function tone(action: string): Tone {
  if (/^(Suspended|Deleted|Sign-in refused|Turned off|Cancelled an invite)/.test(action))
    return 'bad'
  if (/^(Signed in|Signed out|Unsuspended|Finished setting up|Cancelled a deletion)/.test(action))
    return 'good'
  if (/^(Created|Made|Changed sign-ups|Admin)/.test(action)) return 'purple'
  return 'plain'
}

export function AuditLog({
  toast,
  onOpenAccount
}: {
  toast: (message: string, bad?: boolean) => void
  onOpenAccount: (id: string) => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const latest = useRef(0)

  useEffect(() => {
    const timer = setTimeout(
      () => {
        const ticket = ++latest.current
        void api.audit(query).then((result) => {
          if (ticket !== latest.current) return
          if (result.ok) {
            setEntries(result.data.entries)
            setHasMore(result.data.hasMore)
            setError(null)
          } else setError(result.message)
        })
      },
      query ? 250 : 0
    )
    return () => clearTimeout(timer)
  }, [query])

  const loadMore = async (): Promise<void> => {
    if (!entries?.length) return
    const result = await api.audit(query, entries[entries.length - 1].createdAt)
    if (result.ok) {
      setEntries([...entries, ...result.data.entries])
      setHasMore(result.data.hasMore)
    } else toast(result.message, true)
  }

  return (
    <>
      <header className="page-head" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1>Audit log</h1>
          <p className="sub">
            Everything done in Control, kept for good. Entries can’t be edited or deleted.
          </p>
        </div>
        <div className="tools">
          <label className="search">
            <Icon d={ICONS.search} size={16} strokeWidth={2} />
            <input
              type="search"
              placeholder="Account or action"
              aria-label="Search the audit log"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: 170 }}
            />
          </label>
          <button
            type="button"
            className="btn"
            disabled={exporting}
            onClick={async () => {
              setExporting(true)
              const result = await window.control.exportAudit()
              setExporting(false)
              if (!result.ok) toast(result.message, true)
              else if (result.saved) toast('Audit log saved.')
            }}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </header>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <section className="card" style={{ overflow: 'hidden' }} aria-label="Audit log entries">
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col">About</th>
                <th scope="col">Your note</th>
              </tr>
            </thead>
            <tbody>
              {entries === null && !error && (
                <tr>
                  <td colSpan={4} className="muted">
                    Loading…
                  </td>
                </tr>
              )}
              {entries?.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    {query ? `Nothing matches “${query}”.` : 'Nothing yet.'}
                  </td>
                </tr>
              )}
              {entries?.map((e) => (
                <tr key={e.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {when(e.createdAt)}
                  </td>
                  <td>
                    <Chip tone={tone(e.action)}>{e.action}</Chip>
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {e.targetUserId && e.action !== 'Deleted an account' ? (
                      <button
                        type="button"
                        className="link-btn"
                        style={{ color: 'var(--c-ink)', textDecoration: 'none', textAlign: 'left' }}
                        onClick={() => onOpenAccount(e.targetUserId!)}
                      >
                        {e.targetLabel ?? 'Open account'}
                      </button>
                    ) : (
                      (e.targetLabel ?? (e.adminUsername ? `@${e.adminUsername} (you)` : '—'))
                    )}
                  </td>
                  <td style={{ color: 'var(--c-quiet)' }}>
                    {e.note}
                    {e.ip && /^Sign/.test(e.action) && (
                      <span className="muted"> · from {e.ip}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hasMore && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--c-row-line)' }}>
            <button type="button" className="btn btn--small" onClick={() => void loadMore()}>
              Show older entries
            </button>
          </div>
        )}
      </section>
    </>
  )
}
