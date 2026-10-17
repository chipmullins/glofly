import { useCallback, useEffect, useId, useState, type JSX } from 'react'
import {
  api,
  type ReportDetail,
  type ReportOutcome,
  type ReportReason,
  type ReportRow,
  type ResolveAction
} from '../lib/api'
import { Avatar, Chip, Dialog, NoteField, type Tone } from '../components/common'
import { ago, longDate, time } from '../lib/format'

// Reports from the Report button in Glofly: a queue of open ones, and the resolved ones.
// Each report shows the reported message and a few around it, as the reporter saw them
// (a copy kept with the report, so edits and deletes don't hide anything). Every outcome
// needs a note and goes in the audit log.

const REASON_TONE: Record<ReportReason, Tone> = {
  spam: 'plain',
  harassment: 'bad',
  hate: 'bad',
  sexual: 'bad',
  violence: 'bad',
  self_harm: 'warn',
  other: 'plain'
}

const OUTCOME: Record<ReportOutcome, [string, Tone]> = {
  dismissed: ['Dismissed', 'plain'],
  removed: ['Message removed', 'warn'],
  warned: ['Warned', 'warn'],
  suspended: ['Suspended', 'bad']
}

type Status = 'open' | 'resolved'

export function Reports({
  toast,
  onOpenAccount,
  onCountChange
}: {
  toast: (message: string, bad?: boolean) => void
  onOpenAccount: (id: string) => void
  /** Keeps the sidebar's open-reports badge in step */
  onCountChange: (open: number) => void
}): JSX.Element {
  const [status, setStatus] = useState<Status>('open')
  const [rows, setRows] = useState<ReportRow[] | null>(null)
  const [counts, setCounts] = useState({ open: 0, resolved: 0 })
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReportDetail | null>(null)
  const [resolving, setResolving] = useState<ResolveAction['action'] | null>(null)

  const load = useCallback(
    (which: Status, keepSelection = false) => {
      void api.reports(which).then((result) => {
        if (!result.ok) {
          setError(result.message)
          return
        }
        setError(null)
        setRows(result.data.reports)
        setCounts(result.data.counts)
        setMore(result.data.more)
        onCountChange(result.data.counts.open)
        if (!keepSelection) setSelected(result.data.reports[0]?.id ?? null)
      })
    },
    [onCountChange]
  )

  useEffect(() => {
    load(status)
  }, [load, status])

  useEffect(() => {
    if (!selected) return
    let alive = true
    void api.report(selected).then((result) => {
      if (!alive) return
      if (result.ok) setDetail(result.data.report)
      else setError(result.message)
    })
    return () => {
      alive = false
    }
  }, [selected])

  const loadMore = (): void => {
    const last = rows?.at(-1)
    if (!last) return
    void api.reports(status, last.id).then((result) => {
      if (!result.ok) return
      setRows((old) => [...(old ?? []), ...result.data.reports])
      setMore(result.data.more)
    })
  }

  const shown = detail && detail.id === selected ? detail : null

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="sub">
            From the Report button in Glofly. You see the reported message and the few around it,
            nothing else.
          </p>
        </div>
      </header>

      <div className="filters-bar">
        <div className="filters" role="group" aria-label="Which reports">
          {(['open', 'resolved'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="filter"
              aria-pressed={status === s}
              onClick={() => {
                setRows(null)
                setDetail(null)
                setStatus(s)
              }}
            >
              {s === 'open' ? 'Open' : 'Resolved'}
              <span className="count">{counts[s]}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <div className="accounts-layout">
        <section aria-label="Reports list" className="card accounts-list">
          {!rows && !error && (
            <p className="loading" style={{ padding: '18px' }}>
              Loading…
            </p>
          )}
          {rows?.length === 0 && (
            <div className="empty" style={{ padding: '28px 18px' }}>
              {status === 'open' ? 'No reports waiting. Nice and quiet.' : 'Nothing resolved yet.'}
            </div>
          )}
          {rows?.map((r) => (
            <button
              key={r.id}
              type="button"
              className="account-row report-row"
              aria-current={selected === r.id ? 'true' : undefined}
              onClick={() => setSelected(r.id)}
            >
              <span className="text">
                <span className="name">
                  {r.reported ? `@${r.reported.username}` : 'Deleted account'}
                  <span className="report-row-by">
                    {' '}
                    · reported by {r.reporter ? `@${r.reporter.username}` : 'a deleted account'}
                  </span>
                </span>
                <span className="handle report-row-preview">
                  {r.kind === 'person'
                    ? 'Reported from their profile'
                    : r.preview
                      ? `“${r.preview}”`
                      : 'A message'}
                </span>
              </span>
              <span className="report-row-side">
                <Chip small tone={REASON_TONE[r.reason]}>
                  {r.reasonLabel}
                </Chip>
                {r.outcome && (
                  <Chip small tone={OUTCOME[r.outcome][1]}>
                    {OUTCOME[r.outcome][0]}
                  </Chip>
                )}
                <span className="seen">
                  {ago(r.status === 'open' ? r.createdAt : r.resolvedAt)}
                </span>
              </span>
            </button>
          ))}
          {more && (
            <div className="list-more">
              <button type="button" className="btn btn--small" onClick={loadMore}>
                Show older reports
              </button>
            </div>
          )}
        </section>

        {shown ? (
          <ReportView
            report={shown}
            onOpenAccount={onOpenAccount}
            onResolve={(action) => setResolving(action)}
          />
        ) : (
          rows &&
          rows.length > 0 && (
            <section className="card detail">
              <p className="loading">Loading…</p>
            </section>
          )
        )}
      </div>

      {resolving && shown && (
        <ResolveDialog
          report={shown}
          action={resolving}
          onClose={() => setResolving(null)}
          onDone={(message) => {
            setResolving(null)
            toast(message)
            setDetail(null)
            load(status)
          }}
        />
      )}
    </>
  )
}

function ReportView({
  report: r,
  onOpenAccount,
  onResolve
}: {
  report: ReportDetail
  onOpenAccount: (id: string) => void
  onResolve: (action: ResolveAction['action']) => void
}): JSX.Element {
  const nameOf = (id: string): string => {
    const p = r.people.find((x) => x.id === id)
    return p ? p.displayName : 'Unknown'
  }
  const reported = r.reported
  return (
    <section className="card detail" aria-label="Report">
      <div className="detail-head">
        {reported && <Avatar id={reported.id} name={reported.displayName} big />}
        <div className="who">
          <span className="name">{reported?.displayName ?? 'Deleted account'}</span>
          <span className="handle">
            {reported ? `@${reported.username}` : ''}
            {r.reportedSuspended && ' · suspended'}
          </span>
        </div>
      </div>

      <dl className="facts">
        <dt>Reason</dt>
        <dd>
          <Chip small tone={REASON_TONE[r.reason]}>
            {r.reasonLabel}
          </Chip>
        </dd>
        <dt>Reported by</dt>
        <dd>
          {r.reporter ? (
            r.reporter.exists ? (
              <button
                type="button"
                className="link-btn"
                onClick={() => onOpenAccount(r.reporter!.id)}
              >
                {r.reporter.displayName} (@{r.reporter.username})
              </button>
            ) : (
              `${r.reporter.displayName} (account deleted)`
            )
          ) : (
            'A deleted account'
          )}
        </dd>
        <dt>When</dt>
        <dd>{longDate(r.createdAt)}</dd>
        <dt>Where</dt>
        <dd>
          {r.kind === 'person'
            ? 'From their profile card'
            : r.chat?.kind === 'nebula'
              ? `#${r.chat.name} in the constellation ${r.chat.constellation.name}`
              : r.chat?.kind === 'group'
                ? `A group${r.chat.name ? ` (${r.chat.name})` : ''}`
                : 'A direct message'}
        </dd>
        <dt>Other reports</dt>
        <dd>
          {r.otherReportsAboutThem === 0
            ? 'None about them'
            : `${r.otherReportsAboutThem} more about them`}
        </dd>
      </dl>

      {r.details && (
        <div>
          <span className="section-label">What they said</span>
          <blockquote className="report-details">{r.details}</blockquote>
        </div>
      )}

      <div>
        <span className="section-label">
          {r.kind === 'message' ? 'The conversation' : 'Recent messages between them'}
        </span>
        {r.context.length === 0 ? (
          <p className="hint" style={{ marginTop: 6 }}>
            {r.kind === 'message' ? 'No messages kept.' : 'They have no direct messages.'}
          </p>
        ) : (
          <ol className="transcript">
            {r.context.map((m) => {
              const isReported = m.id === r.message?.id
              return (
                <li
                  key={m.id}
                  className={
                    isReported ? 'transcript-row transcript-row--reported' : 'transcript-row'
                  }
                >
                  <span className="transcript-meta">
                    <strong>{nameOf(m.senderId)}</strong> · {time(new Date(m.createdAt))}
                    {isReported && <span className="transcript-flag">Reported</span>}
                  </span>
                  <span
                    className={
                      m.deleted ? 'transcript-body transcript-body--deleted' : 'transcript-body'
                    }
                  >
                    {m.deleted
                      ? 'Deleted before the report'
                      : m.body || (m.attachments.length ? '' : '(empty)')}
                  </span>
                  {m.attachments.length > 0 && (
                    <span className="transcript-files">📎 {m.attachments.join(', ')}</span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
        <p className="hint" style={{ marginTop: 8, fontSize: 12 }}>
          As it was when reported. Photos and files are listed by name only.
        </p>
      </div>

      {r.status === 'resolved' ? (
        <div className="notice">
          <strong>{r.outcome ? OUTCOME[r.outcome][0] : 'Resolved'}</strong>
          {r.resolvedBy && ` by ${r.resolvedBy}`} · {longDate(r.resolvedAt)}
          {r.note && <div className="hint">“{r.note}”</div>}
        </div>
      ) : (
        <div>
          <span className="section-label">What to do</span>
          <div className="actions-grid" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn--action" onClick={() => onResolve('dismiss')}>
              Dismiss
            </button>
            <button
              type="button"
              className="btn btn--action"
              disabled={r.kind !== 'message'}
              title={
                r.kind !== 'message' ? 'This report is about a person, not a message' : undefined
              }
              onClick={() => onResolve('remove')}
            >
              Remove message
            </button>
            <button
              type="button"
              className="btn btn--action btn--danger-soft"
              disabled={!reported?.exists}
              onClick={() => onResolve('warn')}
            >
              Warn @{reported?.username ?? 'them'}
            </button>
            <button
              type="button"
              className="btn btn--action btn--danger"
              disabled={!reported?.exists || r.reportedSuspended}
              onClick={() => onResolve('suspend')}
            >
              {r.reportedSuspended ? 'Already suspended' : 'Suspend'}
            </button>
          </div>
          {reported?.exists && (
            <button
              type="button"
              className="link-btn"
              style={{ marginTop: 10 }}
              onClick={() => onOpenAccount(reported.id)}
            >
              Open @{reported.username} in Accounts
            </button>
          )}
        </div>
      )}
    </section>
  )
}

const TITLES: Record<ResolveAction['action'], string> = {
  dismiss: 'Dismiss report',
  remove: 'Remove the message',
  warn: 'Warn them',
  suspend: 'Suspend the account'
}

function ResolveDialog({
  report: r,
  action,
  onClose,
  onDone
}: {
  report: ReportDetail
  action: ResolveAction['action']
  onClose: () => void
  onDone: (message: string) => void
}): JSX.Element {
  const [text, setText] = useState('')
  const [alsoRemove, setAlsoRemove] = useState(r.kind === 'message')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const textId = useId()
  const who = r.reported ? `@${r.reported.username}` : 'They'

  const intro = {
    dismiss: 'Nothing happens to anyone. Use it when the report doesn’t break the rules.',
    remove:
      'The message is deleted for everyone in the chat, like its sender deleting it. Other open reports of it close too.',
    warn: `${who} sees your warning as “A message from the Glofly team” the next time they open Glofly, and has to press I understand.`,
    suspend: `${who} is signed out everywhere and can’t log in (they see your reason) until you unsuspend them in Accounts.`
  }[action]

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    const local: Record<string, string> = {}
    if (action === 'warn' && text.trim().length < 10) local.text = 'Write the warning they’ll see.'
    if (action === 'suspend' && text.trim().length < 3)
      local.text = 'Write the reason they’ll see when they try to log in.'
    if (note.trim().length < 3) local.note = 'Add a short note for the audit log.'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length) return
    setBusy(true)
    const body: ResolveAction =
      action === 'warn'
        ? { action, warning: text.trim(), alsoRemove, note: note.trim() }
        : action === 'suspend'
          ? { action, reason: text.trim(), alsoRemove, note: note.trim() }
          : { action, note: note.trim() }
    const result = await api.resolveReport(r.id, body)
    setBusy(false)
    if (result.ok) onDone(result.data.message ?? 'Done.')
    else if (result.fields) {
      setErrors({
        ...result.fields,
        ...(result.fields.warning || result.fields.reason
          ? { text: result.fields.warning ?? result.fields.reason }
          : {})
      })
      if (!result.fields.note && !result.fields.warning && !result.fields.reason)
        setFormError(result.message)
    } else setFormError(result.message)
  }

  return (
    <Dialog title={TITLES[action]} intro={intro} onClose={onClose} narrow busy={busy}>
      <form
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        noValidate
      >
        {(action === 'warn' || action === 'suspend') && (
          <div className="field">
            <label htmlFor={textId}>
              {action === 'warn' ? 'The warning they’ll see' : 'Reason they’ll see at login'}
            </label>
            <textarea
              id={textId}
              className="textarea"
              rows={action === 'warn' ? 4 : 2}
              maxLength={action === 'warn' ? 600 : 200}
              value={text}
              placeholder={
                action === 'warn'
                  ? 'e.g. "Please keep group chats friendly. Insulting people breaks the Glofly rules, and next time your account may be suspended."'
                  : 'e.g. "Repeated harassment after a warning."'
              }
              aria-invalid={errors.text ? true : undefined}
              onChange={(e) => setText(e.target.value)}
            />
            {errors.text && <span className="hint hint--error">{errors.text}</span>}
          </div>
        )}
        {(action === 'warn' || action === 'suspend') && r.kind === 'message' && (
          <label className="check">
            <input
              type="checkbox"
              checked={alsoRemove}
              onChange={(e) => setAlsoRemove(e.target.checked)}
            />
            Also remove the reported message
          </label>
        )}
        <NoteField value={note} onChange={setNote} error={errors.note} />
        {formError && (
          <div className="error-box" role="alert">
            {formError}
          </div>
        )}
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="submit"
            className={`btn ${action === 'dismiss' ? 'btn--primary' : 'btn--danger'}`}
            disabled={busy}
          >
            {busy ? 'Working…' : TITLES[action]}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
