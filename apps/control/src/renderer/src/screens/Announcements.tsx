import { useCallback, useEffect, useId, useState, type JSX } from 'react'
import {
  api,
  PLATFORM_LABEL,
  type Announcement,
  type AppPlatform,
  type AppVersionInfo
} from '../lib/api'
import { Chip, Dialog, NoteField, TextField } from '../components/common'
import { Icon, ICONS } from '../components/icons'
import { longDate, plural, when } from '../lib/format'

// Messages to everyone: the banner at the top of every Glofly app, and the required update
// (older apps are asked to update before they can carry on).

export function Announcements({
  toast
}: {
  toast: (message: string, bad?: boolean) => void
}): JSX.Element {
  const [current, setCurrent] = useState<Announcement | null>(null)
  const [history, setHistory] = useState<Announcement[]>([])
  const [version, setVersion] = useState<AppVersionInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [ending, setEnding] = useState<Announcement | null>(null)
  const [requiring, setRequiring] = useState(false)
  // Desktop, Android and iPhone each have their own version numbers, so each has its own minimum.
  const [platform, setPlatform] = useState<AppPlatform>('desktop')

  const load = useCallback(() => {
    void api.announcements().then((result) => {
      if (!result.ok) return setError(result.message)
      setError(null)
      setCurrent(result.data.current)
      setHistory(result.data.history)
    })
    void api.appVersion(undefined, platform).then((result) => result.ok && setVersion(result.data))
  }, [platform])

  useEffect(() => {
    load()
  }, [load])

  const past = history.filter((h) => h.id !== current?.id).slice(0, 10)

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Announcements</h1>
          <p className="sub">A banner in everyone&apos;s Glofly, and the version everyone needs.</p>
        </div>
      </header>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}

      <section className="card" aria-labelledby="banner-title">
        <div className="section-head">
          <div>
            <h2 id="banner-title" style={{ fontWeight: 600, fontSize: 18 }}>
              Banner
            </h2>
            <p>
              One line at the top of the app, live for everyone signed in. People can dismiss it.
              Posting a new one replaces the old.
            </p>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setWriting(true)}>
            <Icon d={ICONS.plus} size={16} strokeWidth={2.2} />
            New announcement
          </button>
        </div>
        <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {current ? (
            <>
              <Preview
                body={current.body}
                tone={current.tone}
                linkLabel={current.linkLabel}
                hasLink={!!current.linkUrl}
              />
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'center',
                  flexWrap: 'wrap'
                }}
              >
                <span className="hint">
                  Showing since {when(current.createdAt)}
                  {current.endsAt
                    ? ` · ends by itself ${when(current.endsAt)}`
                    : ' · until you end it'}
                  {current.linkUrl ? ` · links to ${current.linkUrl}` : ''}
                </span>
                <button
                  type="button"
                  className="btn btn--small btn--danger-soft"
                  onClick={() => setEnding(current)}
                >
                  End now
                </button>
              </div>
            </>
          ) : (
            <p className="hint" style={{ margin: 0 }}>
              No banner showing right now.
            </p>
          )}
          {past.length > 0 && (
            <div className="history-list">
              <span className="section-label" style={{ padding: '6px 0' }}>
                Earlier
              </span>
              {past.map((h) => (
                <div key={h.id} className="history-item">
                  <span>
                    {h.tone === 'important' && (
                      <Chip small tone="warn">
                        Important
                      </Chip>
                    )}{' '}
                    {h.body}
                  </span>
                  <span className="meta">{longDate(h.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="min-title">
        <div className="section-head">
          <div>
            <h2 id="min-title" style={{ fontWeight: 600, fontSize: 18 }}>
              Required update
            </h2>
            <p>
              Apps older than the minimum show “Please update Glofly” and can&apos;t carry on until
              they update. Each app has its own version numbers, so each has its own minimum.
              Desktop apps from 0.1.7 and older count as older than any minimum.
            </p>
            <div className="filters" role="group" aria-label="Which app" style={{ marginTop: 10 }}>
              {(['desktop', 'android', 'ios'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className="filter"
                  aria-pressed={platform === p}
                  onClick={() => setPlatform(p)}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="btn btn--primary" onClick={() => setRequiring(true)}>
            {version?.minVersion ? 'Change' : 'Set a minimum'}
          </button>
        </div>
        <div className="card-pad">
          <dl className="facts">
            <dt>Minimum now</dt>
            <dd>
              {version?.minVersion ? (
                <strong>{version.minVersion}</strong>
              ) : (
                'None (every version works)'
              )}
            </dd>
            <dt>Newest in use</dt>
            <dd>{version?.newest ?? '—'}</dd>
            {version?.message && (
              <>
                <dt>Message</dt>
                <dd>{version.message}</dd>
              </>
            )}
          </dl>
        </div>
      </section>

      {writing && (
        <NewAnnouncement
          onClose={() => setWriting(false)}
          onDone={(message) => {
            setWriting(false)
            toast(message)
            load()
          }}
        />
      )}
      {ending && (
        <EndAnnouncement
          announcement={ending}
          onClose={() => setEnding(null)}
          onDone={(message) => {
            setEnding(null)
            toast(message)
            load()
          }}
        />
      )}
      {requiring && version && (
        <RequireVersion
          info={version}
          platform={platform}
          onClose={() => setRequiring(false)}
          onDone={(message) => {
            setRequiring(false)
            toast(message)
            load()
          }}
        />
      )}
    </>
  )
}

function Preview({
  body,
  tone,
  linkLabel,
  hasLink
}: {
  body: string
  tone: 'info' | 'important'
  linkLabel: string | null
  hasLink: boolean
}): JSX.Element {
  return (
    <div
      className={
        tone === 'important' ? 'announce-preview announce-preview--important' : 'announce-preview'
      }
    >
      <Icon d={ICONS.announcements} size={18} />
      <span style={{ flex: 1 }}>{body || 'Your announcement'}</span>
      {hasLink && <span className="link">{linkLabel || 'Learn more'}</span>}
      <span aria-hidden="true">×</span>
    </div>
  )
}

function NewAnnouncement({
  onClose,
  onDone
}: {
  onClose: () => void
  onDone: (message: string) => void
}): JSX.Element {
  const [body, setBody] = useState('')
  const [tone, setTone] = useState<'info' | 'important'>('info')
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [hours, setHours] = useState('none')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const bodyId = useId()

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    const local: Record<string, string> = {}
    if (body.trim().length < 3) local.body = 'Write the announcement.'
    if (linkUrl.trim() && !/^https:\/\//.test(linkUrl.trim()))
      local.linkUrl = 'Links must start with https://'
    if (note.trim().length < 3) local.note = 'Add a short note for the audit log.'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length) return
    setBusy(true)
    const result = await api.postAnnouncement({
      body: body.trim(),
      tone,
      ...(linkUrl.trim()
        ? { linkUrl: linkUrl.trim(), linkLabel: linkLabel.trim() || undefined }
        : {}),
      hours: hours === 'none' ? null : Number(hours),
      note: note.trim()
    })
    setBusy(false)
    if (result.ok) onDone(result.data.message ?? 'Posted.')
    else if (result.fields) setErrors(result.fields)
    else setFormError(result.message)
  }

  return (
    <Dialog
      title="New announcement"
      intro="Shows at once at the top of everyone's Glofly. Keep it to one line."
      onClose={onClose}
      busy={busy}
    >
      <form
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        noValidate
      >
        <div className="field">
          <label htmlFor={bodyId}>Announcement</label>
          <textarea
            id={bodyId}
            className="textarea"
            rows={2}
            maxLength={240}
            value={body}
            placeholder='e.g. "Glofly will restart at 10 PM tonight for an update (about 2 minutes)."'
            aria-invalid={errors.body ? true : undefined}
            onChange={(e) => setBody(e.target.value)}
          />
          <span className={errors.body ? 'hint hint--error' : 'hint'}>
            {errors.body ?? `${body.length} / 240`}
          </span>
        </div>
        <div className="field">
          <span className="field-label">Style</span>
          <div className="tone-pick" role="radiogroup" aria-label="Style">
            {(['info', 'important'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className="filter"
                role="radio"
                aria-checked={tone === t}
                aria-pressed={tone === t}
                onClick={() => setTone(t)}
              >
                {t === 'info' ? 'Info' : 'Important'}
              </button>
            ))}
          </div>
        </div>
        <Preview
          body={body.trim()}
          tone={tone}
          linkLabel={linkLabel.trim() || null}
          hasLink={!!linkUrl.trim()}
        />
        <div className="two-cols">
          <TextField
            label="Link (optional)"
            value={linkUrl}
            onChange={setLinkUrl}
            error={errors.linkUrl}
            maxLength={300}
            hint="https:// only"
          />
          <TextField
            label="Link text"
            value={linkLabel}
            onChange={setLinkLabel}
            error={errors.linkLabel}
            maxLength={30}
            hint='Default "Learn more"'
          />
        </div>
        <div className="field">
          <label htmlFor="announce-hours">Show it</label>
          <select
            id="announce-hours"
            className="select"
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          >
            <option value="none">Until I end it</option>
            <option value="1">For 1 hour</option>
            <option value="4">For 4 hours</option>
            <option value="24">For a day</option>
            <option value="72">For 3 days</option>
            <option value="168">For a week</option>
          </select>
        </div>
        <NoteField
          value={note}
          onChange={setNote}
          error={errors.note}
          placeholder='e.g. "Server update tonight"'
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
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Posting…' : 'Post to everyone'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function EndAnnouncement({
  announcement,
  onClose,
  onDone
}: {
  announcement: Announcement
  onClose: () => void
  onDone: (message: string) => void
}): JSX.Element {
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (note.trim().length < 3) return setError('Add a short note for the audit log.')
    setBusy(true)
    const result = await api.endAnnouncement(announcement.id, note.trim())
    setBusy(false)
    if (result.ok) onDone(result.data.message ?? 'Ended.')
    else setError(result.fields?.note ?? result.message)
  }
  return (
    <Dialog
      title="End the announcement"
      intro="It disappears from everyone's app at once."
      onClose={onClose}
      narrow
      busy={busy}
    >
      <form
        onSubmit={submit}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        noValidate
      >
        <Preview
          body={announcement.body}
          tone={announcement.tone}
          linkLabel={announcement.linkLabel}
          hasLink={!!announcement.linkUrl}
        />
        <NoteField value={note} onChange={setNote} error={error ?? undefined} />
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--danger" disabled={busy}>
            {busy ? 'Ending…' : 'End now'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}

function RequireVersion({
  info,
  platform,
  onClose,
  onDone
}: {
  info: AppVersionInfo
  platform: AppPlatform
  onClose: () => void
  onDone: (message: string) => void
}): JSX.Element {
  const [value, setValue] = useState(info.minVersion ?? info.newest ?? '')
  const [message, setMessage] = useState(info.message ?? '')
  const [note, setNote] = useState('')
  const [check, setCheck] = useState<AppVersionInfo['check']>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const valid = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/.test(value.trim())

  // How many devices and people would be asked to update.
  useEffect(() => {
    if (!valid) return
    const v = value.trim()
    let alive = true
    const timer = setTimeout(() => {
      void api
        .appVersion(v, platform)
        .then((result) => alive && result.ok && setCheck(result.data.check))
    }, 300)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [value, valid, platform])

  async function save(version: string | null): Promise<void> {
    const local: Record<string, string> = {}
    if (version !== null && !valid) local.version = 'Use a version like 0.2.0.'
    if (note.trim().length < 3) local.note = 'Add a short note for the audit log.'
    setErrors(local)
    setFormError(null)
    if (Object.keys(local).length) return
    setBusy(true)
    const result = await api.setAppVersion(version, message.trim(), note.trim(), platform)
    setBusy(false)
    if (result.ok) onDone(result.data.message ?? 'Saved.')
    else if (result.fields) setErrors(result.fields)
    else setFormError(result.message)
  }

  return (
    <Dialog
      title={`Required update · ${PLATFORM_LABEL[platform]}`}
      intro={`The newest ${PLATFORM_LABEL[platform]} version anyone is running is ${info.newest ?? 'unknown'}. You can't require a version nobody has yet.`}
      onClose={onClose}
      narrow
      busy={busy}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save(value.trim())
        }}
        style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
        noValidate
      >
        <TextField
          label="Minimum version"
          value={value}
          onChange={setValue}
          error={errors.version}
          maxLength={12}
          hint={
            valid && check && check.version === value.trim()
              ? check.devices === 0
                ? 'Every device is already on this version or newer.'
                : `${plural(check.devices, 'device')} (${plural(check.people, 'person', 'people')}) will be asked to update.`
              : 'Like 0.2.0'
          }
        />
        <TextField
          label="Message (optional)"
          value={message}
          onChange={setMessage}
          error={errors.message}
          maxLength={200}
          hint='Default: "This version of Glofly is too old. Please update to keep using it."'
        />
        <NoteField value={note} onChange={setNote} error={errors.note} />
        {formError && (
          <div className="error-box" role="alert">
            {formError}
          </div>
        )}
        <div className="dialog-buttons">
          {info.minVersion && (
            <button
              type="button"
              className="btn btn--danger-soft"
              style={{ marginRight: 'auto' }}
              disabled={busy}
              onClick={() => void save(null)}
            >
              Remove the minimum
            </button>
          )}
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Saving…' : 'Require it'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
