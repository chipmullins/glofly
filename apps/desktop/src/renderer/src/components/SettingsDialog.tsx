import { useEffect, useRef, useState } from 'react'
import type { PrivacySettings, SignedInUser } from '../../../preload/api-types'
import { CloseIcon, LogOutIcon } from './icons'
import './dialogs.css'
import './SettingsDialog.css'

type SettingsDialogProps = {
  user: SignedInUser
  onClose: () => void
  onLogout: () => void
  onSessionExpired: () => void
}

type Row = { key: keyof PrivacySettings; label: string; desc?: string }

// Wording from the design (Settings → General → Privacy).
const PRIVACY: Row[] = [
  {
    key: 'readReceipts',
    label: 'Read receipts',
    desc: "Let people know when you've read their messages. If you turn this off, you won't see theirs either."
  },
  {
    key: 'showLastSeen',
    label: 'Show when I was last online',
    desc: 'Friends see “Last seen 2 hours ago” when you’re offline.'
  },
  { key: 'showTyping', label: 'Show when I’m typing' }
]

function Toggle({
  on,
  label,
  onChange
}: {
  on: boolean
  label: string
  onChange: (on: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={on ? 'toggle toggle--on' : 'toggle'}
      onClick={() => onChange(!on)}
    >
      <span className="toggle-knob" />
    </button>
  )
}

export default function SettingsDialog({
  user,
  onClose,
  onLogout,
  onSessionExpired
}: SettingsDialogProps): React.JSX.Element {
  const [settings, setSettings] = useState<PrivacySettings | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    window.glofly.settings.get().then((result) => {
      if (result.ok) setSettings(result.data)
      else if (result.error === 'unauthorized') onSessionExpired()
      else setNotice(result.message)
    })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onSessionExpired])

  async function change(key: keyof PrivacySettings, value: boolean): Promise<void> {
    if (!settings) return
    const before = settings
    setSettings({ ...settings, [key]: value }) // flip right away
    const result = await window.glofly.settings.set({ [key]: value })
    if (result.ok) {
      setSettings(result.data)
      setNotice(null)
    } else {
      setSettings(before) // put it back
      if (result.error === 'unauthorized') onSessionExpired()
      else setNotice(result.message)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="dialog settings"
      >
        <header className="settings-head">
          <h1 id="settings-title">Settings</h1>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close settings"
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="settings-body">
          <nav aria-label="Settings sections" className="settings-nav">
            <span className="settings-nav-item settings-nav-item--active" aria-current="page">
              <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#B8430A"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
                <circle cx="9" cy="6" r="2" fill="#FBDCC4" />
                <circle cx="15" cy="12" r="2" fill="#FBDCC4" />
                <circle cx="8" cy="18" r="2" fill="#FBDCC4" />
              </svg>
              General
            </span>
          </nav>

          <div className="settings-content">
            {notice && (
              <p className="dialog-message" role="alert">
                {notice}
              </p>
            )}

            <section className="settings-section">
              <h2>Privacy</h2>
              <div className="settings-card">
                {PRIVACY.map((row) => (
                  <div key={row.key} className="settings-row">
                    <div className="settings-row-text">
                      <span className="settings-row-label">{row.label}</span>
                      {row.desc && <span className="settings-row-desc">{row.desc}</span>}
                    </div>
                    {settings ? (
                      <Toggle
                        on={settings[row.key]}
                        label={row.label}
                        onChange={(on) => void change(row.key, on)}
                      />
                    ) : (
                      <span className="toggle toggle--loading" aria-hidden="true" />
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="settings-card settings-logout">
              <div className="settings-row-text">
                <span className="settings-row-label">Log out</span>
                <span className="settings-row-desc">
                  Signed in as @{user.username} on this device
                </span>
              </div>
              <button
                type="button"
                className="small-button small-button--quiet settings-logout-button"
                onClick={onLogout}
              >
                <LogOutIcon />
                Log out
              </button>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
