import { useState, type JSX, type ReactNode } from 'react'
import { Dialog, NoteField, TextField } from './common'
import type { Result } from '../lib/api'

// Every account action goes through this: a short explanation, any fields it needs,
// and the note for the audit log (required by the server too).

export type ActionField = {
  name: string
  label: string
  hint?: ReactNode
  type?: string
  maxLength?: number
  initial?: string
}

export type ActionSpec = {
  title: string
  intro: ReactNode
  confirmLabel: string
  danger?: boolean
  fields?: ActionField[]
  notice?: ReactNode
  notePlaceholder?: string
  run: (values: Record<string, string>, note: string) => Promise<Result<{ message?: string }>>
}

export function ActionDialog({
  spec,
  onClose,
  onDone
}: {
  spec: ActionSpec
  onClose: () => void
  onDone: (message: string) => void
}): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries((spec.fields ?? []).map((f) => [f.name, f.initial ?? '']))
  )
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    const local: Record<string, string> = {}
    for (const f of spec.fields ?? [])
      if (!values[f.name]?.trim()) local[f.name] = `Fill in ${f.label.toLowerCase()}.`
    if (note.trim().length < 3)
      local.note = 'Add a short note for the audit log (a few words is enough).'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length) return
    setBusy(true)
    const result = await spec.run(
      Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()])),
      note.trim()
    )
    setBusy(false)
    if (result.ok) {
      onDone(result.data.message ?? 'Done.')
      return
    }
    if (result.fields && Object.keys(result.fields).length) {
      setErrors(result.fields)
      const known = new Set([...(spec.fields ?? []).map((f) => f.name), 'note'])
      const other = Object.entries(result.fields).find(([k]) => !known.has(k))
      if (other) setFormError(other[1])
    } else {
      setFormError(result.message)
    }
  }

  return (
    <Dialog title={spec.title} intro={spec.intro} onClose={onClose} narrow busy={busy}>
      <form
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        noValidate
      >
        {(spec.fields ?? []).map((f) => (
          <TextField
            key={f.name}
            label={f.label}
            type={f.type}
            hint={f.hint}
            maxLength={f.maxLength}
            value={values[f.name] ?? ''}
            error={errors[f.name]}
            onChange={(v) => setValues((old) => ({ ...old, [f.name]: v }))}
          />
        ))}
        {spec.notice}
        <NoteField
          value={note}
          onChange={setNote}
          error={errors.note}
          placeholder={spec.notePlaceholder}
        />
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
            className={`btn ${spec.danger ? 'btn--danger' : 'btn--primary'}`}
            disabled={busy}
          >
            {busy ? 'Working…' : spec.confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
