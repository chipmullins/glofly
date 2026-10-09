import { useCallback, useEffect, useState, type JSX } from 'react'
import { api, type InviteCode, type SignupMode } from '../lib/api'
import { ActionDialog, type ActionSpec } from '../components/ActionDialog'
import { Chip, Dialog, NoteField, TextField } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { shortDate } from '../lib/format'

const MODES: { id: SignupMode; title: string; text: string }[] = [
  { id: 'open', title: 'Open', text: 'Anyone with the app can sign up.' },
  {
    id: 'invite',
    title: 'Invite only',
    text: 'Sign-up needs an invite code from you. Best while testing.'
  },
  { id: 'closed', title: 'Closed', text: 'No new sign-ups at all. Existing accounts keep working.' }
]

export function Signups({
  toast
}: {
  toast: (message: string, bad?: boolean) => void
}): JSX.Element {
  const [mode, setMode] = useState<SignupMode | null>(null)
  const [codes, setCodes] = useState<InviteCode[]>([])
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<ActionSpec | null>(null)
  const [making, setMaking] = useState(false)

  const load = useCallback(() => {
    void api.signups().then((result) => {
      if (result.ok) {
        setMode(result.data.mode)
        setCodes(result.data.codes)
        setError(null)
      } else setError(result.message)
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const chooseMode = (next: SignupMode): void => {
    if (!mode || next === mode) return
    const from = MODES.find((m) => m.id === mode)!.title
    const to = MODES.find((m) => m.id === next)!
    setAction({
      title: `Change sign-ups to ${to.title}`,
      intro: (
        <>
          {from} → <strong>{to.title}</strong>. {to.text}
          {next === 'invite' &&
            ' People on Glofly 0.1.7 or older see a general error when signing up, so make sure testers have updated.'}
        </>
      ),
      confirmLabel: `Make it ${to.title}`,
      run: (_v, note) => api.setMode(next, note)
    })
  }

  return (
    <>
      <header className="page-head">
        <h1>Sign-ups</h1>
      </header>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <section
        style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        aria-labelledby="mode-title"
      >
        <h2 id="mode-title" style={{ fontWeight: 600, fontSize: 18 }}>
          Who can create an account
        </h2>
        <div className="modes" role="radiogroup" aria-labelledby="mode-title">
          {MODES.map((m) => (
            <label key={m.id} className="mode">
              <span className="top">
                <input
                  type="radio"
                  name="signup-mode"
                  checked={mode === m.id}
                  disabled={!mode}
                  onChange={() => chooseMode(m.id)}
                />
                <span className="title">{m.title}</span>
              </span>
              <span className="text">{m.text}</span>
            </label>
          ))}
        </div>
        <p className="hint" style={{ margin: 0, fontSize: 13 }}>
          Accounts you create for someone in Control always work, whichever you choose.
        </p>
      </section>

      <section className="card" style={{ overflow: 'hidden' }} aria-labelledby="codes-title">
        <div className="section-head">
          <div>
            <h2 id="codes-title" style={{ fontWeight: 600, fontSize: 18 }}>
              Invite codes
            </h2>
            <p>
              People type one on the sign-up screen while sign-ups are invite only. You see who used
              which.
            </p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setMaking(true)}>
            <Icon d={ICONS.plus} size={16} strokeWidth={2.2} />
            New invite code
          </button>
        </div>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">For</th>
                <th scope="col">Used</th>
                <th scope="col">Used by</th>
                <th scope="col">Expires</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No invite codes yet.
                  </td>
                </tr>
              )}
              {codes.map((c) => (
                <tr key={c.id}>
                  <td>
                    <code className={`code${c.state === 'off' ? ' code--off' : ''}`}>{c.code}</code>
                  </td>
                  <td>{c.label}</td>
                  <td>
                    {c.uses} of {c.maxUses}
                  </td>
                  <td className="muted">
                    {c.usedBy.length
                      ? c.usedBy.map((u) => `@${u.username}`).join(', ') +
                        (c.usedBy.length === 1 ? ` · ${shortDate(c.usedBy[0].usedAt)}` : '')
                      : 'Not used yet'}
                  </td>
                  <td className="muted">
                    {c.state === 'off' ? (
                      <Chip small>Turned off</Chip>
                    ) : c.state === 'used_up' ? (
                      'Used up'
                    ) : c.state === 'expired' ? (
                      <Chip small>Expired</Chip>
                    ) : c.expiresAt ? (
                      shortDate(c.expiresAt)
                    ) : (
                      'Never'
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      {c.state === 'active' && (
                        <>
                          <button
                            type="button"
                            className="btn btn--small"
                            onClick={() => {
                              void window.control.copy(c.code)
                              toast(`${c.code} copied.`)
                            }}
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            className="btn btn--small btn--danger-soft"
                            style={{ fontWeight: 600 }}
                            onClick={() =>
                              setAction({
                                title: `Turn off ${c.code}`,
                                intro:
                                  'It stops working at once. Accounts already made with it stay as they are.',
                                confirmLabel: 'Turn off',
                                danger: true,
                                run: (_v, note) => api.disableCode(c.id, note)
                              })
                            }
                          >
                            Turn off
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {action && (
        <ActionDialog
          spec={action}
          onClose={() => setAction(null)}
          onDone={(message) => {
            setAction(null)
            toast(message === 'Done.' ? 'Saved.' : message)
            load()
          }}
        />
      )}
      {making && (
        <NewCode
          onClose={() => setMaking(false)}
          onDone={(code) => {
            setMaking(false)
            void window.control.copy(code)
            toast(`${code} made and copied. Share it with them.`)
            load()
          }}
        />
      )}
    </>
  )
}

function NewCode({
  onClose,
  onDone
}: {
  onClose: () => void
  onDone: (code: string) => void
}): JSX.Element {
  const [label, setLabel] = useState('')
  const [uses, setUses] = useState('1')
  const [days, setDays] = useState('14')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    const local: Record<string, string> = {}
    const maxUses = Number(uses)
    if (!label.trim()) local.label = "Say who it's for."
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100)
      local.maxUses = 'Between 1 and 100.'
    if (note.trim().length < 3)
      local.note = 'Add a short note for the audit log (a few words is enough).'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length) return
    setBusy(true)
    const result = await api.createCode({
      label: label.trim(),
      maxUses,
      expiresInDays: days === 'never' ? null : Number(days),
      note: note.trim()
    })
    setBusy(false)
    if (result.ok) onDone(result.data.code)
    else if (result.fields) setErrors(result.fields)
    else setFormError(result.message)
  }

  return (
    <Dialog
      title="New invite code"
      intro="Share it by text or in person. It looks like GLOW-7K2M."
      onClose={onClose}
      narrow
      busy={busy}
    >
      <form
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        noValidate
      >
        <TextField
          label="Who it's for"
          value={label}
          onChange={setLabel}
          error={errors.label}
          maxLength={60}
          hint='e.g. "Friday group" or "Sam"'
        />
        <div className="two-cols">
          <TextField
            label="How many sign-ups"
            type="number"
            value={uses}
            onChange={setUses}
            error={errors.maxUses}
          />
          <div className="field">
            <label htmlFor="code-days">Works for</label>
            <select
              id="code-days"
              className="select"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="never">Until turned off</option>
            </select>
          </div>
        </div>
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
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Making…' : 'Make code'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
