import { useEffect, useRef, useState } from 'react'
import type { AccentChoice, SignedInUser, ThemeChoice } from '../../../preload/api-types'
import Avatar from './Avatar'
import PhotoCropper from './PhotoCropper'
import { QrImage } from '../screens/LoginExtras'
import { PHOTO_TYPES, readPhoto, type PickedPhoto } from '../lib/photoPick'
import { noteInvited } from '../lib/welcome'
import { copyFriendLink, useFriendLink } from '../lib/friendLink'
import { FRIEND_LINK_PITCH, friendLinkText } from '@glofly/shared/friendLinks'
import './WelcomeFlow.css'

// 0.7.5 welcome flow (Welcome.dc.html, approved Oct 20): a brand-new account gets three short
// steps over the app: a photo and what you're up to, your look (theme and accent, applied as
// you pick), and your first friend. Skip for now works on every step. Every button follows the
// accent you pick (Chip asked). Shown once per account on the device it was made on.

/** Where a phone camera goes to get the app (glofly.app's download section). */
const PHONE_DOWNLOAD_URL = 'https://glofly.app/#download'

const THEMES: { id: ThemeChoice; name: string }[] = [
  { id: 'system', name: 'Match my computer' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' }
]

// The same five as the mockup (Settings → General also has Graphite).
const ACCENTS: { id: AccentChoice; name: string; swatch: string }[] = [
  { id: 'orange', name: 'Glow Orange', swatch: '#f47a1f' },
  { id: 'red', name: 'Glofly Red', swatch: '#e0193a' },
  { id: 'lagoon', name: 'Glofly Lagoon', swatch: '#1789ad' },
  { id: 'violet', name: 'Glofly Violet', swatch: '#8b3fd9' },
  { id: 'blossom', name: 'Glofly Blossom', swatch: '#d63384' }
]

type Note = { kind: 'good' | 'bad'; text: string } | null

export default function WelcomeFlow({
  user,
  onUserChange,
  onFriendsChanged,
  onSessionExpired,
  onDone
}: {
  user: SignedInUser
  onUserChange: (changes: Pick<SignedInUser, 'displayName' | 'avatarVersion'>) => void
  onFriendsChanged: () => void
  onSessionExpired: () => void
  /** Finished or skipped (never shown again) */
  onDone: () => void
}): React.JSX.Element {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const firstName = user.displayName.trim().split(/\s+/)[0] || user.username

  // Step 1: photo and "What are you up to?"
  const [cropping, setCropping] = useState<PickedPhoto | null>(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoNote, setPhotoNote] = useState<Note>(null)
  const [statusText, setStatusText] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Step 2: the look, applied as soon as it's picked
  const [theme, setTheme] = useState<ThemeChoice | null>(null)
  const [accent, setAccent] = useState<AccentChoice | null>(null)
  useEffect(() => {
    void window.glofly.app.getSettings().then((s) => {
      if (!s) return
      setTheme(s.theme)
      setAccent(s.accent)
    })
  }, [])
  function pickLook(changes: { theme?: ThemeChoice; accent?: AccentChoice }): void {
    if (changes.theme) setTheme(changes.theme)
    if (changes.accent) setAccent(changes.accent)
    void window.glofly.app.setSettings(changes)
  }

  // Step 3: the first friend
  const [username, setUsername] = useState('')
  const [adding, setAdding] = useState(false)
  const [friendNote, setFriendNote] = useState<Note>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [inviteNote, setInviteNote] = useState<Note>(null)
  const [qrOpen, setQrOpen] = useState(false)
  // 0.8.0: "Copy your invite link" (the link is made when step 3 shows)
  const myLink = useFriendLink(user.id, step === 3)
  const [linkCopied, setLinkCopied] = useState(false)
  async function copyLink(): Promise<void> {
    if (!myLink.link) {
      setInviteNote({ kind: 'bad', text: myLink.problem ?? 'Your link is still being made.' })
      return
    }
    if (await copyFriendLink(myLink.link.code)) {
      noteInvited(user.id)
      setInviteNote(null)
      setLinkCopied(true)
      window.setTimeout(() => setLinkCopied(false), 1600)
    } else setInviteNote({ kind: 'bad', text: "Couldn't copy the link." })
  }

  // Each step starts at its heading, for keyboards and screen readers.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus()
  }, [step])

  // The last step says goodbye for a moment, then opens Glofly.
  useEffect(() => {
    if (step !== 4) return
    const t = window.setTimeout(onDone, 1600)
    return () => window.clearTimeout(t)
  }, [step, onDone])

  // Esc works like "Skip for now" (never while the photo is being positioned).
  const doneRef = useRef(onDone)
  useEffect(() => {
    doneRef.current = onDone
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented && !cropping) doneRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [cropping])

  async function pickPhoto(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const picked = await readPhoto(file)
    if ('error' in picked) {
      setPhotoNote({ kind: 'bad', text: picked.error })
      return
    }
    setPhotoNote(null)
    setCropping(picked)
  }

  async function uploadPhoto(data: ArrayBuffer, type: PickedPhoto['type']): Promise<void> {
    setCropping(null)
    setPhotoBusy(true)
    const result = await window.glofly.profile.setPhoto(data, type)
    setPhotoBusy(false)
    if (result.ok) {
      onUserChange({ displayName: user.displayName, avatarVersion: result.data.avatarVersion })
      setPhotoNote({ kind: 'good', text: 'Looking good!' })
    } else if (result.error === 'unauthorized') onSessionExpired()
    else setPhotoNote({ kind: 'bad', text: result.message })
  }

  async function next(): Promise<void> {
    if (step === 1 && statusText.trim()) {
      // Saved quietly: a problem here never stops the welcome.
      void window.glofly.status.set({ statusText: statusText.trim() })
    }
    setStep((s) => (s < 4 ? ((s + 1) as 2 | 3 | 4) : s))
  }

  async function addFriend(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const name = username.trim().replace(/^@/, '')
    if (!name || adding) return
    setAdding(true)
    setFriendNote(null)
    const result = await window.glofly.friends.sendRequest(name)
    setAdding(false)
    if (result.ok) {
      setFriendNote({
        kind: 'good',
        text:
          result.data.status === 'accepted'
            ? `You and @${name} are friends now!`
            : `Request sent to @${name}. They’ll show up once they accept.`
      })
      setUsername('')
      onFriendsChanged()
    } else if (result.error === 'unauthorized') onSessionExpired()
    else setFriendNote({ kind: 'bad', text: result.message })
  }

  async function invite(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!email.trim() || inviting) return
    setInviting(true)
    setInviteNote(null)
    const result = await window.glofly.friends.invite(email.trim())
    setInviting(false)
    if (result.ok) {
      noteInvited(user.id)
      setInviteNote({ kind: 'good', text: `Invite sent to ${email.trim()}.` })
      setEmail('')
    } else if (result.error === 'unauthorized') onSessionExpired()
    else setInviteNote({ kind: 'bad', text: result.message })
  }

  const note = (n: Note): React.ReactNode =>
    n && (
      <p
        className={n.kind === 'good' ? 'wf-note wf-note--good' : 'wf-note wf-note--bad'}
        role="status"
      >
        {n.text}
      </p>
    )

  return (
    <div className="dialog-backdrop wf-backdrop">
      <div
        className="dialog wf"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wf-title"
        aria-describedby="wf-steps"
      >
        <div className="wf-top">
          <div className="wf-dots" id="wf-steps" aria-label={`Step ${Math.min(step, 3)} of 3`}>
            {[1, 2, 3].map((n) => (
              <span
                key={n}
                className={
                  n === step ? 'wf-dot wf-dot--now' : n < step ? 'wf-dot wf-dot--done' : 'wf-dot'
                }
              />
            ))}
          </div>
          {step < 4 && (
            <button type="button" className="wf-skip" onClick={onDone}>
              Skip for now
            </button>
          )}
        </div>

        {step === 1 && (
          <div className="wf-step">
            <div>
              <h2 id="wf-title" ref={headingRef} tabIndex={-1}>
                Welcome to Glofly, {firstName}!
              </h2>
              <p className="wf-lede">Let’s make it feel like you. This takes about a minute.</p>
            </div>
            <div className="wf-photo">
              <span className="wf-avatar">
                <Avatar
                  id={user.id}
                  name={user.displayName}
                  avatarVersion={user.avatarVersion}
                  size={104}
                  mine
                />
              </span>
              <div className="wf-photo-side">
                <button
                  type="button"
                  className="wf-button"
                  disabled={photoBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  {photoBusy
                    ? 'Saving…'
                    : user.avatarVersion
                      ? 'Change profile photo'
                      : 'Add a profile photo'}
                </button>
                <span className="wf-hint">
                  Friends see it in chats and calls. You can change it any time.
                </span>
                {note(photoNote)}
                <input
                  ref={fileRef}
                  type="file"
                  accept={PHOTO_TYPES.join(',')}
                  hidden
                  onChange={(e) => void pickPhoto(e)}
                />
              </div>
            </div>
            <div className="wf-field">
              <label htmlFor="wf-status">
                What are you up to? <span>(optional)</span>
              </label>
              <input
                id="wf-status"
                value={statusText}
                maxLength={80}
                placeholder="Grinding ranked tonight"
                onChange={(e) => setStatusText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void next()
                }}
              />
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="wf-step">
            <div>
              <h2 id="wf-title" ref={headingRef} tabIndex={-1}>
                Pick your look
              </h2>
              <p className="wf-lede">Change it later in Settings → General.</p>
            </div>
            <div className="wf-themes" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.id}
                  className={theme === t.id ? 'wf-theme wf-theme--on' : 'wf-theme'}
                  onClick={() => pickLook({ theme: t.id })}
                >
                  <span className={`wf-theme-art wf-theme-art--${t.id}`} aria-hidden="true">
                    <span className="wf-theme-side" />
                    <span className="wf-theme-bubble" />
                    <span className="wf-theme-mine" />
                  </span>
                  <span className="wf-theme-name">{t.name}</span>
                </button>
              ))}
            </div>
            <div className="wf-accents" role="radiogroup" aria-label="Accent color">
              <span className="wf-accents-label" aria-hidden="true">
                Accent
              </span>
              {ACCENTS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={accent === a.id}
                  aria-label={a.name}
                  title={a.name}
                  className={accent === a.id ? 'wf-accent wf-accent--on' : 'wf-accent'}
                  style={{ background: a.swatch }}
                  onClick={() => pickLook({ accent: a.id })}
                />
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="wf-step">
            <div>
              <h2 id="wf-title" ref={headingRef} tabIndex={-1}>
                Find your friends
              </h2>
              <p className="wf-lede">Glofly is only about the people you add. Start with one.</p>
            </div>
            <form className="wf-find" onSubmit={(e) => void addFriend(e)}>
              <label htmlFor="wf-find" className="visually-hidden">
                Their username
              </label>
              <input
                id="wf-find"
                value={username}
                placeholder="Their username, like @maya"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setUsername(e.target.value)}
              />
              <button type="submit" className="wf-button" disabled={adding || !username.trim()}>
                {adding ? 'Adding…' : 'Add friend'}
              </button>
            </form>
            {note(friendNote)}
            <div className="wf-cards">
              <div className="wf-card">
                <strong>Not on Glofly yet?</strong>
                <span>{FRIEND_LINK_PITCH.replace("'", '’')}</span>
                <button
                  type="button"
                  className={linkCopied ? 'wf-outline wf-outline--done' : 'wf-outline'}
                  onClick={() => void copyLink()}
                  title={myLink.link ? `https://${friendLinkText(myLink.link.code)}` : undefined}
                >
                  {linkCopied ? 'Copied!' : 'Copy your invite link'}
                </button>
                {myLink.link && (
                  <span className="wf-link-text">{friendLinkText(myLink.link.code)}</span>
                )}
                {inviteOpen ? (
                  <form className="wf-invite" onSubmit={(e) => void invite(e)}>
                    <label htmlFor="wf-email" className="visually-hidden">
                      Their email
                    </label>
                    <input
                      id="wf-email"
                      type="email"
                      value={email}
                      placeholder="Their email"
                      autoFocus
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <button
                      type="submit"
                      className="wf-outline"
                      disabled={inviting || !email.trim()}
                    >
                      {inviting ? 'Sending…' : 'Send'}
                    </button>
                  </form>
                ) : (
                  <button type="button" className="wf-link" onClick={() => setInviteOpen(true)}>
                    Email an invite instead
                  </button>
                )}
                {note(inviteNote)}
              </div>
              <div className="wf-card">
                <strong>Glofly on your phone</strong>
                <span>
                  Scan to open the download page. Once it’s on your phone, you can sign in on any
                  computer by scanning a QR code.
                </span>
                {qrOpen ? (
                  <span className="wf-qr">
                    <QrImage
                      text={PHONE_DOWNLOAD_URL}
                      size={132}
                      label="QR code that opens Glofly's download page"
                    />
                  </span>
                ) : (
                  <button type="button" className="wf-outline" onClick={() => setQrOpen(true)}>
                    Show QR to get the app
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="wf-done" role="status">
            <span className="wf-done-glow" aria-hidden="true" />
            <h2 id="wf-title" ref={headingRef} tabIndex={-1}>
              You’re all set. Glow on!
            </h2>
          </div>
        )}

        {step < 4 && (
          <div className="wf-nav">
            <button
              type="button"
              className="wf-back"
              style={{ visibility: step > 1 ? 'visible' : 'hidden' }}
              onClick={() => setStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3) : s))}
            >
              Back
            </button>
            <button type="button" className="wf-button wf-next" onClick={() => void next()}>
              {step === 3 ? 'Start chatting' : 'Next'}
            </button>
          </div>
        )}
      </div>
      {cropping && (
        <PhotoCropper
          src={cropping.src}
          animated={cropping.type === 'image/gif'}
          onApply={({ data }) => void uploadPhoto(data, 'image/webp')}
          onUseWhole={() => void uploadPhoto(cropping.data, cropping.type)}
          onCancel={() => setCropping(null)}
        />
      )}
    </div>
  )
}
