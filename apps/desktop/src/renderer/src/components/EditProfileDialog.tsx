import { useEffect, useRef, useState } from 'react'
import type {
  MyStatus,
  MyStatusChoice,
  PhotoType,
  Profile,
  SignedInUser
} from '../../../preload/api-types'
import { initials, shortDate } from '../lib/names'
import { AvatarFace } from './Avatar'
import { CalendarIcon, PencilIcon } from './icons'
import { ProfileHero } from './ProfileCard'
import './dialogs.css'
import './ProfileDialogs.css'
import PhotoCropper from './PhotoCropper'
import { PHOTO_TYPES, readPhoto, type PickedPhoto } from '../lib/photoPick'

type EditProfileDialogProps = {
  user: SignedInUser
  status: MyStatus
  /** Called after saving, with your updated details. */
  onSaved: (user: SignedInUser, status: MyStatus) => void
  onClose: () => void
  onSessionExpired: () => void
  /** 0.9.1: Settings → Profile (header, pronouns, board, who sees what) */
  onMore?: () => void
}

const DISPLAY_NAME_MAX = 32
const STATUS_TEXT_MAX = 80
const BIO_MAX = 190

// Labels from the design's status picker.
const STATUS_CHOICES: { id: MyStatusChoice; label: string }[] = [
  { id: 'online', label: 'Online' },
  { id: 'away', label: 'Away' },
  { id: 'dnd', label: 'Do Not Disturb' },
  { id: 'invisible', label: 'Invisible' }
]

/** A photo picked but not saved yet: kept until Save, so Cancel throws it away. */
type PhotoChange =
  | {
      kind: 'new'
      data: ArrayBuffer
      type: PhotoType
      preview: string
      /** The photo as picked, so it can be positioned again */
      original: PickedPhoto
    }
  | { kind: 'remove' }

/** Edit my profile (EditProfile.dc.html). */
export default function EditProfileDialog({
  user,
  status,
  onSaved,
  onClose,
  onSessionExpired,
  onMore
}: EditProfileDialogProps): React.JSX.Element {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [displayName, setDisplayName] = useState(user.displayName)
  const [statusChoice, setStatusChoice] = useState<MyStatusChoice>(status.status)
  const [statusText, setStatusText] = useState(status.statusText ?? '')
  const [bio, setBio] = useState<string | null>(null) // null until loaded
  const [photo, setPhoto] = useState<PhotoChange | null>(null)
  /** The photo being positioned in the crop window */
  const [cropping, setCropping] = useState<PickedPhoto | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  const expiredRef = useRef(onSessionExpired)
  useEffect(() => {
    closeRef.current = onClose
    expiredRef.current = onSessionExpired
  })

  useEffect(() => {
    window.glofly.profile.getMine().then((result) => {
      if (result.ok) {
        setProfile(result.data)
        setBio(result.data.bio ?? '')
      } else if (result.error === 'unauthorized') expiredRef.current()
      else {
        setBio('')
        setError(result.message)
      }
    })
    nameRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = '' // so picking the same file again still counts
    if (!file) return
    const picked = await readPhoto(file)
    if ('error' in picked) {
      setError(picked.error)
      return
    }
    // Choose what's in the circle first.
    setCropping(picked)
    setError(null)
  }

  const hasPhoto = photo ? photo.kind === 'new' : user.avatarVersion !== null
  const bioLength = bio?.length ?? 0 // counted the same way the server counts

  async function save(): Promise<void> {
    const name = displayName.trim()
    if (!name) {
      setNameError('Enter a display name.')
      nameRef.current?.focus()
      return
    }
    if (bioLength > BIO_MAX) {
      setError(`About me can be up to ${BIO_MAX} characters.`)
      return
    }
    setNameError(null)
    setError(null)
    setSaving(true)

    // Each part saves on its own; if one fails, stop and say why (earlier parts stay saved).
    const fail = (result: { error: string; message: string }): void => {
      setSaving(false)
      if (result.error === 'unauthorized') onSessionExpired()
      else setError(result.message)
    }

    let avatarVersion = user.avatarVersion
    if (photo?.kind === 'new') {
      const result = await window.glofly.profile.setPhoto(photo.data, photo.type)
      if (!result.ok) return fail(result)
      avatarVersion = result.data.avatarVersion
    } else if (photo?.kind === 'remove') {
      const result = await window.glofly.profile.removePhoto()
      if (!result.ok) return fail(result)
      avatarVersion = null
    }
    setPhoto(null)

    let savedName = user.displayName
    const newBio = bio === null ? undefined : bio.trim() || null
    const changes = {
      ...(name !== user.displayName ? { displayName: name } : {}),
      ...(newBio !== undefined && newBio !== (profile?.bio ?? null) ? { bio: newBio } : {})
    }
    if (Object.keys(changes).length) {
      const result = await window.glofly.profile.update(changes)
      if (!result.ok) return fail(result)
      savedName = result.data.displayName
      setProfile(result.data)
    }

    let savedStatus = status
    const text = statusText.trim()
    const statusChanges = {
      ...(statusChoice !== status.status ? { status: statusChoice } : {}),
      ...(text !== (status.statusText ?? '') ? { statusText: text } : {})
    }
    if (Object.keys(statusChanges).length) {
      const result = await window.glofly.status.set(statusChanges)
      if (!result.ok) return fail(result)
      savedStatus = result.data
    }

    setSaving(false)
    onSaved({ ...user, displayName: savedName, avatarVersion }, savedStatus)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Edit my profile"
        className="dialog profile-dialog edit-profile"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <ProfileHero
          sparks={['a']}
          flies={[
            { left: '88%', top: 56, size: 'small', rotate: 12 },
            { left: '72%', top: 16, size: 'big', rotate: -12 }
          ]}
          label="Edit profile"
          closeLabel="Close"
          onClose={onClose}
        />

        <div className="profile-body">
          <div className="profile-side">
            {/* The photo itself opens the file picker too; the small Edit pill makes that clear. */}
            <div className="photo-wrap">
              <button
                type="button"
                className="avatar avatar--me photo-button profile-photo"
                aria-label="Change profile photo"
                onClick={() => fileRef.current?.click()}
              >
                {photo?.kind === 'new' ? (
                  <img className="avatar-photo" src={photo.preview} alt="" draggable={false} />
                ) : photo?.kind === 'remove' ? (
                  initials(displayName || user.displayName)
                ) : (
                  <AvatarFace
                    id={user.id}
                    name={displayName || user.displayName}
                    avatarVersion={user.avatarVersion}
                  />
                )}
              </button>
              <button
                type="button"
                className="photo-edit"
                tabIndex={-1}
                aria-hidden="true"
                onClick={() => fileRef.current?.click()}
              >
                <PencilIcon size={13} strokeWidth={2.2} />
                Edit
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept={PHOTO_TYPES.join(',')}
              hidden
              onChange={(e) => void pickPhoto(e)}
            />
            {photo?.kind === 'new' && (
              <button
                type="button"
                className="photo-remove photo-adjust"
                onClick={() => setCropping(photo.original)}
              >
                Adjust position
              </button>
            )}
            {hasPhoto && (
              <button
                type="button"
                className="photo-remove"
                onClick={() => setPhoto(user.avatarVersion !== null ? { kind: 'remove' } : null)}
              >
                Remove photo
              </button>
            )}

            <div className="ep-field">
              <label htmlFor="ep-status">Status</label>
              <div className="ep-select-wrap">
                <span
                  className={`ep-select-dot ep-select-dot--${statusChoice}`}
                  aria-hidden="true"
                />
                <select
                  id="ep-status"
                  className="ep-select"
                  value={statusChoice}
                  onChange={(e) => setStatusChoice(e.target.value as MyStatusChoice)}
                >
                  {STATUS_CHOICES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {profile?.joinedAt && (
              <div className="profile-joined">
                <CalendarIcon size={15} strokeWidth={2} />
                Joined Glofly {shortDate(profile.joinedAt)}
              </div>
            )}
          </div>

          <div className="profile-main">
            <div className="ep-row">
              <div className="ep-field">
                <label htmlFor="ep-display">Display name</label>
                <input
                  ref={nameRef}
                  id="ep-display"
                  type="text"
                  className={nameError ? 'ep-input ep-input--error' : 'ep-input'}
                  value={displayName}
                  maxLength={DISPLAY_NAME_MAX}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? 'ep-display-error' : undefined}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                {nameError && (
                  <span id="ep-display-error" className="ep-error">
                    {nameError}
                  </span>
                )}
              </div>
              <div className="ep-field">
                <label htmlFor="ep-user">Username</label>
                <input
                  id="ep-user"
                  type="text"
                  className="ep-input"
                  value={`@${user.username}`}
                  readOnly
                  aria-describedby="ep-user-hint"
                />
                <span id="ep-user-hint" className="ep-hint">
                  Usernames are permanent
                </span>
              </div>
            </div>

            <div className="ep-field">
              <label htmlFor="ep-custom">Status message</label>
              <input
                id="ep-custom"
                type="text"
                className="ep-input"
                value={statusText}
                maxLength={STATUS_TEXT_MAX}
                placeholder="What are you up to?"
                onChange={(e) => setStatusText(e.target.value)}
              />
            </div>

            <div className="ep-field">
              <div className="ep-label-row">
                <label htmlFor="ep-bio">About me</label>
                <span className={bioLength > BIO_MAX ? 'ep-hint ep-count--over' : 'ep-hint'}>
                  {bioLength} / {BIO_MAX}
                </span>
              </div>
              <textarea
                id="ep-bio"
                className="ep-textarea"
                rows={4}
                maxLength={BIO_MAX}
                value={bio ?? ''}
                disabled={bio === null}
                placeholder="Tell friends a little about yourself"
                onChange={(e) => setBio(e.target.value)}
              />
            </div>

            {onMore && (
              <button type="button" className="profile-nickname-button" onClick={onMore}>
                <PencilIcon size={14} strokeWidth={2} />
                Header image, pronouns and your board
              </button>
            )}

            {error && (
              <p className="dialog-message" role="alert">
                {error}
              </p>
            )}

            <div className="ep-buttons">
              <button type="button" className="ep-cancel" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="ep-save" disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      </form>
      {cropping && (
        <PhotoCropper
          src={cropping.src}
          animated={cropping.type === 'image/gif'}
          onApply={({ data, preview }) => {
            setPhoto({ kind: 'new', data, type: 'image/webp', preview, original: cropping })
            setCropping(null)
          }}
          onUseWhole={() => {
            setPhoto({
              kind: 'new',
              data: cropping.data,
              type: cropping.type,
              preview: cropping.src,
              original: cropping
            })
            setCropping(null)
          }}
          onCancel={() => setCropping(null)}
        />
      )}
    </div>
  )
}
