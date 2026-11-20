import { useEffect, useRef, useState } from 'react'
import {
  CONSTELLATION_NAME_MAX,
  CONSTELLATION_TAGS_MAX,
  CONSTELLATION_TYPES,
  JOIN_REQUEST_NOTE_MAX,
  VISIBILITY_LABELS,
  cleanTag,
  inviteCodeFrom,
  type ConstellationTemplate,
  type ConstellationType,
  type ConstellationVisibility,
  type DirectoryEntry
} from '@glofly/shared/constellations'
import { api } from '../lib/constellations'
import { CloseIcon, ConstellationIcon, StarIcon } from './bits'
import TemplatePicker from './TemplatePicker'

// The + (Create.dc.html, approved): tabs Create | Join with an invite. Create: icon, name, "Start
// with" templates, and (Oct 17) who can join: Invite only, Public, or Public with approval,
// with a kind and genre tags for the directory. "You'll be the Owner". Join: a link or code, with
// a preview of the constellation.

type PhotoType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'
const PHOTO_TYPES: PhotoType[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

function DialogStars(): React.JSX.Element {
  return (
    <>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 40,
          top: 20,
          width: 3,
          height: 3,
          borderRadius: 2,
          background: '#ffb347'
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 180,
          top: 34,
          width: 2,
          height: 2,
          borderRadius: 1,
          background: '#e9d5c4'
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 330,
          top: 16,
          width: 4,
          height: 4,
          borderRadius: 2,
          background: '#ffb347',
          boxShadow: '0 0 10px 3px rgba(255,165,74,.45)'
        }}
      />
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: 470,
          top: 40,
          width: 2,
          height: 2,
          borderRadius: 1,
          background: '#f9b26b'
        }}
      />
    </>
  )
}

/** Genre tags: type and press Enter (or a comma). */
export function TagInput({
  tags,
  onChange
}: {
  tags: string[]
  onChange: (tags: string[]) => void
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  function add(raw: string): void {
    const t = cleanTag(raw)
    if (!raw.trim()) return
    if (!t) {
      setProblem('Tags use letters and numbers, up to 20 characters.')
      return
    }
    if (tags.includes(t)) {
      setText('')
      return
    }
    if (tags.length >= CONSTELLATION_TAGS_MAX) {
      setProblem(`Up to ${CONSTELLATION_TAGS_MAX} tags.`)
      return
    }
    setProblem(null)
    onChange([...tags, t])
    setText('')
  }
  return (
    <>
      <div className="cx-tag-input">
        {tags.map((t) => (
          <span key={t} className="cx-tag-chip">
            #{t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => onChange(tags.filter((x) => x !== t))}
            >
              <CloseIcon size={12} />
            </button>
          </span>
        ))}
        <input
          type="text"
          aria-label="Genre tags"
          placeholder={tags.length ? '' : 'e.g. mmo, raids, chill'}
          value={text}
          maxLength={24}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add(text)
            } else if (e.key === 'Backspace' && !text && tags.length) {
              onChange(tags.slice(0, -1))
            }
          }}
          onBlur={() => add(text)}
        />
      </div>
      {problem && (
        <span className="cx-hint" style={{ color: 'var(--glo-danger-text)' }}>
          {problem}
        </span>
      )}
    </>
  )
}

/** Who can join (Invite only / Public / Public, approval needed). */
export function VisibilityChoices({
  value,
  onChange
}: {
  value: ConstellationVisibility
  onChange: (v: ConstellationVisibility) => void
}): React.JSX.Element {
  return (
    <div className="cx-choices cx-choices--three">
      {(['invite', 'public', 'approval'] as const).map((v) => (
        <button
          key={v}
          type="button"
          className="cx-choice"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
        >
          <strong>{VISIBILITY_LABELS[v].name}</strong>
          <span>{VISIBILITY_LABELS[v].what}</span>
        </button>
      ))}
    </div>
  )
}

export default function CreateJoin({
  initialTab,
  initialCode,
  onClose,
  onDone
}: {
  initialTab: 'create' | 'join'
  /** A link someone opened (glofly.app/c/…) */
  initialCode?: string | null
  onClose: () => void
  /** Created or joined: open it */
  onDone: (constellationId: string) => void
}): React.JSX.Element {
  const [tab, setTab] = useState<'create' | 'join'>(initialTab)
  // Create
  const [name, setName] = useState('')
  const [template, setTemplate] = useState<ConstellationTemplate>('gaming')
  /** 0.8.0: Create is two steps: the details, then the starting point (Templates board) */
  const [step, setStep] = useState<'details' | 'template'>('details')
  const [visibility, setVisibility] = useState<ConstellationVisibility>('invite')
  const [type, setType] = useState<ConstellationType | ''>('')
  const [tags, setTags] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [photo, setPhoto] = useState<{ data: ArrayBuffer; type: PhotoType; url: string } | null>(
    null
  )
  // Join
  const [link, setLink] = useState(initialCode ?? '')
  /** The preview for the code it was loaded for */
  const [found, setFound] = useState<{
    code: string
    preview: DirectoryEntry | null
    problem: string | null
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (tab === 'create') nameRef.current?.focus()
  }, [tab])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(
    () => () => {
      if (photo) URL.revokeObjectURL(photo.url)
    },
    [photo]
  )

  // The invite preview, as you paste.
  const code = inviteCodeFrom(link)
  const current = code && found?.code === code ? found : null
  const preview = current?.preview ?? null
  const previewProblem = code
    ? (current?.problem ?? null)
    : link.trim()
      ? "That doesn't look like a Glofly invite."
      : null
  useEffect(() => {
    if (!code) return
    let stale = false
    const timer = setTimeout(() => {
      void api.linkPreview(code).then((r) => {
        if (stale) return
        if (r.ok) setFound({ code, preview: r.data.constellation, problem: null })
        else setFound({ code, preview: null, problem: r.message })
      })
    }, 250)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [code])

  async function pickPhoto(file: File | undefined): Promise<void> {
    if (!file) return
    if (!PHOTO_TYPES.includes(file.type as PhotoType)) {
      setError('Pick a JPG, PNG, WebP or GIF picture.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('Pictures can be up to 8 MB.')
      return
    }
    setError(null)
    setPhoto({
      data: await file.arrayBuffer(),
      type: file.type as PhotoType,
      url: URL.createObjectURL(file)
    })
  }

  /** The details are fine: on to the starting point. */
  function detailsReady(): boolean {
    if (!name.trim()) {
      setError('Give your constellation a name.')
      return false
    }
    if (visibility !== 'invite' && !type) {
      setError('Pick what kind of constellation it is, so people can find it.')
      return false
    }
    return true
  }

  async function create(): Promise<void> {
    if (!detailsReady()) {
      setStep('details')
      return
    }
    setBusy(true)
    setError(null)
    const r = await api.create({
      name: name.trim(),
      template,
      visibility,
      type: type || null,
      tags: visibility === 'invite' ? [] : tags,
      description: visibility === 'invite' ? null : description.trim() || null
    })
    if (!r.ok) {
      setBusy(false)
      setError(r.message)
      return
    }
    if (photo) await api.setIcon(r.data.constellation.id, photo.data, photo.type)
    setBusy(false)
    onDone(r.data.constellation.id)
  }

  async function join(): Promise<void> {
    if (!code || !preview) return
    if (preview.joined) {
      onDone(preview.id)
      return
    }
    setBusy(true)
    setError(null)
    const r = await api.joinLink(code)
    setBusy(false)
    if (!r.ok) {
      setError(r.message)
      return
    }
    onDone(r.data.constellation.id)
  }

  return (
    <div
      className="cx-dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cx-cc-title"
        className={
          tab === 'create' && step === 'template' ? 'cx-dialog cx-dialog--wide' : 'cx-dialog'
        }
      >
        <div className="cx-dialog-top">
          <DialogStars />
          <div role="tablist" aria-label="Create or join" className="cx-tabs">
            <button
              type="button"
              role="tab"
              className="cx-tab"
              aria-selected={tab === 'create'}
              onClick={() => setTab('create')}
            >
              Create
            </button>
            <button
              type="button"
              role="tab"
              className="cx-tab"
              aria-selected={tab === 'join'}
              onClick={() => setTab('join')}
            >
              Join with an invite
            </button>
          </div>
          <button type="button" className="cx-dialog-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        {tab === 'create' && step === 'template' ? (
          <div className="cx-dialog-body">
            <TemplatePicker
              value={template}
              onChange={setTemplate}
              busy={busy}
              onBack={() => {
                setError(null)
                setStep('details')
              }}
              onCreate={() => void create()}
            />
            {error && <p className="cx-error">{error}</p>}
          </div>
        ) : tab === 'create' ? (
          <form
            className="cx-dialog-body"
            onSubmit={(e) => {
              e.preventDefault()
              setError(null)
              if (detailsReady()) setStep('template')
            }}
          >
            <h1 id="cx-cc-title">Create a constellation</h1>
            <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <button
                type="button"
                className={photo ? 'cx-icon-pick cx-icon-pick--set' : 'cx-icon-pick'}
                aria-label="Choose an icon"
                onClick={() => fileRef.current?.click()}
              >
                {photo ? (
                  <img src={photo.url} alt="" className="cx-icon-img" />
                ) : (
                  <>
                    <svg
                      width="22"
                      height="22"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="5" width="18" height="14" rx="3" />
                      <circle cx="12" cy="12" r="3.2" />
                      <path d="M8 5l1.5-2h5L16 5" />
                    </svg>
                    ICON
                  </>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  void pickPhoto(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
              <label className="cx-field">
                Name
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  maxLength={CONSTELLATION_NAME_MAX}
                  placeholder="Friday Raid Club"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
            </div>

            <fieldset className="cx-fieldset">
              <legend>Who can join</legend>
              <VisibilityChoices value={visibility} onChange={setVisibility} />
            </fieldset>

            {visibility !== 'invite' && (
              <>
                <div style={{ display: 'flex', gap: 12 }}>
                  <label className="cx-field" style={{ flex: '0 0 200px' }}>
                    Kind
                    <select
                      value={type}
                      onChange={(e) => setType(e.target.value as ConstellationType | '')}
                    >
                      <option value="">Pick one</option>
                      {CONSTELLATION_TYPES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="cx-field">
                    <span>Genre tags</span>
                    <TagInput tags={tags} onChange={setTags} />
                  </div>
                </div>
                <label className="cx-field">
                  Description <span className="cx-hint">Shown in the directory</span>
                  <textarea
                    value={description}
                    maxLength={300}
                    placeholder="What it's about, who it's for"
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </label>
              </>
            )}

            <div className="cx-note">
              <StarIcon size={18} color="#f47a1f" />
              <span>You&apos;ll be the Owner. Rename, add or remove nebulas any time.</span>
            </div>
            {error && <p className="cx-error">{error}</p>}
            <div className="cx-dialog-actions">
              <button type="button" className="cx-button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="cx-button cx-button--primary" disabled={busy}>
                Next: pick a starting point
              </button>
            </div>
          </form>
        ) : (
          <form
            className="cx-dialog-body"
            onSubmit={(e) => {
              e.preventDefault()
              void join()
            }}
          >
            <h1 id="cx-cc-title">Join a constellation</h1>
            <p>
              Paste the invite link a friend sent you. Invites from friends also show up on your
              dashboard.
            </p>
            <label className="cx-field">
              Invite link or code
              <input
                type="text"
                placeholder="glofly.app/c/AbC123"
                value={link}
                autoFocus
                onChange={(e) => setLink(e.target.value)}
              />
            </label>
            {preview && (
              <div className="cx-preview">
                <ConstellationIcon
                  id={preview.id}
                  name={preview.name}
                  color={preview.color}
                  iconVersion={preview.iconVersion}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    fontFamily: 'var(--glo-font-display)',
                    fontWeight: 700,
                    flex: 'none'
                  }}
                />
                <span style={{ flex: 1 }}>
                  <strong>{preview.name}</strong>
                  <span>
                    {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'}
                    {preview.friends.length > 0 &&
                      ` · ${preview.friends.map((f) => f.displayName.split(/\s+/)[0]).join(', ')} ${preview.friends.length === 1 ? 'is' : 'are'} in it`}
                    {preview.joined && " · You're already in it"}
                  </span>
                </span>
              </div>
            )}
            {previewProblem && !preview && (
              <p className="cx-hint" style={{ fontSize: 14 }}>
                {previewProblem}
              </p>
            )}
            {error && <p className="cx-error">{error}</p>}
            <div className="cx-dialog-actions">
              <button type="button" className="cx-button" onClick={onClose}>
                Cancel
              </button>
              <button
                type="submit"
                className="cx-button cx-button--join"
                disabled={busy || !preview}
              >
                {preview?.joined ? 'Open' : busy ? 'Joining…' : 'Join'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

/** "Public, approval needed": a short note to the moderators. */
export function AskToJoin({
  entry,
  onClose,
  onSent
}: {
  entry: DirectoryEntry
  onClose: () => void
  onSent: () => void
}): React.JSX.Element {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function send(): Promise<void> {
    setBusy(true)
    const r = await api.join(entry.id, note.trim() || undefined)
    setBusy(false)
    if (!r.ok) {
      setError(r.message)
      return
    }
    onSent()
  }
  return (
    <div
      className="cx-dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cx-ask-title"
        className="cx-dialog"
        style={{ width: 480 }}
      >
        <div className="cx-dialog-top" style={{ height: 72 }}>
          <DialogStars />
          <button type="button" className="cx-dialog-close" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>
        <form
          className="cx-dialog-body"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <h1 id="cx-ask-title">Ask to join {entry.name}</h1>
          <p>A moderator lets people in. Say hi and why you&apos;d like to join (optional).</p>
          <label className="cx-field">
            Note
            <textarea
              value={note}
              maxLength={JOIN_REQUEST_NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
          </label>
          {error && <p className="cx-error">{error}</p>}
          <div className="cx-dialog-actions">
            <button type="button" className="cx-button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="cx-button cx-button--join" disabled={busy}>
              {busy ? 'Sending…' : 'Ask to join'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
